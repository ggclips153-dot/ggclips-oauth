import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { worldView } from '../src/domain/view.ts';
import { TestWorld, mayorOf, messenger, owner } from './helpers.ts';

const apply = (w: TestWorld, city: string, type: string, fact: string, payload: Record<string, unknown>) => {
  const i = w.intent(type, city, payload);
  return w.fact(mayorOf(city), { type: fact, city, payload, authorizedBy: i.seq });
};

describe('renaming and deleting districts and departments', () => {
  it('renames a district and a department', () => {
    const w = new TestWorld();
    const city = w.city();
    const dist = w.district(city, 'Front Desk');
    const dept = w.department(city, dist);
    apply(w, city, 'rename_district', 'district.renamed', { districtId: dist, name: 'Reception', supervisor: 'Hale' });
    apply(w, city, 'rename_department', 'department.renamed', { departmentId: dept, name: 'Bookings' });
    assert.deepEqual([w.state.districts.get(dist)!.name, w.state.districts.get(dist)!.supervisor], ['Reception', 'Hale']);
    assert.equal(w.state.departments.get(dept)!.name, 'Bookings');
    assert.equal(w.state.departments.get(dept)!.scope, 'Book qualified appointments', 'scope unchanged when not given');
  });

  it('deletes only what is empty: a department without agents, a district without departments', () => {
    const w = new TestWorld();
    const city = w.city();
    const dist = w.district(city);
    const dept = w.department(city, dist);
    const a = w.agent(city, dept, 'Iris');
    assert.throws(() => w.intent('delete_district', city, { districtId: dist }), /still has 1 department/);
    assert.throws(() => w.intent('delete_department', city, { departmentId: dept }), /still has 1 agent\(s\): Iris/);
    const other = w.department(city, dist);
    const i = w.intent('move_agent', city, { agentId: a, toDepartmentId: other });
    w.fact(mayorOf(city), { type: 'agent.moved', city, subject: a, payload: { toDepartmentId: other }, authorizedBy: i.seq });
    const prof = w.professor(city, dept);
    apply(w, city, 'delete_department', 'department.deleted', { departmentId: dept });
    assert.ok(!w.state.departments.has(dept));
    assert.equal(w.state.agents.get(prof)!.specialtyDepartmentId, null, 'its professor keeps teaching, without a specialty');
    assert.throws(() => apply(w, city, 'delete_department', 'department.deleted', { departmentId: other }), /still has 1 agent/);
  });

  it('a deleted district disappears from the view and its ID is never reused', () => {
    const w = new TestWorld();
    const city = w.city();
    const dist = w.district(city, 'Old');
    apply(w, city, 'delete_district', 'district.deleted', { districtId: dist });
    assert.deepEqual(worldView(w.state, owner, w.time).cities[0]!.districts, []);
    const next = w.district(city, 'New');
    assert.notEqual(next, dist);
  });

  it("a Mayor cannot rename or delete another city's district", () => {
    const w = new TestWorld();
    const a = w.city();
    const b = w.city('Personal Finance City');
    const dist = w.district(a);
    assert.throws(() => w.intent('rename_district', b, { districtId: dist, name: 'x' }), /not in/);
  });
});

describe('renaming a city', () => {
  it('only the name changes: the ID, Mayor and districts stay', () => {
    const w = new TestWorld();
    const city = w.city('Security', 'essentials');
    const dist = w.district(city, 'Oversight');
    const i = w.intent('rename_city', city, { name: 'HQ' });
    w.fact(messenger, { type: 'city.renamed', city, payload: { name: 'HQ' }, authorizedBy: i.seq });
    const c = worldView(w.state, owner, w.time).cities[0]!;
    assert.deepEqual([c.id, c.name, c.mayorName, c.districts.map((d) => d.id)], ['security', 'HQ', 'Mayor Ada', [dist]]);
  });

  it("the World Messenger records it, as Marc asked, never a Mayor or the Messenger on its own", () => {
    const w = new TestWorld();
    const city = w.city();
    assert.throws(() => w.fact(messenger, { type: 'city.renamed', city, payload: { name: 'HQ' } }), /must cite an owner intent/);
    const i = w.intent('rename_city', city, { name: 'HQ' });
    assert.throws(() => w.fact(mayorOf(city), { type: 'city.renamed', city, payload: { name: 'HQ' }, authorizedBy: i.seq }), /mayor may not write city\.renamed/);
    assert.throws(() => w.fact(messenger, { type: 'city.renamed', city, payload: { name: 'Other' }, authorizedBy: i.seq }), /does not match/);
    assert.throws(() => w.intent('rename_city', 'no-such-city', { name: 'HQ' }), /unknown city/);
    assert.throws(() => w.intent('rename_city', city, { name: '  ' }), /must not be empty/);
  });

  it("the old name's ID is never reused: a new city with that name gets a new ID", () => {
    const w = new TestWorld();
    const city = w.city('Security', 'essentials');
    const i = w.intent('rename_city', city, { name: 'HQ' });
    w.fact(messenger, { type: 'city.renamed', city, payload: { name: 'HQ' }, authorizedBy: i.seq });
    assert.equal(w.city('Security', 'essentials'), 'security-2');
  });
});

describe('creating an agent at the college with just its focus', () => {
  it('needs only the focus; the persona is optional', () => {
    const w = new TestWorld();
    const city = w.city();
    const i = w.intent('create_agent', city, { domainFocus: 'dental bookings' });
    const a = w.fact(mayorOf(city), { type: 'agent.enrolled', city, payload: i.payload, authorizedBy: i.seq }).subject!;
    const agent = w.state.agents.get(a)!;
    assert.equal(agent.domainFocus, 'dental bookings');
    assert.equal(agent.persona, null);
    assert.ok(agent.name, 'a name is generated');
    assert.throws(() => w.intent('create_agent', city, {}), /domainFocus is required/);
  });
});
