// Bot tokens and other secrets. Kept in config/secrets.json (mode 600, gitignored), never in the
// ledger: the ledger only ever stores the secret's name (e.g. a department's `botTokenRef`).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export class Secrets {
  private readonly path: string | null;
  private readonly map: Record<string, string>;

  constructor(path: string | null) {
    this.path = path;
    this.map = path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  }

  /** Store a secret under a fresh name and return the name. Values are write-only through the API. */
  put(prefix: string, value: string): string {
    const clean = prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'secret';
    const ref = `${clean}-${randomBytes(3).toString('hex')}`;
    this.map[ref] = value;
    if (this.path) writeFileSync(this.path, `${JSON.stringify(this.map, null, 2)}\n`, { mode: 0o600 });
    return ref;
  }

  has(ref: string) {
    return Object.hasOwn(this.map, ref);
  }
}
