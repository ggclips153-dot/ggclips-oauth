import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Profiles, hashToken } from '../src/auth/profiles.ts';
import { createApp } from '../src/server/app.ts';
import { TestWorld } from './helpers.ts';

const tokens = { marc: 't-marc', dm: 't-dm', bob: 't-bob', mayorA: 't-mayor-a' };

describe('HTTP API', () => {
  const w = new TestWorld();
  const a = w.city('A City');
  const b = w.city('B City');
  const profiles = new Profiles([
    { id: 'marc', role: 'owner', writeScope: ['*'], tokenSha256: hashToken(tokens.marc) },
    { id: 'dm', role: 'dm', writeScope: ['*'], tokenSha256: hashToken(tokens.dm) },
    { id: 'bob', role: 'architect', writeScope: [], tokenSha256: hashToken(tokens.bob) },
    { id: 'mayor-a', role: 'mayor', writeScope: [a], tokenSha256: hashToken(tokens.mayorA) },
  ]);
  const server = createApp(w.ledger, profiles);
  let base = '';

  before(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  const call = (path: string, token?: string, body?: unknown) =>
    fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

  it('requires a valid token', async () => {
    assert.equal((await call('/api/health')).status, 200);
    assert.equal((await call('/api/state')).status, 401);
    assert.equal((await call('/api/state', 'nope')).status, 401);
  });

  it('a Mayor reads only its own city', async () => {
    const state = await (await call('/api/state', tokens.mayorA)).json();
    assert.deepEqual(state.cities.map((c: { id: string }) => c.id), [a]);
    const { events } = await (await call('/api/events', tokens.mayorA)).json();
    assert.ok(events.length > 0);
    assert.ok(events.every((e: { city: string; subject: string }) => e.city === a || e.subject === a));
  });

  it('Bob reads across cities but cannot write', async () => {
    const state = await (await call('/api/state', tokens.bob)).json();
    assert.equal(state.cities.length, 2);
    const res = await call('/api/events', tokens.bob, { type: 'intent.message_mayor', city: a, payload: { text: 'x' } });
    assert.equal(res.status, 403);
  });

  it('rejects a Mayor writing another city\'s tag with 403', async () => {
    const res = await call('/api/events', tokens.mayorA, {
      type: 'city.kpi_pulse',
      city: b,
      payload: { metric: 'qualified_bookings', value: 3, period: 'week', periodStart: '2026-09-21' },
    });
    assert.equal(res.status, 403);
  });

  it('Marc -> intent -> DM routes -> visible as routed', async () => {
    const res = await call('/api/events', tokens.marc, { type: 'intent.message_mayor', city: a, payload: { text: 'weekly report please' } });
    assert.equal(res.status, 201);
    const intent = await res.json();
    let state = await (await call('/api/state', tokens.marc)).json();
    assert.ok(state.pendingIntents.some((i: { seq: number }) => i.seq === intent.seq));
    const routed = await call('/api/events', tokens.dm, { type: 'dm.routed', city: a, payload: { intentSeq: intent.seq, to: 'mayor:a-city' } });
    assert.equal(routed.status, 201);
    state = await (await call('/api/state', tokens.marc)).json();
    assert.ok(!state.pendingIntents.some((i: { seq: number }) => i.seq === intent.seq));
  });

  it('only the owner may verify the chain', async () => {
    assert.equal((await call('/api/verify', tokens.dm)).status, 403);
    assert.deepEqual(await (await call('/api/verify', tokens.marc)).json(), { ok: true, count: w.ledger.state.lastSeq });
  });
});
