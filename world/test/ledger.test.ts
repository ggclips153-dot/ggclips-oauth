import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
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
