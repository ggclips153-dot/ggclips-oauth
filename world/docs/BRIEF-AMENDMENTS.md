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
| A7 | 2026-09-25 | **Shadows are interns**: students in the last phase before graduation, attached to the department they studied for (not to a specific agent). They learn by working alongside its graduated agents. They count in agent totals (under student, labelled intern). | `agent.interned`, `INTERN_BADGE` |
| A8 | 2026-09-25 | **Departments have no slots.** A department is the agents who specialise in it. The New Department form drops "agent-slot count". **The Mayor appoints shadow promotions** (student → intern → graduated) on its own, with no Marc intent. Higher promotions (active, senior, dept-lead), placement, moves and deletion stay Mayor + Marc via the DM. | `agent.interned`, `agent.graduated`; `slots` removed |
| A9 | 2026-09-25 | **Department caps and shadow chain of command.** Marc can set a cap on graduated ("fully working") agents and on shadows per department, when creating it or later. Once assigned, a shadow takes work from its department's graduated agents, not from the Mayor. **Prompt-propagation exception (option B):** a graduated agent may hand a task from the department's approved *basic tasks* list to a shadow in its own department. Every hand-off is recorded; the shadow's output comes back as data for the graduated agent to check. No other agent-to-agent instruction is allowed. **Dept-lead counts only graduated agents.** | `maxGraduated`, `maxShadows`, `basicTasks`, `task.delegated`, `task.returned` |
| A10 | 2026-09-25 | **Professors**: department specialists who teach, give exams and judge whether a student is fit to graduate; graduation needs a passed exam from a professor of that department. Not graduated agents: not capped, not counted toward dept-lead, not in the state counts. | `exam.graded` |
| A11 | 2026-09-25 | **Each city has a College.** New beginner agents and professors are created only at the college. A new agent waits there, enrolled and unplaced; **adding an agent to a department assigns an existing agent of that city, it never creates one.** A professor can be connected to an existing department at creation (or later). A **senior (tier 5)** agent can be retired into a professor, keeping its ID and name. When a department reports an unfilled role, the Mayor sends a professor who specialises in that department, for a set time. | `intent.create_agent` (no department), `intent.place_agent`, `professor.enrolled`, `professor.specialized`, `agent.retired_to_professor`, `department.role_requested`, `professor.stepped_in` |
| A12 | 2026-09-25 | **Professors stay at the college teaching** and go to the department they specialise in only when it needs them (a role request), for a set time, then return. Their specialty is set at creation or later, within the city. A jailed professor can't examine or step in. | `professor.stepped_in`, `intent.specialize_professor` |
| A13 | 2026-09-25 | **Professors have their own strike rules.** No KPI strikes and no task strikes; they take only *teaching strikes* under the college's rules (the full school system is being designed by Marc). 3 teaching strikes = held awaiting deletion, deleted only on Marc's routed intent. Each professor keeps a **teaching record**: exams given, exams passed, students graduated under it. | `professor.strike`, `teaching` |
| A14 | 2026-09-25 | **The Dean**: one per college, manages its professors. Marc creates the first dean. The dean is judged on **how its graduates perform in their fields** (scorecard: graduates, still working, promoted past probation, KPI strikes, jail terms, deleted). **The Mayor judges the dean** and governs the whole city: colleges, districts and departments. | `intent.create_dean`, `dean.appointed`, `dean.reviewed`, dean `scorecard` |
| A15 | 2026-09-25 | **Security applies teaching strikes to professors** (observed by a Security agent deployed to that city; task strikes are for department agents only). **Deans report** agents caught not doing their work to Security, and **Security brings them up to Marc** (his escalation inbox). Marc decides. | `dean.reported`, `security.escalated`, `escalations` |

**Scope note.** Day-to-day ledger discipline (every agent recording its ledger properly) is run by Hermes. This project builds the world: its model, rules, ledger and dashboard.

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
