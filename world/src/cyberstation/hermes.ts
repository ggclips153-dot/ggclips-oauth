// CyberStation's link to Hermes (A31; plan step 1). Each world agent's work runs on its own Hermes profile, over
// Hermes's OpenAI-compatible API server, so it answers with its own persona, tools and Mnemosyne memory. Nothing
// is copied (A21). The settings (the server's address and each profile's API_SERVER_KEY) live in
// config/hermes.json, written only by `npm run hermes` in Marc's own window. Keys never leave this server.
import { existsSync, readFileSync } from 'node:fs';
import { warnIfShared, writePrivateJson } from '../auth/files.ts';

export interface HermesSettings {
  /** Hermes's API server as the PC reaches it, e.g. http://<VPS Tailscale IP>:8642 (over Tailscale). */
  url: string;
  /**
   * One API server for every profile (Hermes's gateway.multiplex_profiles): routes are /p/<profile>/v1/…
   * Otherwise the server runs one profile and routes are /v1/….
   */
  multiplex: boolean;
  /** Each profile's API_SERVER_KEY, by profile name. */
  keys: Record<string, string>;
}

export const EMPTY_SETTINGS: HermesSettings = { url: '', multiplex: true, keys: {} };

export function loadHermesSettings(path: string): HermesSettings {
  if (!existsSync(path)) return { ...EMPTY_SETTINGS, keys: {} };
  warnIfShared(path);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<HermesSettings>;
  return { url: String(raw.url ?? '').replace(/\/+$/, ''), multiplex: raw.multiplex !== false, keys: { ...(raw.keys ?? {}) } };
}

export function saveHermesSettings(path: string, s: HermesSettings) {
  writePrivateJson(path, s);
}

/** Why a turn couldn't run on Hermes, in words Marc can act on. Never contains a key. */
export class HermesError extends Error {}

const TURN_TIMEOUT_MS = 10 * 60_000; // an agent may use its tools for a while before it answers

export class HermesLink {
  private readonly settings: HermesSettings;
  private readonly fetchImpl: typeof fetch;

  constructor(settings: HermesSettings, fetchImpl: typeof fetch = fetch) {
    this.settings = settings;
    this.fetchImpl = fetchImpl;
  }

  /** Hermes's address is set. */
  configured(): boolean {
    return !!this.settings.url;
  }

  /** This profile's turns can be sent: the address and its key are both set. */
  canReach(profile: string | null | undefined): profile is string {
    return !!profile && this.configured() && !!this.keyFor(profile);
  }

  /** Profiles that have a key on this PC (names only). */
  profiles(): string[] {
    return Object.keys(this.settings.keys).sort();
  }

  private keyFor(profile: string): string | undefined {
    const k = Object.keys(this.settings.keys).find((name) => name.toLowerCase() === profile.toLowerCase());
    return k ? this.settings.keys[k] : undefined;
  }

  /** The profile's OpenAI-style base: /p/<profile>/v1 on a multiplexed server, else /v1. */
  base(profile: string): string {
    return this.settings.multiplex ? `${this.settings.url}/p/${encodeURIComponent(profile)}/v1` : `${this.settings.url}/v1`;
  }

  /**
   * One turn: Marc's words to the agent, answered by its Hermes profile. The session is the agent's world ID, so
   * the conversation continues from one message to the next.
   */
  async ask(profile: string, sessionId: string, text: string, { timeoutMs = TURN_TIMEOUT_MS } = {}): Promise<string> {
    const key = this.keyFor(profile);
    if (!this.configured()) throw new HermesError("Hermes's address isn't set on this PC (npm.cmd run hermes -- url <address>)");
    if (!key) throw new HermesError(`no key for Hermes profile "${profile}" on this PC (npm.cmd run hermes -- key ${profile})`);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base(profile)}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-hermes-session-id': sessionId },
        body: JSON.stringify({ model: profile, messages: [{ role: 'user', content: text }], stream: false }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const why = (err as Error).name === 'TimeoutError' ? `no answer within ${Math.round(timeoutMs / 60_000)} minutes` : (err as Error).message;
      throw new HermesError(`couldn't reach Hermes at ${this.settings.url} (${why})`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new HermesError(`Hermes refused the key for "${profile}" (${res.status}); enter it again with npm.cmd run hermes -- key ${profile}`);
    }
    if (res.status === 404) throw new HermesError(`Hermes has no profile "${profile}" at ${this.base(profile)} (404)`);
    if (!res.ok) throw new HermesError(`Hermes answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const answer = body.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim()) throw new HermesError(`Hermes sent no answer for "${profile}"`);
    return answer;
  }

  /** Is the API server up? (Its health check needs no key.) */
  async health(timeoutMs = 5000): Promise<{ ok: boolean; detail: string }> {
    if (!this.configured()) return { ok: false, detail: 'no address set' };
    try {
      const res = await this.fetchImpl(`${this.settings.url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
      return { ok: res.ok, detail: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  /** Does Hermes accept this profile's key? Lists its models, which needs the key and sends no turn. */
  async checkKey(profile: string, timeoutMs = 10_000): Promise<{ ok: boolean; detail: string }> {
    const key = this.keyFor(profile);
    if (!key) return { ok: false, detail: 'no key on this PC' };
    try {
      const res = await this.fetchImpl(`${this.base(profile)}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs) });
      return { ok: res.ok, detail: res.ok ? 'key accepted' : `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}
