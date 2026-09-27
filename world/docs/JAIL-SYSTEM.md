# The Jailing System — Complete Handoff (updated for A22)

This document covers Security City's jail as built in `world/`. It is written from the code:
- `src/domain/model.ts`, `src/domain/state.ts` (`workOutJail`), `src/ledger/guard.ts`, `src/ledger/catalog.ts`
- `src/server/executor.ts`, `src/domain/view.ts`
- `public/app.js`, `public/forms.js`, `public/city3d.js`

and from the tests:
- `test/jail.test.ts`, `test/discipline.test.ts`, `test/college.test.ts`, `test/dean.test.ts`,
  `test/lifecycle.test.ts`

Where Marc's own words set a rule, they are quoted.

**Amendments behind it:**
- **A3:** Security keeps a jail.
- **A6:** task strikes and jail terms.
- **A13/A15:** professors and Security's teaching strikes; dean reports go to Marc.
- **A22 (27 Sept):** World HQ confirms strikes; voids, early release, eviction; clean time; everyone can be
  struck; deletion needs HQ's record and typing the agent's ID.

---

## 1. In one paragraph

Security City keeps agents **deployed to every city** to watch for work not being done.
- **Strikes.** A deployed agent that catches someone not doing a task gets Security's Mayor to **report** a
  strike. The report counts **only once World HQ confirms it**.
- **The ladder.** Every **3 confirmed task strikes** is a **jail term**: 6 hours, then 24 hours, then 3 days.
  The **4th** time, the agent is jailed **awaiting deletion**.
- **Professors** also take **teaching strikes**: every 3 is a term of 6 hours, then 24 hours, and the **3rd**
  time means awaiting deletion.
- **Other holds.** A **3rd KPI strike**, or Marc **evicting** an agent, also means awaiting deletion.
- **Release and forgiveness.** Terms end **on their own**. Each **60 strike-free days** lowers the jail level
  one step.
- **Marc's powers.** He can **void** any strike and **release** anyone early.
- **Deletion.** Nothing is deleted automatically. **World HQ's supervisor** writes the archive and lesson
  record, Marc **reviews it**, and he deletes by **typing the agent's ID**.

**Marc's words**
- 25 Sept: *"if they're caught not doing a task they will get a strike, 3 strikes and they go to jail for 6
  hours for the first time, 24 hours the 2nd time. 3 days for the 3rd time and face deletion on the 4th."*
- 27 Sept (A22):
  - *"No HQ should confirm"*
  - *"All agents can be struck or sent to Jail except for Bob and World Messenger"*
  - *"3 teaching strikes will lead to jail 3 times in jail will face deletion"*
  - *"HQ supervisor, yes ask me first"*
  - *"make me type their agent id as a form of 2 factor authentication"*
  - Chosen: World HQ is a new world-level office; 60 days per step; professors 6h then 24h.

---

## 2. World HQ (new, A22)

- **What it is.** A **world-level office** above the cities, with its own **supervisor**. The supervisor is
  a bot login with the role **`hq`**. It reads every city and may write only its own event types:
  - **Confirm** or **dismiss** each strike Security reports (`hq.strike_confirmed`, `hq.strike_dismissed`).
    Until then a report is "Waiting for World HQ" and **doesn't count**.
  - **Write the deletion record** (`hq.deletion_record`) for an agent held awaiting deletion: where its
    ledger is archived, where its lesson record is, and a short summary.
- **Who can't confirm.** Marc, the DM, the Mayors and Security can't confirm or dismiss a strike: only HQ.
  Marc can **void** a report at any time (section 6).
- **Creating the login:** `npm run profile -- add --id world-hq --role hq`. The token goes to the HQ
  supervisor's bot.
- **Can HQ be struck?** Not yet: HQ's supervisor isn't an agent in the ledger (see section 12).

---

## 3. The three kinds of strike

