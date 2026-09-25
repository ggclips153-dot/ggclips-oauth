// HTTP API over the ledger. Every request is authenticated to a profile; writes go through the
// write-guard, reads are filtered to the profile's read scope.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Profiles } from '../auth/profiles.ts';
import { canRead, worldView } from '../domain/view.ts';
import type { LedgerEvent } from '../domain/state.ts';
import { LedgerError } from '../ledger/errors.ts';
import type { Profile } from '../ledger/guard.ts';
import type { Ledger } from '../ledger/ledger.ts';

const MAX_BODY = 64 * 1024;
const HEARTBEAT_MS = 25_000;

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new LedgerError('INVALID', 'request body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new LedgerError('INVALID', 'request body must be JSON');
  }
}

function authenticate(req: IncomingMessage, profiles: Profiles): Profile {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  const profile = profiles.byToken(token);
  if (!profile) throw new LedgerError('UNAUTHENTICATED', 'missing or invalid bearer token');
  return profile;
}

const intParam = (url: URL, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(url.searchParams.get(name) ?? fallback);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
};

export function createApp(ledger: Ledger, profiles: Profiles): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, { ok: true, lastSeq: ledger.state.lastSeq });
      }
      const profile = authenticate(req, profiles);

      if (req.method === 'GET' && url.pathname === '/api/me') {
        return send(res, 200, profile);
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return send(res, 200, worldView(ledger.state, profile));
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
      if (req.method === 'GET' && url.pathname === '/api/verify') {
        if (profile.role !== 'owner') throw new LedgerError('FORBIDDEN', 'owner only');
        return send(res, 200, ledger.verify());
      }
      if (req.method === 'GET' && url.pathname === '/api/stream') {
        return stream(req, res, url, ledger, profile);
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
function stream(req: IncomingMessage, res: ServerResponse, url: URL, ledger: Ledger, profile: Profile) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
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
  const beat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(beat);
    ledger.events.off('event', write);
  });
}
