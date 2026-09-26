import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Profiles, hashToken } from '../src/auth/profiles.ts';
import { createApp } from '../src/server/app.ts';
import { TestWorld, dm, owner } from './helpers.ts';

describe('Marc can create structure and agents himself (as DM and Mayor), or leave it to the bots', () => {
  const w = new TestWorld();
  const city = w.city();
  const profiles = new Profiles([
    { id: 'marc', role: 'owner', writeScope: ['*'], tokenSha256: hashToken('t-marc') },
    { id: 'mayor-a', role: 'mayor', writeScope: [city], tokenSha256: hashToken('t-mayor') },
  ]);
  const server = createApp(w.ledger, profiles);
  let base = '';
  before(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());
  const carry = (seq: number, token = 't-marc') => fetch(`${base}/api/intents/${seq}/create-now`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  const ask = (type: string, payload: unknown) => w.ledger.append(owner, { type, city, payload });

  it('routes and applies it through the write-guard, recorded as Marc', async () => {
    const i = ask('intent.create_district', { name: 'Front Desk', supervisor: 'Rowe' });
    const res = await carry(i.seq);
    assert.equal(res.status, 201);
    const { events } = await res.json();
    assert.deepEqual(events.map((e: { type: string }) => e.type), ['dm.routed', 'district.created']);
    assert.deepEqual(events.map((e: { actor: string }) => e.actor), ['marc-as-dm', 'marc-as-mayor']);
    assert.equal([...w.state.districts.values()].filter((d) => d.name === 'Front Desk').length, 1);
  });

  it('cannot be carried out twice, and only the owner may do it', async () => {
    const i = ask('intent.create_district', { name: 'Back Office', supervisor: 'Hale' });
    assert.equal((await carry(i.seq, 't-mayor')).status, 403);
    assert.equal((await carry(i.seq)).status, 201);
    assert.equal((await carry(i.seq)).status, 409);
    assert.equal((await carry(99999)).status, 404);
  });

  it('works on a request a bot already routed but no Mayor carried out', async () => {
    const i = ask('intent.create_agent', { persona: { voice: 'v', temperament: 't' }, domainFocus: 'bookings' });
    w.ledger.append(dm, { type: 'dm.routed', city, payload: { intentSeq: i.seq, to: 'mayor' } });
    const { events } = await (await carry(i.seq)).json();
    assert.deepEqual(events.map((e: { type: string }) => e.type), ['agent.enrolled']);
  });

  it('the rules still hold: a promotion the ledger forbids is refused, even for Marc', async () => {
    const rookie = w.collegeAgent(city, 'Rookie');
    const promote = ask('intent.promote_agent', { agentId: rookie, to: 'active' });
    assert.equal((await carry(promote.seq)).status, 409);
    assert.equal(w.state.agents.get(rookie)!.state, 'enrolled');
  });

  it('assigning an existing agent can be applied directly, and the rules still hold', async () => {
    const district = [...w.state.districts.values()][0]!.id;
    const d = ask('intent.create_department', { districtId: district, name: 'Booking', scope: 'Book appointments' });
    const { events } = await (await carry(d.seq)).json();
    const dept = events.at(-1).subject;
    const a = w.collegeAgent(city, 'Iris');
    const place = ask('intent.place_agent', { agentId: a, departmentId: dept });
    assert.equal((await carry(place.seq)).status, 201);
    assert.equal(w.state.agents.get(a)!.departmentId, dept);
  });

  it("Marc's creation requests through the API are applied at once: nothing waits on the DM", async () => {
    const res = await fetch(`${base}/api/events`, {
      method: 'POST',
      headers: { authorization: 'Bearer t-marc', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'intent.create_district', city, payload: { name: 'Night Desk', supervisor: 'Vale' } }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.applied, true);
    assert.deepEqual(body.created.map((e: { type: string }) => e.type), ['dm.routed', 'district.created']);
    assert.ok([...w.state.districts.values()].some((d) => d.name === 'Night Desk'));
    assert.ok(w.state.routed.has(body.seq), 'not left waiting on the DM');
  });

  it('every request from Marc is applied at once (A19); a message to a Mayor is routed to them at once', async () => {
    const res = await fetch(`${base}/api/events`, {
      method: 'POST',
      headers: { authorization: 'Bearer t-marc', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'intent.message_mayor', city, payload: { text: 'hello' } }),
    });
    const body = await res.json();
    assert.equal(body.applied, true);
    assert.ok(w.state.routed.has(body.seq), 'nothing waits on the DM');
  });

  it('a request the rules refuse is kept unfinished and Marc is told why', async () => {
    const rookie = w.collegeAgent(city, 'Rookie Two');
    const res = await fetch(`${base}/api/events`, {
      method: 'POST',
      headers: { authorization: 'Bearer t-marc', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'intent.promote_agent', city, payload: { agentId: rookie, to: 'active' } }),
    });
    const body = await res.json();
    assert.equal(body.applied, false);
    assert.match(body.reason, /./);
  });
});
