// HTTP API over the ledger. Every request is authenticated to a profile; writes go through the
// write-guard, reads are filtered to the profile's read scope.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Profiles } from '../auth/profiles.ts';
import { LoginThrottle, SESSION_COOKIE, SESSION_TTL_MS, Sessions, readCookie } from '../auth/sessions.ts';
import { Secrets } from '../auth/secrets.ts';
import { Users } from '../auth/users.ts';
import { SurfaceGuard, type SurfaceNote } from '../security/surfaceGuard.ts';
import { buildId } from './build.ts';
import { CONSTITUTION_DOC_REF, pointerLine, readConstitution } from '../domain/constitution.ts';
import { readScope } from '../domain/view.ts';
import { canRead, worldView } from '../domain/view.ts';
import type { LedgerEvent } from '../domain/state.ts';
import { LedgerError } from '../ledger/errors.ts';
import type { Profile } from '../ledger/guard.ts';
import type { Ledger } from '../ledger/ledger.ts';

const MAX_BODY = 64 * 1024;
const HEARTBEAT_MS = 25_000;
// A real filesystem path (not a URL pathname), so folders with spaces and Windows drives work.
const PUBLIC_DIR = resolve(import.meta.dirname, '../../public') + sep;
const WORLD_DIR = resolve(import.meta.dirname, '../..');
const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Hardened headers on every response. Scripts and styles only from this origin: no inline code runs. */
const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

export interface AppOptions {
  users?: Users;
  secrets?: Secrets;
  surface?: SurfaceGuard;
  sessions?: Sessions;
  throttle?: LoginThrottle;
  /** Mark the session cookie Secure (default true; set false only for plain-http local testing). */
  cookieSecure?: boolean;
  /** Take the client IP from X-Forwarded-For (only behind a trusted reverse proxy). */
  trustProxy?: boolean;
  /** The World Constitution file (default docs/constitution/WORLD-CONSTITUTION.md). */
  constitutionPath?: string;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

/** Static files, cached in memory with an ETag and a gzip copy; reloaded when the file changes on disk. */
const staticCache = new Map<string, { mtimeMs: number; body: Buffer; gzip: Buffer; etag: string }>();

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const type = STATIC_TYPES[extname(file)];
  const full = normalize(join(PUBLIC_DIR, file));
  if (!type || !full.startsWith(PUBLIC_DIR)) return false;
  try {
    const { mtimeMs } = await stat(full);
    let entry = staticCache.get(full);
    if (!entry || entry.mtimeMs !== mtimeMs) {
      const body = await readFile(full);
      entry = { mtimeMs, body, gzip: gzipSync(body), etag: `"${createHash('sha1').update(body).digest('base64url')}"` };
      staticCache.set(full, entry);
    }
    // Vendored libraries live in versioned folders (vendor/three-r186), so they never change: cache for a year.
    // The dashboard's own files revalidate each load and come back as 304 when unchanged.
    const cacheControl = file.startsWith('vendor/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    const base = { 'content-type': type, 'cache-control': cacheControl, etag: entry.etag, vary: 'accept-encoding', ...SECURITY_HEADERS };
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, base);
      res.end();
      return true;
    }
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    res.writeHead(200, { ...base, ...(gzip ? { 'content-encoding': 'gzip' } : {}) });
    res.end(gzip ? entry.gzip : entry.body);
    return true;
  } catch {
    return false;
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new LedgerError('INVALID', 'request body too large');
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new LedgerError('INVALID', 'request body must be JSON');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new LedgerError('INVALID', 'request body must be a JSON object');
  return body;
}

/** Bots authenticate with a bearer token; the dashboard with a session cookie. */
function authenticate(req: IncomingMessage, profiles: Profiles, sessions: Sessions): { profile: Profile; viaCookie: boolean } {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) {
    const profile = profiles.byToken(header.slice(7).trim());
    if (!profile) throw new LedgerError('UNAUTHENTICATED', 'invalid bearer token');
    return { profile, viaCookie: false };
  }
  const profileId = sessions.get(readCookie(req.headers.cookie, SESSION_COOKIE));
  const profile = profileId ? profiles.byId(profileId) : undefined;
  if (!profile) throw new LedgerError('UNAUTHENTICATED', 'not signed in');
  return { profile, viaCookie: true };
}

