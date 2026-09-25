-- World EVENT LEDGER. Append-only, enforced by the database itself (not just the app).
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS events (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT    NOT NULL,
  kind          TEXT    NOT NULL CHECK (kind IN ('fact', 'intent')),
  type          TEXT    NOT NULL,
  city          TEXT    NOT NULL,          -- the city= tag (WORLD for world events)
  actor         TEXT    NOT NULL,          -- writer profile id
  actor_role    TEXT    NOT NULL CHECK (actor_role IN ('owner', 'dm', 'mayor')),
  subject       TEXT,
  payload       TEXT    NOT NULL,
  authorized_by INTEGER REFERENCES events (seq),
  prev_hash     TEXT    NOT NULL,
  hash          TEXT    NOT NULL UNIQUE    -- sha256 chain: tampering breaks every later hash
);
CREATE INDEX IF NOT EXISTS events_city ON events (city, seq);
CREATE INDEX IF NOT EXISTS events_subject ON events (subject, seq);

CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'event ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'event ledger is append-only'); END;

-- Every ID ever issued (cities, districts, departments, agents). Never deleted, never reissued.
CREATE TABLE IF NOT EXISTS id_registry (
  id         TEXT    PRIMARY KEY,
  kind       TEXT    NOT NULL,
  issued_seq INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS id_registry_no_update BEFORE UPDATE ON id_registry
BEGIN SELECT RAISE(ABORT, 'issued IDs are permanent'); END;
CREATE TRIGGER IF NOT EXISTS id_registry_no_delete BEFORE DELETE ON id_registry
BEGIN SELECT RAISE(ABORT, 'issued IDs are permanent; retired IDs are never recycled'); END;

-- Monotonic counters for numbered IDs (AGT-000001 ...). Can only go up.
CREATE TABLE IF NOT EXISTS id_counters (
  kind TEXT    PRIMARY KEY,
  last INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS id_counters_monotonic BEFORE UPDATE ON id_counters
WHEN NEW.last <= OLD.last
BEGIN SELECT RAISE(ABORT, 'ID counters only move forward'); END;
CREATE TRIGGER IF NOT EXISTS id_counters_no_delete BEFORE DELETE ON id_counters
BEGIN SELECT RAISE(ABORT, 'ID counters are permanent'); END;
