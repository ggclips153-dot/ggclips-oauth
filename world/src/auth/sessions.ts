// Browser sessions for the dashboard, plus login throttling.
// Sessions live in memory: a server restart signs everyone out (by design; nothing to leak on disk).
import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'world_session';
export const SESSION_TTL_MS = 7 * 24 * 3_600_000;

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export class Sessions {
  /** sha256(token) -> session. The raw token only ever lives in the user's cookie. */
  private readonly map = new Map<string, { profileId: string; expires: number }>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  create(profileId: string): string {
    const token = randomBytes(32).toString('base64url');
    this.map.set(digest(token), { profileId, expires: this.now() + SESSION_TTL_MS });
    return token;
  }

  /** The session's profile id; slides the expiry forward while in use. */
  get(token: string | undefined): string | undefined {
    if (!token) return undefined;
    const key = digest(token);
    const s = this.map.get(key);
    if (!s) return undefined;
    if (s.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    s.expires = this.now() + SESSION_TTL_MS;
    return s.profileId;
  }

  destroy(token: string | undefined) {
    if (token) this.map.delete(digest(token));
  }
}

/** 5 failed logins within 15 minutes locks that client out for 15 minutes. */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();
  private readonly now: () => number;
  static readonly MAX = 5;
  static readonly WINDOW_MS = 15 * 60_000;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private recent(key: string) {
    const cutoff = this.now() - LoginThrottle.WINDOW_MS;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    this.failures.set(key, list);
    return list;
  }

  blocked(key: string) {
    return this.recent(key).length >= LoginThrottle.MAX;
  }

  fail(key: string) {
    this.recent(key).push(this.now());
  }

  succeed(key: string) {
    this.failures.delete(key);
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}
