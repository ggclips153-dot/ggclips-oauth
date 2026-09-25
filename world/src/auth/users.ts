// Dashboard logins. A user is a username + password bound to one profile (its role and scope).
// Passwords are stored only as scrypt hashes. Bots keep using bearer tokens (profiles.ts).
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export interface UserRecord {
  username: string;
  profileId: string;
  salt: string;
  hash: string;
}

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;
export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): { salt: string; hash: string } {
  return { salt, hash: scryptSync(password, salt, KEYLEN, SCRYPT).toString('hex') };
}

// Burn the same time for unknown usernames, so response time doesn't reveal which usernames exist.
const DUMMY = hashPassword('dummy-password-for-timing');

export class Users {
  private readonly byName = new Map<string, UserRecord>();

  constructor(list: UserRecord[]) {
    for (const u of list) {
      if (!u.username || !u.profileId || !/^[0-9a-f]+$/.test(u.salt) || !/^[0-9a-f]{128}$/.test(u.hash)) {
        throw new Error(`invalid user record: ${u.username}`);
      }
      this.byName.set(u.username.toLowerCase(), u);
    }
  }

  static load(path: string): Users {
    return new Users(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []);
  }

  get size() {
    return this.byName.size;
  }

  /** The profile id for a correct username + password, else undefined. */
  verify(username: string, password: string): string | undefined {
    const user = this.byName.get(username.trim().toLowerCase());
    const { hash } = hashPassword(password, user?.salt ?? DUMMY.salt);
    const ok = timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user?.hash ?? DUMMY.hash, 'hex'));
    return ok && user ? user.profileId : undefined;
  }
}