| | KPI strikes | Task strikes | Teaching strikes |
|---|---|---|---|
| **Who gets them** | Graduated department agents | **Everyone who is an agent of a city**: department agents (once placed), **professors** and **deans**. Not Bob or the DM | Professors |
| **Why** | Missed the city KPI (value below target) | Caught not doing a task | Broke a college rule (free text until the school system spec) |
| **Reported by** | The home Mayor (`agent.school_returned` / `agent.third_strike`) | **Security's Mayor**, under Security's tag (`security.task_strike`) | **Security's Mayor** (`professor.strike`) |
| **Counts when** | Recorded | **World HQ confirms** | **World HQ confirms** |
| **Counter** | 0–3, never resets (a release from the 3rd sets it back to 2) | 0–2, resets at each jailing | 0–2, resets at each jailing |
| **Consequence** | Miss #1, #2 → school; #3 → **awaiting deletion** | Every 3rd → term: **6 h → 24 h → 3 days → awaiting deletion** | Every 3rd → term: **6 h → 24 h → awaiting deletion** |

The counters are **separate**. A professor has two ladders (task and teaching); a dean has the task ladder.

---

## 4. Deployment: who may observe

- **Deploying:** Marc deploys a **graduated Security City agent** to a city (Security City → **Deploy an
  agent**). Security's Mayor carries it out; under A19 it applies at once.
- **Where:** one city at a time; deploying again moves it. It ends by itself if the agent goes back to
  school or retires into a professor.
- **Who may be the observer:** a report is refused unless the observer is **all** of these:
  - a living Security department agent
  - graduated
  - deployed to the struck person's city
  - not in jail
  - not the person being struck

---

## 5. The ladders, exactly

```
Task strikes (agents, professors, deans):     Teaching strikes (professors):
  3 confirmed → term 1: 6 hours                 3 confirmed → term 1: 6 hours
  3 confirmed → term 2: 24 hours                3 confirmed → term 2: 24 hours
  3 confirmed → term 3: 3 days                  3 confirmed → term 3: AWAITING DELETION
  3 confirmed → term 4: AWAITING DELETION
```

- **When a strike counts.** A strike counts at the moment **HQ confirms** it. The count toward the next term
  resets to 0 at each jailing.
- **Release is automatic.** A term ends at `until`, and nobody writes a release. "Awaiting deletion" never
  ends on its own.
- **Clean time (A22): 60 days per step.**
  - Each full 60 days with no counted strike (and no term running) lowers that ladder's level by one step,
    down to zero.
  - The clock restarts at each counted strike and at the end of each term.
  - Example: an agent that served 24 hours (level 2) and then stays clean 60 days is back at level 1. Its next
    3rd strike gives 24 hours again, not 3 days.
  - The Security page shows each person's **jail level now**.
- **Where the numbers live:** all in `src/domain/model.ts`.
  - `TASK_STRIKES_PER_JAIL = 3`
  - `JAIL_TERMS_HOURS = [6, 24, 72]`
  - `TEACHING_JAIL_TERMS_HOURS = [6, 24]`
  - `CLEAN_DAYS_PER_LEVEL = 60`
  - `MAX_STRIKES = 3` (KPI)

**How it's worked out.** The jail isn't stored as a changing value. It's **worked out from the ledger** in
order:
- confirmed, not voided strikes
- holds (3rd KPI strike, eviction)
- Marc's releases

So voiding a strike later gives exactly the jail the person would have had without it. A server restart
always gives the same answer.

---

## 6. Marc's powers (A22)

| Action | Where | What happens |
|---|---|---|
| **Void a strike** (pending or confirmed) | Security → "Waiting for World HQ" or "Recent strikes" → **Void** (with a reason) | It never counts. The jail is worked out again; a term it caused ends. |
| **Release early** | Security jail table, or the person's row → **Release early** (with a reason) | Ends the term now (the level stays). From "awaiting deletion" it goes back to work: after a 3rd KPI strike with one KPI chance left; its deletion record is cleared. |
| **Evict** (before a 3rd strike) | The person's row, or the jail table → **Evict**: reason, then **type the agent's ID** | Held in jail **awaiting deletion** (cause "Evicted"). HQ then writes the record, and Marc decides. |
| **Delete** | **Review & delete**, which appears once HQ's record is in | Step 1: **review HQ's lesson record** (Marc: "ask me first"). Step 2: **type the agent's ID**. The deletion uses exactly HQ's archive and lesson references. |

