import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { worldView } from '../src/domain/view.ts';
import { TestWorld, mayorOf, owner, persona } from './helpers.ts';

const BASIC = ['draft follow-up email', 'log call notes'];

/** A department with caps (A9): at most 2 graduated agents and 1 shadow. */
const setup = (settings: Record<string, unknown> = { maxGraduated: 2, maxShadows: 1, basicTasks: BASIC }) => {
  const w = new TestWorld();
  const city = w.city();
  const district = w.district(city);
  const payload = { districtId: district, name: 'Booking', scope: 'Book qualified appointments', ...settings };
  const i = w.intent('create_department', city, payload);
  const dept = w.fact(mayorOf(city), { type: 'department.created', city, payload, authorizedBy: i.seq }).subject!;
  return { w, city, district, dept, mayor: mayorOf(city) };
};

const intern = (w: TestWorld, city: string, id: string) =>
  w.fact(mayorOf(city), { type: 'agent.interned', city, subject: id, payload: {} });

describe('department caps (A9)', () => {
  it('caps shadows and graduated ("fully working") agents; students are not capped', () => {
    const { w, city, dept } = setup();
    const [a, b, c, d] = ['Iris', 'Juno', 'Kai', 'Lark'].map((n) => w.agent(city, dept, n)) as [string, string, string, string];
    intern(w, city, a);
    assert.throws(() => intern(w, city, b), /shadows cap \(1\)/);
    w.promote(city, a, 'probationer'); // graduating frees the shadow place
    w.promote(city, b, 'probationer');
    intern(w, city, c);
    w.exam(city, c);
    assert.throws(() => w.fact(mayorOf(city), { type: 'agent.graduated', city, subject: c, payload: {} }), /graduated cap \(2\)/);
    assert.equal(w.state.departmentAgents(dept).length, 4, 'd is a student; students are not capped');
    void d;
  });

  it('Marc can change the caps later (routed through the DM)', () => {
    const { w, city, dept } = setup();
    const payload = { departmentId: dept, maxGraduated: 5, maxShadows: 3, basicTasks: BASIC };
    const i = w.intent('configure_department', city, payload);
    w.fact(mayorOf(city), { type: 'department.configured', city, payload, authorizedBy: i.seq });
    const d = w.state.departments.get(dept)!;
    assert.deepEqual([d.maxGraduated, d.maxShadows], [5, 3]);
    // Omitting a cap removes it.
    const j = w.intent('configure_department', city, { departmentId: dept });
    w.fact(mayorOf(city), { type: 'department.configured', city, payload: { departmentId: dept }, authorizedBy: j.seq });
    assert.deepEqual([d.maxGraduated, d.maxShadows, d.basicTasks], [null, null, []]);
  });

  it('caps apply to moves into the department too', () => {
    const { w, city, district, dept } = setup({ maxGraduated: 1 });
    const payload = { districtId: district, name: 'Intake', scope: 'Intake calls' };
    const i = w.intent('create_department', city, payload);
    const other = w.fact(mayorOf(city), { type: 'department.created', city, payload, authorizedBy: i.seq }).subject!;
    w.promote(city, w.agent(city, dept, 'Iris'), 'probationer');
    const mover = w.agent(city, other, 'Juno');
    w.promote(city, mover, 'probationer');
    const move = w.intent('move_agent', city, { agentId: mover, toDepartmentId: dept });
    assert.throws(
      () => w.fact(mayorOf(city), { type: 'agent.moved', city, subject: mover, payload: { toDepartmentId: dept }, authorizedBy: move.seq }),
      /graduated cap \(1\)/,
    );
  });

  it('rejects a malformed basic-task list', () => {
    const w = new TestWorld();
    const city = w.city();
    const districtId = w.district(city);
    const bad = (basicTasks: unknown) => () =>
      w.ledger.append(owner, { type: 'intent.create_department', city, payload: { districtId, name: 'X', scope: 's', basicTasks } });
    assert.throws(bad(['a', 'a']), /duplicates/);
    assert.throws(bad([1]), /must be text/);
    assert.throws(bad('a'), /must be a list/);
  });
});

