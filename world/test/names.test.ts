import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { suggestNames } from '../src/domain/names.ts';
import { Ledger } from '../src/ledger/ledger.ts';
import { TestWorld, mayorOf, owner, persona } from './helpers.ts';

describe('name generator', () => {
  it('suggests distinct names, never a reserved name or a Mayor\'s', () => {
    const w = new TestWorld();
    w.city(); // Mayor is "Mayor Ada"
    const names = suggestNames(w.state, 20, { first: ['Marc', 'Bob', 'Mayor Ada', 'Iris', ...Array.from({ length: 30 }, (_, i) => `N${i}`)] });
    assert.equal(new Set(names).size, 20);
    for (const n of ['Marc', 'Bob', 'Mayor Ada']) assert.ok(!names.includes(n));
  });

  it('skips living and retired names, then falls back to First Surname', () => {
    const w = new TestWorld();
    const city = w.city();
    const dept = w.department(city, w.district(city));
    w.agent(city, dept, 'Iris');
    w.state.retiredNames.add('juno');
    const names = suggestNames(w.state, 3, { first: ['Iris', 'Juno', 'Kai'], last: ['Stone'], rand: () => 0 });
    assert.deepEqual(names, ['Kai', 'Iris Stone', 'Juno Stone']);
  });

  it('a New Agent intent without a name gets one generated and recorded', () => {
    const w = new TestWorld();
    const city = w.city();
    const dept = w.department(city, w.district(city));
    const intent = w.ledger.append(owner, { type: 'intent.create_agent', city, payload: { persona, domainFocus: 'hvac', departmentId: dept } });
    const name = intent.payload.name as string;
    assert.ok(name.length > 0);
    w.ledger.append({ id: 'dm', role: 'dm', writeScope: ['*'] }, { type: 'dm.routed', city, payload: { intentSeq: intent.seq, to: 'mayor' } });
    // The Mayor must enroll exactly the generated name.
    assert.throws(
      () => w.fact(mayorOf(city), { type: 'agent.enrolled', city, payload: { name: 'Other', persona, domainFocus: 'hvac', departmentId: dept }, authorizedBy: intent.seq }),
      /does not match/,
    );
    const e = w.fact(mayorOf(city), { type: 'agent.enrolled', city, payload: { name, persona, domainFocus: 'hvac', departmentId: dept }, authorizedBy: intent.seq });
    assert.equal(w.state.agents.get(e.subject!)!.name, name);
  });

  it('generation is injectable and deterministic for tests', () => {
    const l = new Ledger({ path: ':memory:', names: { first: ['Solo'], rand: () => 0 } });
    assert.deepEqual(l.suggestNames(1), ['Solo']);
  });
});
