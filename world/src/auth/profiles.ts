// Writer/reader profiles with per-profile write scope. Tokens are stored only as sha256 hashes.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { ROLES, WORLD_TAG } from '../domain/model.ts';
import type { Profile } from '../ledger/guard.ts';

export interface ProfileRecord extends Profile {
  tokenSha256: string;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

/** Enforce the role/scope shape so a mis-edited config cannot widen anyone's reach. */
export function checkProfile(p: ProfileRecord): ProfileRecord {
  const where = `profile "${p.id}"`;
  if (!p.id || typeof p.id !== 'string') throw new Error('profile id is required');
  if (!ROLES.includes(p.role)) throw new Error(`${where}: unknown role ${p.role}`);
  if (!Array.isArray(p.writeScope)) throw new Error(`${where}: writeScope must be a list`);
  if (!/^[0-9a-f]{64}$/.test(p.tokenSha256)) throw new Error(`${where}: tokenSha256 must be a sha256 hex digest`);
  const scope = p.writeScope;
  switch (p.role) {
    case 'owner':
    case 'dm':
      if (scope.length !== 1 || scope[0] !== '*') throw new Error(`${where}: ${p.role} writeScope must be ["*"]`);
      break;
    case 'mayor':
      if (scope.length !== 1 || scope[0] === '*' || scope[0] === WORLD_TAG) {
        throw new Error(`${where}: a mayor's writeScope is exactly its own city`);
      }
      break;
    case 'architect':
      if (scope.length !== 0) throw new Error(`${where}: Bob is read-only; writeScope must be []`);
      break;
  }
  return p;
}

export class Profiles {
  private readonly list: ProfileRecord[];

  constructor(list: ProfileRecord[]) {
    this.list = list.map(checkProfile);
    const ids = new Set<string>();
    for (const p of this.list) {
      if (ids.has(p.id)) throw new Error(`duplicate profile id ${p.id}`);
      ids.add(p.id);
    }
  }

  static load(path: string): Profiles {
    if (!existsSync(path)) return new Profiles([]);
    return new Profiles(JSON.parse(readFileSync(path, 'utf8')));
  }

  get size() {
    return this.list.length;
  }

  byToken(token: string | undefined): Profile | undefined {
    if (!token) return undefined;
    const digest = Buffer.from(hashToken(token), 'hex');
    for (const p of this.list) {
      if (timingSafeEqual(digest, Buffer.from(p.tokenSha256, 'hex'))) {
        const { tokenSha256: _omit, ...profile } = p;
        return profile;
      }
    }
    return undefined;
  }
}
