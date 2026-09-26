// StarNet: the operating system the agents run on (A20). Each city gets its own StarNet station, run from
// StarNet's source (https://github.com/androoAGI/starnet) as a local sidecar with its own port and workspace.
// The dashboard shows the station when you open a city, and agents' conversations run through it: real model
// calls, tools and costs, with StarNet's own consent rules. Stations bind to 127.0.0.1 only.
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface StationConfig {
  port: number;
  /** Bearer key for StarNet's /v1 API (it refuses to enable /v1 without one of 16+ characters). */
  apiKey: string;
}
export type StationState = 'starting' | 'up' | 'down' | 'stopped';
export interface StationStatus {
  cityId: string;
  port: number;
  url: string;
  state: StationState;
  error: string | null;
  since: string;
}

export interface StationOptions {
  /** Path to a StarNet source checkout (the folder with sidecar/index.js). */
  starnetDir: string;
  /** Where each city's workspace lives (a folder per city). */
  workspacesDir: string;
  /** Ports and keys per city, kept across restarts (mode 600). */
  configPath: string;
  basePort?: number;
  /** Extra environment for every station (e.g. STARNET_OPENROUTER_KEY). */
  env?: Record<string, string>;
  log?: (m: string) => void;
  /** Health check interval. */
  everyMs?: number;
  /** Called when a station's state changes. */
  onChange?: () => void;
}

/** A city's station key: demo and real worlds never share a station. */
const keyOf = (cityId: string, scope: string) => `${scope}:${cityId}`;

export class Stations {
  private readonly opts: Required<Omit<StationOptions, 'env'>> & { env: Record<string, string> };
  private readonly config: Record<string, StationConfig>;
  private readonly procs = new Map<string, ChildProcess>();
  private readonly status = new Map<string, StationStatus>();
  private readonly restarts = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;

  private readonly scope: string;

  constructor(scope: string, opts: StationOptions) {
    this.scope = scope;
    this.opts = { basePort: 8801, log: (m) => console.log(m), everyMs: 10_000, env: {}, onChange: () => {}, ...opts };
    this.config = existsSync(opts.configPath) ? JSON.parse(readFileSync(opts.configPath, 'utf8')) : {};
  }

  /** Is StarNet's source where we were told? */
  static check(starnetDir: string): string | null {
    return existsSync(join(starnetDir, 'sidecar', 'index.js')) ? null : `no StarNet source at ${starnetDir} (expected sidecar/index.js)`;
  }

  private configFor(cityId: string): StationConfig {
    const k = keyOf(cityId, this.scope);
    if (!this.config[k]) {
      const used = new Set(Object.values(this.config).map((c) => c.port));
      let port = this.opts.basePort;
      while (used.has(port)) port++;
      this.config[k] = { port, apiKey: randomBytes(24).toString('hex') };
      mkdirSync(dirname(this.opts.configPath), { recursive: true });
      writeFileSync(this.opts.configPath, `${JSON.stringify(this.config, null, 2)}\n`, { mode: 0o600 });
      chmodSync(this.opts.configPath, 0o600);
    }
    return this.config[k]!;
  }

  private set(cityId: string, state: StationState, error: string | null = null) {
    const cfg = this.configFor(cityId);
    const prev = this.status.get(cityId);
    if (prev && prev.state === state && prev.error === error) return;
    this.status.set(cityId, { cityId, port: cfg.port, url: `http://127.0.0.1:${cfg.port}/`, state, error, since: new Date().toISOString() });
    if (state !== 'starting') this.opts.log(`StarNet station for ${cityId} (port ${cfg.port}): ${state}${error ? ` (${error})` : ''}`);
    this.opts.onChange();
  }

