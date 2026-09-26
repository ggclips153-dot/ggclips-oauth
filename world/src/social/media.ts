// Photos and videos for posts: uploaded once, stored content-addressed (data/media/<sha256>.<ext>), served to
// signed-in viewers with Range support so videos can be scrubbed.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

export const MEDIA_TYPES: Record<string, { ext: string; kind: 'image' | 'video' }> = {
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/png': { ext: 'png', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'image/gif': { ext: 'gif', kind: 'image' },
  'video/mp4': { ext: 'mp4', kind: 'video' },
  'video/quicktime': { ext: 'mov', kind: 'video' },
  'video/webm': { ext: 'webm', kind: 'video' },
};
const BY_EXT = Object.fromEntries(Object.entries(MEDIA_TYPES).map(([type, v]) => [v.ext, type]));
export const MAX_MEDIA_BYTES = 512 * 1024 * 1024;

export class MediaStore {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  /** Stream an upload to disk while hashing it; returns its ref, or throws a message for the client. */
  async save(req: IncomingMessage, contentType: string): Promise<{ ref: string; kind: 'image' | 'video'; size: number; url: string }> {
    const type = MEDIA_TYPES[contentType.split(';')[0]!.trim().toLowerCase()];
    if (!type) throw new Error(`unsupported file type ${contentType}; use JPEG, PNG, WebP, GIF, MP4, MOV or WebM`);
    mkdirSync(this.dir, { recursive: true });
    const tmp = join(this.dir, `.upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const hash = createHash('sha256');
    const out = createWriteStream(tmp, { mode: 0o600 });
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_MEDIA_BYTES) throw new Error('file larger than 512 MB');
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      if (!size) throw new Error('empty file');
      const name = `${hash.digest('hex')}.${type.ext}`;
      const final = join(this.dir, name);
      if (existsSync(final)) rmSync(tmp);
      else renameSync(tmp, final);
      return { ref: `media/${name}`, kind: type.kind, size, url: `/media/${name}` };
    } catch (err) {
      out.destroy();
      rmSync(tmp, { force: true });
      throw err;
    }
  }

  path(name: string): string | null {
    if (!/^[0-9a-f]{64}\.[a-z0-9]{2,5}$/.test(name)) return null;
    const full = join(this.dir, name);
    return existsSync(full) ? full : null;
  }

  /** Serve a stored file (with Range requests for video). */
  serve(req: IncomingMessage, res: ServerResponse, name: string): boolean {
    const full = this.path(name);
    if (!full) return false;
    const size = statSync(full).size;
    const type = BY_EXT[name.split('.').pop()!] ?? 'application/octet-stream';
    const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end) {
        res.writeHead(416, { 'content-range': `bytes */${size}` });
        res.end();
        return true;
      }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      createReadStream(full, { start, end }).pipe(res);
      return true;
    }
    res.writeHead(200, { ...headers, 'content-length': size });
    createReadStream(full).pipe(res);
    return true;
  }
}
