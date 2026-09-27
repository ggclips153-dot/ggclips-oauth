import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { Profiles, hashToken } from '../src/auth/profiles.ts';
import type { Role } from '../src/domain/model.ts';
import { Ledger } from '../src/ledger/ledger.ts';
import { TestWorld, owner } from './helpers.ts';

describe('event ledger: append-only', () => {
  it('rejects UPDATE and DELETE at the database level', () => {
    const w = new TestWorld();
    w.city();
    assert.throws(() => w.ledger.db.exec("UPDATE events SET type = 'x' WHERE seq = 1"), /append-only/);
    assert.throws(() => w.ledger.db.exec('DELETE FROM events'), /append-only/);
    assert.throws(() => w.ledger.db.exec('DELETE FROM id_registry'), /never recycled/);
  });

  it('keeps an intact hash chain and detects tampering', () => {
    const w = new TestWorld();
    w.city();
    assert.deepEqual(w.ledger.verify(), { ok: true, count: 3 });
    // Simulate someone bypassing the triggers with raw file access.
    w.ledger.db.exec('DROP TRIGGER events_no_update');
    w.ledger.db.exec(`UPDATE events SET payload = '{"name":"Forged"}' WHERE seq = 1`);
    const result = w.ledger.verify();
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.brokenAt, 1);
  });

  it('rebuilds identical state from the ledger after restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'world-'));
    try {
      const path = join(dir, 'world.db');
      const w = new TestWorld(path);
      const city = w.city();
      const dept = w.department(city, w.district(city));
      const id = w.agent(city, dept, 'Iris');
      w.promote(city, id, 'probationer');
      const before = JSON.stringify(w.state.agents.get(id));
      w.ledger.close();

      const reopened = new Ledger({ path });
      assert.equal(JSON.stringify(reopened.state.agents.get(id)), before);
      assert.equal(reopened.verify().ok, true);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stamps actor and server time; clients cannot choose them', () => {
    const w = new TestWorld();
    const e = w.ledger.append(owner, { type: 'intent.create_city', city: 'WORLD', payload: { name: 'X', family: 'claude', mayorName: 'M' } });
    assert.equal(e.actor, 'marc');
    assert.equal(e.actorRole, 'owner');
    assert.equal(e.kind, 'intent');
  });
});

describe('A22: the District Messenger is now the World Messenger', () => {
  it('the World Messenger routes and writes world events', () => {
    const w = new TestWorld();
    w.city();
    assert.deepEqual(w.ledger.readAll().map((e) => [e.type, e.actorRole]), [
      ['intent.create_city', 'owner'],
      ['messenger.routed', 'messenger'],
      ['city.created', 'messenger'],
    ]);
  });

  it('the old name is gone: no dm role, no dm.routed', () => {
    const w = new TestWorld();
    const city = w.city();
    const i = w.ledger.append(owner, { type: 'intent.message_mayor', city, payload: { text: 'hi' } });
    const oldDm = { id: 'dm', role: 'dm' as Role, writeScope: ['*'] };
    assert.throws(() => w.ledger.append(oldDm, { type: 'dm.routed', city, payload: { intentSeq: i.seq, to: 'mayor' } }), /unknown event type/);
    assert.throws(() => w.ledger.append(oldDm, { type: 'messenger.routed', city, payload: { intentSeq: i.seq, to: 'mayor' } }), /may not write/);
    assert.throws(() => new Profiles([{ id: 'dm', role: 'dm' as Role, writeScope: ['*'], tokenSha256: hashToken('t') }]), /now "messenger"/);
  });

  it('refuses a ledger file made before A22 with a clear message, and lets go of the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'world-'));
    try {
      const before = readFileSync(new URL('../src/ledger/schema.sql', import.meta.url), 'utf8').replace("'messenger'", "'dm'");
      for (const [name, advice] of [['world.db', /before A22.*archive/], ['demo.db', /before A22.*npm run demo/]] as const) {
        const path = join(dir, name);
        const db = new DatabaseSync(path);
        db.exec(before);
        db.close();
        assert.throws(() => new Ledger({ path }), advice);
        rmSync(path); // would fail (file busy) on Windows if the refused ledger were still open
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