  /** Start the city's station (no-op if it's running). */
  start(cityId: string) {
    if (this.procs.has(cityId) || this.stopping) return;
    const cfg = this.configFor(cityId);
    const workspace = resolve(this.opts.workspacesDir, cityId);
    mkdirSync(workspace, { recursive: true });
    const child = spawn(process.execPath, [join(this.opts.starnetDir, 'sidecar', 'index.js')], {
      cwd: this.opts.starnetDir,
      env: {
        ...process.env,
        ...this.opts.env,
        STARNET_PORT: String(cfg.port),
        STARNET_WORKSPACES: workspace,
        STARNET_API_KEY: cfg.apiKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.procs.set(cityId, child);
    this.set(cityId, 'starting');
    const tag = `[starnet ${cityId}:${cfg.port}]`;
    // Stations are chatty; pass on only their problems (set STARNET_VERBOSE=1 for everything).
    const verbose = process.env.STARNET_VERBOSE === '1';
    const lines = (buf: Buffer) => String(buf).split('\n').filter((l) => l.trim() && (verbose || (/\b(error|failed|cannot|EADDRINUSE)\b/i.test(l) && !l.startsWith('[exec-env]')))).forEach((l) => this.opts.log(`${tag} ${l}`));
    child.stdout?.on('data', lines);
    child.stderr?.on('data', lines);
    child.on('exit', (code, signal) => {
      this.procs.delete(cityId);
      if (this.stopping) return this.set(cityId, 'stopped');
      this.set(cityId, 'down', `station stopped (${signal ?? `exit ${code}`})`);
      // Restart with backoff: 2s, 4s … up to a minute.
      const n = (this.restarts.get(cityId) ?? 0) + 1;
      this.restarts.set(cityId, n);
      setTimeout(() => this.start(cityId), Math.min(60_000, 1000 * 2 ** n)).unref();
    });
    child.on('error', (err) => this.set(cityId, 'down', err.message));
  }

  /** Start a station for each city and keep checking they're healthy. */
  startAll(cityIds: string[]) {
    for (const c of cityIds) this.start(c);
    this.timer ??= setInterval(() => void this.checkHealth(), this.opts.everyMs);
    this.timer.unref?.();
    setTimeout(() => void this.checkHealth(), 1500).unref();
  }

  async checkHealth() {
    await Promise.all([...this.procs.keys()].map(async (cityId) => {
      const cfg = this.configFor(cityId);
      try {
        const res = await fetch(`http://127.0.0.1:${cfg.port}/health`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`health check: HTTP ${res.status}`);
        this.restarts.set(cityId, 0);
        this.set(cityId, 'up');
      } catch (err) {
        const cur = this.status.get(cityId);
        if (cur?.state !== 'starting' || Date.now() - Date.parse(cur.since) > 30_000) this.set(cityId, 'down', (err as Error).message);
      }
    }));
  }

  statuses(): Record<string, StationStatus> {
    return Object.fromEntries(this.status);
  }

  isUp(cityId: string) {
    return this.status.get(cityId)?.state === 'up';
  }

  /**
   * One turn of a conversation with an agent, run on its city's station. The session id is the agent's ID, so
   * StarNet keeps one agent per world agent, with its own transcript and memory across turns.
   */
  async ask(cityId: string, agentId: string, system: string, text: string, { timeoutMs = 180_000 } = {}): Promise<string> {
    const cfg = this.configFor(cityId);
    const res = await fetch(`http://127.0.0.1:${cfg.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}`, 'x-starnet-session-id': agentId },
      body: JSON.stringify({ model: 'starnet-agent', stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: text }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok) throw new Error(body?.error?.message ?? `StarNet answered HTTP ${res.status}`);
    const answer = body?.choices?.[0]?.message?.content;
    if (body?.starnet && body.starnet.completed === false && !answer) throw new Error(`StarNet run ${body.starnet.status ?? 'failed'}${body.starnet.error ? `: ${body.starnet.error}` : ''}`);
    if (typeof answer !== 'string' || !answer.trim()) throw new Error('StarNet returned no answer');
    return answer.trim();
  }

  stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    for (const p of this.procs.values()) p.kill('SIGTERM');
  }
}
