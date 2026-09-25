# World — cloud management dashboard for Marc's AI cities

Built to the World Build Brief. **Phase 1 (this commit): the world EVENT LEDGER**, which is the single
source of truth, plus its write-guard, ID rules, state projection, HTTP API and live stream. The
dashboard UI (world map, city view, forms) builds on this in the next phases.

```
WORLD (Marc) ── only DM, Bob and Essentials cities read across cities; nobody edits another
 └ CITY (Mayor + bot, FAMILY = revenue | claude | gemini | essentials)
    ├ COLLEGE (dean + professors; creates beginner agents, A11-A14)
    └ DISTRICT (supervisor)
       └ DEPARTMENT (the agents who specialise in it; optional caps, professors, A8-A10)
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
| Shadows: the Mayor appoints student → intern (shadow) → graduated, after a professor's passed exam; higher promotions need Marc's routed intent | guard rules |
| Department caps on graduated agents and shadows; dept-lead needs 3+ graduated agents | guard rules |
| College: agents and professors are created only at the college; a department takes an EXISTING agent of its city; seniors can retire into professors; professors step in only for their specialty, take only teaching strikes (from Security) and keep a teaching record; one dean per college, scored on its graduates, reviewed by the Mayor, replaceable by an outstanding professor; dean reports go to Security, which escalates them to Marc | guard rules, `docs/BRIEF-AMENDMENTS.md` |
| Delegation (option B): graduated agent → shadow in its own department, approved basic tasks only, every hand-off logged | `task.delegated`, `task.returned` |
| Name generator: a New Agent intent with no name gets one generated and recorded in the intent | `src/domain/names.ts` |
| Strict payloads: unknown fields rejected; bot tokens can never enter the ledger (only a `botTokenRef`) | `src/ledger/validate.ts` |
| Mayors read only their own city; Marc, DM, Bob and **Essentials** Mayors (Innovations, Security) read everything. Nobody edits another city | `src/domain/view.ts` |
| Security: agents deployed per city record **task strikes** (separate from KPI strikes). Every 3 = jail for 6h → 24h → 3 days, released on its own; the 4th time, or a 3rd KPI strike = held awaiting deletion. Deletion only from there, and only on Marc's routed intent | guard rules, `docs/BRIEF-AMENDMENTS.md` |

## Run it

Needs **Node 22.18+** only (built-in SQLite and TypeScript). No native modules, so the folder moves
between the VPS and a local PC as-is: copy the folder plus `data/world.db`, `config/profiles.json`
and `config/users.json`.

```bash
npm install                 # dev tooling only (typescript for typecheck)
npm test                    # 89 tests

# API profiles (bots use the bearer token printed once)
npm run profile -- add --id marc --role owner --label Marc
npm run profile -- add --id dm --role dm
npm run profile -- add --id bob --role architect
npm run seed                # the 5 cities in config/seed.json (safe to re-run)
npm run profile -- add --id mayor-ai-receptionist-city --role mayor --city ai-receptionist-city

# Dashboard sign-in (asks for a password, min 12 characters, stored only as a hash)
npm run user -- add --username marc --profile marc
npm run user -- add --username ana --profile mayor-ai-receptionist-city   # read-only, own city

