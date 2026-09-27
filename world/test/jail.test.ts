import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canRead, worldView } from '../src/domain/view.ts';
import { isJailed } from '../src/domain/state.ts';
import { TestWorld, mayorOf, messenger, owner } from './helpers.ts';

/** A revenue city with a working agent, the two Essentials cities, and a Security agent deployed to watch. */
const setup = () => {
  const w = new TestWorld();
  const city = w.city('AI Receptionist City');
  const security = w.city('Security City', 'essentials');
  const innovations = w.city('Innovations City', 'essentials');
  const other = w.city('Personal Finance City');
  const dept = w.department(city, w.district(city));
  const agent = w.agent(city, dept, 'Iris');
  w.promote(city, agent, 'probationer');

  const patrol = w.department(security, w.district(security, 'Patrol'));
  const guard = w.agent(security, patrol, 'Sentinel');
  w.promote(security, guard, 'probationer');
  const d = w.intent('deploy_agent', security, { agentId: guard, toCity: city });
  w.fact(mayorOf(security), { type: 'agent.deployed', city: security, subject: guard, payload: { toCity: city }, authorizedBy: d.seq });
  return { w, city, security, innovations, other, dept, agent, guard };
};

const taskStrike = (w: TestWorld, security: string, agentId: string, observedBy: string) =>
  w.fact(mayorOf(security), {
    type: 'security.task_strike',
    city: security,
    payload: { agentId, observedBy, task: 'daily ledger entry', evidence: 'no entry for 2026-09-24' },
  });

const strikes = (w: TestWorld, s: ReturnType<typeof setup>, n: number) => {
  for (let i = 0; i < n; i++) taskStrike(w, s.security, s.agent, s.guard);
};

describe('Essentials family: cross-city READ, never edit', () => {
  it('Essentials Mayors read every city; revenue Mayors read only their own', () => {
    const { w, city, security, innovations, other } = setup();
    for (const essentials of [security, innovations]) {
      assert.equal(worldView(w.state, mayorOf(essentials), w.time).cities.length, 4);
    }
    assert.deepEqual(worldView(w.state, mayorOf(city), w.time).cities.map((c) => c.id), [city]);
    const otherEvent = w.ledger.readAll().find((e) => e.type === 'city.created' && e.subject === other)!;
    assert.ok(canRead(mayorOf(security), otherEvent, w.state));
    assert.ok(!canRead(mayorOf(city), otherEvent, w.state));
  });

  it('Essentials Mayors still cannot write another city\'s tag', () => {
    const { w, city, security, innovations } = setup();
    const pulse = { metric: 'qualified_bookings', value: 1, period: 'week', periodStart: '2026-09-21' };
    for (const essentials of [security, innovations]) {
      assert.throws(() => w.ledger.append(mayorOf(essentials), { type: 'city.kpi_pulse', city, payload: pulse }), /outside .* write scope/);
    }
  });
});

