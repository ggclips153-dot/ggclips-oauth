# The Jailing System — Complete Handoff (updated for A28, A30 and A32)

This document covers the jail as built in `world/`. It is written from the code:
- `src/domain/model.ts`, `src/domain/state.ts` (`workOutJail`), `src/ledger/guard.ts`, `src/ledger/catalog.ts`
- `src/server/executor.ts`, `src/domain/view.ts`
- `public/app.js`, `public/forms.js`, `public/city3d.js`, `public/world3d.js`

and from the tests:
- `test/jail.test.ts`, `test/discipline.test.ts`, `test/college.test.ts`, `test/dean.test.ts`,
  `test/lifecycle.test.ts`

Where Marc's own words set a rule, they are quoted. **HQ is the Security city** (A28): in Marc's world the city
named HQ (ID `security`); in the demo, "Security City" (ID `security-city`).

**Amendments behind it:**
- **A3:** Security keeps a jail.
- **A6:** task strikes and jail terms.
- **A13/A15:** professors and Security's teaching strikes; dean reports go to Marc.
- **A28:** the Security city is **HQ**, whatever its name. Marc's HQ was created as "Security" before a city
  could be created as the Security city, so it was made the Security city once, from its page ("Make this the
  Security city", `city.security_designated`).
- **A30:** **every city has its own jail.** An agent serving a term is held in its own city's jail. An agent
  **awaiting deletion** is moved to **HQ's jail** and waits there for Marc's decision. Where an agent is held is
  worked out from the ledger (like the terms), so no event records the move.
- **A32 (27 Sept):** HQ confirms strikes; voids, early release, eviction; clean time; everyone can be struck;
  deletion needs HQ's record and typing the agent's ID.

---

## 1. In one paragraph

HQ keeps agents **deployed to every city** to watch for work not being done.
- **Strikes.** A deployed agent that catches someone not doing a task gets HQ's Mayor to **report** a strike.
  The report counts **only once HQ confirms it** (its Judiciary).
- **The ladder.** Every **3 confirmed task strikes** is a **jail term**: 6 hours, then 24 hours, then 3 days,
  served in the person's own city's jail. The **4th** time, the agent is jailed **awaiting deletion** in HQ's jail.
- **Professors** also take **teaching strikes**: every 3 is a term of 6 hours, then 24 hours, and the **3rd**
  time means awaiting deletion.
- **Other holds.** A **3rd KPI strike**, or Marc **evicting** an agent, also means awaiting deletion.
- **Release and forgiveness.** Terms end **on their own**. Each **60 strike-free days** lowers the jail level
  one step.
- **Marc's powers.** He can **void** any strike and **release** anyone early.
- **Deletion.** Nothing is deleted automatically. **HQ's supervisor** writes the archive and lesson record,
  Marc **reviews it**, and he deletes by **typing the agent's ID**.

**Marc's words**
- 25 Sept: *"if they're caught not doing a task they will get a strike, 3 strikes and they go to jail for 6
  hours for the first time, 24 hours the 2nd time. 3 days for the 3rd time and face deletion on the 4th."*
- 27 Sept (A30): *"Every city will have a jail and HQ's Jail will be the one agents are held in before facing
  deletion"*; *"HQ is SECURITY"*.
- 27 Sept (A32):
  - *"No HQ should confirm"*
  - *"All agents can be struck or sent to Jail except for Bob and World Messenger"*
  - *"3 teaching strikes will lead to jail 3 times in jail will face deletion"*
  - *"HQ supervisor, yes ask me first"*
  - *"make me type their agent id as a form of 2 factor authentication"*
  - Chosen: 60 days per step; professors 6h then 24h. Then "HQ = Security confirms": HQ is the Security city,
    not a separate office.

---

## 2. HQ confirms (A32)

- **Who confirms.** HQ, the Security city. Its **Mayor** records HQ's decisions (its Judiciary's) under HQ's own
  tag, like its reports:
  - **Confirm** or **dismiss** each strike reported (`security.strike_confirmed`, `security.strike_dismissed`).
    Until then a report is "Waiting for HQ" and **doesn't count**.
  - **Write the deletion record** (`security.deletion_record`) for an agent held awaiting deletion: where its
    ledger is archived, where its lesson record is, and a short summary.
- **Who can't confirm.** Marc, the World Messenger and every other city's Mayor. Marc can **void** a report at
  any time (section 6).
- **No new login or role.** HQ's Mayor bot does it, with the Mayor login of HQ's city.
- **Why not a separate office.** A cloud session built "World HQ" as its own world-level office with a new
  ledger role, and a one-time rebuild of the ledger file to allow it. Marc chose "HQ = Security confirms", so
  neither was kept.

---

## 3. The three kinds of strike

