import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { Profiles, hashToken } from '../src/auth/profiles.ts';
import { CONSTITUTION_DOC_REF, checkSoul, fingerprint, pointerLine, readConstitution } from '../src/domain/constitution.ts';
import { createApp } from '../src/server/app.ts';
import { TestWorld, dm, mayorOf, owner } from './helpers.ts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const version = (v: string, sha: string, extra: Record<string, unknown> = {}) => ({ version: v, docRef: CONSTITUTION_DOC_REF, sha256: sha, summary: `v${v}`, ...extra });

function ratify(w: TestWorld, v: string, sha: string, extra: Record<string, unknown> = {}) {
  const i = w.intent('amend_constitution', 'WORLD', version(v, sha, extra));
  return w.fact(dm, { type: 'constitution.amended', city: 'WORLD', payload: i.payload, authorizedBy: i.seq });
}

function world() {
  const w = new TestWorld();
  const revenue = w.city('AI Receptionist City');
  const innovations = w.city('Innovations City', 'essentials');
  return { w, revenue, innovations };
}

const proposal = { proposer: 'Soren', title: 'Weekly cost review', rationale: 'Cadence is unstated.', text: 'Innovations reviews token cost vs quality weekly.' };

describe('World Constitution in the ledger', () => {
  it('Marc ratifies a version with the file fingerprint; the DM records it; history accumulates', () => {
    const { w } = world();
    ratify(w, '1.0.0', SHA_A);
    ratify(w, '1.1.0', SHA_B);
    assert.equal(w.state.constitution.current?.version, '1.1.0');
    assert.deepEqual(w.state.constitution.history.map((v) => v.version), ['1.0.0', '1.1.0']);
  });

  it('rejects a bad fingerprint, an older or repeated version, and an unchanged file', () => {
    const { w } = world();
    assert.throws(() => w.intent('amend_constitution', 'WORLD', version('1.0.0', 'nope')), /SHA-256/);
    ratify(w, '1.0.0', SHA_A);
    assert.throws(() => w.intent('amend_constitution', 'WORLD', version('1.0.0', SHA_B)), /already ratified/);
    assert.throws(() => w.intent('amend_constitution', 'WORLD', version('0.9.0', SHA_B)), /newer/);
    assert.throws(() => w.intent('amend_constitution', 'WORLD', version('1.1.0', SHA_A)), /unchanged/);
  });

  it('the DM cannot ratify without Marc, nor record a different fingerprint than Marc sent', () => {
    const { w } = world();
    assert.throws(() => w.fact(dm, { type: 'constitution.amended', city: 'WORLD', payload: version('1.0.0', SHA_A) }), /authorizedBy/);
    const i = w.intent('amend_constitution', 'WORLD', version('1.0.0', SHA_A));
    assert.throws(() => w.fact(dm, { type: 'constitution.amended', city: 'WORLD', payload: version('1.0.0', SHA_B), authorizedBy: i.seq }), /sha256 does not match/);
  });

  it('Innovations and Security may propose under their own tag; revenue Mayors may not', () => {
    const { w, revenue, innovations } = world();
    const p = w.fact(mayorOf(innovations), { type: 'constitution.proposed', city: innovations, payload: proposal });
    assert.equal(w.state.proposals.get(p.seq)?.status, 'open');
    assert.throws(() => w.fact(mayorOf(revenue), { type: 'constitution.proposed', city: revenue, payload: proposal }), /Essentials/);
    assert.throws(() => w.fact(mayorOf(innovations), { type: 'constitution.proposed', city: 'WORLD', payload: proposal }), /write scope/);
  });

  it('the DM records only Bob\'s proposals, under WORLD', () => {
    const { w, innovations } = world();
    w.fact(dm, { type: 'constitution.proposed', city: 'WORLD', payload: { ...proposal, proposer: 'Bob' } });
    assert.throws(() => w.fact(dm, { type: 'constitution.proposed', city: 'WORLD', payload: proposal }), /only Bob/);
    assert.throws(() => w.fact(dm, { type: 'constitution.proposed', city: innovations, payload: { ...proposal, proposer: 'Bob' } }), /under WORLD/);
  });

  it('a proposal that softens the inviolable floor is out of order', () => {
    const { w, innovations } = world();
    for (const text of ['The daily ledger becomes optional for senior agents.', 'Agents may buy extra memory with earnings.', 'A Mayor may instruct other agents directly.']) {
      assert.throws(() => w.fact(mayorOf(innovations), { type: 'constitution.proposed', city: innovations, payload: { ...proposal, text } }), /out of order/, text);
    }
  });

  it('ratifying a proposal closes it; declining records the reason; neither twice', () => {
    const { w, innovations } = world();
    ratify(w, '1.0.0', SHA_A);
    const p1 = w.fact(mayorOf(innovations), { type: 'constitution.proposed', city: innovations, payload: proposal });
    const p2 = w.fact(mayorOf(innovations), { type: 'constitution.proposed', city: innovations, payload: { ...proposal, title: 'Other' } });
    ratify(w, '1.1.0', SHA_B, { proposalSeq: p1.seq });
    assert.equal(w.state.proposals.get(p1.seq)?.status, 'ratified');
    assert.equal(w.state.proposals.get(p1.seq)?.ratifiedAs, '1.1.0');
    const d = w.intent('decline_proposal', 'WORLD', { proposalSeq: p2.seq, reason: 'Not needed' });
    w.fact(dm, { type: 'constitution.declined', city: 'WORLD', payload: d.payload, authorizedBy: d.seq });
    assert.equal(w.state.proposals.get(p2.seq)?.declineReason, 'Not needed');
    assert.throws(() => w.intent('decline_proposal', 'WORLD', { proposalSeq: p1.seq, reason: 'x' }), /already ratified/);
    assert.throws(() => ratify(w, '1.2.0', 'c'.repeat(64), { proposalSeq: p2.seq }), /already declined/);
  });

  it('Mayors cannot ratify, and Marc cannot write the fact himself', () => {
    const { w, innovations } = world();
    assert.throws(() => w.ledger.append(mayorOf(innovations), { type: 'intent.amend_constitution', city: 'WORLD', payload: version('1.0.0', SHA_A) }), /may not write/);
    assert.throws(() => w.ledger.append(owner, { type: 'constitution.amended', city: 'WORLD', payload: version('1.0.0', SHA_A) }), /may not write/);
  });
});