describe('Security: deployment and task strikes', () => {
  it('task strikes are recorded under Security\'s own tag and are a separate counter from KPI strikes', () => {
    const s = setup();
    const e = taskStrike(s.w, s.security, s.agent, s.guard);
    assert.equal(e.city, s.security);
    const a = s.w.state.agents.get(s.agent)!;
    assert.equal(a.taskStrikes, 1);
    assert.equal(a.strikes, 0, 'KPI strikes untouched');
    // The home Mayor sees the strike against its own agent; another revenue Mayor does not.
    assert.ok(canRead(mayorOf(s.city), e, s.w.state));
    assert.ok(!canRead(mayorOf(s.other), e, s.w.state));
  });

  it('only a Security agent deployed to the agent\'s city can observe a strike', () => {
    const s = setup();
    const otherDept = s.w.department(s.other, s.w.district(s.other));
    const elsewhere = s.w.agent(s.other, otherDept, 'Kai');
    assert.throws(() => taskStrike(s.w, s.security, elsewhere, s.guard), /not deployed to personal-finance-city/);
    assert.throws(() => taskStrike(s.w, s.security, s.guard, s.guard), /cannot strike itself|not deployed/);
    // A revenue agent is not a Security observer.
    const peer = s.w.agent(s.city, s.dept, 'Juno');
    assert.throws(() => taskStrike(s.w, s.security, s.agent, peer), /not a Security City agent/);
    // Innovations cannot record strikes.
    assert.throws(
      () => s.w.fact(mayorOf(s.innovations), { type: 'security.task_strike', city: s.innovations, payload: { agentId: s.agent, observedBy: s.guard, task: 't', evidence: 'e' } }),
      /only security-city/,
    );
  });

  it('deployment needs Marc\'s routed intent and a graduated Security agent', () => {
    const s = setup();
    const patrol = s.w.state.agents.get(s.guard)!.departmentId!;
    const rookie = s.w.agent(s.security, patrol, 'Warden');
    assert.throws(() => s.w.intent('deploy_agent', s.security, { agentId: rookie, toCity: s.city }), /must be graduated/);
    assert.throws(() => s.w.intent('deploy_agent', s.city, { agentId: s.agent, toCity: s.other }), /only security-city/);
    assert.throws(
      () => s.w.fact(mayorOf(s.security), { type: 'agent.deployed', city: s.security, subject: s.guard, payload: { toCity: s.other } }),
      /must cite an owner intent/,
    );
  });
});

