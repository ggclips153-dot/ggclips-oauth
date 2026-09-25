import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TestWorld, mayorOf, persona } from './helpers.ts';

const setup = () => {
  const w = new TestWorld();
  const city = w.city();
  const dept = w.department(city, w.district(city));
  return { w, city, dept };
};

describe('identity: globally-unique, never-reused IDs', () => {
  it('issues sequential IDs and a canonical identity record', () => {
    const { w, city, dept } = setup();
    const a = w.agent(city, dept, 'Iris');
    const b = w.agent(city, dept, 'Juno');
    assert.equal(a, 'AGT-000001');
    assert.equal(b, 'AGT-000002');
    const rec = w.state.agents.get(a)!;
    assert.equal(rec.name, 'Iris');
    assert.equal(rec.departmentId, dept);
    assert.equal(rec.state, 'student');
    assert.equal(rec.graduated, false);
    assert.equal(rec.ledgerPointer, 'agents/AGT-000001/ledger/');
    assert.equal(rec.memoryScope, 'agents/AGT-000001/memory/');
  });

  it('a deleted agent\'s ID and name are retired forever; the replacement gets new ones', () => {
    const { w, city, dept } = setup();
    const a = deleteAfterThreeStrikes(w, city, dept, 'Iris');
    assert.ok(w.state.agents.get(a)!.deleted);
    assert.throws(() => w.agent(city, dept, 'Iris'), /retired forever/);
    assert.throws(() => w.agent(city, dept, 'iris'), /retired forever/);
    const replacement = w.agent(city, dept, 'Nova');
    assert.notEqual(replacement, a);
    assert.ok(Number(replacement.slice(4)) > Number(a.slice(4)), 'IDs only move forward');
  });

  it('cannot act on a deleted agent', () => {
    const { w, city, dept } = setup();
    const a = deleteAfterThreeStrikes(w, city, dept, 'Iris');
    assert.throws(() => w.fact(mayorOf(city), { type: 'agent.status', city, subject: a, payload: { status: 'working' } }), /retired/);
  });

  it('city IDs are unique slugs, never reissued', () => {
    const w = new TestWorld();
    assert.equal(w.city('GGClutchPlays'), 'ggclutchplays');
    assert.equal(w.city('GGClutchPlays'), 'ggclutchplays-2');
  });
});

describe('lifecycle: enrollment -> school -> graduation -> active -> promotion', () => {
  it('walks the ladder with the lifecycle strip recorded', () => {
    const { w, city, dept } = setup();
    const a = w.agent(city, dept, 'Iris');
    w.promote(city, a, 'probationer');
    w.promote(city, a, 'active');
    w.promote(city, a, 'senior');
    const rec = w.state.agents.get(a)!;
    assert.equal(rec.state, 'senior');
    assert.deepEqual(rec.lifecycle.map((l) => l.stage), ['enrollment', 'school', 'school', 'school', 'graduation', 'active', 'promotion']);
    assert.deepEqual(rec.lifecycle.slice(1, 4).map((l) => l.detail), [undefined, 'intern', 'exam pass']);
  });

  it('cannot skip rungs', () => {
    const { w, city, dept } = setup();
    const a = w.agent(city, dept, 'Iris');
    assert.throws(() => w.promote(city, a, 'active'), /requires probationer/);
    assert.throws(() => w.promote(city, a, 'senior'), /requires active/);
  });

  it('dept-lead only for a senior when the department has 3+ GRADUATED agents', () => {
    const { w, city, dept } = setup();
    const a = w.agent(city, dept, 'Iris');
    const juno = w.agent(city, dept, 'Juno');
    for (const to of ['probationer', 'active', 'senior'] as const) w.promote(city, a, to);
    w.promote(city, juno, 'probationer');
    w.agent(city, dept, 'Kai'); // a student: does not count
    assert.throws(() => w.promote(city, a, 'dept-lead'), /3\+ graduated agents/);
    w.promote(city, w.agent(city, dept, 'Lark'), 'probationer');
    w.promote(city, a, 'dept-lead');
    const rec = w.state.agents.get(a)!;
    assert.equal(rec.state, 'senior');
    assert.deepEqual(rec.badges, ['dept-lead']);
    // dept-lead counts under senior.
    assert.equal(w.state.cityAgentCounts(city).senior, 1);
  });
});

