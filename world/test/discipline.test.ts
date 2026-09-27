// A32: HQ confirms strikes; Marc voids strikes, releases early and evicts (typing the agent's ID); clean time
// lowers the jail level; deans and professors can be struck; deletion needs HQ's archive and lesson record.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canRead, worldView } from '../src/domain/view.ts';
import { isJailed } from '../src/domain/state.ts';
import { carryOut } from '../src/server/executor.ts';
import { TestWorld, mayorOf, messenger, owner, persona } from './helpers.ts';

const marc = { messenger: { id: 'marc-as-messenger', role: 'messenger' as const, writeScope: ['*'] }, mayor: (c: string) => ({ id: 'marc-as-mayor', role: 'mayor' as const, writeScope: [c] }) };

const setup = () => {
  const w = new TestWorld();
  const city = w.city('AI Receptionist City');
  const security = w.city('Security City', 'essentials');
  const other = w.city('Personal Finance City');
  const dept = w.department(city, w.district(city));
  const agent = w.agent(city, dept, 'Iris');
  w.promote(city, agent, 'probationer');
  const guard = w.agent(security, w.department(security, w.district(security, 'Patrol')), 'Sentinel');
  w.promote(security, guard, 'probationer');
  const d = w.intent('deploy_agent', security, { agentId: guard, toCity: city });
  w.fact(mayorOf(security), { type: 'agent.deployed', city: security, subject: guard, payload: { toCity: city }, authorizedBy: d.seq });
  const report = (target = agent) =>
    w.fact(mayorOf(security), { type: 'security.task_strike', city: security, payload: { agentId: target, observedBy: guard, task: 'daily ledger entry', evidence: 'none for 2026-09-24' } });
  const strike = (target = agent) => w.hqConfirm(report(target).seq);
  const ask = (type: string, c: string, payload: Record<string, unknown>) => carryOut(w.ledger, w.ledger.append(owner, { type: `intent.${type}`, city: c, payload }), marc);
  const a = (id = agent) => w.state.agents.get(id)!;
  return { w, city, security, other, dept, agent, guard, report, strike, ask, a };
};

describe('A32: HQ confirms strikes', () => {
  it('a report counts only once HQ confirms it; a dismissed report never counts; only HQ decides', () => {
    const s = setup();
    const r1 = s.report();
    const r2 = s.report();
    assert.equal(s.a().taskStrikes, 0);
    assert.equal(worldView(s.w.state, owner, s.w.time).taskStrikes.filter((t) => t.status === 'pending').length, 2);
    // Only HQ (the Security city) decides: not the struck agent's own Mayor, not the World Messenger.
    const confirm = { type: 'security.strike_confirmed', payload: { strikeSeq: r1.seq } };
    assert.throws(() => s.w.ledger.append(mayorOf(s.city), { ...confirm, city: s.security }), /outside .* write scope/);
    assert.throws(() => s.w.ledger.append(mayorOf(s.city), { ...confirm, city: s.city }), /only security-city confirms/);
    assert.throws(() => s.w.ledger.append(messenger, { ...confirm, city: s.security }), /may not write/);
    s.w.hqConfirm(r1.seq);
    s.w.hqDismiss(r2.seq, 'entry was late, not missing');
    assert.equal(s.a().taskStrikes, 1);
    assert.throws(() => s.w.hqConfirm(r2.seq), /already dismissed/);
    // The home Mayor sees HQ's decisions about its own agent; another city's Mayor does not.
    const decision = s.w.ledger.readAll().at(-1)!;
    assert.ok(canRead(mayorOf(s.city), decision, s.w.state));
    assert.ok(!canRead(mayorOf(s.other), decision, s.w.state));
  });

  it('HQ can\'t confirm while the agent is in jail', () => {
    const s = setup();
    const waiting = s.report();
    s.strike(); s.strike(); s.strike();
    assert.ok(isJailed(s.a(), s.w.time));
    assert.throws(() => s.w.hqConfirm(waiting.seq), /in jail/);
    assert.throws(() => s.report(), /in jail/, 'no new reports while inside either');
  });
});