- **Checked twice.** A wrong ID is refused in the form and again by the server. Nothing happens.
- **Evict and Delete buttons appear** for department agents (city Details), professors (College), the dean
  (dean card) and anyone in the jail table.

---

## 7. What a person in jail can't do

While inside (any term, or awaiting deletion):

| Area | Blocked |
|---|---|
| **Work and pay** | Earnings and rewards |
| **Strikes** | New strike reports; HQ can't confirm a waiting report either |
| **School and ladder** | Exams (as student or as examiner), intern, graduation, promotions, dept-lead |
| **Movement** | Moves, retiring to professor, a professor stepping in |
| **Other roles** | Delegating to shadows; a jailed dean can't report; a jailed professor can't be made dean; a jailed Security agent can't observe |

It **keeps** its ID, name, place, history and conversations (Marc can still talk to it).

---

## 8. Deletion, step by step

1. **The person is held awaiting deletion:** 4th task term, 3rd teaching term, 3rd KPI strike, or eviction.
2. **World HQ's supervisor writes `hq.deletion_record`:**
   - `ledgerArchiveRef`: the agent's full ledger, frozen and archived
   - `lessonRecordRef`: the distilled, sanitized lesson record for the replacement
   - `summary`: a short summary

   Until then the jail shows "Awaiting deletion · World HQ writing the lesson record", and Delete isn't
   offered.
3. **Marc** clicks **Review & delete**, reads the record, approves, and **types the agent's ID**.
4. **The home Mayor carries it out** (`agent.deleted`, with HQ's exact references; under A19 at once):
   - the ID and name are retired forever
   - the agent is listed under Retired agents with its lesson record

"Lessons persist, the individual doesn't." No agent executes its own exit.

---

## 9. Dean reports (A15)

1. **A dean reports** an agent to Security (`dean.reported`). A jailed dean can't report, and it can't report
   itself.
2. **Security escalates** it to Marc (`security.escalated`).
3. It appears in the **Inbox**. **Marc decides**; a report never jails anyone by itself.

---

## 10. Who sees what

- **Everything:** Marc, the DM, Bob, **World HQ**, and the Essentials Mayors (Security, Innovations).
- **Another Mayor** sees only its own city's people in the jail, plus the reports, HQ decisions and voids
  **about its own agents**, even though they're recorded under Security's or the World's tag.
- **Who writes what:**
  - Only Security's Mayor writes reports.
  - Only HQ confirms, dismisses or writes deletion records.
  - Only Marc voids, releases and evicts.

---

## 11. In the dashboard

| Place | What you see |
|---|---|
| **Security** (top bar) | **Jail**: who, city, cause (task / teaching / KPI strikes / evicted), term, release time or "awaiting your deletion decision", **jail level now**, and Release early / Evict / Review & delete. **Waiting for World HQ**: reports not yet decided, with Void. **Recent strikes**: HQ's decisions (confirmed / dismissed / voided), with Void. Also the shared-surface guard. |
| **City Details → agent rows** | "KPI x/3 · Task x/3 · jail level n · n awaiting HQ", a jail chip, and Release early / Evict / Review & delete. |
| **College → professors; dean card** | The same, with "Teaching x/3" for professors. |
| **Map and city header** | "N in jail" chips; "In jail" in the world KPI row. |
| **Dean scorecard** | The graduates' jail terms served and in jail now. |
| **3D city** | Security City's red jail cage holds every jailed person (hover for details); other cities show their own inside. |

---

## 12. Ledger events

| Event | Written by | Tag | Payload | Rules |
|---|---|---|---|---|
| `intent.deploy_agent` / `agent.deployed` | Marc / Security's Mayor | security-city | `agentId`, `toCity` | graduated Security agent |
| `security.task_strike` | Security's Mayor | security-city | `agentId`, `observedBy`, `task`, `evidence`, `evidenceRef?` | a **report**; target not jailed; observer rules |
| `professor.strike` | Security's Mayor | security-city | `professorId`, `observedBy`, `rule`, `evidence`, `evidenceRef?` | a **report**; professor not jailed |
| `hq.strike_confirmed` | **World HQ** | WORLD | `strikeSeq`, `note?` | report pending; person not in jail |
| `hq.strike_dismissed` | **World HQ** | WORLD | `strikeSeq`, `reason` | report pending |
| `intent.void_strike` → `strike.voided` | Marc → DM (A19: marc-as-dm) | WORLD | `strikeSeq`, `reason` | report not already voided or dismissed |
| `intent.release_agent` → `agent.released` | Marc → DM | the person's city | `agentId`, `reason` | the person is in jail |
| `intent.evict_agent` → `agent.evicted` | Marc → home Mayor | the person's city | `agentId`, `reason`, **`confirmAgentId`** | the typed ID must match; not already awaiting deletion |
| `agent.school_returned` / `agent.third_strike` | home Mayor | the agent's city | KPI miss fields | the 3rd → awaiting deletion |
| `hq.deletion_record` | **World HQ** | the person's city | `ledgerArchiveRef`, `lessonRecordRef`, `summary` | person awaiting deletion |
| `intent.delete_agent` → `agent.deleted` | Marc → home Mayor | the person's city | `agentId`, **`confirmAgentId`** / refs | typed ID must match; awaiting deletion; **uses HQ's exact refs** |
| `dean.reported` / `security.escalated` | city Mayor / Security's Mayor | city / security-city | report fields / `reportSeq`, `summary` | once per report |

**Upgrade of older ledgers.** A ledger created before A22 only accepted owner, DM and Mayor writers. On first
start, the server rebuilds the events table with the wider writer list. It copies every entry exactly (same
numbers, same hashes), so the tamper-proof chain is unchanged; the copy is checked, and the server refuses to
continue if anything differs.

Strikes recorded **before** A22 had no HQ confirmation, so they now show as "Waiting for World HQ" and count
once HQ confirms them.

---

## 13. Open questions (back to the District Messenger)

1. **Mayors in jail.** Marc said Mayors can be struck and jailed too, but a Mayor isn't an agent record in the
   ledger yet. Before building it:
   - While a Mayor is in jail, who runs the city: its Mayor bot paused, the DM, or a deputy?
   - Which of its writes are blocked?
   - Does "deletion" of a Mayor mean replacing it with a new Mayor?
   - Who observes a Mayor: a Security agent deployed to that city?
2. **District supervisors and World HQ's own supervisor.** Can they be struck and jailed too? (Everyone except
   Bob and the DM suggests yes.)
