# Starting the live world on Marc's PC — handoff (26 September 2026)

For the next Claude session on Marc's PC, and for Marc. The goal: take the world from "the demo works" to the
**live world** (the real ledger) running on the PC, one step at a time, with Marc deciding each step.

## 1. Where things stand

- **Code:** branch `claude/ai-agent-world-build-xxy71v`, build `93483d8` or later, with A22 in (the World
  Messenger; no seeding).
- **The PC:** Windows 10, PowerShell. Node 24.19 (`C:\Program Files\nodejs`), Git 2.55, Tailscale connected
  and the VPS reachable. The project is at `$HOME\ggclips-oauth`.
- **Checked on the PC:** `npm.cmd test` 165/165; the demo; and a fresh world from empty, in a throwaway folder
  (sign in, Ratify 1.0.0, + New city, the World Messenger's bot login over the API).
- **Built:** the demo (`world\data\demo.db`).
- **Not created yet (this is the job):** the live ledger `world\data\world.db`, and the logins
  `world\config\profiles.json`, `users.json` and `secrets.json`.

**Read first:** `CLAUDE.md`; then `world/docs/HANDOFF-2026-09-26.md` sections 3 (setup), 4 (everyday use,
troubleshooting), 12 (what the bots connect to) and 20 (open questions); `world/docs/BRIEF-AMENDMENTS.md` up to
A22; `world/docs/JAIL-SYSTEM.md`.

## 2. Rules for this session

- **Marc decides, and does the dashboard steps.** You prepare, check, explain and fix. Ask before each step
  that changes anything. Never create cities, departments or agents yourself (A19, A21).
- **Secrets never pass through the chat.** Marc runs, in his own PowerShell window, every command that prints a
  token (`profile add`) or asks for a password (`user add`). Never set `WORLD_PASSWORD` for a real login. Never
  print, save or commit a token or a password. `config\*.json` and `data\` are gitignored: keep them that way.
- **Marc runs the live server in his own PowerShell window**, so it keeps running after this session ends.
  Don't start the live server from your own shell.
- **Never edit or delete `data\world.db`** (or its `-wal` and `-shm` files). Back up only with the server
  stopped (handoff section 4).
- **Never change Windows or firewall settings.** If Windows asks something, Marc answers it.
- **The dashboard never writes the shared memory surface** (A21).
- **The command queue** (Marc's global rules): check it at the start, and show each queued command for his
  approval, one at a time. At the end of the last session the world-surface server refused connections; if its
  tools fail, tell Marc it probably needs a restart.
- **Git:** fetch before you push (other sessions push to this branch too). This PC has no git identity, so
  commit with `git -c user.name=Claude -c user.email=noreply@anthropic.com commit …`. Don't change Marc's git
  settings.
- **If `node` or `npm.cmd` isn't found** in your shell, the app was started before Node was installed: prefix
  commands with `$env:Path = "C:\Program Files\nodejs;" + $env:Path`, or ask Marc to restart the app.

## 3. Ask Marc these first, one at a time

1. **Constitution Article XI** (open question #25). It lists the amendments it incorporates as A1–A18. Should
   1.0.0 also list A19–A22? Decide **before** ratifying: once ratified, any change is a new version.
2. **Which cities first**, with the family and Mayor of each. He creates them himself (A22). A4's list is the
   reference: AI Receptionist City (Ana), Personal Finance City (Greg) and GGClutchPlays (Kevin), all Revenue;
   Innovations City (Soren) and Security City (Odette), both Essentials.
3. **What to connect now**, and what can wait. Each is optional for the first start:
   - **the World Messenger's webhook:** needs its URL and secret from the Messenger (open question #10).
     Without it the Messenger reads the ledger, which is its queue either way;
   - **the shared-surface reader on the VPS** (handoff 3.5): needs an SSH login as `hermeswebui`, and the
     surface's city names for the Memory tab (open question #3);
   - **StarNet** (handoff 3.4): about 3.3 GB, not tried on Windows yet, and every station makes real model
     calls with real costs.
4. **Always on?** Today the world runs only while its PowerShell window is open and the PC is awake. Starting it
   automatically (for example with Windows Task Scheduler) would be a new decision: ask, don't set it up unasked.

Already answered, don't ask again: Windows and PowerShell (#4); other devices over Tailscale, yes (#5); each
agent is its own Hermes profile and the Hermes API server isn't on yet (#1); Bob builds Hermes profiles and the
World Messenger records it (#2, A22).

## 4. The live start, step by step

Wait for Marc after each step. Everything runs in PowerShell.

### Step 1 — Pre-flight (you)

```powershell
cd $HOME\ggclips-oauth
git fetch origin claude/ai-agent-world-build-xxy71v
git pull --ff-only origin claude/ai-agent-world-build-xxy71v
cd world
npm.cmd install
npm.cmd test
Test-Path data\world.db, config\profiles.json, config\users.json
```

Expect `ℹ fail 0`, and `False` three times (no live world yet). If a live ledger already exists, stop and ask
Marc: never overwrite it.

### Step 2 — Logins (Marc, in his own window)

```powershell
cd $HOME\ggclips-oauth\world
npm.cmd run profile -- add --id marc --role owner --label Marc
npm.cmd run profile -- add --id messenger --role messenger
npm.cmd run profile -- add --id bob --role architect
npm.cmd run profile -- add --id hermes-gateway --role gateway
npm.cmd run user -- add --username marc --profile marc
```

Each `profile add` prints a token **once**. Where each one goes:
- `messenger` → the World Messenger's Hermes profile secrets, on the VPS;
- `bob` → Bob's Hermes profile secrets (Bob reads; the ledger refuses his writes);
- `hermes-gateway` → Hermes's shared-surface write check, `POST /api/surface/check` (open question #11);
- `marc` → not needed: Marc signs in with his password. Don't store it anywhere.

`user add` asks for Marc's dashboard password (12 characters or more).

### Step 3 — The Constitution's text (you, only if Marc said yes to section 3, question 1)

Change only Article XI's list in `world/docs/constitution/WORLD-CONSTITUTION.md`, in Marc's words. Run
`npm.cmd test`, then commit and push. Nothing else in the Constitution changes.

### Step 4 — Optional connections (only what Marc chose)

- **Surface reader on the VPS:** handoff 3.5. Check from the PC: `curl.exe http://<VPS Tailscale IP>:8765/health`.
- **StarNet:** handoff 3.4.

### Step 5 — Start the live world (Marc, in his own window)

Stop the demo first if it's running: both use port 8787.

```powershell
cd $HOME\ggclips-oauth\world
$env:WORLD_HOST = (tailscale ip -4); $env:WORLD_COOKIE_SECURE = "0"
npm.cmd start
```

Put any settings Marc chose before `npm.cmd start` (handoff 3.6): `$env:MESSENGER_WEBHOOK_URL` and
`$env:MESSENGER_WEBHOOK_SECRET`, `$env:SURFACE_URL` and `$env:SURFACE_TOKEN`, `$env:STARNET_DIR`.

- **Why the Tailscale address:** the bots run on the VPS and must reach the world at
  `http://<PC Tailscale IP>:8787`, and so do Marc's other devices. With the default (`127.0.0.1`) nothing
  outside the PC can reach it. The PC's own browser then uses `http://<PC Tailscale IP>:8787` too.
- **Expect:** `World ledger: 0 events verified. Listening on http://<PC Tailscale IP>:8787`, then
  `Build <id>`. No "Demo sign-in" line: that's only the demo.
- **If Windows asks** whether Node.js may accept connections, Marc allows it. Then check from the VPS:
  `curl http://<PC Tailscale IP>:8787/api/health` answers with `"mode":"live"`.
- **`EADDRNOTAVAIL`** means Tailscale isn't connected yet: connect it and start again.

### Step 6 — Sign in and ratify (Marc)

Open `http://<PC Tailscale IP>:8787`, sign in as `marc`, then **Constitution → Ratify 1.0.0**. It shows
"In force".

Then (you): `npm.cmd run constitution -- pointer` prints the SOUL pointer line. Its fingerprint differs from the
MacBook's 1.0.0 (A22 changed the text), so any SOUL that carries the old line needs the new one. The World
Messenger or Bob updates SOULs on the VPS when Marc tells them to; never automatically.

### Step 7 — Cities (Marc)

**Map → + New city**, one at a time, with initial districts if he wants them. Departments come later, from each
city's page.

### Step 8 — Mayor logins (Marc, in his own window), once each city exists

The city's ID is in the address bar: `#/city/<id>`. For example:

```powershell
npm.cmd run profile -- add --id mayor-ai-receptionist-city --role mayor --city ai-receptionist-city
```

Each token → that Mayor bot's secrets on the VPS. Optional, a read-only dashboard sign-in for a Mayor:
`npm.cmd run user -- add --username ana --profile mayor-ai-receptionist-city`. **Logins are read at start:** stop
the server (Ctrl+C) and start it again with the same settings.

### Step 9 — Connect the World Messenger

When the Messenger has its webhook URL and secret: stop the server, set `MESSENGER_WEBHOOK_URL` and
`MESSENGER_WEBHOOK_SECRET`, and start again. Check:
- from the VPS, its bot: `curl -H "Authorization: Bearer <its token>" http://<PC Tailscale IP>:8787/api/me`
  answers with `"role":"messenger"`;
- `http://<PC Tailscale IP>:8787/api/health` then shows `messengerSeenAt`;
- Marc sends **Message Mayor** from a city's page, and the Messenger gets a signed ping.

Its full contract: handoff section 12 (role `messenger`, `messenger.routed`, `x-world-signature`).

### Step 10 — Check and back up

Go through the first-run check (handoff 3.8). Then make the first backup (handoff section 4), with the server
stopped.

### Step 11 — Report to Marc

The build ID (top right of the dashboard), what's live, what's still off, and the open questions left. Plain
language, short, with the commands he needs.

## 5. Watch-outs

- Only one address answers: `127.0.0.1` or the Tailscale address, whichever `WORLD_HOST` says.
- The live world stops when its window closes, or when the PC sleeps or restarts.
- Jail terms use the PC's clock: keep Windows time sync on.
- Nothing is backed up automatically yet (open question #21).
- The demo keeps working next to the live world, with its own in-memory login that never opens the live world.
  To run both, start the demo in another window on another port: `$env:WORLD_PORT = "8788"`, then
  `npm.cmd run demo:start`.

## 6. After the live start

The next build is the **Hermes link** (A21; handoff 11.5 and 21). It waits on:
- open question #1: how Hermes 0.21.4 turns on its API server per profile (the World Messenger finds out);
- open question #3: the surface's city names.

Also still open: the jail questions in `JAIL-SYSTEM.md` section 11, and the rest of handoff section 20.
