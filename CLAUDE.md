# Marc's World — instructions for any Claude session working in this repo

The project is `world/`: the event ledger and dashboard for Marc's world of AI cities. The rest of this repo
(`oauth/`, `privacy/`, `terms/`, root `index.html`) is Marc's older site; leave it alone.

**Read first, in this order:**
1. `world/docs/HANDOFF-2026-09-26.md`: everything built, decided and open (setup, rules, screens, all ledger
   events, API, history, 24 open questions, what's next).
2. `world/docs/source/WORLD-BUILD-BRIEF.md`: Marc's original brief (authoritative).
3. `world/docs/BRIEF-AMENDMENTS.md`: A1–A21, every change Marc ratified on top of the brief.
4. `world/docs/SPEC-2026-09-26-SHARED-MEMORY-FOUR-TIER.md`: the shared-memory spec (A21).
5. `world/docs/OPEN-QUESTIONS.md`: interim decisions where the brief is ambiguous.

**Branch:** `claude/ai-agent-world-build-xxy71v`. Develop, commit and push there.

## Working rules (Marc's standing instructions)

- **Follow the brief precisely.** Where anything is ambiguous, **ask Marc rather than improvise**, and flag it
  "back to the District Messenger". Record ratified changes as the next amendment (A22, …) in
  `BRIEF-AMENDMENTS.md`.
- **Marc builds and decides; agents do the work.** Marc never carries out tasks. Everything he does from the
  dashboard applies at once, as DM and Mayor, through the write-guard (A19).
- **Agents are created only at a city's college.** A department only *assigns* an existing agent of that
  city. Agents are created only by Marc (dashboard) or by the DM, a Mayor or the Architect on his
  instruction, **never automatically** (A21).
- **No auto-publish.** Nothing is published without Marc's approval.
- **Deletion always needs a double confirm:** "Yes, continue", then type the exact name.
- **The inviolable floor:**
  - the ledger is append-only and hash-chained
  - no cross-city writes
  - memory and knowledge are never for sale
  - essentials are never economy-gated
- **The dashboard never writes the shared memory surface** (`surface.db` on the VPS). It only reads it
  through `world/vps/surface_reader.py` (A21).
- **Hermes agents are the real agents** (Mnemosyne memory; Hermes 0.21.4 on the VPS). Never copy them. Link
  to them (A21).

## How to work

- **Node 22.18+,** no runtime dependencies. From `world/`:
  - `npm install`
  - `npm test` (must stay at `fail 0`)
  - `npx tsc --noEmit -p .`
- **Frontend:** plain ES modules in `world/public/`, using the `h`/`s` DOM helpers. Never use innerHTML.
- **Try it:** `npm run demo` once, then `npm run demo:start` at http://127.0.0.1:8787 (sign in with
  `marc` / `demo-password-123`).
- **Test every UI change** in a real browser before pushing.
- **After each push,** tell Marc the new build (short commit ID, shown top right of the dashboard) and the exact
  terminal commands to update:
  - `git pull origin claude/ai-agent-world-build-xxy71v`
  - restart the server
  - hard-refresh the browser
- **Writing for Marc:** plain language, short, with the commands he needs.
