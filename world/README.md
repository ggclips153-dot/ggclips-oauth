# World — cloud management dashboard for Marc's AI cities

Built to the World Build Brief. **Phase 1 (this commit): the world EVENT LEDGER**, which is the single
source of truth, plus its write-guard, ID rules, state projection, HTTP API and live stream. The
dashboard UI (world map, city view, forms) builds on this in the next phases.

```
WORLD (Marc) ── only DM + Bob cross cities, read-only
 └ CITY (Mayor + bot, FAMILY = revenue | claude | gemini | essentials)
    └ DISTRICT (supervisor)
       └ DEPARTMENT (owns agent slots)
          └ AGENT (unique, never-reused ID)
```

## How writes flow

```
Marc (dashboard) ──intent.*──▶ EVENT LEDGER ◀──dm.routed / world events── DM (Telegram)
                                   ▲                                        │ relays to Mayor bot
                                   └──────── city events (own city only) ── Mayor
Dashboard / Bob ◀── read (filtered) ── EVENT LEDGER
```

1. Marc submits a form. The dashboard writes an **intent** (`intent.create_agent`, …). An intent changes nothing on its own.
2. The ledger pings the DM webhook (optional). Either way the ledger **is** the DM's queue: unrouted intents appear in `GET /api/state → pendingIntents`.
3. The DM writes `dm.routed` and relays the request to the Mayor's Telegram bot.
4. The Mayor (or the DM, for world events) writes the **fact**, citing the intent: `authorizedBy: <intent seq>`.

A fact that places, promotes, moves or deletes an agent, or creates structure, is **rejected** unless it
cites a Marc intent the DM has routed, for that city, matching exactly, and not already used.
No agent executes its own exit, move or promotion.

## Enforced rules (all covered by tests)

| Rule | Where |
|---|---|
| Ledger is append-only: UPDATE/DELETE are rejected by the database | `src/ledger/schema.sql` triggers |
| SHA-256 hash chain; server refuses to start if the chain is broken | `Ledger.verify()`, `npm run verify` |
| Cross-city write enforcement: per-profile `writeScope`, out-of-scope city tags REJECTED | `src/ledger/guard.ts` |
| Only Marc (owner) writes intents; only DM routes; Bob writes nothing; agents have no write profile | `src/ledger/catalog.ts` |
| Agent IDs `AGT-000001…` are global, monotonic and never reissued; deleted IDs and names are retired | `id_registry`, `id_counters`, `WorldState.retiredNames` |
| Canonical identity record: ID, name, placement card, tier, graduation state, ledger pointer, own memory scope | `Agent` in `src/domain/state.ts` |
| Ladder student → probationer → active → senior; dept-lead badge on a senior only with 3+ agents in the dept | guard rules |
| 3 chances: miss #1 → school, #2 → school, #3 → 3rd strike → deletion (with archive + lesson record refs) | guard rules |
| Department slot counts | guard rules |
| Name generator: a New Agent intent with no name gets one generated and recorded in the intent | `src/domain/names.ts` |
| Strict payloads: unknown fields rejected; bot tokens can never enter the ledger (only a `botTokenRef`) | `src/ledger/validate.ts` |
| Mayors read only their own city; Marc, DM, Bob and **Essentials** Mayors (Innovations, Security) read everything. Nobody edits another city | `src/domain/view.ts` |
| Security: agents deployed per city record **task strikes** (separate from KPI strikes). Every 3 = jail for 6h → 24h → 3 days, released on its own; the 4th time, or a 3rd KPI strike = held awaiting deletion. Deletion only from there, and only on Marc's routed intent | guard rules, `docs/BRIEF-AMENDMENTS.md` |

## Run it

Needs **Node 22.18+** only (built-in SQLite and TypeScript). No native modules, so the folder moves
between the VPS and a local PC as-is: copy the folder plus `data/world.db` and `config/profiles.json`.

```bash
npm install                 # dev tooling only (typescript for typecheck)
npm test                    # 47 tests
npm run profile -- add --id marc --role owner
npm run profile -- add --id dm --role dm
npm run profile -- add --id bob --role architect
npm run seed                # the 5 cities in config/seed.json (safe to re-run)
npm run profile -- add --id mayor-ai-receptionist-city --role mayor --city ai-receptionist-city
npm start                   # http://127.0.0.1:8787
```

| Env var | Default | |
|---|---|---|
| `WORLD_DB` | `data/world.db` | the ledger |
| `WORLD_PROFILES` | `config/profiles.json` | token hashes + write scopes (gitignored, mode 600) |
| `WORLD_PORT` / `WORLD_HOST` | `8787` / `127.0.0.1` | put nginx + TLS in front on the Hostinger VPS |
| `DM_WEBHOOK_URL` / `DM_WEBHOOK_SECRET` | unset | POSTs each new intent, signed `x-world-signature: sha256=<hmac>` |

## API (for the DM and Mayor bots)

All routes except `/api/health` need `Authorization: Bearer <token>`.

| Method | Path | |
|---|---|---|
| GET | `/api/health` | liveness |
| GET | `/api/me` | the caller's profile |
| GET | `/api/state` | world projection, filtered to the caller |
| GET | `/api/events?after=<seq>&limit=` | raw events, filtered; page with `next` |
| GET | `/api/stream?after=<seq>` | live Server-Sent Events (`Last-Event-ID` supported) |
| POST | `/api/events` | append `{type, city, subject?, payload, authorizedBy?}` |
| GET | `/api/names?count=5` | owner only: suggested agent names (never retired, in use or reserved) |
| GET | `/api/verify` | owner only: verify the hash chain |

Example: the Mayor places an agent the DM routed to it:

```json
POST /api/events
{ "type": "agent.placed", "city": "ai-receptionist-city", "subject": "AGT-000001",
  "payload": { "departmentId": "DPT-000001" }, "authorizedBy": 42 }
```

## Seed cities

| City | Family | Mayor |
|---|---|---|
| AI Receptionist City | revenue | Ana |
| Personal Finance City | revenue | Greg |
| GGClutchPlays | revenue | Kevin |
| Innovations City | essentials | Soren (generated) |
| Security City | essentials | Odette (generated) |

The full list of event types, their writers and payloads is in `src/ledger/catalog.ts`.

## Phases

1. ✅ Event ledger, writer roles, write-guard, ID rules, state projection, API, live stream
2. World map: city tiles, family homes, live KPI pulse + agent counts by state
3. Entity creation forms (New City / District / Department / Agent)
4. City layer: Mayor, per-agent lifecycle strip, live agent-status panel
5. Shared-surface write-guard + no-agent-instructs-agent enforcement + injection red-team tests
6. Currency ledger + graduation-vetting gate + clean attribution
7. World Constitution doc + templates

Marc's changes to the brief are recorded in [`docs/BRIEF-AMENDMENTS.md`](docs/BRIEF-AMENDMENTS.md).
Open questions for the DM are tracked in [`docs/OPEN-QUESTIONS.md`](docs/OPEN-QUESTIONS.md).