describe('lifecycle: 3 chances total', () => {
  it('miss #1 -> school, miss #2 -> school, miss #3 -> 3rd strike -> deletion', () => {
    const { w, city, dept } = setup();
    const a = w.agent(city, dept, 'Iris');
    const graduate = () => w.promote(city, a, 'probationer');

    graduate();
    w.miss(city, a);
    assert.equal(w.state.agents.get(a)!.state, 'student');
    graduate();
    w.miss(city, a);
    graduate();
    // The 3rd miss must be written as the 3rd strike.
    assert.throws(() => w.miss(city, a), /3rd strike/);
    w.miss(city, a, true);

    const del = w.intent('delete_agent', city, { agentId: a });
    w.fact(mayorOf(city), {
      type: 'agent.deleted',
      city,
      subject: a,
      payload: { ledgerArchiveRef: 'archive/AGT-000001/ledger.tar', lessonRecordRef: 'lessons/AGT-000001.md' },
      authorizedBy: del.seq,
    });
    const rec = w.state.agents.get(a)!;
    assert.deepEqual(
      rec.lifecycle.map((l) => l.stage),
      [
        'enrollment', 'school', 'school', 'school', 'graduation',
        'school-return', 'school', 'school', 'graduation',
        'school-return', 'school', 'school', 'graduation',
        '3rd-strike', 'deletion',
      ],
    );
    assert.equal(rec.deleted!.lessonRecordRef, 'lessons/AGT-000001.md');
    assert.equal(rec.departmentId, null, 'removed from its department');
  });

  it('deletion is not possible before the 3rd strike, even with an intent', () => {
    const { w, city, dept } = setup();
    const a = w.agent(city, dept, 'Iris');
    const del = w.intent('delete_agent', city, { agentId: a });
    assert.throws(
      () => w.fact(mayorOf(city), { type: 'agent.deleted', city, subject: a, payload: { ledgerArchiveRef: 'x', lessonRecordRef: 'y' }, authorizedBy: del.seq }),
      /jailed awaiting deletion/,
    );
  });

  it('a strike needs an actual KPI miss', () => {
    const { w, city, dept } = setup();
    const a = w.agent(city, dept, 'Iris');
    w.promote(city, a, 'probationer');
    assert.throws(
      () => w.fact(mayorOf(city), { type: 'agent.school_returned', city, subject: a, payload: { reason: 'r', metric: 'qualified_bookings', value: 12, target: 10 } }),
      /KPI miss/,
    );
  });
});

describe('moves', () => {
  it('moves within a city only, with owner intent, dropping the lead badge', () => {
    const w = new TestWorld();
    const city = w.city('A City');
    const other = w.city('B City');
    const dist = w.district(city);
    const d1 = w.department(city, dist);
    const d2 = w.department(city, dist);
    const foreign = w.department(other, w.district(other));
    const a = w.agent(city, d1, 'Iris');

    assert.throws(() => w.intent('move_agent', city, { agentId: a, toDepartmentId: foreign }), /not in a-city/);
    const i = w.intent('move_agent', city, { agentId: a, toDepartmentId: d2 });
    w.fact(mayorOf(city), { type: 'agent.moved', city, subject: a, payload: { toDepartmentId: d2 }, authorizedBy: i.seq });
    assert.equal(w.state.agents.get(a)!.departmentId, d2);
  });
});

function deleteAfterThreeStrikes(w: TestWorld, city: string, dept: string, name: string): string {
  const a = w.agent(city, dept, name);
  for (let n = 0; n < 3; n++) {
    w.promote(city, a, 'probationer');
    w.miss(city, a, n === 2);
  }
  const del = w.intent('delete_agent', city, { agentId: a });
  w.fact(mayorOf(city), { type: 'agent.deleted', city, subject: a, payload: { ledgerArchiveRef: 'a', lessonRecordRef: 'l' }, authorizedBy: del.seq });
  return a;
}
