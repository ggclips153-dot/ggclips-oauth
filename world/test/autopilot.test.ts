import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { describe, it } from 'node:test';
import { attachDemoAutopilot } from '../src/server/demoAutopilot.ts';
import { TestWorld, owner, persona } from './helpers.ts';

const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
};

describe('demo autopilot (demo.db only)', () => {
  it('refuses to attach to the real ledger', () => {
    const w = new TestWorld();
    assert.throws(() => attachDemoAutopilot(w.ledger, '/srv/world/data/world.db', () => {}), /only runs on data\/demo.db/);
  });

  it('routes and carries out Marc\'s requests through the normal write-guard', async () => {
    const w = new TestWorld();
    attachDemoAutopilot(w.ledger, '/x/data/demo.db', () => {});
    w.ledger.append(owner, { type: 'intent.create_city', city: 'WORLD', payload: { name: 'Demo City', family: 'claude', mayorName: 'Nia', initialDistricts: [{ name: 'Ops', supervisor: 'Rae' }] } });
    await settle();
    const city = w.state.cities.get('demo-city')!;
    assert.equal(city.family, 'claude');
    assert.equal([...w.state.districts.values()].filter((d) => d.cityId === 'demo-city').length, 1);

    w.ledger.append(owner, { type: 'intent.create_agent', city: 'demo-city', payload: { persona, domainFocus: 'ops' } });
    await settle();
    const agent = [...w.state.agents.values()].find((a) => a.cityId === 'demo-city')!;
    assert.equal(agent.state, 'enrolled');
    assert.equal(w.state.routed.size, 2);
  });

  it('a request the rules reject is routed but not carried out', async () => {
    const w = new TestWorld();
    const logs: string[] = [];
    const city = w.city();
    const dept = w.department(city, w.district(city));
    const id = w.agent(city, dept, 'Iris');
    attachDemoAutopilot(w.ledger, '/x/data/demo.db', (m) => logs.push(m));
    w.ledger.append(owner, { type: 'intent.promote_agent', city, payload: { agentId: id, to: 'active' } }); // still a student
    await settle();
    assert.equal(w.state.agents.get(id)!.state, 'student');
    assert.match(logs.join('\n'), /not carried out: .*requires probationer/);
  });
});
