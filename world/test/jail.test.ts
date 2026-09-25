import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { worldView, canRead } from '../src/domain/view.ts';
import { TestWorld, dm, mayorOf, owner } from './helpers.ts';

/** Revenue city with a placed agent, plus the two Essentials cities. */
const setup = () => {
  const w = new TestWorld();
  const city = w.city('AI Receptionist City');
  const security = w.city('Security City', 'essentials');
  const innovations = w.city('Innovations City', 'essentials');
  const other = w.city('Personal Finance City');
  const dept = w.department(city, w.district(city), 5);
  const agent = w.agent(city, dept, 'Iris');
  w.promote(city, agent, 'probationer');
  return { w, city, security, innovations, other, dept, agent };
};

const flag = (w: TestWorld, security: string, agentId: string) =>
  w.fact(mayorOf(security), {
    type: 'security.flagged',
    city: security,
    payload: { agentId, reason: 'not_doing_tasks', evidence: 'no ledger entries for 3 days' },
  });

describe('Essentials family: cross-city READ, never edit', () => {
  it('Essentials Mayors read every city; revenue Mayors read only their own', () => {
    const { w, city, security, innovations, other } = setup();
    for (const essentials of [security, innovations]) {
      assert.equal(worldView(w.state, mayorOf(essentials)).cities.length, 4);
    }
    assert.deepEqual(worldView(w.state, mayorOf(city)).cities.map((c) => c.id), [city]);
    const otherEvent = w.ledger.readAll().find((e) => e.city === other)!;
    assert.ok(otherEvent ? canRead(mayorOf(security), otherEvent, w.state) : true);
  });

  it('Essentials Mayors still cannot write another city\'s tag', () => {
    const { w, city, security, innovations } = setup();
    const pulse = { metric: 'qualified_bookings', value: 1, period: 'week', periodStart: '2026-09-21' };
    for (const essentials of [security, innovations]) {
      assert.throws(() => w.ledger.append(mayorOf(essentials), { type: 'city.kpi_pulse', city, payload: pulse }), /outside .* write scope/);
    }
  });
});

describe('Security jail', () => {
  it('3rd strike puts the agent in jail, awaiting deletion; it cannot be released', () => {
    const { w, city, agent } = setup();
    w.miss(city, agent);
    w.promote(city, agent, 'probationer');
    w.miss(city, agent);
    w.promote(city, agent, 'probationer');
    w.miss(city, agent, true);
    assert.equal(w.state.agents.get(agent)!.jail!.reason, 'awaiting_deletion');
    assert.throws(() => w.intent('release_agent', city, { agentId: agent }), /awaiting deletion cannot be released/);

    const del = w.intent('delete_agent', city, { agentId: agent });
    w.fact(mayorOf(city), { type: 'agent.deleted', city, subject: agent, payload: { ledgerArchiveRef: 'a', lessonRecordRef: 'l' }, authorizedBy: del.seq });
    assert.equal(w.state.agents.get(agent)!.jail, null);
    assert.equal(worldView(w.state, owner).jail.length, 0);
  });

  it('Security flags an agent in another city under its OWN tag; Marc jails; home Mayor executes', () => {
    const { w, city, security, agent } = setup();
    const f = flag(w, security, agent);
    assert.equal(f.city, security);
    assert.equal(w.state.agents.get(agent)!.jail, null, 'a flag alone changes nothing');

    // The home Mayor cannot jail without Marc's routed intent.
    assert.throws(() => w.fact(mayorOf(city), { type: 'agent.jailed', city, subject: agent, payload: { reason: 'not_doing_tasks' } }), /must cite an owner intent/);
    const i = w.intent('jail_agent', city, { agentId: agent, reason: 'not_doing_tasks', flagSeq: f.seq });
    // Security cannot execute it: the agent's city tag is outside its write scope.
    assert.throws(
      () => w.fact(mayorOf(security), { type: 'agent.jailed', city, subject: agent, payload: { reason: 'not_doing_tasks', flagSeq: f.seq }, authorizedBy: i.seq }),
      /outside .* write scope/,
    );
    w.fact(mayorOf(city), { type: 'agent.jailed', city, subject: agent, payload: { reason: 'not_doing_tasks', flagSeq: f.seq }, authorizedBy: i.seq });

    const jail = worldView(w.state, mayorOf(security)).jail;
    assert.deepEqual(jail.map((j) => [j.id, j.cityId, j.jail!.reason]), [[agent, city, 'not_doing_tasks']]);
  });

  it('a jailed agent cannot climb, move or take strikes until released', () => {
    const { w, city, security, agent } = setup();
    const i = w.intent('jail_agent', city, { agentId: agent, reason: 'not_doing_tasks' });
    w.fact(mayorOf(city), { type: 'agent.jailed', city, subject: agent, payload: { reason: 'not_doing_tasks' }, authorizedBy: i.seq });
    assert.throws(() => w.promote(city, agent, 'active'), /in jail/);
    assert.throws(() => w.miss(city, agent), /in jail/);

    const r = w.intent('release_agent', city, { agentId: agent });
    w.fact(mayorOf(city), { type: 'agent.released', city, subject: agent, payload: {}, authorizedBy: r.seq });
    w.promote(city, agent, 'active');
    assert.equal(w.state.agents.get(agent)!.state, 'active');
    void security;
  });

  it('only Security City files flags, and a flag must match the jailed agent', () => {
    const { w, city, innovations, security, agent, dept } = setup();
    assert.throws(
      () => w.fact(mayorOf(innovations), { type: 'security.flagged', city: innovations, payload: { agentId: agent, reason: 'not_doing_tasks', evidence: 'x' } }),
      /only security-city/,
    );
    const other = w.agent(city, dept, 'Juno');
    const f = flag(w, security, other);
    assert.throws(() => w.intent('jail_agent', city, { agentId: agent, reason: 'not_doing_tasks', flagSeq: f.seq }), /is about/);
  });

  it('a revenue Mayor sees only its own city\'s jailed agents and flags', () => {
    const { w, city, security, other, agent } = setup();
    flag(w, security, agent);
    assert.equal(worldView(w.state, mayorOf(other)).securityFlags.length, 0);
    assert.equal(worldView(w.state, mayorOf(city)).securityFlags.length, 1);
    void dm;
  });
});
