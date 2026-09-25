// Private config files (secrets, profiles, users): written atomically and readable only by the owner.
import { chmodSync, existsSync, renameSync, statSync, writeFileSync } from 'node:fs';

/** Write via a temp file + rename, so a crash never leaves half-written JSON; always mode 600. */
export function writePrivateJson(path: string, value: unknown) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** Warn (once, at load) when a private file is readable by others, e.g. after copying it to a server. */
export function warnIfShared(path: string) {
  if (process.platform === 'win32' || !existsSync(path)) return;
  if (statSync(path).mode & 0o077) console.warn(`warning: ${path} is readable by other users; run: chmod 600 "${path}"`);
}
