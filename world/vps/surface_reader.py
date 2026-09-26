#!/usr/bin/env python3
"""Read-only view of the shared memory surface (SPEC 2026-09-26, four-tier shared memory, section 6).

Runs on the VPS next to surface.db. It opens the database READ-ONLY (SQLite URI mode=ro), never starts a write
transaction and never takes the write lock, so the Mnemosyne shared-surface path stays the one writer. The
world dashboard (on Marc's PC) reads it over Tailscale with a bearer token.

Python standard library only. Run it as the same user as Hermes (WAL readers need the -shm file):

    SURFACE_READER_TOKEN=<long random secret> \\
    SURFACE_DB=/home/hermeswebui/.hermes/mnemosyne_shared/surface.db \\
    SURFACE_READER_HOST=<the VPS's Tailscale IP> SURFACE_READER_PORT=8765 \\
    python3 surface_reader.py

GET /health                       -> {"ok": true, "db": ..., "notes": n}
GET /notes?after=<cursor>&limit=  -> {"notes": [...], "cursor": "..."}   (bearer token required)

Each note: id, table, content, source, ts, importance, veracity, and the four tags city/dept/agent/kind read
from its metadata (keys "city", "dept", "agent", "kind"; or a leading "city=… dept=… agent=… kind=…" line in the
content). A note missing any tag comes back with "untagged": [the missing fields] so it can be flagged, never
guessed.
"""
import hmac
import json
import os
import re
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DB = os.environ.get("SURFACE_DB", os.path.expanduser("~/.hermes/mnemosyne_shared/surface.db"))
TOKEN = os.environ.get("SURFACE_READER_TOKEN", "")
HOST = os.environ.get("SURFACE_READER_HOST", "127.0.0.1")
PORT = int(os.environ.get("SURFACE_READER_PORT", "8765"))
TABLES = ("working_memory", "episodic_memory")
TAGS = ("city", "dept", "agent", "kind")
KINDS = {"roster", "kpi", "status", "dispatch", "lesson", "policy", "note", "lifecycle"}
PREFIX = re.compile(r"^\s*(?:\[[^\]]*\]\s*)?(?:surface \w+:\s*)?((?:(?:city|dept|agent|kind)=\S+\s*){1,4})", re.I)
MAX_LIMIT = 2000


def connect():
    # mode=ro: SQLite refuses every write on this connection. query_only is a second lock on the same door.
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5)
    conn.execute("PRAGMA query_only = ON")
    conn.row_factory = sqlite3.Row
    return conn


def tags_of(meta, content):
    tags = {}
    if isinstance(meta, dict):
        # Tags may sit at the top of the metadata or under a "world" object.
        src = meta.get("world") if isinstance(meta.get("world"), dict) else meta
        for t in TAGS:
            v = src.get(t)
            if isinstance(v, str) and v.strip():
                tags[t] = v.strip()
    if len(tags) < 4:
        m = PREFIX.match(content or "")
        if m:
            for part in m.group(1).split():
                k, _, v = part.partition("=")
                k = k.lower()
                if k in TAGS and v and k not in tags:
                    tags[k] = v
    return tags


def rows(conn, table, after_ts, limit):
    cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
    if not cols:
        return []
    ts_col = "timestamp" if "timestamp" in cols else "created_at"
    q = f"SELECT id, content, source, {ts_col} AS ts, importance, metadata_json, veracity FROM {table} WHERE COALESCE({ts_col}, '') > ? ORDER BY {ts_col} ASC LIMIT ?"
    out = []
    for r in conn.execute(q, (after_ts, limit)):
        try:
            meta = json.loads(r["metadata_json"]) if r["metadata_json"] else {}
        except ValueError:
            meta = {}
        tags = tags_of(meta, r["content"])
        note = {
            "id": r["id"],
            "table": table,
            "content": r["content"],
            "source": r["source"],
            "ts": r["ts"],
            "importance": r["importance"],
            "veracity": r["veracity"],
            **{t: tags.get(t) for t in TAGS},
        }
        missing = [t for t in TAGS if not tags.get(t)]
        if tags.get("kind") and tags["kind"] not in KINDS:
            missing.append("kind (not one of the eight)")
        if missing:
            note["untagged"] = missing
        out.append(note)
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "surface-reader/1"

    def send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        got = self.headers.get("authorization", "")
        return bool(TOKEN) and hmac.compare_digest(got.encode(), f"Bearer {TOKEN}".encode())

    def do_GET(self):  # noqa: N802 (http.server naming)
        url = urlparse(self.path)
        try:
            if url.path == "/health":
                with connect() as conn:
                    n = sum(conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES if conn.execute("SELECT 1 FROM sqlite_master WHERE name=?", (t,)).fetchone())
                return self.send(200, {"ok": True, "db": DB, "notes": n})
            if url.path == "/notes":
                if not self.authorized():
                    return self.send(401, {"error": "unauthorized"})
                q = parse_qs(url.query)
                after = q.get("after", [""])[0]
                limit = max(1, min(int(q.get("limit", ["500"])[0]), MAX_LIMIT))
                with connect() as conn:
                    notes = sorted((n for t in TABLES for n in rows(conn, t, after, limit)), key=lambda n: n["ts"] or "")[:limit]
                return self.send(200, {"notes": notes, "cursor": notes[-1]["ts"] if notes else after})
            return self.send(404, {"error": "not found"})
        except sqlite3.Error as err:
            return self.send(503, {"error": f"surface unavailable: {err}"})

    def do_POST(self):  # noqa: N802
        self.send(405, {"error": "read-only"})

    do_PUT = do_DELETE = do_PATCH = do_POST

    def log_message(self, fmt, *args):
        sys.stderr.write("surface-reader: " + (fmt % args) + "\n")


if __name__ == "__main__":
    if len(TOKEN) < 24:
        sys.exit("Set SURFACE_READER_TOKEN to a secret of at least 24 characters (e.g. `openssl rand -hex 32`).")
    if not os.path.exists(DB):
        sys.exit(f"No surface database at {DB} (set SURFACE_DB).")
    print(f"surface-reader: read-only view of {DB} on http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
