import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { SurfaceFeed, type SurfaceNote } from '../src/surface/feed.ts';

const note = (id: string, city: string | null, dept: string, agent: string, kind: string, ts: string): SurfaceNote =>
  ({ id, table: 'working_memory', content: `${kind} ${id}`, source: 'surface_manual', ts, importance: 0.8, veracity: 'unknown', city, dept, agent, kind });

describe('shared surface feed (A21, read-only)', () => {
  it('reads the reader page by page, maps city tags, and shows each reader only what the matrix allows', async () => {
    const pages = [
      [note('a', 'ggclutchplays', 'fps', 'fps-agent-2', 'status', '2026-09-26T10:00'), note('b', 'receptionist', 'governance', '—', 'kpi', '2026-09-26T10:01'), note('c', 'WORLD', 'world', '—', 'policy', '2026-09-26T10:02'), note('d', 'media', 'x', 'y', 'dispatch', '2026-09-26T10:03')],
      [],
    ];
    const asked: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      asked.push(url);
      assert.equal((init.headers as Record<string, string>).authorization, 'Bearer tok');
      const notes = pages.shift() ?? [];
      return new Response(JSON.stringify({ notes, cursor: notes.at(-1)?.ts ?? '' }), { status: 200 });
    }) as typeof fetch;
    const dir = mkdtempSync(join(tmpdir(), 'surf-'));
    writeFileSync(join(dir, 'map.json'), JSON.stringify({ receptionist: 'ai-receptionist-city' }));
    let changes = 0;
    const feed = new SurfaceFeed({ url: 'http://vps:8765/', token: 'tok', cityMapPath: join(dir, 'map.json'), fetchImpl, onChange: () => changes++ });
    await feed.poll();
    await feed.poll();
    assert.match(asked[1]!, /after=2026-09-26T10%3A03/, 'continues from the cursor');
    const known = (id: string) => ['ggclutchplays', 'ai-receptionist-city'].includes(id);
    const marc = feed.view('*', known);
    assert.equal(marc.ok, true);
    assert.equal(marc.total, 4);
    assert.deepEqual(marc.unmappedCities, ['media']);
    assert.deepEqual(marc.notes.map((n) => [n.id, n.cityId]), [['d', null], ['c', 'WORLD'], ['b', 'ai-receptionist-city'], ['a', 'ggclutchplays']]);
    // A Mayor: own city + WORLD, never another city.
    const mayor = feed.view('ai-receptionist-city', known);
    assert.deepEqual(mayor.notes.map((n) => n.id).sort(), ['b', 'c']);
    assert.deepEqual(mayor.unmappedCities, []);
    assert.equal(changes, 1);
  });

  it('reports a reader that is down without losing what it already has', async () => {
    let up = true;
    const fetchImpl = (async () => (up ? new Response(JSON.stringify({ notes: [note('a', 'WORLD', 'world', '—', 'policy', '1')], cursor: '1' })) : new Response('{"error":"surface unavailable"}', { status: 503 }))) as unknown as typeof fetch;
    const feed = new SurfaceFeed({ url: 'http://vps', token: 't', fetchImpl });
    await feed.poll();
    up = false;
    await feed.poll();
    const v = feed.view('*', () => false);
    assert.equal(v.ok, false);
    assert.match(v.error!, /surface unavailable/);
    assert.equal(v.total, 1);
  });
});
