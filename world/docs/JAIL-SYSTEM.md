# The Jailing System — Complete Handoff

This document covers Security City's jail as built in `world/`. It is written from the code
(`src/domain/model.ts`, `src/domain/state.ts`, `src/ledger/guard.ts`, `src/ledger/catalog.ts`,
`src/domain/view.ts`, `public/app.js`, `public/city3d.js`) and the tests (`test/jail.test.ts`,
`test/college.test.ts`, `test/dean.test.ts`, `test/lifecycle.test.ts`). Where Marc's own words set a rule,
they are quoted.

**Amendments behind it:**
- **A3:** Security keeps a jail.
- **A6:** task strikes and jail terms.
- **A13/A15:** professors take teaching strikes from Security.
- **A15:** deans report to Security, which escalates to Marc.

---

## 1. In one paragraph

Security City keeps a department of agents **deployed to every city** to watch for work not being done.
Each time a deployed agent catches an agent in its city not doing a task, Security's Mayor records a **task
strike**. Every **3 task strikes** puts the agent in **jail**: 6 hours the first time, 24 hours the second,
3 days the third. The **4th** time, the agent is jailed **awaiting deletion**. The same happens after a
**3rd KPI strike** (a department agent), or a **3rd teaching strike** (a professor). Timed terms end **on
their own**. Nobody has to release anyone. **Nothing is ever deleted automatically:** only Marc decides a
deletion, and the agent's home Mayor carries it out.

Marc, 25 Sept: *"if they're caught not doing a task they will get a strike, 3 strikes and they go to jail for 6
hours for the first time, 24 hours the 2nd time. 3 days for the 3rd time and face deletion on the 4th."*
*"yes 2 separate counters"*, *"There will be a department created in the Security city that has agents
deployed in each city"*, *"yes release happens on it's own"*.

---

## 2. The three kinds of strike

