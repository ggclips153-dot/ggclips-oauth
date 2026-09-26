// The shared memory surface, read-only (A21; SPEC 2026-09-26 four-tier shared memory). The surface lives on the
// VPS; vps/surface_reader.py serves it read-only and this feed pulls it over Tailscale. The dashboard never
// writes the surface and never opens its database.
import { existsSync, readFileSync } from 'node:fs';

export const SURFACE_KINDS = ['roster', 'kpi', 'status', 'dispatch', 'lesson', 'policy', 'note', 'lifecycle'] as const;

export interface SurfaceNote {
  id: string;
  table: string;
  content: string;
  source: string | null;
  ts: string | null;
  importance: number | null;
  veracity: string | null;
  city: string | null;
  dept: string | null;
  agent: string | null;
  kind: string | null;
  untagged?: string[];
  /** The world city this note's `city` tag names ("WORLD" for the world layer), when known. */
  cityId?: string | null;
}

export interface SurfaceStatus {
  enabled: boolean;
  ok: boolean;
  error: string | null;
  lastPoll: string | null;
  notes: number;
}

export interface SurfaceOptions {
  url: string;
  token: string;
  /** Surface city name -> world city ID (e.g. "receptionist" -> "ai-receptionist-city"). */
  cityMapPath?: string;
  everyMs?: number;
  keep?: number;
  onChange?: () => void;
  fetchImpl?: typeof fetch;
}

export class SurfaceFeed {
  private readonly notes = new Map<string, SurfaceNote>();
  private cursor = '';
  private timer: NodeJS.Timeout | null = null;
  private status: SurfaceStatus = { enabled: true, ok: false, error: 'not polled yet', lastPoll: null, notes: 0 };
  private readonly opts: Required<Omit<SurfaceOptions, 'cityMapPath'>> & { cityMap: Record<string, string> };

  constructor(opts: SurfaceOptions) {
    const cityMap = opts.cityMapPath && existsSync(opts.cityMapPath) ? JSON.parse(readFileSync(opts.cityMapPath, 'utf8')) : {};
    this.opts = { everyMs: 15_000, keep: 5000, onChange: () => {}, fetchImpl: fetch, ...opts, url: opts.url.replace(/\/+$/, ''), cityMap };
  }

  /** The world city a surface `city` tag names: the map first, else a city with that ID. */
  cityIdOf(tag: string | null, known: (id: string) => boolean): string | null {
    if (!tag || tag === '—') return tag === '—' ? 'WORLD' : null;
    if (tag.toUpperCase() === 'WORLD') return 'WORLD';
    const mapped = this.opts.cityMap[tag] ?? this.opts.cityMap[tag.toLowerCase()];
    if (mapped) return mapped;
    return known(tag) ? tag : known(tag.toLowerCase()) ? tag.toLowerCase() : null;
  }

  async poll(): Promise<void> {
    const before = this.notes.size;
    try {
      // Catch up page by page (a new dashboard reads the whole history once).
      for (let page = 0; page < 20; page++) {
        const res = await this.opts.fetchImpl(`${this.opts.url}/notes?after=${encodeURIComponent(this.cursor)}&limit=1000`, {
          headers: { authorization: `Bearer ${this.opts.token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await res.json().catch(() => null)) as { notes?: SurfaceNote[]; cursor?: string; error?: string } | null;
        if (!res.ok || !body?.notes) throw new Error(body?.error ?? `surface reader answered HTTP ${res.status}`);
        for (const n of body.notes) this.notes.set(n.id, n);
        if (body.cursor) this.cursor = body.cursor;
        if (body.notes.length < 1000) break;
      }
      // Keep the newest notes only.
      if (this.notes.size > this.opts.keep) {
        const drop = [...this.notes.values()].sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? '')).slice(0, this.notes.size - this.opts.keep);
        for (const n of drop) this.notes.delete(n.id);
      }
      const changed = !this.status.ok || this.notes.size !== before;
      this.status = { enabled: true, ok: true, error: null, lastPoll: new Date().toISOString(), notes: this.notes.size };
      if (changed) this.opts.onChange();
    } catch (err) {
      const msg = (err as Error).message;
      const changed = this.status.error !== msg;
      this.status = { ...this.status, ok: false, error: msg, lastPoll: new Date().toISOString() };
      if (changed) this.opts.onChange();
    }
  }

  start() {
    void this.poll();
    this.timer ??= setInterval(() => void this.poll(), this.opts.everyMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * What a reader may see, per the spec's matrix: Marc, the DM and the Architect ('*') see every city and WORLD;
   * a Mayor sees its own city and WORLD, never another city.
   */
  view(scope: string, known: (id: string) => boolean) {
    const notes = [...this.notes.values()]
      .map((n) => ({ ...n, cityId: this.cityIdOf(n.city, known) }))
      .filter((n) => scope === '*' || n.cityId === scope || n.cityId === 'WORLD')
      .sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''));
    return { ...this.status, notes: notes.slice(0, 1500), total: notes.length, unmappedCities: scope === '*' ? [...new Set(notes.filter((n) => n.city && !n.cityId).map((n) => n.city!))] : [] };
  }
}