| | KPI strikes | Task strikes | Teaching strikes |
|---|---|---|---|
| **Who gets them** | Graduated department agents | **Everyone who is an agent of a city**: department agents (once placed), **professors** and **deans**. Not Bob or the World Messenger | Professors |
| **Why** | Missed the city KPI (value below target) | Caught not doing a task | Broke a college rule (free text until the school system spec) |
| **Reported by** | The home Mayor (`agent.school_returned` / `agent.third_strike`) | **HQ's Mayor**, under HQ's tag (`security.task_strike`) | **HQ's Mayor** (`professor.strike`) |
| **Counts when** | Recorded | **HQ confirms** | **HQ confirms** |
| **Counter** | 0–3, never resets (a release from the 3rd sets it back to 2) | 0–2, resets at each jailing | 0–2, resets at each jailing |
| **Consequence** | Miss #1, #2 → school; #3 → **awaiting deletion** | Every 3rd → term: **6 h → 24 h → 3 days → awaiting deletion** | Every 3rd → term: **6 h → 24 h → awaiting deletion** |

The counters are **separate**. A professor has two ladders (task and teaching); a dean has the task ladder.

---

## 4. Deployment: who may observe

- **Deploying:** Marc deploys a **graduated HQ agent** to a city (HQ's page → **Deploy an agent**). HQ's Mayor
  carries it out; under A19 it applies at once.
- **Where:** one city at a time; deploying again moves it. It ends by itself if the agent goes back to
  school or retires into a professor.
- **Who may be the observer:** a report is refused unless the observer is **all** of these:
  - a living HQ department agent
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
- **Clean time (A32): 60 days per step.**
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
always gives the same answer. **Where** the person is held (A30) is worked out the same way: its own city's jail
during a term, HQ's while awaiting deletion.

---

## 6. Marc's powers (A32)

| Action | Where | What happens |
|---|---|---|
| **Void a strike** (pending or confirmed) | Security → "Waiting for HQ" or "Recent strikes" → **Void** (with a reason) | It never counts. The jail is worked out again; a term it caused ends. |
| **Release early** | Security jail table, or the person's row → **Release early** (with a reason) | Ends the term now (the level stays). From "awaiting deletion" it goes back to work: after a 3rd KPI strike with one KPI chance left; its deletion record is cleared. |
| **Evict** (before a 3rd strike) | The person's row, or the jail table → **Evict**: reason, then **type the agent's ID** | Held in HQ's jail **awaiting deletion** (cause "Evicted"). HQ then writes the record, and Marc decides. |
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
| **Other roles** | Delegating to shadows; a jailed dean can't report; a jailed professor can't be made dean; a jailed HQ agent can't observe |

It **keeps** its ID, name, place, history and conversations (Marc can still talk to it).

---

## 8. Deletion, step by step

1. **The person is held awaiting deletion** in HQ's jail: 4th task term, 3rd teaching term, 3rd KPI strike, or
   eviction.
2. **HQ's supervisor writes the deletion record** (`security.deletion_record`, by HQ's Mayor, under HQ's tag):
   - `agentId`: who it is for
   - `ledgerArchiveRef`: the agent's full ledger, frozen and archived
   - `lessonRecordRef`: the distilled, sanitized lesson record for the replacement
   - `summary`: a short summary

   Until then the jail shows "Awaiting deletion · HQ writing the lesson record", and Delete isn't offered.
3. **Marc** clicks **Review & delete**, reads the record, approves, and **types the agent's ID**.
4. **The home Mayor carries it out** (`agent.deleted`, with HQ's exact references; under A19 at once):
   - the ID and name are retired forever
   - the agent is listed under Retired agents with its lesson record

"Lessons persist, the individual doesn't." No agent executes its own exit.

---

## 9. Dean reports (A15)

1. **A dean reports** an agent to Security (`dean.reported`). A jailed dean can't report, and it can't report
   itself.
2. **HQ escalates** it to Marc (`security.escalated`).
3. It appears in the **Inbox**. **Marc decides**; a report never jails anyone by itself.

---

## 10. Who sees what

- **Everything:** Marc, the World Messenger, Bob, and the Essentials Mayors (HQ, Innovations).
- **Another Mayor** sees only its own city's people in the jail, plus the reports, HQ's decisions, deletion
  records and voids **about its own agents**, even though they're recorded under HQ's or the World's tag.
- **Who writes what:**
  - Only HQ's Mayor writes reports, confirmations, dismissals and deletion records.
  - Only Marc voids, releases and evicts.

---

## 11. In the dashboard

| Place | What you see |
|---|---|
| **Security** (top bar) | **Jail**: who, city, **held in** (its own city's jail, or HQ's while awaiting deletion), cause (task / teaching / KPI strikes / evicted), term, release time or "awaiting your deletion decision", **jail level now**, and Release early / Evict / Review & delete. **Waiting for HQ**: reports not yet decided, with Void. **Recent strikes**: HQ's decisions (confirmed / dismissed / voided), with Void. A warning while the world has no Security city. Also the shared-surface guard. |
| **City Details → agent rows** | "KPI x/3 · Task x/3 · jail level n · n awaiting HQ", a jail chip, and Release early / Evict / Review & delete. |
| **College → professors; dean card** | The same, with "Teaching x/3" for professors. |
| **Map and city header** | "N in jail" chips; "In jail" in the world KPI row. |
| **Dean scorecard** | The graduates' jail terms served and in jail now. |
| **3D city and globe** | **Every city** has a red wireframe **jail cage** holding its own jailed people (hover for details). HQ's cage also holds the agents **awaiting deletion** from every city. Jailed people wear orange and stand inside. |
| **Deploy an agent** | Button on HQ's page (owner). |
| **Make this the Security city** | Button on an Essentials city's page while the world has none (owner, once). |

---

## 12. Ledger events

| Event | Written by | Tag | Payload | Rules |
|---|---|---|---|---|
| `intent.deploy_agent` / `agent.deployed` | Marc / HQ's Mayor | HQ | `agentId`, `toCity` | graduated HQ agent |
| `security.task_strike` | HQ's Mayor | HQ | `agentId`, `observedBy`, `task`, `evidence`, `evidenceRef?` | a **report**; target not jailed; observer rules |
| `professor.strike` | HQ's Mayor | HQ | `professorId`, `observedBy`, `rule`, `evidence`, `evidenceRef?` | a **report**; professor not jailed |
| `security.strike_confirmed` | **HQ's Mayor** | HQ | `strikeSeq`, `note?` | report pending; person not in jail |
| `security.strike_dismissed` | **HQ's Mayor** | HQ | `strikeSeq`, `reason` | report pending |
| `intent.void_strike` → `security.strike_voided` | Marc → World Messenger (A19: marc-as-messenger) | WORLD | `strikeSeq`, `reason` | report not already voided or dismissed |
| `intent.release_agent` → `agent.released` | Marc → World Messenger | the person's city | `agentId`, `reason` | the person is in jail |
| `intent.evict_agent` → `agent.evicted` | Marc → home Mayor | the person's city | `agentId`, `reason`, **`confirmAgentId`** | the typed ID must match; not already awaiting deletion |
| `agent.school_returned` / `agent.third_strike` | home Mayor | the agent's city | KPI miss fields | the 3rd → awaiting deletion |
| `security.deletion_record` | **HQ's Mayor** | HQ | `agentId`, `ledgerArchiveRef`, `lessonRecordRef`, `summary` | person awaiting deletion |
| `intent.delete_agent` → `agent.deleted` | Marc → home Mayor | the person's city | `agentId`, **`confirmAgentId`** / refs | typed ID must match; awaiting deletion; **uses HQ's exact refs** |
| `dean.reported` / `security.escalated` | city Mayor / HQ's Mayor | city / HQ | report fields / `reportSeq`, `summary` | once per report |
| `intent.designate_security_city` → `city.security_designated` | Marc → World Messenger | that city | none | an Essentials city; once per world (A28) |

"HQ" as a tag is the Security city's ID: `security` in Marc's world, `security-city` in the demo.

A jail term is not an event. It's the **result** of the confirmed strikes, worked out from the ledger;
release is worked out from time, and so is where the person is held (A30). So a restart gives exactly the same
jail. Strikes recorded **before** A32 had no confirmation, so they show as "Waiting for HQ" and count once HQ
confirms them (Marc's live world has none).

---

## 13. Open questions (back to the World Messenger)

1. **Mayors in jail.** Marc said Mayors can be struck and jailed too, but a Mayor isn't an agent record in the
   ledger yet. Before building it:
   - While a Mayor is in jail, who runs the city: its Mayor bot paused, the World Messenger, or a deputy?
   - Which of its writes are blocked?
   - Does "deletion" of a Mayor mean replacing it with a new Mayor?
   - Who observes a Mayor: an HQ agent deployed to that city?
2. **Supervisors.** Can district and department supervisors be struck and jailed too? (Everyone except Bob and
   the World Messenger suggests yes.)
3. **KPI strikes and HQ.** HQ confirms task and teaching strikes. KPI strikes are recorded by the home Mayor
   from the KPI numbers. Should HQ confirm those too?
4. **Partial strikes and clean time.** Clean time lowers the jail **level**. Should 1–2 strikes toward the
   next term also wear off after 60 clean days?
5. **Disputes (A27).** The Jail Supervisor → Mayor → Marc review chain and the 5 disputes per agent are still to
   be built on top of voids (`OPEN-QUESTIONS.md` #43–#45, #48).
6. **Clock.** Terms run on the world server's clock: keep the PC's time synced automatically.
7. **Demo.** The demo's jailed agent is released 6 hours after the demo is built; a 4th report waits for HQ.

---

## 14. Tests

`npm test`: 191 tests, all passing.

**`test/jail.test.ts`**
- Essentials read everything but write only their own city.
- Reports count only after HQ confirms.
- Observer rules and deployment.
- **The ladder hour by hour** (6 h, 24 h, 3 days, each checked an hour before and at release).
- A year without release while awaiting deletion.
- The level after a term; deletion only with HQ's record.
- **A28:** a Security city named HQ runs deployments, strikes and the jail; one per world, Essentials only; an
  older world keeps `security-city`; an Essentials city made before A28 (Marc's "Security", renamed HQ) can be
  made the Security city once.
- **A30:** a term is served in the home city's jail; awaiting deletion, the agent is held in HQ's; with no
  Security city yet, it stays in its own city's jail.

**`test/discipline.test.ts` (A32)**
- Only HQ confirms (not the struck agent's Mayor, not the World Messenger); dismissed reports never count.
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
