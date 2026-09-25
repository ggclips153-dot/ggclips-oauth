import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TestWorld, mayorOf } from './helpers.ts';

const WEEK = '2026-09-21'; // a Monday

const setup = () => {
  const w = new TestWorld();
  const city = w.city('AI Receptionist City');
  const other = w.city('Personal Finance City');
  const dept = w.department(city, w.district(city));
  const agent = w.agent(city, dept, 'Iris');
  w.promote(city, agent, 'probationer');
  w.promote(city, agent, 'active');
  const deliver = (by = agent, revenue: 'real' | 'synthetic' = 'real', week = WEEK) =>
    w.fact(mayorOf(city), {
      type: 'work.deliverable',
      city,
      payload: { agentId: by, artifactRef: 'bookings/482', revenue, ...(revenue === 'real' ? { revenueRef: 'invoice/1001', revenueCents: 150_000 } : {}), periodStart: week, description: 'Booked 3 cleanings' },
    });
  const rework = (by = agent) => w.fact(mayorOf(city), { type: 'work.qc_rework', city, payload: { agentId: by, artifactRef: 'bookings/482', periodStart: WEEK, reason: 'wrong time slot' } });
  const earn = (deliverableSeq: number, amountCents = 5_000, by = agent) => {
    const i = w.intent('grant_earning', city, { agentId: by, deliverableSeq, amountCents });
    return w.fact(mayorOf(city), { type: 'currency.earned', city, payload: { agentId: by, deliverableSeq, amountCents }, authorizedBy: i.seq });
  };
  const spend = (reward: string, amountCents: number, detail: string, by = agent) => {
    const i = w.intent('grant_reward', city, { agentId: by, reward, amountCents, detail });
    return w.fact(mayorOf(city), { type: 'currency.spent', city, payload: { agentId: by, reward, amountCents, detail }, authorizedBy: i.seq });
  };
  return { w, city, other, dept, agent, deliver, rework, earn, spend };
};

