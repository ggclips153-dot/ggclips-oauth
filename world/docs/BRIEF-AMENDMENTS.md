# Amendments to the World Build Brief

Changes Marc has ratified on top of the original brief. The brief stays authoritative for
everything not listed here.

| # | Date | Amendment | Enforced in |
|---|---|---|---|
| A1 | 2026-09-25 | New city FAMILY **Essentials** (`essentials`), alongside `revenue`, `claude` and `gemini`. Innovations City and Security City are Essentials cities. Essentials get their own home on the world map. | `FAMILIES` in `src/domain/model.ts` |
| A2 | 2026-09-25 | Essentials cities may **see** every other city but **never edit** them. An Essentials Mayor reads all cities; it still writes only its own city's tag. (Extends "only the DM and Bob cross between cities".) | `readScope` in `src/domain/view.ts`; write-guard unchanged |
| A3 | 2026-09-25 | **Security jail.** Security City holds agents (a) waiting to be deleted after a 3rd strike, and (b) caught not doing their tasks. | `agent.jailed`, `agent.released`, `security.flagged` |
| A4 | 2026-09-25 | First cities: AI Receptionist City (Mayor Ana), Personal Finance City (Greg), GGClutchPlays (Kevin), Innovations City (Soren), Security City (Odette). | `config/seed.json` |
| A5 | 2026-09-25 | **Name generator** for agent display names, so Marc doesn't have to name each agent. | `src/domain/names.ts` |

## How the jail works (A3)

- **3rd strike → jail automatically**, with reason `awaiting_deletion`. It stays there until Marc's
  delete intent is executed. It can't be released.
- **Not doing tasks:**
  1. Security's Mayor files `security.flagged` about an agent in any city. The flag is written under
     **Security's own city tag**: it's a report, not an edit.
  2. Marc decides and writes `intent.jail_agent`, citing the flag if there is one. The DM routes it.
  3. The agent's **home Mayor** writes `agent.jailed`. Security can't, because the agent's city tag is
     outside its write scope.
  4. Release works the same way: `intent.release_agent`, then `agent.released` from the home Mayor.
- A jailed agent can't graduate, be promoted, move or take strikes until it's released or deleted.
- The jail roster (`GET /api/state → jail`) shows jailed agents from every city. Security, Innovations,
  Marc, the DM and Bob see all of them; a revenue Mayor sees only its own city's.