npm start                   # http://127.0.0.1:8787
```

### Try the dashboard on demo data

`npm run demo` writes a sample world to `data/demo.db` (never the real ledger), then:

```bash
npm run demo:start
```

Demo mode also turns on a **demo stand-in for the DM and the Mayors**, so the dashboard's forms take
effect within a second, through the same write-guard as the real bots. It refuses to run on anything
but `data/demo.db`: the real world is never auto-executed.

### Settings

| Env var | Default | |
|---|---|---|
| `WORLD_DB` | `data/world.db` | the ledger |
| `WORLD_PROFILES` | `config/profiles.json` | API token hashes + write scopes (gitignored, mode 600) |
| `WORLD_USERS` | `config/users.json` | dashboard logins, scrypt-hashed (gitignored, mode 600) |
| `WORLD_PORT` / `WORLD_HOST` | `8787` / `127.0.0.1` | keep it on localhost; reach it through Tailscale or the Hermes route |
| `WORLD_COOKIE_SECURE` | on | set `0` only when testing over plain `http://` on a machine other than localhost |
| `WORLD_TRUST_PROXY` | off | set `1` only behind a reverse proxy, so sign-in throttling sees the real client IP |
| `WORLD_SECRETS` | `config/secrets.json` | bot tokens from the department form (gitignored, mode 600); the ledger keeps only their names |
| `DM_WEBHOOK_URL` / `DM_WEBHOOK_SECRET` | unset | POSTs each new intent, signed `x-world-signature: sha256=<hmac>` |

## The dashboard

- **Sign in** with a password. Sessions last 7 days while in use, and a restart signs everyone out.
  Five wrong passwords lock that device out for 15 minutes.
- **World map**: one home per family (Revenue, Claude, Gemini, Essentials). Each city tile shows its
  Mayor, the latest KPI pulse against target with a trend line, agents by state, and anyone in jail.
- **City view**: KPI history (with a table view), the college (dean scorecard, professors' teaching
  records, new agents waiting for a department), every district and department (caps, shadows, unfilled
  roles, delegated tasks), and each agent's live status, strikes and lifecycle strip.
- **3D world** (switch on the World page): an island with one region per family, a platform per city,
  a building per department (taller = more agents), the college dome, a KPI beacon (green on target, red
  below), agents as figures coloured by state (working agents move), and Security's jail holding every
  jailed agent. Drag to orbit, scroll or pinch to zoom, hover or tap for details, click a city to open it.
  It is live like the map, loads only when chosen, and runs offline (three.js is vendored in
  `public/vendor/three`).
- **Jail**, **Inbox** (dean reports Security escalated to Marc) and **Activity** (the live ledger feed).
- **Forms (owner only)**, each writing an intent for the DM to route: New City (with initial districts),
  New District, New Department (caps, basic tasks, bot token stored as a server secret), department
  settings, college: Create agent / Create professor / Create or Replace dean, Assign an existing agent to a
  department (from the college, or moved from another department), Promote, Make dept-lead, Retire to
  professor, Delete (only when awaiting deletion), professor specialty, Security deployment, Message
  Mayor. Names can be left blank or suggested by the name generator. "Waiting on the DM" lists
  requests not yet routed.
- Everything updates live from the ledger. Mayors see only their own city; Marc, the DM, Bob and the
  Essentials Mayors see every city.
- Security: strict Content-Security-Policy (no inline code), HttpOnly SameSite=Strict cookies, a
  required header on browser writes (CSRF), and ledger text is always rendered as text, never HTML.

## API (for the DM and Mayor bots)

Bots send `Authorization: Bearer <token>`. The dashboard uses its session cookie, and browser writes must also send `x-world-request: 1`.

| Method | Path | |
|---|---|---|
| GET | `/api/health` | liveness |
| POST | `/api/login`, `/api/logout` · GET `/api/session` | dashboard sign-in (session cookie) |
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
2. ✅ Password sign-in; world map with family homes, city tiles, live KPI pulse + agent counts; city view; jail, inbox, activity
3. ✅ Entity forms: city, district, department, college agents, professors, dean; assign, promote, retire, delete, deploy, message Mayor
4. City layer: Mayor, per-agent lifecycle strip, live agent-status panel
5. Shared-surface write-guard + no-agent-instructs-agent enforcement + injection red-team tests
6. Currency ledger + graduation-vetting gate + clean attribution
7. World Constitution doc + templates

Marc's changes to the brief are recorded in [`docs/BRIEF-AMENDMENTS.md`](docs/BRIEF-AMENDMENTS.md).
Open questions for the DM are tracked in [`docs/OPEN-QUESTIONS.md`](docs/OPEN-QUESTIONS.md).
