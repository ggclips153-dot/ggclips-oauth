import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isJailed } from '../src/domain/state.ts';
import { worldView } from '../src/domain/view.ts';
import { TestWorld, mayorOf, owner, persona } from './helpers.ts';

const setup = () => {
  const w = new TestWorld();
  const city = w.city();
  const district = w.district(city);
  const dept = w.department(city, district);
  return { w, city, district, dept, mayor: mayorOf(city) };
};

const college = (w: TestWorld, city: string) => worldView(w.state, owner, w.time).cities.find((c) => c.id === city)!.college;

describe('the college (A11): agents are created here, departments take existing ones', () => {
  it('a new agent starts at the college, enrolled and unplaced', () => {
    const { w, city } = setup();
    const id = w.collegeAgent(city);
    const a = w.state.agents.get(id)!;
    assert.deepEqual([a.state, a.departmentId], ['enrolled', null]);
    assert.deepEqual(college(w, city).enrolled.map((e) => e.id), [id]);
  });

  it('New Agent no longer takes a department', () => {
    const { w, city, dept } = setup();
    assert.throws(
      () => w.ledger.append(owner, { type: 'intent.create_agent', city, payload: { persona, domainFocus: 'x', departmentId: dept } }),
      /departmentId is not a known field/,
    );
  });

  it('adding to a department assigns an EXISTING agent of that city; it never creates one', () => {
    const { w, city, dept } = setup();
    const id = w.collegeAgent(city, 'Iris');
    const before = w.state.agents.size;
    w.place(city, id, dept);
    assert.equal(w.state.agents.size, before, 'no new agent');
    assert.deepEqual([w.state.agents.get(id)!.state, w.state.agents.get(id)!.departmentId], ['student', dept]);
    assert.equal(college(w, city).enrolled.length, 0);

    assert.throws(() => w.intent('place_agent', city, { agentId: 'AGT-999999', departmentId: dept }), /unknown agent/);
    const other = w.city('Personal Finance City');
    const outsider = w.collegeAgent(other, 'Kai');
    assert.throws(() => w.intent('place_agent', city, { agentId: outsider, departmentId: dept }), /not in ai-receptionist-city/);
    assert.throws(() => w.place(city, id, dept), /already placed/);
  });
});

describe('professors at the college (A10, A11)', () => {
  it('created at the college, optionally specialised in an existing department; can be specialised later', () => {
    const { w, city, dept } = setup();
    const i = w.intent('create_professor', city, { persona, domainFocus: 'booking' });
    const prof = w.fact(mayorOf(city), { type: 'professor.enrolled', city, payload: i.payload, authorizedBy: i.seq }).subject!;
    assert.equal(w.state.agents.get(prof)!.specialtyDepartmentId, null);
    assert.deepEqual(college(w, city).professors.map((p) => p.id), [prof]);

    const student = w.agent(city, dept, 'Iris');
    const examine = () => w.fact(mayorOf(city), { type: 'exam.graded', city, subject: student, payload: { professorId: prof, result: 'pass' } });
    assert.throws(examine, /does not teach/);

    const s = w.intent('specialize_professor', city, { professorId: prof, departmentId: dept });
    w.fact(mayorOf(city), { type: 'professor.specialized', city, payload: { professorId: prof, departmentId: dept }, authorizedBy: s.seq });
    examine();
    assert.equal(w.state.agents.get(student)!.lastExam!.result, 'pass');
  });

  it('professors are not department agents: no placement, promotion or state counts', () => {
    const { w, city, dept } = setup();
    const prof = w.professor(city, dept);
    assert.throws(() => w.intent('place_agent', city, { agentId: prof, departmentId: dept }), /is a professor/);
    assert.throws(() => w.intent('promote_agent', city, { agentId: prof, to: 'active' }), /is a professor/);
    assert.equal(Object.values(w.state.cityAgentCounts(city)).reduce((x, y) => x + y, 0), 0);
  });

  it('a senior (tier 5) agent can retire into a professor, keeping its ID and name', () => {
    const { w, city, dept } = setup();
    const a = w.agent(city, dept, 'Iris');
    assert.throws(() => w.intent('retire_to_professor', city, { agentId: a }), /only a senior/);
    for (const to of ['probationer', 'active', 'senior'] as const) w.promote(city, a, to);
    const i = w.intent('retire_to_professor', city, { agentId: a });
    w.fact(mayorOf(city), { type: 'agent.retired_to_professor', city, subject: a, payload: {}, authorizedBy: i.seq });
    const rec = w.state.agents.get(a)!;
    assert.deepEqual([rec.id, rec.name, rec.role, rec.departmentId, rec.specialtyDepartmentId], [a, 'Iris', 'professor', null, dept]);
    assert.equal(w.state.graduatedIn(dept).length, 0, 'left the department');
    assert.equal(w.state.cityAgentCounts(city).senior, 0, 'counted at the college, not in state counts');
  });

  it('a department reports an unfilled role; the Mayor sends a professor of THAT specialty, for a set time', () => {
    const { w, city, district, dept, mayor } = setup();
    const other = w.department(city, district);
    const specialist = w.professor(city, dept);
    const wrong = w.professor(city, other);
    const req = w.fact(mayor, { type: 'department.role_requested', city, payload: { departmentId: dept, role: 'front-desk caller' } });
    const stepIn = (professorId: string) => () =>
      w.fact(mayor, { type: 'professor.stepped_in', city, payload: { professorId, departmentId: dept, role: 'front-desk caller', hours: 24, requestSeq: req.seq } });

    assert.throws(stepIn(wrong), /does not specialise/);
    stepIn(specialist)();
    assert.throws(stepIn(specialist), /already filled/);
    assert.equal(w.state.roleRequests.get(req.seq)!.filledBy!.professorId, specialist);
    w.advanceHours(24);
    assert.equal(college(w, city).professors.find((p) => p.id === specialist)!.steppedIn, null, 'ends on its own');
  });
});

