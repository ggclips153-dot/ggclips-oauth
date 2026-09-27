# Operator build plan (Bob's command `cmd_1a0e14e476e`)

For Tony's approval and Bob's review. Written 27 Sep 2026. **Tony approved the order and the decisions below
on 27 Sep; each step still goes live only with his approval.** Bob reviews it on his command.

The goal: Bob can run the world from the dashboard, supervisors carry out Tony's tasks on **CyberStation**, and
every agent is a real Hermes agent (A23–A31).

## What StarNet's code tells us

Read from StarNet's source (`github.com/androoAGI/starnet`, commit 7ee93ce, downloaded to `C:\Users\ggcli\starnet-src`).

- **License:** the code is MIT, so it can be copied and changed. The name, logo, station art and sprites are
  not licensed (its `NOTICE.md`): a copy ships under its own name and art. Ours is CyberStation (A31).
- **How a turn runs:** each crew member's turn goes to a model provider. A plain answer with no tool calls ends
  the run cleanly, and a run can have no tools at all. So a Hermes agent, which runs its own tools and memory,
  can be the "model" for its crew member.
- **What's missing for Hermes:** StarNet sets the model per crew member, but the address and key per station.
  Each Hermes agent has its own address and key, so we add those per crew member.
- **Crew and lead:** a station has a lead who hands work to named crew members, then steers, interrupts or
  resumes it, and runs can be cancelled. That matches A26 (the Department Supervisor leads, the department's
  agents are the crew).
- **One program per station,** reachable only from the PC itself. A station per department means one program
  per department.
- **StarNet can import a Hermes agent,** but it copies the persona into its own agent. We link to the real one
  instead (A21: never copy).
- **Most of StarNet's engine repeats what Hermes already does** (model calls, tools, memory, sessions; StarNet
  was partly ported from Hermes), and its lead hands out work through its own local tools, which a Hermes agent
  on the VPS can't reach. So Tony chose **our own engine, on Hermes**, keeping StarNet's station ideas.

## The steps

### 1. CyberStation's engine, on Hermes
- **Our own engine, inside the world server** (Tony: "Our own on Hermes"). No extra programs and nothing extra
  to install, however many stations there are.
- **A tool and a place of work** (Tony: "The CyberStation will act as a tool and place of work for our agents
  to use. It will never create agents"). Agents are created only at the college, from the dashboard (A11, A23).
- **Stations:** one per department (A31), with the department's agents as its crew and its supervisor as the
  lead. Each city's college also has one, which acts as the classroom (Tony), for the dean, professors and new
  agents.
- **The Hermes link:** each agent's work runs on its own Hermes profile over Hermes's API server, with its own
  key and the agent's ID as the session, so it answers with its own persona, tools and Mnemosyne memory. Each
  agent is linked to its profile in the ledger (A23: the World Messenger records it).
- Talking to an agent from the dashboard goes through its station to Hermes.
- **Needs:** Hermes's API server on and reachable from the PC (asked of Bob), and the keys on the PC (Tony).
- **Done when:** Tony talks to a real Hermes agent at its station, and it answers from its own memory.
- **Built so far (27 Sep):** Link to Hermes on each agent (`agent.hermes_linked`, recorded by the World
  Messenger); `npm run hermes` for Hermes's address and the keys, kept in `config/hermes.json` on the PC; a
  linked agent's answers come from its own Hermes profile (`src/cyberstation/`). Tested against a stand-in
  Hermes. **Next in this step:** the stations themselves (crew, supervisor, running work), once Hermes is on.

### 2. CyberStation's screens (decided: our own)
- Our own screens, in the dashboard's cyberpunk style: a department floor with a workstation per agent, chat,
  tasks, runs and costs. All ours, so they can be shared and can work from other devices.
- **No create-agent screen** (Tony): agents are created only at the college.

### 3. Supervisors and tasks (A25, A26)
- Every district and department records a supervisor. Departments don't have one yet. Supervisors are Hermes
  agents too.
- Tony gives a task to a department. Its supervisor dispatches it on the station, then checks, steers or
  withdraws it. Each step is a ledger event, and Security can see it.
- A supervisor only suggests new tasks: Supervisor → Mayor → World Messenger → Tony. Nothing runs until Tony
  decides.

### 4. New agents are Hermes agents (A23)
- Tony creates an agent at the college. Claude builds its Hermes shell on the VPS (profile, memory, private
  bank), and Bob writes its SOUL and role.
- Tony approves it in the dashboard. The World Messenger records it, and it goes live.
- **Needs:** how Claude reaches Hermes on the VPS to build a shell (from Bob and Hermes).

### 5. The shared memory link (A29, open questions #42 and #46)
- Read the shared memory through Hermes's bridge, so the Memory tab works again.
- Write Tony's new cities and departments to it, as `tony`.
- **Needs:** the bridge details (#46).

### 6. Bob's operator views (A25)
- A sign-in for Bob, read-only in the ledger, with:
  - the world map with supervisors
  - the agent roster (role, rank, district, jail, strikes)
  - the jail board
  - the command queue
  - his notes
  - the audit log

### 7. Strike records and appeals (A27)
- Built once open questions #43–#45 and #48 are settled.

## Tony's decisions (27 Sep)
1. **The order:** 1 to 7, as above.
2. **The screens:** our own (A), with no create-agent screen.
3. **The college's agents:** "A college station per city that will act as the classroom".
4. **The engine:** "Our own on Hermes. The CyberStation will act as a tool and place of work for our agents to
   use. It will never create agents so dont include the create agent screen".

## For Bob's review
- Turning on Hermes's API server (the request on `cmd_1a0e14e476e`).
- The bridge details and note format (#46).
- How Claude reaches Hermes on the VPS to build agent shells (step 4).
