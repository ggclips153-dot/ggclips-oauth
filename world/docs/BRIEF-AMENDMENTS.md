# Amendments to the World Build Brief

Changes Marc has ratified on top of the original brief. The brief stays authoritative for
everything not listed here.

| # | Date | Amendment | Enforced in |
|---|---|---|---|
| A1 | 2026-09-25 | New city FAMILY **Essentials** (`essentials`), alongside `revenue`, `claude` and `gemini`. Innovations City and Security City are Essentials cities. Essentials get their own home on the world map. | `FAMILIES` in `src/domain/model.ts` |
| A2 | 2026-09-25 | Essentials cities may **see** every other city but **never edit** them. An Essentials Mayor reads all cities; it still writes only its own city's tag. (Extends "only the DM and Bob cross between cities".) | `readScope` in `src/domain/view.ts`; write-guard unchanged |
| A3 | 2026-09-25 | **Security jail.** Security City holds agents (a) waiting to be deleted, and (b) serving a term for task strikes. | `Jail` in `src/domain/state.ts` |
| A4 | 2026-09-25 | First cities: AI Receptionist City (Mayor Ana), Personal Finance City (Greg), GGClutchPlays (Kevin), Innovations City (Soren), Security City (Odette). | `config/seed.json` |
| A5 | 2026-09-25 | **Name generator** for agent display names, so Marc doesn't have to name each agent. | `src/domain/names.ts` |
| A6 | 2026-09-25 | **Task strikes**, a counter separate from KPI strikes. A Security City department has agents deployed to each city. Caught not doing a task = 1 task strike. Every 3 = a jail term: 6 hours, then 24 hours, then 3 days; the 4th time = jailed awaiting deletion. Terms end on their own. Task strikes reset after each term; the term level never resets. | `security.task_strike`, `agent.deployed` |
| A7 | 2026-09-25 | **Shadows** are interns: students in the last phase before graduation. Professors (the most experienced) supervise the shadow's work. A shadow covers its slot while the holder is out and takes the slot if the holder is deleted or the department expands. Shadows count in agent totals. | Not built yet (see OPEN-QUESTIONS #17-#20) |

## How Security and the jail work (A3, A6)

- **Deployment.** Marc writes `intent.deploy_agent` for a graduated Security City agent and a target
  city. The DM routes it, and Security's Mayor writes `agent.deployed`.
- **Task strike.** When a deployed agent catches an agent in its city not doing a task, Security's
  Mayor writes `security.task_strike`, naming the observer, the task and the evidence. It goes under
  **Security's own city tag**. The ledger rejects it unless the observer is a living Security agent
  deployed to that agent's city. The home Mayor can see strikes against its own agents.
- **Jail terms, automatic.** On every 3rd task strike the agent is jailed and its task strikes reset
  to 0. Term 1 = 6 hours, term 2 = 24 hours, term 3 = 3 days. Timed terms end on their own; the
  dashboard works this out from the ledger clock and nobody has to write a release.
- **Awaiting deletion.** The 4th jailing (task strikes), or a 3rd KPI strike, holds the agent until
  deleted. Nothing is deleted automatically: Marc writes `intent.delete_agent`, the DM routes it, and
  the home Mayor executes. Deletion is refused for any agent not held awaiting deletion.
- **While jailed**, an agent can't graduate, be promoted, move, take KPI strikes or take more task
  strikes.
- **Visibility.** The jail roster (`GET /api/state → jail`) lists agents currently inside, from every
  city. Security, Innovations, Marc, the DM and Bob see all of them; a revenue Mayor sees only its own.