describe('earning: the graduation-vetting gate', () => {
  it('an active agent earns for a real-revenue deliverable, vetted by Marc and executed by the Mayor', () => {
    const s = setup();
    const d = s.deliver();
    s.earn(d.seq, 5_000);
    assert.deepEqual(s.w.state.account(s.agent), { earnedCents: 5_000, spentCents: 0, balanceCents: 5_000, rewards: [] });
    assert.throws(() => s.earn(d.seq), /already credited/);
  });

  it('never without Marc\'s routed intent, and never self-run', () => {
    const s = setup();
    const d = s.deliver();
    assert.throws(
      () => s.w.fact(mayorOf(s.city), { type: 'currency.earned', city: s.city, payload: { agentId: s.agent, deliverableSeq: d.seq, amountCents: 100 } }),
      /must cite an owner intent/,
    );
  });

  it('students and probationers earn nothing; synthetic work earns nothing', () => {
    const s = setup();
    const rookie = s.w.agent(s.city, s.dept, 'Juno');
    s.w.promote(s.city, rookie, 'probationer');
    assert.throws(() => s.earn(s.deliver(rookie).seq, 100, rookie), /only active or senior agents earn/);
    assert.throws(() => s.earn(s.deliver(s.agent, 'synthetic').seq), /synthetic work .* earns nothing/);
  });

  it('clean attribution: more than one QC rework in the week loses that week\'s credit', () => {
    const s = setup();
    const d = s.deliver();
    s.rework();
    s.earn(d.seq, 100); // one rework is fine
    const d2 = s.deliver();
    s.rework();
    assert.throws(() => s.earn(d2.seq), /2 QC reworks in the week of 2026-09-21: that week's credit is lost/);
    // Next week is clean again.
    s.earn(s.deliver(s.agent, 'real', '2026-09-28').seq, 100);
  });

  it('credit goes to the deliverable\'s owner, and attribution stays in the city', () => {
    const s = setup();
    const peer = s.w.agent(s.city, s.dept, 'Kai');
    s.w.promote(s.city, peer, 'probationer');
    s.w.promote(s.city, peer, 'active');
    const d = s.deliver();
    assert.throws(() => s.earn(d.seq, 100, peer), /credited to AGT-\d+, not/);
    assert.throws(() => s.w.intent('grant_earning', s.other, { agentId: s.agent, deliverableSeq: d.seq, amountCents: 100 }), /not in personal-finance-city/);
  });

  it('weeks start on Monday; real revenue needs a source', () => {
    const s = setup();
    assert.throws(() => s.deliver(s.agent, 'real', '2026-09-23'), /Monday/);
    assert.throws(
      () => s.w.fact(mayorOf(s.city), { type: 'work.deliverable', city: s.city, payload: { agentId: s.agent, artifactRef: 'a', revenue: 'real', periodStart: WEEK, description: 'd' } }),
      /needs a revenueRef/,
    );
  });
});

describe('spending: rewards R1-R5 only, executed by the Mayor + Marc', () => {
  it('spends from the balance on a reward, never beyond it', () => {
    const s = setup();
    s.earn(s.deliver().seq, 10_000);
    s.spend('R5', 2_500, 'Hall of Agents for September bookings');
    assert.deepEqual(s.w.state.account(s.agent), { earnedCents: 10_000, spentCents: 2_500, balanceCents: 7_500, rewards: ['R5'] });
    assert.throws(() => s.spend('R1', 9_000, 'Add the calendar-sync lane'), /balance is \$75\.00; this reward costs \$90\.00/);
  });

  it('only R1-R5 exist', () => {
    const s = setup();
    s.earn(s.deliver().seq, 10_000);
    assert.throws(() => s.spend('R6', 100, 'a bonus'), /must be one of: R1, R2, R3, R4, R5/);
  });

  it('express non-rewards are rejected, whatever the reward code', () => {
    const s = setup();
    s.earn(s.deliver().seq, 100_000);
    const cases: [string, RegExp][] = [
      ['Admin authority over the Booking department', /extra authority/],
      ['Access to another city', /cross-city reach/],
      ['A wallet for its own purchases', /no agent holds or spends/],
      ['Auto-publish replies to clients', /auto-publish/],
      ['Skip school after the next miss', /skipping school/],
      ['Premium curriculum access', /memory and knowledge are free/],
      ['A ledger exemption on weekends', /the ledger is a duty/],
      ['Immunity from deletion', /deletion-immunity/],
      ['Unlocks its job tools', /essentials/],
      ['Access to Personal Finance City', /never reach another city/],
    ];
    for (const [detail, why] of cases) assert.throws(() => s.spend('R1', 100, detail), why, detail);
  });

  it('R3 needs a department with 3+ graduated agents', () => {
    const s = setup();
    s.earn(s.deliver().seq, 10_000);
    assert.throws(() => s.spend('R3', 100, 'Mentorship of new shadows'), /3\+ graduated agents/);
    for (const n of ['Kai', 'Lark']) s.w.promote(s.city, s.w.agent(s.city, s.dept, n), 'probationer');
    s.spend('R3', 100, 'Mentorship of new shadows');
  });

  it('R4 grace is never deletion-immunity: a 3rd strike still leads to deletion', () => {
    const s = setup();
    s.earn(s.deliver().seq, 10_000);
    s.spend('R4', 1_000, 'First-retry grace on the next KPI miss');
    for (let i = 0; i < 2; i++) {
      s.w.miss(s.city, s.agent);
      s.w.promote(s.city, s.agent, 'probationer');
    }
    s.w.miss(s.city, s.agent, true);
    const del = s.w.intent('delete_agent', s.city, { agentId: s.agent });
    s.w.fact(mayorOf(s.city), { type: 'agent.deleted', city: s.city, subject: s.agent, payload: { ledgerArchiveRef: 'a', lessonRecordRef: 'l' }, authorizedBy: del.seq });
    assert.ok(s.w.state.agents.get(s.agent)!.deleted);
  });

  it('a deleted agent\'s account is frozen', () => {
    const s = setup();
    s.earn(s.deliver().seq, 10_000);
    for (let i = 0; i < 2; i++) {
      s.w.miss(s.city, s.agent);
      s.w.promote(s.city, s.agent, 'probationer');
    }
    s.w.miss(s.city, s.agent, true);
    const del = s.w.intent('delete_agent', s.city, { agentId: s.agent });
    s.w.fact(mayorOf(s.city), { type: 'agent.deleted', city: s.city, subject: s.agent, payload: { ledgerArchiveRef: 'a', lessonRecordRef: 'l' }, authorizedBy: del.seq });
    assert.throws(() => s.w.intent('grant_reward', s.city, { agentId: s.agent, reward: 'R5', amountCents: 100, detail: 'x' }), /deleted/);
  });
});
