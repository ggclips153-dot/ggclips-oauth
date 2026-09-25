import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canRead, worldView } from '../src/domain/view.ts';
import { TestWorld, mayorOf, owner, persona } from './helpers.ts';

const setup = () => {
  const w = new TestWorld();
  const city = w.city();
  const dept = w.department(city, w.district(city));
  const security = w.city('Security City', 'essentials');
  return { w, city, dept, security, mayor: mayorOf(city) };
};

const appointDean = (w: TestWorld, city: string) => {
  const i = w.intent('create_dean', city, { persona, domainFocus: 'running the college' });
  return w.fact(mayorOf(city), { type: 'dean.appointed', city, payload: i.payload, authorizedBy: i.seq }).subject!;
};

const view = (w: TestWorld, city: string, by = owner) => worldView(w.state, by, w.time).cities.find((c) => c.id === city)!;

describe('the Dean (A14)', () => {
  it('Marc creates the college\'s dean (generated name, never-reused ID); one per college', () => {
    const { w, city } = setup();
    const dean = appointDean(w, city);
    const rec = w.state.agents.get(dean)!;
    assert.match(dean, /^AGT-\d{6}$/);
    assert.equal(rec.role, 'dean');
    assert.equal(view(w, city).college.dean!.id, dean);
    assert.throws(() => w.intent('create_dean', city, { persona, domainFocus: 'x' }), /already has a dean/);
    // A dean is not a department agent.
    assert.throws(() => w.intent('promote_agent', city, { agentId: dean, to: 'active' }), /is a dean at the college/);
  });

  it('is judged on how its graduates perform in their fields', () => {
    const { w, city, dept } = setup();
    const before = w.agent(city, dept, 'Early');
    w.promote(city, before, 'probationer'); // graduated before the dean took office: not counted
    appointDean(w, city);
    const [a, b, c] = ['Iris', 'Juno', 'Kai'].map((n) => w.agent(city, dept, n)) as [string, string, string];
    for (const id of [a, b, c]) w.promote(city, id, 'probationer');
    w.promote(city, a, 'active');
    w.miss(city, b);
    const card = view(w, city).college.dean!.scorecard;
    assert.deepEqual(card, { graduates: 3, stillWorking: 2, promotedPastProbation: 1, kpiStrikes: 1, jailTerms: 0, inJailNow: 0, deleted: 0 });
  });

  it('the Mayor judges the dean', () => {
    const { w, city, mayor } = setup();
    const dean = appointDean(w, city);
    w.fact(mayor, { type: 'dean.reviewed', city, payload: { deanId: dean, rating: 'meets', notes: 'graduates steady' } });
    assert.equal(view(w, city).college.dean!.reviews[0]!.rating, 'meets');
    assert.throws(() => w.fact(mayor, { type: 'dean.reviewed', city, payload: { deanId: 'AGT-999999', rating: 'meets', notes: 'x' } }), /not the dean/);
  });
});

describe('dean reports -> Security -> Marc (A15)', () => {
  it('the dean reports work not being done; Security escalates it to Marc\'s inbox', () => {
    const { w, city, dept, security, mayor } = setup();
    const dean = appointDean(w, city);
    const lazy = w.agent(city, dept, 'Iris');
    const r = w.fact(mayor, { type: 'dean.reported', city, payload: { deanId: dean, agentId: lazy, reason: 'skipped daily study', evidence: 'no entries 3 days' } });
    assert.equal(view(w, city).deanReports.length, 1);
    assert.equal(worldView(w.state, owner, w.time).escalations.length, 0, 'not in Marc\'s inbox until Security escalates');

    // Security reads it (cross-city read) and escalates under its own tag.
    assert.ok(canRead(mayorOf(security), r, w.state));
    const e = w.fact(mayorOf(security), { type: 'security.escalated', city: security, payload: { reportSeq: r.seq, summary: 'Iris idle 3 days' } });
    const inbox = worldView(w.state, owner, w.time).escalations;
    assert.deepEqual(inbox.map((x) => [x.agentId, x.escalated!.summary]), [[lazy, 'Iris idle 3 days']]);
    assert.ok(canRead(mayor, e, w.state), 'the home Mayor sees the escalation about its city');
    assert.throws(
      () => w.fact(mayorOf(security), { type: 'security.escalated', city: security, payload: { reportSeq: r.seq, summary: 'again' } }),
      /already escalated/,
    );
  });

  it('only the city\'s own dean reports, only agents of its city, and only Security escalates', () => {
    const { w, city, dept, mayor } = setup();
    const dean = appointDean(w, city);
    const other = w.city('Personal Finance City');
    const outsider = w.agent(other, w.department(other, w.district(other)), 'Kai');
    const report = (payload: Record<string, unknown>) => () => w.fact(mayor, { type: 'dean.reported', city, payload: { reason: 'r', evidence: 'e', ...payload } });
    assert.throws(report({ deanId: dean, agentId: outsider }), /not in ai-receptionist-city/);
    assert.throws(report({ deanId: dean, agentId: dean }), /cannot report itself/);
    const staff = w.agent(city, dept, 'Iris');
    assert.throws(report({ deanId: staff, agentId: staff }), /not the dean/);
    const r = report({ deanId: dean, agentId: staff })();
    assert.throws(() => w.fact(mayor, { type: 'security.escalated', city, payload: { reportSeq: r.seq, summary: 's' } }), /only security-city escalates/);
  });
});

describe('replacing a dean (A16)', () => {
  it('an outstanding professor becomes dean; the outgoing dean returns to teaching', () => {
    const { w, city, dept, mayor } = setup();
    const oldDean = appointDean(w, city);
    const prof = w.professor(city, dept);
    w.promote(city, w.agent(city, dept, 'Iris'), 'probationer'); // counted for the old dean

    assert.throws(() => w.fact(mayor, { type: 'dean.replaced', city, payload: { professorId: prof } }), /must cite an owner intent/);
    const i = w.intent('replace_dean', city, { professorId: prof });
    w.fact(mayor, { type: 'dean.replaced', city, payload: { professorId: prof }, authorizedBy: i.seq });

    const college = view(w, city).college;
    assert.equal(college.dean!.id, prof);
    assert.equal(college.dean!.scorecard.graduates, 0, 'fresh scorecard');
    assert.equal(w.state.agents.get(prof)!.teaching!.graduates, 1, 'its teaching record is kept');
    assert.ok(college.professors.some((p) => p.id === oldDean), 'old dean is a professor again');
  });

  it('only a professor of this college, not in jail, can be made dean', () => {
    const { w, city, dept } = setup();
    appointDean(w, city);
    const student = w.agent(city, dept, 'Iris');
    assert.throws(() => w.intent('replace_dean', city, { professorId: student }), /unknown professor/);
    const other = w.city('Personal Finance City');
    const foreign = w.professor(other, w.department(other, w.district(other)));
    assert.throws(() => w.intent('replace_dean', city, { professorId: foreign }), /not in ai-receptionist-city/);
  });

  it('a college with no dean can take its first one from its professors', () => {
    const { w, city, dept, mayor } = setup();
    const prof = w.professor(city, dept);
    const i = w.intent('replace_dean', city, { professorId: prof });
    w.fact(mayor, { type: 'dean.replaced', city, payload: { professorId: prof }, authorizedBy: i.seq });
    assert.equal(w.state.deanOf(city)!.id, prof);
  });
});