const intParam = (url: URL, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(url.searchParams.get(name) ?? fallback);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
};

export function createApp(ledger: Ledger, profiles: Profiles, opts: AppOptions = {}): Server {
  const users = opts.users ?? new Users([]);
  const secrets = opts.secrets ?? new Secrets(null);
  const surface = opts.surface ?? new SurfaceGuard(ledger.db, ledger.state, () => ledger.clock());
  const sessions = opts.sessions ?? new Sessions();
  const throttle = opts.throttle ?? new LoginThrottle();
  const secure = opts.cookieSecure ?? true;
  const cookie = (value: string, maxAgeS: number) =>
    `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeS}${secure ? '; Secure' : ''}`;
  const clientIp = (req: IncomingMessage) =>
    // Behind a proxy, the address the proxy itself appended (the last one) is the only one to trust.
    (opts.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1)!.trim() : '') || req.socket.remoteAddress || 'unknown';

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        if (await serveStatic(req, res, url.pathname)) return;
        return send(res, 404, { error: 'NOT_FOUND', message: 'no such page' });
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        // Re-read each time, so a `git pull` shows up without restarting the server.
        return send(res, 200, { ok: true, lastSeq: ledger.state.lastSeq, build: buildId(WORLD_DIR) });
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const ip = clientIp(req);
        if (throttle.blocked(ip)) return send(res, 429, { error: 'THROTTLED', message: 'too many failed sign-ins; try again in 15 minutes' });
        const body = (await readJson(req)) as { username?: unknown; password?: unknown };
        const profileId =
          typeof body.username === 'string' && typeof body.password === 'string' ? users.verify(body.username, body.password) : undefined;
        const profile = profileId ? profiles.byId(profileId) : undefined;
        if (!profile) {
          throttle.fail(ip);
          return send(res, 401, { error: 'UNAUTHENTICATED', message: 'wrong username or password' });
        }
        throttle.succeed(ip);
        return send(res, 200, profile, { 'set-cookie': cookie(sessions.create(profile.id), SESSION_TTL_MS / 1000) });
      }
      if (req.method === 'GET' && url.pathname === '/api/session') {
        // Lets the dashboard ask "am I signed in?" without an error response.
        const profileId = sessions.get(readCookie(req.headers.cookie, SESSION_COOKIE));
        return send(res, 200, { profile: (profileId && profiles.byId(profileId)) || null });
      }
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        sessions.destroy(readCookie(req.headers.cookie, SESSION_COOKIE));
        return send(res, 200, { ok: true }, { 'set-cookie': cookie('', 0) });
      }

      const { profile, viaCookie } = authenticate(req, profiles, sessions);
      // CSRF: a browser write must carry a custom header, which another site cannot send without CORS.
      if (viaCookie && req.method !== 'GET' && req.headers['x-world-request'] !== '1') {
        throw new LedgerError('FORBIDDEN', 'missing x-world-request header');
      }

      // Shared-surface guard: Hermes' gateway (and Marc, for testing) ask before any agent writes a note.
      if (req.method === 'POST' && url.pathname === '/api/surface/check') {
        if (profile.role !== 'gateway' && profile.role !== 'owner') throw new LedgerError('FORBIDDEN', 'only the surface gateway may ask');
        const note = (await readJson(req)) as SurfaceNote;
        return send(res, 200, surface.check(note));
      }
      if (profile.role === 'gateway') throw new LedgerError('FORBIDDEN', 'the surface gateway may only call /api/surface/check');

      if (req.method === 'GET' && url.pathname === '/api/me') {
        return send(res, 200, profile);
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const scope = readScope(profile, ledger.state);
        // A Mayor sees flags on notes aimed at their city, but the text only when their own agent wrote it:
        // a note the cross-city guard blocked must not reach the other city after all.
        const surfaceFlags = surface
          .recentFlags(50)
          .filter((f) => scope === '*' || f.writerCity === scope || f.city === scope)
          .map((f) => (scope === '*' || f.writerCity === scope ? f : { ...f, excerpt: '', writer: '' }));
        return send(res, 200, { ...worldView(ledger.state, profile, ledger.clock()), surfaceFlags });
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const after = intParam(url, 'after', 0);
        const limit = intParam(url, 'limit', 500, 1000);
        const events = ledger.read(after, limit);
        const next = events.at(-1)?.seq ?? after;
        return send(res, 200, { events: events.filter((e) => canRead(profile, e, ledger.state)), next });
      }
      if (req.method === 'POST' && url.pathname === '/api/events') {
        const input = (await readJson(req)) as Record<string, unknown>;
        const event = ledger.append(profile, {
          type: String(input.type ?? ''),
          city: input.city as string,
          subject: (input.subject as string | undefined) ?? null,
          payload: input.payload,
          authorizedBy: (input.authorizedBy as number | undefined) ?? null,
        });
        return send(res, 201, event);
      }
      if (req.method === 'GET' && url.pathname === '/api/names') {
        if (profile.role !== 'owner') throw new LedgerError('FORBIDDEN', 'owner only');
        return send(res, 200, { names: ledger.suggestNames(Math.max(1, intParam(url, 'count', 5, 20))) });
      }
      if (req.method === 'POST' && url.pathname === '/api/secrets') {
        // Write-only: stores e.g. a department's bot token and returns only its name for the ledger.
        if (profile.role !== 'owner') throw new LedgerError('FORBIDDEN', 'owner only');
        const body = (await readJson(req)) as { purpose?: unknown; value?: unknown };
        if (typeof body.value !== 'string' || !body.value.trim() || body.value.length > 500) throw new LedgerError('INVALID', 'value must be text (max 500)');
        return send(res, 201, { ref: secrets.put(typeof body.purpose === 'string' ? body.purpose : 'secret', body.value.trim()) });
      }
      if (req.method === 'GET' && url.pathname === '/api/verify') {
        if (profile.role !== 'owner') throw new LedgerError('FORBIDDEN', 'owner only');
        return send(res, 200, ledger.verify());
      }
      if (req.method === 'GET' && url.pathname === '/api/constitution') {
        // Every profile is bound by it, so every signed-in profile may read it.
        const file = readConstitution(opts.constitutionPath);
        const { current, history } = ledger.state.constitution;
        return send(res, 200, {
          docRef: CONSTITUTION_DOC_REF,
          file: file && { text: file.text, sha256: file.sha256 },
          ratified: current,
          // In force only when the file on disk is exactly the ratified one.
          inForce: !!(file && current && file.sha256 === current.sha256),
          pointer: current ? pointerLine(current.version, current.sha256) : null,
          history,
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/stream') {
        return stream(req, res, url, ledger, profile, surface);
      }
      send(res, 404, { error: 'NOT_FOUND', message: 'no such route' });
    } catch (err) {
      if (err instanceof LedgerError) return send(res, err.status, { error: err.code, message: err.message });
      console.error(err);
      send(res, 500, { error: 'INTERNAL', message: 'internal error' });
    }
  });
}