3. **KPI strikes and HQ.** HQ confirms Security's task and teaching strikes. KPI strikes are recorded by the
   home Mayor from the KPI numbers. Should HQ confirm those too?
4. **Partial strikes and clean time.** Clean time lowers the jail **level**. Should 1–2 strikes toward the
   next term also wear off after 60 clean days?
5. **Clock.** Terms run on the world server's clock: keep the PC's time synced automatically.
6. **Demo.** The demo's jailed agent is released 6 hours after the demo is built; a 4th report waits for HQ.

---

## 14. Tests

`npm test`: 170 tests, all passing.

**`test/jail.test.ts`**
- Reports count only after HQ confirms.
- Observer rules and deployment.
- **The ladder hour by hour** (6 h, 24 h, 3 days, each checked an hour before and at release).
- A year without release while awaiting deletion.
- The level after a term; deletion only with HQ's record.

**`test/discipline.test.ts` (A22)**
- Only HQ confirms; dismissed reports never count.
- The home Mayor sees HQ's decisions about its agents.
- HQ can't confirm while the person is inside.
- **Voiding** the strike that caused a term ends it.
- **Early release**, including from a 3rd KPI strike (one chance left).
- **60-day clean-time** step-down (the next term is 24 h instead of 3 days).
- **A dean jailed** by task strikes.
- **Eviction and deletion** refuse a wrong typed ID and need HQ's record, with HQ's exact refs.
- A release clears the record.

**Other files**
- **`test/college.test.ts`:** professors take task strikes too; the **teaching ladder** (6 h, 24 h, then
  awaiting deletion); jailed professors can't examine or step in.
- **`test/dean.test.ts`**, **`test/lifecycle.test.ts`:** dean reports and escalations; the KPI 3-chances path.
