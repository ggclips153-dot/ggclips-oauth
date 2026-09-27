import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { attachCyberStation } from '../src/cyberstation/bridge.ts';
import { HermesLink, loadHermesSettings, saveHermesSettings } from '../src/cyberstation/hermes.ts';
import type { LedgerEvent } from '../src/domain/state.ts';
import { worldView } from '../src/domain/view.ts';
import { TestWorld, mayorOf, messenger, owner } from './helpers.ts';

/** Link an agent to a Hermes profile the way Marc does: his request, recorded by the World Messenger (A23). */
const link = (w: TestWorld, city: string, agentId: string, profile: string) => {
  const i = w.intent('link_hermes_profile', city, { agentId, profile });
  return w.fact(messenger, { type: 'agent.hermes_linked', city, subject: agentId, payload: { profile }, authorizedBy: i.seq });
};

describe('CyberStation: linking an agent to its own Hermes profile (A23, A31)', () => {
  it('Marc links it, the World Messenger records it, and the view shows the profile', () => {
    const w = new TestWorld();
    const city = w.city();
    const a = w.agent(city, w.department(city, w.district(city)), 'Iris');
    link(w, city, a, 'iris');
    assert.equal(w.state.agents.get(a)!.hermesProfile, 'iris');
    const view = worldView(w.state, owner, w.time);
    assert.equal(view.cities[0]!.districts[0]!.departments[0]!.agents[0]!.hermesProfile, 'iris');
  });

  it('one profile is one agent, only the World Messenger records it, and the name is checked', () => {
    const w = new TestWorld();
    const city = w.city();
    const dept = w.department(city, w.district(city));
    const a = w.agent(city, dept, 'Iris');
    const b = w.agent(city, dept, 'Juno');
    link(w, city, a, 'iris');
    assert.throws(() => w.intent('link_hermes_profile', city, { agentId: b, profile: 'IRIS' }), /already linked to Iris/);
    const i = w.intent('link_hermes_profile', city, { agentId: b, profile: 'juno' });
    assert.throws(() => w.fact(mayorOf(city), { type: 'agent.hermes_linked', city, subject: b, payload: { profile: 'juno' }, authorizedBy: i.seq }), /mayor may not write/);
    assert.throws(() => w.fact(messenger, { type: 'agent.hermes_linked', city, subject: b, payload: { profile: 'other' }, authorizedBy: i.seq }), /does not match/);
    assert.throws(() => w.intent('link_hermes_profile', city, { agentId: b, profile: 'no spaces' }), /Hermes profile name/);
    // A professor at the college is linked the same way (its station is the college, "the classroom").
    const prof = w.professor(city, dept);
    link(w, city, prof, 'prof-hale');
    assert.equal(w.state.agents.get(prof)!.hermesProfile, 'prof-hale');
  });
});