/** Server-sent events: replay from Last-Event-ID / ?after, then live. */
function stream(req: IncomingMessage, res: ServerResponse, url: URL, ledger: Ledger, profile: Profile, surface: SurfaceGuard) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    ...SECURITY_HEADERS,
  });
  // Send something at once so the browser knows the stream is open, even when nothing is replayed.
  res.write(': connected\n\n');
  const write = (e: LedgerEvent) => {
    if (canRead(profile, e, ledger.state)) res.write(`id: ${e.seq}\nevent: ledger\ndata: ${JSON.stringify(e)}\n\n`);
  };
  const lastId = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? ledger.state.lastSeq);
  let cursor = Number.isInteger(lastId) && lastId >= 0 ? lastId : ledger.state.lastSeq;
  for (let batch = ledger.read(cursor, 1000); batch.length; batch = ledger.read(cursor, 1000)) {
    batch.forEach(write);
    cursor = batch.at(-1)!.seq;
  }
  ledger.events.on('event', write);
  // Shared-surface guard flags are not ledger events; tell readers in scope so their Security page refreshes.
  const flag = (f: { writerCity: string | null; city: string | null }) => {
    const scope = readScope(profile, ledger.state);
    if (scope === '*' || f.writerCity === scope || f.city === scope) res.write('event: surface\ndata: {}\n\n');
  };
  surface.events.on('flag', flag);
  const beat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(beat);
    ledger.events.off('event', write);
    surface.events.off('flag', flag);
  });
}
