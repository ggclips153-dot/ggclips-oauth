// Regression tests for the issues found in the full review.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { Profiles, hashToken } from '../src/auth/profiles.ts';
import { createApp } from '../src/server/app.ts';
// @ts-expect-error plain browser module, no types
import { parseMoney } from '../public/forms.js';
import { TestWorld, mayorOf } from './helpers.ts';

describe('ledger rules found in review', () => {
  it('a senior retiring into a professor starts with no strikes (teaching strikes are counted fresh)', () => {
    const w = new TestWorld();
    const city = w.city();
    const dept = w.department(city, w.district(city));
    const a = w.agent(city, dept, 'Iris');
    w.promote(city, a, 'probationer');
    w.miss(city, a);
    w.promote(city, a, 'probationer');
    w.miss(city, a);
    for (const to of ['probationer', 'active', 'senior'] as const) w.promote(city, a, to);
    assert.equal(w.state.agents.get(a)!.strikes, 2);
    const i = w.intent('retire_to_professor', city, { agentId: a });
    w.fact(mayorOf(city), { type: 'agent.retired_to_professor', city, subject: a, payload: {}, authorizedBy: i.seq });
    assert.equal(w.state.agents.get(a)!.strikes, 0);
  });

  it("a pass from one department's professor does not graduate the agent after a move", () => {
    const w = new TestWorld();
    const city = w.city();
    const district = w.district(city);
    const d1 = w.department(city, district);
    const d2 = w.department(city, district);
    const a = w.agent(city, d1, 'Iris');
    w.fact(mayorOf(city), { type: 'agent.interned', city, subject: a, payload: {} });
    w.exam(city, a);
    const i = w.intent('move_agent', city, { agentId: a, toDepartmentId: d2 });
    w.fact(mayorOf(city), { type: 'agent.moved', city, subject: a, payload: { toDepartmentId: d2 }, authorizedBy: i.seq });
    assert.throws(() => w.fact(mayorOf(city), { type: 'agent.graduated', city, subject: a, payload: {} }), /needs a passed exam/);
  });

  it('a deployed Security agent sent back to school stops observing and cannot be redeployed', () => {
    const w = new TestWorld();
    const city = w.city();
    const security = w.city('Security City', 'essentials');
    const guard = w.agent(security, w.department(security, w.district(security, 'Patrol')), 'Sentinel');
    w.promote(security, guard, 'probationer');
    const d = w.intent('deploy_agent', security, { agentId: guard, toCity: city });
    w.fact(mayorOf(security), { type: 'agent.deployed', city: security, subject: guard, payload: { toCity: city }, authorizedBy: d.seq });
    w.miss(security, guard);
    assert.equal(w.state.agents.get(guard)!.deployedTo, null);
    assert.throws(() => w.intent('deploy_agent', security, { agentId: guard, toCity: city }), /must be graduated/);
  });

  it('impossible calendar dates are rejected (2026-02-30 would roll over to a Monday)', () => {
    const w = new TestWorld();
    const city = w.city();
    const pulse = (periodStart: string) => w.fact(mayorOf(city), { type: 'city.kpi_pulse', city, payload: { metric: 'm', value: 1, period: 'week', periodStart } });
    assert.throws(() => pulse('2026-02-30'), /YYYY-MM-DD/);
    pulse('2026-03-02');
  });
});

describe('server input found in review', () => {
  it('a JSON body that is not an object is a 400, not a 500', async () => {
    const w = new TestWorld();
    const server = createApp(w.ledger, new Profiles([{ id: 'marc', role: 'owner', writeScope: ['*'], tokenSha256: hashToken('t') }]));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for (const body of ['null', '[1]', '"x"']) {
        const res = await fetch(`${base}/api/events`, { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body });
        assert.equal(res.status, 400, body);
      }
      assert.equal((await fetch(`${base}/api/login`, { method: 'POST', body: 'null' })).status, 400);
    } finally {
      server.close();
    }
  });
});

describe('dashboard money input', () => {
  it('reads dollars into cents without guessing', () => {
    assert.equal(parseMoney('1250'), 125000);
    assert.equal(parseMoney('$1,250.50'), 125050);
    assert.equal(parseMoney('12,50'), 1250, 'a decimal comma');
    assert.equal(parseMoney('12.5'), 1250);
    assert.ok(Number.isNaN(parseMoney('1,2,3')));
    assert.ok(Number.isNaN(parseMoney('abc')));
  });
});

describe('a department only assigns an existing agent (A11)', () => {
  it('a create request cannot name a department, and placement needs a place_agent request for an existing agent', () => {
    const w = new TestWorld();
    const city = w.city();
    const dept = w.department(city, w.district(city));
    assert.throws(() => w.intent('create_agent', city, { persona: { voice: 'v', temperament: 't' }, domainFocus: 'x', departmentId: dept }), /departmentId is not a known field/);
    const i = w.intent('create_agent', city, { persona: { voice: 'v', temperament: 't' }, domainFocus: 'x' });
    const a = w.fact(mayorOf(city), { type: 'agent.enrolled', city, payload: i.payload, authorizedBy: i.seq }).subject!;
    assert.throws(() => w.fact(mayorOf(city), { type: 'agent.placed', city, subject: a, payload: { departmentId: dept }, authorizedBy: i.seq }), /cannot authorize agent.placed/);
    w.place(city, a, dept);
    assert.equal(w.state.agents.get(a)!.departmentId, dept);
  });
});