| | KPI strikes | Task strikes | Teaching strikes |
|---|---|---|---|
| **Who gets them** | Graduated department agents (probationer, active, senior) | Department agents that are placed (not `enrolled`); **not** professors or deans | Professors only |
| **Why** | The agent missed its city KPI (value below target) | Caught not doing a task by a deployed Security agent | Broke a college rule (free text until Marc's school system arrives) |
| **Who records it** | The agent's **home Mayor** (`agent.school_returned`, `agent.third_strike`) | **Security's Mayor**, under **Security's own city tag** (`security.task_strike`) | **Security's Mayor** (`professor.strike`) |
| **Counter** | `strikes` (0–3), never resets | `taskStrikes` (0–2), **resets to 0 at each jailing** | `strikes` (0–3), never resets |
| **Consequence** | Miss #1 → back to school. Miss #2 → back to school. Miss #3 → **jailed awaiting deletion** | Every 3rd strike → **a jail term** (6 h → 24 h → 3 days); the 4th jailing → **awaiting deletion** | Strikes 1–2: keeps its post. **3rd → jailed awaiting deletion** |
| **Jail cause shown** | "KPI strikes" | "Task strikes" | "Teaching strikes" |

The counters are **completely separate** (Marc: "2 separate counters"). A KPI miss never counts toward jail
terms, and a task strike never sends an agent to school.

**Deans** take none of these. The Mayor judges a dean through reviews (exceeds / meets / below); what a bad
review leads to is still open (section 11).

---

## 3. Deployment: who can give task strikes

- **Marc deploys** a Security agent: Security City page → **Deploy an agent**, then choose the agent and the
  city to watch.
  - This writes `intent.deploy_agent` (tagged `security-city`), and Security's Mayor writes `agent.deployed`.
  - Under A19 it applies at once as Marc.
- **Who can be deployed:** only a **Security City** department agent that is **graduated** (probationer,
  active or senior). Professors and deans can't be deployed.
- **Where:** any city, including Security City itself. Each deployed agent watches **one** city at a time;
  deploying it again moves it.
- **A deployment ends by itself** if the Security agent goes back to school (KPI miss) or retires into a
  professor. It then has to be deployed again after it re-graduates.

**Who may observe a strike.** A strike is rejected unless the observer is all of these:
- a living Security City **department agent** (not a professor or dean)
- **graduated** (probationer, active or senior)
- **deployed to the struck agent's city**
- **not in jail** itself
- **not the struck agent** ("an agent cannot strike itself")

---

## 4. The jail ladder, exactly

```
task strikes:  1  2  [3] → JAIL term 1: 6 hours      (task strikes reset to 0)
               1  2  [3] → JAIL term 2: 24 hours     (reset to 0)
               1  2  [3] → JAIL term 3: 3 days (72h) (reset to 0)
               1  2  [3] → JAIL term 4: AWAITING DELETION (no release)
```

- **The term level never goes down.** An agent that served term 1 months ago goes straight to term 2 on its
  next 3rd strike. (Marc accepted the default: "strikes reset after each term, but the jail level never
  resets".)
- **Release is automatic.** The jail record stores `until` = the moment of the 3rd strike + the term's hours.
  The system works out "in jail?" from the ledger clock: inside while `until` is in the future, free once it
  passes. **No release event is written or needed.**
- **After release** the agent works normally: it can be promoted, earn, and so on. Its `jailTerms` count
  stays.
- **Awaiting deletion** has no `until`, so the agent stays in jail **until Marc decides**. The tests check a
  full year passing without release.

**Where the numbers live (to change them later):**
- `TASK_STRIKES_PER_JAIL = 3`
- `JAIL_TERMS_HOURS = [6, 24, 72]`
- `MAX_STRIKES = 3` (KPI and teaching)

All are in `src/domain/model.ts`. Adding a 4th timed term is one more number in the list, and "awaiting
deletion" moves to the 5th.

---

## 5. What a jailed agent can't do

While inside (a timed term or awaiting deletion), the ledger **rejects** all of these for that agent:

| Area | Blocked |
|---|---|
| **Work and pay** | Being credited earnings (`intent.grant_earning`, `currency.earned`) or given rewards (`intent.grant_reward`, `currency.spent`) |
| **Strikes** | More task strikes (`security.task_strike`) or KPI strikes (`agent.school_returned`, `agent.third_strike`): it isn't being measured while inside |
| **School and ladder** | Exams (`exam.graded`), becoming an intern, graduating, promotion (`intent.promote_agent`, `agent.promoted`), dept-lead |
| **Movement** | Moving department (`intent.move_agent`, `agent.moved`), retiring into a professor |
| **Delegation** | Handing a basic task to a shadow (`task.delegated`) |

**Also:**
- A **jailed Security agent can't observe** strikes.
- A **jailed professor can't give exams, step in** to a department, or be made dean.
- A **jailed dean can't report** agents.

What it **keeps**:
- its ID, name, department placement and history
- its conversations: Marc can still talk to it

---

## 6. Deletion: only from jail, only by Marc

- **Deletion is possible only** for an agent jailed **awaiting deletion**:
  - its 4th task-strike jailing,
  - its 3rd KPI strike, or
  - a professor's 3rd teaching strike.

  Anything else is rejected, including an agent serving a timed term: *"deletion only for an agent jailed
  awaiting deletion (3rd KPI strike, or 4th task-strike jailing)"*.
- **Marc decides.** Delete appears on the **Security** page next to that agent, and on the agent's row in
  its city. It writes `intent.delete_agent`. The **home Mayor** executes `agent.deleted` with:
  - `ledgerArchiveRef`: where the agent's full ledger is **frozen and archived**
  - `lessonRecordRef`: the **distilled, sanitized lesson record** that becomes the replacement's first
    curriculum (template: `docs/templates/LESSON-RECORD.md`)
- **Under A19** Marc's click applies at once, and the refs are filled as `archive/<agentID>/ledger` and
  `lessons/<agentID>.md`. **Hermes must actually archive the ledger and write the lesson record at those
  places.** See section 11, question 6.
- **On deletion:**
  - the agent leaves the jail and its department
  - its **ID and name are retired forever** (never reissued or reused)
  - the lifecycle strip ends at "deletion"
  - it's listed under the city's **Retired agents**, with its lesson record
- The brief: *"Lessons persist, the individual doesn't."* Also: **no agent executes its own exit**.

---

## 7. Deans, Security and Marc's inbox (A15)

Marc: *"deans will … monitor for work not being done and can report an agent to security to be brought up
to me."*

1. A college **dean reports** an agent of its city (`dean.reported`): reason and evidence, written by the
   city's Mayor.
   - A jailed dean can't report.
   - A dean can't report itself.
2. **Security escalates** the report to Marc (`security.escalated`, by Security's Mayor, once per report).
3. It appears in Marc's **Inbox** (top bar). **Marc decides** what happens.
   - Nothing about a report jails or strikes anyone by itself.

---

## 8. Who sees the jail

- **Marc, the DM, Bob, and the Essentials Mayors (Security, Innovations)** see every jailed agent from every
  city (A2).
- **A revenue, Claude or Gemini Mayor** sees only its own city's agents in the jail.
  - It also sees Security's task strikes, teaching strikes and escalations **about its own agents**, even
    though Security records them under its own tag.
- **Nobody but Security's Mayor can write** a task strike, teaching strike or escalation. The home Mayor
  can't erase one.

---

## 9. Where it shows in the dashboard

| Place | What you see |
|---|---|
| **Top bar → Security** (count = people in jail + quarantined notes) | **Jail** table: agent, city, cause, term, release ("5h 12m left") or **"Awaiting your deletion decision"** with **Delete**. **Recent task strikes**: when, agent, city, task, observed by (last 20). Also the shared-surface guard's stopped notes. |
| **Map → city tiles, city header** | A red "**N in jail**" chip. |
| **World KPI row** | "In jail" total. |
| **City → Details → each agent row** | "KPI x/3 · Task x/3", and a jail chip: "Jail · 5h left" or "Jail · awaiting deletion". **Delete** only when awaiting deletion. |
| **College → professors** | The jail chip in "Now". |
| **Dean card** | Scorecard includes the graduates' **jail terms** and **in jail now**. |
| **Live** page | The jail chip next to each agent. |
| **3D city** | **Security City** has a red wireframe **jail cage** holding every jailed agent from every city (hover for "in jail until …" or "awaiting deletion"). Another city with agents inside shows a cage labelled "In Security's jail". Jailed agents wear orange and stand inside. |
| **Deploy an agent** | Button on Security City's page (owner). |

---

## 10. Ledger events involved

| Event | Written by | Tag | Payload | Rules |
|---|---|---|---|---|
| `intent.deploy_agent` | Marc | `security-city` | `agentId`, `toCity` | Security agent, graduated, city exists |
| `agent.deployed` | Security's Mayor | `security-city` | `toCity` (subject = agent) | cites the intent; matches it |
| `security.task_strike` | Security's Mayor | **`security-city` only** | `agentId`, `observedBy`, `task`, `evidence`, `evidenceRef?` | target is a living, placed department agent, not jailed; observer rules in section 3 |
| `agent.school_returned` | home Mayor | the agent's city | `reason`, `metric`, `value`, `target` | a real miss (value < target); graduated agent; not the 3rd |
| `agent.third_strike` | home Mayor | the agent's city | same | exactly 2 prior KPI strikes → jailed awaiting deletion |
| `professor.strike` | Security's Mayor | `security-city` | `professorId`, `observedBy`, `rule`, `evidence`, `evidenceRef?` | observer deployed to the professor's city; the 3rd → awaiting deletion; no 4th |
| `dean.reported` | the city's Mayor | the city | `deanId`, `agentId`, `reason`, `evidence`, `evidenceRef?` | the dean isn't jailed; not itself |
| `security.escalated` | Security's Mayor | `security-city` | `reportSeq`, `summary` | once per report |
| `intent.delete_agent` | Marc | the agent's city | `agentId` | — |
| `agent.deleted` | home Mayor | the agent's city | `ledgerArchiveRef`, `lessonRecordRef` | cites the intent; agent **awaiting deletion** |

A jail term is not an event. It's the **result** of the 3rd strike, worked out when the strike is recorded;
release is worked out from time. So the ledger stays the single source of truth, and a restart gives exactly
the same jail.

---

## 11. Open questions (back to the District Messenger)

1. **Appeals or mistakes.** There's no way to **cancel a wrong strike** or **release someone early**. The
   ledger is append-only, so this would be a new event (e.g. `security.strike_voided`, Marc only). Do you
   want it?
2. **Pardon or clean-record decay.** Should the term level ever go down, for example after 30 or 90 clean
   days? It never does today, as agreed.
3. **Who confirms a strike.** Today Security's Mayor records it on its deployed agent's evidence, and the home
   Mayor can't dispute it. Should the home Mayor (or you) confirm each one first?
4. **Deans and strikes.** Deans can't receive task or teaching strikes; only Mayor reviews. Should a bad dean
   be jailable too?
5. **Teaching-strike rules.** They're free text until your school system spec arrives. Should professors get
   timed terms, or stay "3 = awaiting deletion" with no timed jail?
6. **Archive and lesson record on deletion.** When you click Delete, the refs default to
   `archive/<ID>/ledger` and `lessons/<ID>.md`. Who writes those files: Hermes (the home Mayor) or the DM?
   Should Delete ask you for the lesson record first?
7. **Eviction before a 3rd strike.** You can't delete an agent that isn't awaiting deletion (interim rule). Do
   you want a separate eviction path?
8. **Clock.** Terms use the world server's clock. When the world moves to the PC, the PC's clock should be
   correct (automatic time sync on).
9. **Demo note.** The demo's jailed agent starts a 6-hour term when the demo is built, so it's free again 6
   hours later. Rebuild the demo to see it inside again.

---

## 12. Tests covering it

`npm test` checks every rule above (162 tests in total). The jail-specific ones:

**`test/jail.test.ts`**
- Essentials read everything but write only their own city.
- Task strikes are recorded under Security's tag and are separate from KPI strikes.
- Only a deployed Security agent can observe.
- Deployment needs Marc's intent and a graduated Security agent.
- **The ladder, hour by hour:** 6 h, 24 h and 3 days, each checked one hour before and at release.
  - Blocked actions are refused while inside.
  - The roster appears and disappears.
  - The 4th time waits a full year without release.
  - Deletion by Marc's intent.
- **The level never resets,** and the agent works normally after a term.
- **The 3rd KPI strike** means awaiting deletion; deletion is refused in every other case, including during a
  timed term.

**Other files**
- **`test/college.test.ts`:** professors' teaching strikes, and jailed professors can't examine or step in.
- **`test/dean.test.ts`:** dean reports, Security's escalation to Marc's inbox, and that a jailed professor can't be made dean.
- **`test/lifecycle.test.ts`:** the KPI 3-chances path.
