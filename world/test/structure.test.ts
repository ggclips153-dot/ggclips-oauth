import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { worldView } from '../src/domain/view.ts';
import { TestWorld, mayorOf, owner } from './helpers.ts';

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