describe('delegation, option B (A9)', () => {
  const ready = () => {
    const s = setup();
    const boss = s.w.agent(s.city, s.dept, 'Iris');
    s.w.promote(s.city, boss, 'probationer');
    const shadow = s.w.agent(s.city, s.dept, 'Juno');
    intern(s.w, s.city, shadow);
    return { ...s, boss, shadow };
  };
  const delegate = (s: ReturnType<typeof ready>, from: string, to: string, task = BASIC[0]!) =>
    s.w.fact(s.mayor, { type: 'task.delegated', city: s.city, subject: to, payload: { fromAgentId: from, task } });

  it('a graduated agent hands an approved basic task to a shadow in its own department; it comes back as data', () => {
    const s = ready();
    const d = delegate(s, s.boss, s.shadow);
    assert.equal(worldView(s.w.state, owner, s.w.time).cities[0]!.districts[0]!.departments[0]!.openDelegations.length, 1);
    s.w.fact(s.mayor, { type: 'task.returned', city: s.city, subject: s.shadow, payload: { delegationSeq: d.seq, outcome: 'done', resultRef: 'notes/1' } });
    assert.equal(s.w.state.delegations.get(d.seq)!.returned!.outcome, 'done');
    assert.throws(
      () => s.w.fact(s.mayor, { type: 'task.returned', city: s.city, subject: s.shadow, payload: { delegationSeq: d.seq, outcome: 'done' } }),
      /already returned/,
    );
  });

  it('only approved tasks, only to shadows, only from graduated agents of the same department', () => {
    const s = ready();
    assert.throws(() => delegate(s, s.boss, s.shadow, 'wire money'), /not on .* approved basic-task list/);
    const student = s.w.agent(s.city, s.dept, 'Kai');
    assert.throws(() => delegate(s, s.boss, student), /not a shadow/);
    assert.throws(() => delegate(s, student, s.shadow), /not graduated/);
    // A graduated agent from another department cannot delegate here.
    const payload = { districtId: s.district, name: 'Intake', scope: 'x' };
    const i = s.w.intent('create_department', s.city, payload);
    const other = s.w.fact(s.mayor, { type: 'department.created', city: s.city, payload, authorizedBy: i.seq }).subject!;
    const outsider = s.w.agent(s.city, other, 'Lark');
    s.w.promote(s.city, outsider, 'probationer');
    assert.throws(() => delegate(s, outsider, s.shadow), /only a graduated agent in DPT-\d+ may delegate/);
    // Nor can one shadow delegate to another.
    assert.throws(() => delegate(s, s.shadow, s.shadow), /not graduated/);
  });

  it('delegations can only be recorded by the city\'s own Mayor', () => {
    const s = ready();
    assert.throws(
      () => s.w.ledger.append(owner, { type: 'task.delegated', city: s.city, subject: s.shadow, payload: { fromAgentId: s.boss, task: BASIC[0] } }),
      /may not write/,
    );
  });
});

describe('professors (A10)', () => {
  it('custom-created with a generated name and a never-reused ID; teach one department', () => {
    const { w, city, dept } = setup();
    const i = w.intent('create_professor', city, { persona, domainFocus: 'booking scripts', departmentId: dept });
    assert.ok((i.payload.name as string).length > 0);
    const prof = w.fact(mayorOf(city), { type: 'professor.enrolled', city, payload: i.payload, authorizedBy: i.seq }).subject!;
    assert.match(prof, /^AGT-\d{6}$/);
    assert.equal(w.state.professors.get(prof)!.departmentId, dept);
    // Professors are not graduated agents: they don't count toward caps or dept-lead.
    assert.equal(w.state.graduatedIn(dept).length, 0);
  });

  it('only a professor of the student\'s own department can examine it', () => {
    const { w, city, district, dept } = setup();
    const payload = { districtId: district, name: 'Intake', scope: 'x' };
    const i = w.intent('create_department', city, payload);
    const other = w.fact(mayorOf(city), { type: 'department.created', city, payload, authorizedBy: i.seq }).subject!;
    const wrongProf = w.professor(city, other);
    const student = w.agent(city, dept, 'Iris');
    assert.throws(
      () => w.fact(mayorOf(city), { type: 'exam.graded', city, subject: student, payload: { professorId: wrongProf, result: 'pass' } }),
      /does not teach/,
    );
  });

  it('a return to school wipes the old exam pass', () => {
    const { w, city, dept } = setup({});
    const a = w.agent(city, dept, 'Iris');
    w.promote(city, a, 'probationer');
    w.miss(city, a);
    intern(w, city, a);
    assert.throws(() => w.fact(mayorOf(city), { type: 'agent.graduated', city, subject: a, payload: {} }), /passed exam/);
  });

  it('can step in to fill a role for a set time, ending on its own', () => {
    const { w, city, dept } = setup();
    const prof = w.professor(city, dept);
    w.fact(mayorOf(city), { type: 'professor.stepped_in', city, payload: { professorId: prof, role: 'cover Iris while jailed', hours: 6 } });
    const view = () => worldView(w.state, owner, w.time).cities[0]!.districts[0]!.departments[0]!.professors[0]!;
    assert.equal(view().steppedIn!.role, 'cover Iris while jailed');
    w.advanceHours(6);
    assert.equal(view().steppedIn, null);
  });
});
