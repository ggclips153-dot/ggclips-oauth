import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { agentBrief, attachStarnetBridge } from '../src/starnet/bridge.ts';
import { Stations } from '../src/starnet/stations.ts';
import { TestWorld, owner } from './helpers.ts';

/** A stand-in StarNet source folder: sidecar/index.js serves /health and /v1/chat/completions like StarNet. */
function fakeStarnet(): string {
  const dir = mkdtempSync(join(tmpdir(), 'starnet-'));
  mkdirSync(join(dir, 'sidecar'));
  writeFileSync(join(dir, 'sidecar', 'index.js'), `
    const http = require('node:http');
    const port = Number(process.env.STARNET_PORT);
    http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
        if (req.url === '/health') { res.writeHead(200); return res.end('{"status":"ok"}'); }
        if (req.headers.authorization !== 'Bearer ' + process.env.STARNET_API_KEY) { res.writeHead(401); return res.end('{"error":{"message":"bad key"}}'); }
        const body = JSON.parse(b);
        const user = body.messages.at(-1).content;
        if (user === 'fail') { res.writeHead(502); return res.end('{"error":{"message":"no model provider set"}}'); }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'station ' + process.env.STARNET_WORKSPACES.split('/').pop() + ' session ' + req.headers['x-starnet-session-id'] + ' heard: ' + user + ' | ' + body.messages[0].content.slice(0, 40) } }], starnet: { completed: true } }));
      });
    }).listen(port, '127.0.0.1');
  `);
  return dir;
}

const waitFor = async (fn: () => boolean, ms = 8000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe('StarNet stations (A20)', () => {
  const dir = fakeStarnet();
  const tmp = mkdtempSync(join(tmpdir(), 'stations-'));
  const configPath = join(tmp, 'starnet.json');
  const stations = new Stations('test', { starnetDir: dir, workspacesDir: join(tmp, 'ws'), configPath, basePort: 18801, everyMs: 200, log: () => {} });
  after(() => stations.stop());

  it('starts one station per city on its own port and workspace, with a private key kept on disk (mode 600)', async () => {
    assert.equal(Stations.check(dir), null);
    assert.match(Stations.check(tmp)!, /no StarNet source/);
    stations.startAll(['CITY-A', 'CITY-B']);
    await waitFor(() => stations.isUp('CITY-A') && stations.isUp('CITY-B'));
    const st = stations.statuses();
    assert.deepEqual([st['CITY-A']!.port, st['CITY-B']!.port], [18801, 18802]);
    assert.equal(st['CITY-A']!.url, 'http://127.0.0.1:18801/');
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.ok(cfg['test:CITY-A'].apiKey.length >= 32);
    assert.equal(statSync(configPath).mode & 0o777, 0o600);
  });

  it("an agent's message runs on its city's station; the answer lands in the ledger as agent.said", async () => {
    const w = new TestWorld();
    const city = w.city();
    const dept = w.department(city, w.district(city));
    const kai = w.agent(city, dept, 'Kai');
    stations.start(city);
    await waitFor(() => stations.isUp(city));
    let changes = 0;
    const bridge = attachStarnetBridge(w.ledger, stations, { log: () => {}, onChange: () => changes++ });
    const msg = w.ledger.append(owner, { type: 'intent.message_agent', city, payload: { agentId: kai, text: 'status?' } });
    assert.deepEqual(bridge.working(), [kai]);
    await waitFor(() => (w.state.chats.get(kai)?.length ?? 0) === 2);
    const answer = w.state.chats.get(kai)![1]!;
    assert.equal(answer.from, 'agent');
    assert.equal(answer.replyTo, msg.seq);
    assert.match(answer.text, new RegExp(`station ${city} session ${kai} heard: status\\? \\| You are Kai \\(${kai}\\)`));
    assert.equal(w.ledger.read(msg.seq, 10).find((e) => e.type === 'agent.said')!.actor, `starnet-${city}`);

    w.ledger.append(owner, { type: 'intent.message_agent', city, payload: { agentId: kai, text: 'fail' } });
    await waitFor(() => !!bridge.errors()[kai]);
    assert.match(bridge.errors()[kai]!.message, /no model provider set/);
    assert.ok(changes >= 4);
    assert.equal(w.state.chats.get(kai)!.length, 3, 'no answer is invented when the station fails');
    bridge.stop();
  });

  it("a city without a running station is left to its Mayor's bot", async () => {
    const w = new TestWorld();
    const city = w.city();
    const kai = w.agent(city, w.department(city, w.district(city)), 'Kai');
    const bridge = attachStarnetBridge(w.ledger, { isUp: () => false, ask: async () => 'never' }, { log: () => {} });
    w.ledger.append(owner, { type: 'intent.message_agent', city, payload: { agentId: kai, text: 'hi' } });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(w.state.chats.get(kai)!.length, 1);
    assert.equal(bridge.handles(city), false);
    assert.match(agentBrief(w.ledger, w.state.agents.get(kai)!), /You are Kai .* department/);
    bridge.stop();
  });
});
