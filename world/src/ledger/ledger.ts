// The world EVENT LEDGER: single source of truth. Append goes through the write-guard; reads
// are filtered by the reader's profile. State is a projection replayed from the ledger.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { WORLD_TAG, type Role } from '../domain/model.ts';
import { suggestNames, type NameOptions } from '../domain/names.ts';
import { WorldState, type LedgerEvent } from '../domain/state.ts';
import { checkWrite, type AppendInput, type Draft, type Profile } from './guard.ts';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const GENESIS = '0'.repeat(64);

/** Stable JSON (sorted keys) so the hash chain is reproducible anywhere. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

export function hashEvent(e: Omit<LedgerEvent, 'hash'>): string {
  const body = canonical([e.seq, e.ts, e.kind, e.type, e.city, e.actor, e.actorRole, e.subject, e.payload, e.authorizedBy, e.prevHash]);
  return createHash('sha256').update(body).digest('hex');
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'city';
}

interface Row {
  seq: number;
  ts: string;
  kind: string;
  type: string;
  city: string;
  actor: string;
  actor_role: string;
  subject: string | null;
  payload: string;
  authorized_by: number | null;
  prev_hash: string;
  hash: string;
}

const fromRow = (r: Row): LedgerEvent => ({
  seq: r.seq,
  ts: r.ts,
  kind: r.kind as LedgerEvent['kind'],
  type: r.type,
  city: r.city,
  actor: r.actor,
  actorRole: r.actor_role as Role,
  subject: r.subject,
  payload: JSON.parse(r.payload),
  authorizedBy: r.authorized_by,
  prevHash: r.prev_hash,
  hash: r.hash,
});

export interface LedgerOptions {
  /** File path, or ':memory:' for tests. */
  path: string;
  now?: () => Date;
  names?: NameOptions;
}

export class Ledger {
  readonly db: DatabaseSync;
  readonly state = new WorldState();
  /** Emits 'event' (LedgerEvent) after each committed append. */
  readonly events = new EventEmitter();
  private readonly now: () => Date;
  private readonly names: NameOptions;

  constructor(opts: LedgerOptions) {
    this.db = new DatabaseSync(opts.path);
    this.db.exec(SCHEMA);
    this.now = opts.now ?? (() => new Date());
    this.names = opts.names ?? {};
    this.events.setMaxListeners(1000);
    for (const e of this.readAll()) this.state.apply(e);
  }

  /** The ledger's clock (injectable for tests); decides whether a timed jail term has ended. */
  clock(): Date {
    return this.now();
  }

  close() {
    this.db.close();
  }

  /** Append one event. Throws LedgerError if the write-guard rejects it. */
  append(profile: Profile, input: AppendInput): LedgerEvent {
    const now = this.now();
    const draft = checkWrite(this.state, profile, this.withGeneratedName(input), now);
    this.db.exec('BEGIN IMMEDIATE');
    let event: LedgerEvent;
    try {
      event = this.insert(profile, draft, now);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.state.apply(event);
    this.events.emit('event', event);
    return event;
  }

  /** A New Agent intent without a name gets a generated one, recorded in the intent itself. */
  private withGeneratedName(input: AppendInput): AppendInput {
    const payload = input.payload as Record<string, unknown> | undefined;
    if (input.type !== 'intent.create_agent' || !payload || typeof payload !== 'object' || payload.name != null) return input;
    return { ...input, payload: { ...payload, name: this.suggestNames(1)[0] } };
  }

  /** Available display names: never retired, in use, or reserved. */
  suggestNames(count: number): string[] {
    return suggestNames(this.state, count, this.names);
  }

  private insert(profile: Profile, d: Draft, now: Date): LedgerEvent {
    const seq = this.state.lastSeq + 1;
    const subject = d.allocates ? this.allocateId(d, seq) : d.subject;
    const base = {
      seq,
      ts: now.toISOString(),
      kind: d.kind,
      type: d.type,
      city: d.city,
      actor: profile.id,
      actorRole: profile.role,
      subject,
      payload: d.payload,
      authorizedBy: d.authorizedBy,
      prevHash: this.state.lastHash || GENESIS,
    };
    const event: LedgerEvent = { ...base, hash: hashEvent(base) };
    const res = this.db
      .prepare(
        `INSERT INTO events (seq, ts, kind, type, city, actor, actor_role, subject, payload, authorized_by, prev_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.seq,
        event.ts,
        event.kind,
        event.type,
        event.city,
        event.actor,
        event.actorRole,
        event.subject,
        JSON.stringify(event.payload),
        event.authorizedBy,
        event.prevHash,
        event.hash,
      );
    if (Number(res.lastInsertRowid) !== seq) throw new Error('ledger sequence drift; another writer touched the database');
    return event;
  }

  /** Issue a never-before-used ID. Registry + monotonic counters make reuse impossible. */
  private allocateId(d: Draft, seq: number): string {
    const kind = d.allocates!;
    let id: string;
    if (kind === 'CITY') {
      const base = slugify(String(d.payload.name));
      const taken = this.db.prepare('SELECT 1 FROM id_registry WHERE id = ?');
      id = base === WORLD_TAG.toLowerCase() ? `${base}-city` : base;
      for (let n = 2; taken.get(id); n++) id = `${base}-${n}`;
    } else {
      const row = this.db.prepare('SELECT last FROM id_counters WHERE kind = ?').get(kind) as { last: number } | undefined;
      const next = (row?.last ?? 0) + 1;
      if (row) this.db.prepare('UPDATE id_counters SET last = ? WHERE kind = ?').run(next, kind);
      else this.db.prepare('INSERT INTO id_counters (kind, last) VALUES (?, ?)').run(kind, next);
      id = `${kind}-${String(next).padStart(6, '0')}`;
    }
    this.db.prepare('INSERT INTO id_registry (id, kind, issued_seq) VALUES (?, ?, ?)').run(id, kind, seq);
    return id;
  }

  readAll(): LedgerEvent[] {
    return (this.db.prepare('SELECT * FROM events ORDER BY seq').all() as unknown as Row[]).map(fromRow);
  }

  read(after = 0, limit = 500): LedgerEvent[] {
    return (this.db.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?').all(after, limit) as unknown as Row[]).map(fromRow);
  }

  /** Walk the hash chain. Returns the first broken seq, or null if the ledger is intact. */
  verify(): { ok: true; count: number } | { ok: false; brokenAt: number; reason: string } {
    let prev = GENESIS;
    let count = 0;
    for (const e of this.readAll()) {
      const { hash, ...rest } = e;
      if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq, reason: 'prev_hash does not link' };
      if (hashEvent(rest) !== hash) return { ok: false, brokenAt: e.seq, reason: 'content does not match hash' };
      prev = hash;
      count++;
    }
    return { ok: true, count };
  }
}