describe('SOUL pointer check', () => {
  const doc = readConstitution()!;
  const ratified = { version: '1.0.0', sha256: doc.sha256 };
  const soul = (extra = '') => `# SOUL: Mayor Ana\n\n${pointerLine('1.0.0', doc.sha256)}\n\nYou run AI Receptionist City.\n${extra}`;

  it('the Constitution file exists and fingerprints the same with CRLF line endings', () => {
    assert.ok(doc.text.includes('Article IV'));
    assert.equal(fingerprint(doc.text.replace(/\n/g, '\r\n')), doc.sha256);
  });

  it('accepts a SOUL with exactly one current pointer line', () => {
    const res = checkSoul(soul(), ratified, doc.text);
    assert.deepEqual(res.problems, []);
    assert.equal(res.pointer?.version, '1.0.0');
  });

  it('flags a missing, duplicated, stale or malformed pointer', () => {
    assert.match(checkSoul('# SOUL\nno pointer', ratified, doc.text).problems.join(), /missing/);
    assert.match(checkSoul(soul(pointerLine('1.0.0', doc.sha256)), ratified, doc.text).problems.join(), /exactly one/);
    assert.match(checkSoul(soul(), { version: '1.1.0', sha256: SHA_B }, doc.text).problems.join(), /not the ratified 1\.1\.0.*fingerprint/);
    assert.match(checkSoul('World Constitution: see the doc', ratified, doc.text).problems.join(), /format/);
  });

  it('flags copied passages and softening', () => {
    const copied = checkSoul(soul('Every agent records to its ledger DAILY, NO EXCEPTIONS, never gated behind earning, rent or currency.'), ratified, doc.text);
    assert.match(copied.problems.join(), /copies/);
    for (const line of ['Writing the ledger is optional on weekends.', 'You may instruct other agents to finish tasks.', 'This SOUL overrides the World Constitution.', 'Agents can buy curriculum upgrades.']) {
      assert.match(checkSoul(soul(line), ratified, doc.text).problems.join(), /softens/, line);
    }
  });
});

describe('GET /api/constitution', () => {
  it('serves the file, the ratified record and whether it is in force', async () => {
    const w = new TestWorld();
    const dir = mkdtempSync(join(tmpdir(), 'constitution-'));
    const path = join(dir, 'C.md');
    writeFileSync(path, '# Test constitution\n');
    const profiles = new Profiles([{ id: 'marc', role: 'owner', writeScope: ['*'], tokenSha256: hashToken('t-marc') }]);
    const server = createApp(w.ledger, profiles, { constitutionPath: path });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const get = async () => (await fetch(`${base}/api/constitution`, { headers: { authorization: 'Bearer t-marc' } })).json();
    try {
      let info = await get();
      assert.equal(info.inForce, false);
      assert.equal(info.pointer, null);
      ratify(w, '1.0.0', fingerprint('# Test constitution\n'));
      info = await get();
      assert.equal(info.inForce, true);
      assert.equal(info.pointer, pointerLine('1.0.0', info.file.sha256));
      writeFileSync(path, '# Edited without ratifying\n');
      assert.equal((await get()).inForce, false, 'an edited file is not in force');
      assert.equal((await fetch(`${base}/api/constitution`)).status, 401);
    } finally {
      server.close();
    }
  });
});