describe('A32: Marc voids strikes and releases early', () => {
  it('voiding the strike that triggered a term ends that term, as if it never counted', () => {
    const s = setup();
    s.strike(); s.strike();
    const third = s.report();
    s.w.hqConfirm(third.seq);
    assert.ok(isJailed(s.a(), s.w.time));
    s.ask('void_strike', 'WORLD', { strikeSeq: third.seq, reason: 'wrong agent on the camera' });
    assert.ok(!isJailed(s.a(), s.w.time));
    assert.deepEqual([s.a().taskStrikes, s.a().jailTerms], [2, 0]);
    assert.equal(worldView(s.w.state, owner, s.w.time).taskStrikes.find((t) => t.seq === third.seq)!.status, 'voided');
    assert.throws(() => s.ask('void_strike', 'WORLD', { strikeSeq: third.seq, reason: 'again' }), /already voided/);
  });

  it('early release ends a timed term; released from a 3rd KPI strike, the agent has one chance left', () => {
    const s = setup();
    assert.throws(() => s.ask('release_agent', s.city, { agentId: s.agent, reason: 'x' }), /not in jail/);
    s.strike(); s.strike(); s.strike();
    s.ask('release_agent', s.city, { agentId: s.agent, reason: 'served enough' });
    assert.ok(!isJailed(s.a(), s.w.time));
    assert.equal(s.a().jailTerms, 1, 'the level stays');

    s.w.miss(s.city, s.agent); s.w.promote(s.city, s.agent, 'probationer');
    s.w.miss(s.city, s.agent); s.w.promote(s.city, s.agent, 'probationer');
    s.w.miss(s.city, s.agent, true);
    assert.equal(s.a().jail!.cause, 'kpi_strikes');
    s.ask('release_agent', s.city, { agentId: s.agent, reason: 'KPI target was wrong' });
    assert.ok(!isJailed(s.a(), s.w.time));
    assert.equal(s.a().strikes, 2);
    s.w.miss(s.city, s.agent, true);
    assert.equal(s.a().jail!.status, 'awaiting_deletion');
  });
});

describe('A32: clean time lowers the jail level (60 days per step)', () => {
  it('after 60 strike-free days the next jailing is one step lower', () => {
    const s = setup();
    s.strike(); s.strike(); s.strike(); // term 1: 6h
    assert.equal(worldView(s.w.state, owner, s.w.time).jailLevels[s.agent]!.task, 1, 'level 1 while serving term 1');
    s.w.advanceHours(6);
    s.strike(); s.strike(); s.strike(); // term 2: 24h
    assert.equal(s.a().jailTerms, 2);
    s.w.advanceHours(24 + 60 * 24); // term over + 60 clean days
    assert.equal(worldView(s.w.state, owner, s.w.time).jailLevels[s.agent]!.task, 1, 'shown one step lower today');
    s.strike(); s.strike(); s.strike();
    assert.equal(s.a().jailTerms, 2, 'level 1 + this term = 2');
    assert.equal(Date.parse(s.a().jail!.until!) - s.w.time.getTime(), 24 * 3_600_000, 'a 24h term, not 3 days');
  });
});

describe('A32: everyone but Bob and the DM can be struck', () => {
  it('a dean takes task strikes and jail terms', () => {
    const s = setup();
    const i = s.w.intent('create_dean', s.city, { persona, domainFocus: 'running the college' });
    const dean = s.w.fact(mayorOf(s.city), { type: 'dean.appointed', city: s.city, payload: i.payload, authorizedBy: i.seq }).subject!;
    s.strike(dean); s.strike(dean); s.strike(dean);
    assert.equal(s.a(dean).jail!.cause, 'task_strikes');
    assert.ok(isJailed(s.a(dean), s.w.time));
  });
});

describe('A32: eviction and deletion need Marc to type the agent\'s ID, and HQ\'s record', () => {
  it('evict before a 3rd strike: held awaiting deletion; HQ writes the record; Marc deletes by typing the ID', () => {
    const s = setup();
    assert.throws(() => s.ask('evict_agent', s.city, { agentId: s.agent, reason: 'not a fit', confirmAgentId: 'AGT-999999' }), /type the agent's ID/);
    s.ask('evict_agent', s.city, { agentId: s.agent, reason: 'not a fit', confirmAgentId: s.agent });
    assert.deepEqual([s.a().jail!.status, s.a().jail!.cause], ['awaiting_deletion', 'eviction']);
    assert.throws(() => s.ask('delete_agent', s.city, { agentId: s.agent, confirmAgentId: s.agent }), /HQ has not written/);
    s.w.hqRecord(s.agent, 'archive/AGT/ledger', 'lessons/AGT.md');
    assert.throws(() => s.ask('delete_agent', s.city, { agentId: s.agent, confirmAgentId: 'Iris' }), /type the agent's ID/);
    s.ask('delete_agent', s.city, { agentId: s.agent, confirmAgentId: s.agent });
    assert.deepEqual([s.a().deleted!.ledgerArchiveRef, s.a().deleted!.lessonRecordRef], ['archive/AGT/ledger', 'lessons/AGT.md']);
  });

  it('HQ can only write a deletion record for an agent held awaiting deletion; a release clears it', () => {
    const s = setup();
    assert.throws(() => s.w.hqRecord(s.agent), /not held awaiting deletion/);
    s.ask('evict_agent', s.city, { agentId: s.agent, reason: 'r', confirmAgentId: s.agent });
    s.w.hqRecord(s.agent);
    s.ask('release_agent', s.city, { agentId: s.agent, reason: 'changed my mind' });
    assert.equal(s.a().deletionRecord, null);
    assert.ok(!isJailed(s.a(), s.w.time));
  });
});
