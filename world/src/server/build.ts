// Which version of the world is running: the git commit of this checkout, read straight from .git
// (best effort; "unknown" outside a git checkout). Shown on the dashboard so an update can be confirmed.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function buildId(worldDir: string): string {
  try {
    for (const gitDir of [resolve(worldDir, '.git'), resolve(worldDir, '..', '.git')]) {
      if (!existsSync(gitDir)) continue;
      const head = readFileSync(resolve(gitDir, 'HEAD'), 'utf8').trim();
      if (!head.startsWith('ref: ')) return head.slice(0, 7);
      const ref = head.slice(5);
      const loose = resolve(gitDir, ref);
      if (existsSync(loose)) return readFileSync(loose, 'utf8').trim().slice(0, 7);
      const packed = resolve(gitDir, 'packed-refs');
      if (existsSync(packed)) {
        const line = readFileSync(packed, 'utf8').split('\n').find((l) => l.endsWith(` ${ref}`));
        if (line) return line.slice(0, 7);
      }
    }
  } catch {
    /* fall through */
  }
  return 'unknown';
}