describe('CyberStation: an agent answers on its own Hermes profile', () => {
  const seen: { url: string; auth: string; session: string; body: unknown }[] = [];
  const failing = new Set<string>();
  const hermes = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    seen.push({ url: req.url ?? '', auth: String(req.headers.authorization), session: String(req.headers['x-hermes-session-id']), body: raw ? JSON.parse(raw) : null });
    if (req.url === '/health') return void res.end('ok');
    const m = /^\/p\/([^/]+)\/v1\/chat\/completions$/.exec(req.url ?? '');
    if (!m) {
      res.statusCode = 404;
      return void res.end();
    }
    if (req.headers.authorization !== `Bearer key-${m[1]}`) {
      res.statusCode = 401;
      return void res.end('bad key');
    }
    if (failing.has(m[1]!)) {
      res.statusCode = 500;
      return void res.end('model provider down');
    }
    const { messages } = JSON.parse(raw) as { messages: { content: string }[] };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `${m[1]} heard: ${messages.at(-1)!.content}` } }] }));
  });
  let url = '';
  before(async () => {
    await new Promise<void>((r) => hermes.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(hermes.address() as AddressInfo).port}`;
  });
  after(() => hermes.close());

  it("sends the turn to the agent's profile with its key and the agent's ID as the session", async () => {
    const h = new HermesLink({ url, multiplex: true, keys: { iris: 'key-iris' } });
    assert.equal(await h.ask('iris', 'AGT-000001', 'hello'), 'iris heard: hello');
    const last = seen.at(-1)!;
    assert.deepEqual([last.url, last.auth, last.session], ['/p/iris/v1/chat/completions', 'Bearer key-iris', 'AGT-000001']);
    assert.deepEqual(last.body, { model: 'iris', messages: [{ role: 'user', content: 'hello' }], stream: false });
  });

  it('says plainly what is wrong: no key on this PC, a refused key, Hermes out of reach', async () => {
    const h = new HermesLink({ url, multiplex: true, keys: { iris: 'wrong' } });
    assert.equal(h.canReach('juno'), false);
    await assert.rejects(h.ask('juno', 'A', 'hi'), /no key for Hermes profile "juno"/);
    await assert.rejects(h.ask('iris', 'A', 'hi'), /refused the key for "iris" \(401\)/);
    const down = new HermesLink({ url: 'http://127.0.0.1:1', multiplex: true, keys: { iris: 'k' } });
    await assert.rejects(down.ask('iris', 'A', 'hi'), /couldn't reach Hermes/);
    assert.equal((await h.health()).ok, true);
  });

  it("Marc's message to a linked agent is answered by Hermes and recorded as agent.said; others are left alone", async () => {
    const w = new TestWorld();
    const city = w.city();
    const dept = w.department(city, w.district(city));
    const iris = w.agent(city, dept, 'Iris');
    const juno = w.agent(city, dept, 'Juno');
    link(w, city, iris, 'iris');
    const bridge = attachCyberStation(w.ledger, new HermesLink({ url, multiplex: true, keys: { iris: 'key-iris' } }), { log: () => {} });
    assert.ok(bridge.handlesAgent(iris));
    assert.ok(!bridge.handlesAgent(juno), 'not linked: StarNet or the Mayor bot answers');

    const said = new Promise<LedgerEvent>((resolve) => w.ledger.events.on('event', (e: LedgerEvent) => e.type === 'agent.said' && resolve(e)));
    const msg = w.ledger.append(owner, { type: 'intent.message_agent', city, payload: { agentId: iris, text: 'status?' } });
    assert.deepEqual(bridge.working(), [iris]);
    const answer = await said;
    assert.deepEqual([answer.subject, answer.actor, answer.payload], [iris, `cyberstation-${city}`, { text: 'iris heard: status?', replyTo: msg.seq }]);
    await new Promise((r) => setImmediate(r)); // the "done working" step runs right after the answer is recorded
    assert.deepEqual(bridge.working(), []);

    const count = w.ledger.readAll().length;
    w.ledger.append(owner, { type: 'intent.message_agent', city, payload: { agentId: juno, text: 'hi' } });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(w.ledger.readAll().length, count + 1, 'nothing answered for Juno here');
    bridge.stop();
  });

  it('when Hermes fails, the conversation says why and nothing is recorded', async () => {
    const w = new TestWorld();
    const city = w.city();
    const iris = w.agent(city, w.department(city, w.district(city)), 'Iris');
    link(w, city, iris, 'iris');
    failing.add('iris');
    let settled = () => {};
    const done = new Promise<void>((r) => (settled = r));
    const bridge = attachCyberStation(w.ledger, new HermesLink({ url, multiplex: true, keys: { iris: 'key-iris' } }), { log: () => {}, onChange: () => settled() });
    try {
      const msg = w.ledger.append(owner, { type: 'intent.message_agent', city, payload: { agentId: iris, text: 'hi' } });
      await done; // the "working" signal
      await new Promise((r) => setTimeout(r, 100));
      const err = bridge.errors()[iris];
      assert.equal(err?.seq, msg.seq);
      assert.match(err!.message, /Hermes answered 500: model provider down/);
      assert.ok(!w.ledger.readAll().some((e) => e.type === 'agent.said'));
    } finally {
      failing.delete('iris');
      bridge.stop();
    }
  });
});

describe('CyberStation settings (config/hermes.json)', () => {
  it('keeps the address and keys in one private file; only profile names are ever listed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-settings-'));
    const path = join(dir, 'hermes.json');
    try {
      assert.deepEqual(loadHermesSettings(path), { url: '', multiplex: true, keys: {} });
      saveHermesSettings(path, { url: 'http://h:8642/', multiplex: false, keys: { iris: 'k1' } });
      const s = loadHermesSettings(path);
      assert.deepEqual([s.url, s.multiplex, s.keys], ['http://h:8642', false, { iris: 'k1' }]);
      const h = new HermesLink(s);
      assert.deepEqual(h.profiles(), ['iris']);
      assert.equal(h.base('iris'), 'http://h:8642/v1', 'a single-profile server has no /p/<profile> prefix');
      assert.ok(h.canReach('IRIS'), 'profile names are matched without case');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