describe('Security jail: 3 task strikes = a term; 6h, 24h, 3 days, then deletion', () => {
  it('escalates terms, releases on its own, and resets task strikes after each term', () => {
    const s = setup();
    const a = () => s.w.state.agents.get(s.agent)!;
    const expected: [number, string][] = [[6, '2026-09-25T18:00:00.000Z'], [24, ''], [72, '']];

    for (const [i, [hours]] of expected.entries()) {
      strikes(s.w, s, 2);
      assert.ok(!isJailed(a(), s.w.time), 'two strikes: still free');
      strikes(s.w, s, 1);
      assert.ok(isJailed(a(), s.w.time), `term ${i + 1} starts on the 3rd strike`);
      assert.equal(a().jail!.term, i + 1);
      assert.equal(a().taskStrikes, 0, 'counter resets');
      assert.equal(Date.parse(a().jail!.until!) - s.w.time.getTime(), hours * 3_600_000);
      if (i === 0) assert.equal(a().jail!.until, expected[0]![1]);

      // Jailed: no work, no climbing, no more strikes.
      assert.throws(() => s.w.promote(s.city, s.agent, 'active'), /in jail \(term/);
      assert.throws(() => taskStrike(s.w, s.security, s.agent, s.guard), /in jail/);
      assert.equal(worldView(s.w.state, owner, s.w.time).jail.length, 1);

      s.w.advanceHours(hours - 1);
      assert.ok(isJailed(a(), s.w.time), 'still inside an hour before release');
      s.w.advanceHours(1);
      assert.ok(!isJailed(a(), s.w.time), 'released on its own');
      assert.equal(worldView(s.w.state, owner, s.w.time).jail.length, 0);
    }

    // 4th time: jailed awaiting deletion, no automatic release.
    strikes(s.w, s, 3);
    assert.equal(a().jail!.status, 'awaiting_deletion');
    assert.equal(a().jail!.term, 4);
    s.w.advanceHours(24 * 365);
    assert.ok(isJailed(a(), s.w.time), 'never released on its own');

    // Marc decides; the home Mayor executes.
    const del = s.w.intent('delete_agent', s.city, { agentId: s.agent });
    s.w.fact(mayorOf(s.city), {
      type: 'agent.deleted',
      city: s.city,
      subject: s.agent,
      payload: { ledgerArchiveRef: 'archive/a', lessonRecordRef: 'lessons/a' },
      authorizedBy: del.seq,
    });
    assert.ok(a().deleted);
    assert.equal(worldView(s.w.state, owner, s.w.time).jail.length, 0);
  });

  it('the jail level never resets, but after a term the agent works normally', () => {
    const s = setup();
    strikes(s.w, s, 3);
    s.w.advanceHours(6);
    s.w.promote(s.city, s.agent, 'active');
    assert.equal(s.w.state.agents.get(s.agent)!.jailTerms, 1);
  });

  it('3rd KPI strike: jailed awaiting deletion; deletion impossible otherwise', () => {
    const s = setup();
    const del = s.w.intent('delete_agent', s.city, { agentId: s.agent });
    const deleteIt = () =>
      s.w.fact(mayorOf(s.city), { type: 'agent.deleted', city: s.city, subject: s.agent, payload: { ledgerArchiveRef: 'x', lessonRecordRef: 'y' }, authorizedBy: del.seq });
    assert.throws(deleteIt, /awaiting deletion/);
    // Serving a timed term is not grounds for deletion either.
    strikes(s.w, s, 3);
    assert.throws(deleteIt, /awaiting deletion/);
    s.w.advanceHours(6);

    s.w.miss(s.city, s.agent);
    s.w.promote(s.city, s.agent, 'probationer');
    s.w.miss(s.city, s.agent);
    s.w.promote(s.city, s.agent, 'probationer');
    s.w.miss(s.city, s.agent, true);
    const jail = s.w.state.agents.get(s.agent)!.jail!;
    assert.deepEqual([jail.status, jail.cause], ['awaiting_deletion', 'kpi_strikes']);
    deleteIt();
  });
});

/** A city created as the Security city (A28), with any name. */
const createSecurityCity = (w: TestWorld, name: string) => {
  const payload = { name, family: 'essentials', mayorName: 'Mayor Oakley', security: true };
  const i = w.intent('create_city', 'WORLD', payload);
  return w.fact(messenger, { type: 'city.created', city: 'WORLD', payload, authorizedBy: i.seq }).subject!;
};

describe('A28: the Security city is the one created as such, whatever its name', () => {
  it('a Security city named HQ runs deployments, task strikes and the jail', () => {
    const w = new TestWorld();
    const hq = createSecurityCity(w, 'HQ');
    assert.equal(hq, 'hq');
    assert.equal(w.state.securityCityId(), 'hq');
    const city = w.city('GGClutchPlays');
    const agent = w.agent(city, w.department(city, w.district(city)), 'Iris');
    w.promote(city, agent, 'probationer');
    const guard = w.agent(hq, w.department(hq, w.district(hq, 'Oversight')), 'Sentinel');
    w.promote(hq, guard, 'probationer');
    const d = w.intent('deploy_agent', hq, { agentId: guard, toCity: city });
    w.fact(mayorOf(hq), { type: 'agent.deployed', city: hq, subject: guard, payload: { toCity: city }, authorizedBy: d.seq });
    for (let i = 0; i < 3; i++) taskStrike(w, hq, agent, guard);
    assert.ok(isJailed(w.state.agents.get(agent)!, w.time), 'jailed by HQ');
    assert.equal(worldView(w.state, owner, w.time).securityCityId, 'hq');
  });

  it('one Security city per world, an Essentials city, and the city record must match the request', () => {
    const w = new TestWorld();
    assert.throws(() => w.intent('create_city', 'WORLD', { name: 'Sec', family: 'revenue', mayorName: 'M', security: true }), /Essentials city/);
    // The recorded city must carry the same choice as Marc's request.
    const payload = { name: 'HQ', family: 'essentials', mayorName: 'M', security: true };
    const i = w.intent('create_city', 'WORLD', payload);
    assert.throws(
      () => w.fact(messenger, { type: 'city.created', city: 'WORLD', payload: { name: 'HQ', family: 'essentials', mayorName: 'M' }, authorizedBy: i.seq }),
      /security does not match/,
    );
    w.fact(messenger, { type: 'city.created', city: 'WORLD', payload, authorizedBy: i.seq });
    assert.throws(() => createSecurityCity(w, 'Second HQ'), /already has its Security city \(hq\)/);
    // Another Essentials city is not the Security city: it can't record strikes.
    const innovations = w.city('Innovations', 'essentials');
    assert.equal(w.state.securityCityId(), 'hq');
    assert.throws(
      () => w.fact(mayorOf(innovations), { type: 'security.task_strike', city: innovations, payload: { agentId: 'AGT-000001', observedBy: 'AGT-000002', task: 't', evidence: 'e' } }),
      /only hq records task strikes/,
    );
  });

  it('an older world keeps its Security City (security-city) and cannot add a second', () => {
    const w = new TestWorld();
    w.city('Security City', 'essentials');
    assert.equal(w.state.securityCityId(), 'security-city');
    assert.throws(() => createSecurityCity(w, 'HQ'), /already has its Security city \(security-city\)/);
    assert.throws(() => w.intent('designate_security_city', w.city('Innovations', 'essentials'), {}), /already has its Security city/);
  });

  it('continued: an Essentials city made before A28 (Marc\'s "Security", renamed HQ) can be made the Security city once', () => {
    const w = new TestWorld();
    const hq = w.city('Security', 'essentials');
    const r = w.intent('rename_city', hq, { name: 'HQ' });
    w.fact(messenger, { type: 'city.renamed', city: hq, payload: { name: 'HQ' }, authorizedBy: r.seq });
    assert.equal(w.state.securityCityId(), null, 'not the Security city until Marc says so');
    assert.throws(() => w.intent('designate_security_city', w.city('GGClutchPlays'), {}), /Essentials city/);

    const d = w.intent('designate_security_city', hq, {});
    assert.throws(() => w.fact(mayorOf(hq), { type: 'city.security_designated', city: hq, payload: {}, authorizedBy: d.seq }), /mayor may not write/);
    w.fact(messenger, { type: 'city.security_designated', city: hq, payload: {}, authorizedBy: d.seq });
    assert.equal(w.state.securityCityId(), 'security');
    assert.equal(worldView(w.state, owner, w.time).securityCityId, 'security');

    // Once only: no second Security city, however it is asked for.
    assert.throws(() => w.intent('designate_security_city', w.city('Innovations', 'essentials'), {}), /already has its Security city \(security\)/);
    assert.throws(() => createSecurityCity(w, 'Second HQ'), /already has its Security city \(security\)/);

    // HQ now deploys and records task strikes.
    const city = w.city('AI Receptionist City');
    const agent = w.agent(city, w.department(city, w.district(city)), 'Iris');
    w.promote(city, agent, 'probationer');
    const guard = w.agent(hq, w.department(hq, w.district(hq, 'Oversight')), 'Sentinel');
    w.promote(hq, guard, 'probationer');
    const dep = w.intent('deploy_agent', hq, { agentId: guard, toCity: city });
    w.fact(mayorOf(hq), { type: 'agent.deployed', city: hq, subject: guard, payload: { toCity: city }, authorizedBy: dep.seq });
    for (let i = 0; i < 3; i++) taskStrike(w, hq, agent, guard);
    assert.ok(isJailed(w.state.agents.get(agent)!, w.time), 'jailed on HQ\'s strikes');
  });
});

describe('A30: every city has its own jail; agents awaiting deletion are held in HQ\'s', () => {
  const heldIn = (w: TestWorld) => worldView(w.state, owner, w.time).jail.map((j) => [j.id, j.heldIn]);
  /** KPI misses up to the 3rd strike: jailed awaiting deletion. */
  const threeMisses = (w: TestWorld, city: string, agent: string) => {
    w.miss(city, agent);
    w.promote(city, agent, 'probationer');
    w.miss(city, agent);
    w.promote(city, agent, 'probationer');
    w.miss(city, agent, true);
  };

  it('a term is served in the home city\'s jail; awaiting deletion, the agent is moved to the Security city\'s', () => {
    const s = setup();
    strikes(s.w, s, 3);
    assert.deepEqual(heldIn(s.w), [[s.agent, s.city]]);
    s.w.advanceHours(6);
    threeMisses(s.w, s.city, s.agent);
    assert.deepEqual(heldIn(s.w), [[s.agent, s.security]]);
  });

  it('with no Security city yet, an agent awaiting deletion stays in its own city\'s jail', () => {
    const w = new TestWorld();
    const city = w.city();
    const agent = w.agent(city, w.department(city, w.district(city)), 'Iris');
    w.promote(city, agent, 'probationer');
    threeMisses(w, city, agent);
    assert.deepEqual(heldIn(w), [[agent, city]]);
  });
});