describe('professors follow the same strike rules as everybody else', () => {
  it('task strikes jail a professor on the same ladder; a jailed professor cannot teach or step in', () => {
    const w = new TestWorld();
    const city = w.city();
    const dept = w.department(city, w.district(city));
    const prof = w.professor(city, dept);
    const security = w.city('Security City', 'essentials');
    const guard = w.agent(security, w.department(security, w.district(security)), 'Sentinel');
    w.promote(security, guard, 'probationer');
    const d = w.intent('deploy_agent', security, { agentId: guard, toCity: city });
    w.fact(mayorOf(security), { type: 'agent.deployed', city: security, subject: guard, payload: { toCity: city }, authorizedBy: d.seq });

    for (let i = 0; i < 3; i++) {
      w.fact(mayorOf(security), { type: 'security.task_strike', city: security, payload: { agentId: prof, observedBy: guard, task: 'grade exams', evidence: 'none graded' } });
    }
    const p = w.state.agents.get(prof)!;
    assert.ok(isJailed(p, w.time));
    assert.equal(p.jail!.term, 1);
    const student = w.agent(city, dept, 'Iris');
    assert.throws(() => w.fact(mayorOf(city), { type: 'exam.graded', city, subject: student, payload: { professorId: prof, result: 'pass' } }), /in jail/);
    assert.throws(
      () => w.fact(mayorOf(city), { type: 'professor.stepped_in', city, payload: { professorId: prof, departmentId: dept, role: 'r', hours: 1 } }),
      /in jail/,
    );
    w.advanceHours(6);
    assert.ok(!isJailed(p, w.time));
  });

  it('professors take TEACHING strikes, not KPI strikes: 3 = held awaiting deletion (A13)', () => {
    const { w, city, dept, mayor } = setup();
    const prof = w.professor(city, dept);
    assert.throws(() => w.miss(city, prof), /professors take teaching strikes/);
    const strike = () =>
      w.fact(mayor, { type: 'professor.strike', city, payload: { professorId: prof, rule: 'exam not graded within 48h', evidence: 'exam #12 open 3 days' } });
    strike();
    strike();
    const p = w.state.agents.get(prof)!;
    assert.deepEqual([p.role, p.strikes, p.jail], ['professor', 2, null], 'keeps its post until the 3rd');
    strike();
    assert.deepEqual([p.jail!.status, p.jail!.cause], ['awaiting_deletion', 'teaching_strikes']);
    assert.throws(strike, /awaits deletion/);
    // Only a professor can take a teaching strike, and only in its own city.
    const student = w.agent(city, dept, 'Iris');
    assert.throws(() => w.fact(mayor, { type: 'professor.strike', city, payload: { professorId: student, rule: 'r', evidence: 'e' } }), /unknown professor/);

    const del = w.intent('delete_agent', city, { agentId: prof });
    w.fact(mayor, { type: 'agent.deleted', city, subject: prof, payload: { ledgerArchiveRef: 'a', lessonRecordRef: 'l' }, authorizedBy: del.seq });
    assert.equal(college(w, city).professors.length, 0);
  });

  it('keeps each professor\'s teaching record: exams given, passed, and students graduated under it', () => {
    const { w, city, dept } = setup();
    const prof = w.professor(city, dept);
    const a = w.agent(city, dept, 'Iris');
    w.exam(city, a, 'fail');
    w.promote(city, a, 'probationer'); // intern + pass + graduate
    w.promote(city, w.agent(city, dept, 'Juno'), 'probationer');
    assert.deepEqual(w.state.agents.get(prof)!.teaching, { examsGiven: 3, examsPassed: 2, graduates: 2 });
    assert.deepEqual(college(w, city).professors[0]!.teaching, { examsGiven: 3, examsPassed: 2, graduates: 2 });
  });
});
