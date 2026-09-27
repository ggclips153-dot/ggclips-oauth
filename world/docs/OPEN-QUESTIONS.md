# Open questions for the World Messenger

These are points where the brief is ambiguous. Each one names the interim behaviour the code uses,
so nothing is decided silently. Answer here or via the World Messenger (the District Messenger until A22).

| # | Question | Interim behaviour |
|---|---|---|
| 1 | The brief says a deleted agent's **name is retired forever**, but the New Agent form says the name "can repeat across time". Which wins? | Strict: a deleted agent's name can never be reused (case-insensitive). The name generator also never suggests a living agent's, a Mayor's, Marc's or Bob's name. |
| 2 | Graduation is student → probationer. Is that right, with probationer → active and active → senior as promotions? | Yes. The lifecycle strip marks `graduation`, `active` and `promotion` respectively. |
| 3 | After a school-return, does the agent re-graduate to probationer, or return to its previous tier? | Re-graduates to probationer and climbs again, with Marc's intent at each step. |
| 4 | Can an agent miss KPI while still a student (in school)? | No. Strikes apply only to probationer / active / senior. |
| 5 | Can Marc delete or evict an agent **before** a 3rd strike? | No. `agent.deleted` requires 3 strikes. Eviction can be added as its own event if wanted. |
| 6 | One dept-lead per department? | Yes, one. The badge drops on a move or school-return. |
| 7 | Live agent status: should agents report their own status, or only the Mayor? | Only the Mayor writes `agent.status` (the brief: "Mayor writes city events"). |
| 8 | Families for Personal Finance City and GGClutchPlays? | `revenue` (A4's list). Since A22 Marc picks the family himself when he creates each city. |
| 10 | KPI metrics for Personal Finance City and GGClutchPlays? | `city.kpi_pulse` takes any metric name; AI Receptionist uses `qualified_bookings`. |
| 11 | PROPOSAL-2026-09-25-B-REV2 itself was not in the SOUL upload. Is there anything in it beyond what the SOULs show? | Built from the SOULs: district = supervisor that coordinates + QCs; department = scope + own bank; shared notes on the Mnemosyne shared surface (`surface.db`). |
| 24 | **Can professors be removed or replaced** other than through teaching strikes? | Only through teaching strikes and deletion today. |
| 25 | **Enforcing "the Mayor does not give orders to shadows".** The ledger records delegations but can't see Telegram or Hermes messages. | Left to Hermes at runtime. |
| 28 | **Maximum time a professor may step in.** | Up to 30 days per assignment, set by the Mayor. |
| 31 | **Teaching-strike rules** (Marc's school system). | `professor.strike` takes the rule as text for now; the rule list plugs in when the spec arrives. |
| 33 | **Consequences of a dean's review.** Marc will decide after testing. | Reviews are recorded (exceeds / meets / below); no automatic consequence. |
| 35 | **The outgoing dean** when replaced. | Returns to teaching as a professor at the same college. |
| 36 | **R4 "first-retry grace" in practice.** What does the grace change when the agent next misses KPI? | Recorded as a reward only; strikes and deletion are unchanged (never deletion-immunity). |
| 37 | **Adopting a proposal.** Proposals carry suggested wording; who edits the Constitution file itself? | Marc (or Hermes on his instruction) edits the file, then ratifies it on the Constitution page. Nothing edits the file automatically. |
| 38 | **Version numbers.** Any rule for major vs minor? | Any newer `x.y.z`; the Ratify form suggests the next minor. |
| 39 | **Ledger backups** (`docs/templates/LEDGER-RETENTION.md`): how often, where, how many kept? | None automated. |
| 40 | **Proposals from other cities.** Only Innovations, Security and Bob may propose. Should a revenue Mayor be able to raise one through the World Messenger? | No; they message Marc instead. |
| 41 | **Constitution Article XI** lists the amendments it incorporates as A1–A18. Should the 1.0.0 ratified in the new ledger also list A19–A22? | **Answered (26 Sep):** yes; Article XI lists A1–A22, updated before 1.0.0 was ratified in the new ledger. |
| 42 | **How the dashboard reads the shared surface** (handoff #26). Hermes reports the repo's `vps/surface_reader.py` is superseded by its own shared-memory bridge. A21 as recorded reads through that reader. Keep it, read through the bridge (read-only), or something else? Since A29 the dashboard also writes through the bridge, so reading through it too is the natural fit. | The reader stays off; the Memory tab has no data until this is decided. |
| 43 | **A27: who records an agent's own dispute and a Jail Supervisor's review?** Agents and supervisors have no ledger role. | To settle when A27 is built. Likely their Mayor records it for them, as for `agent.said`. |
| 44 | **A27: what does "adjust" change?** (Void and deny are clear.) | To settle when A27 is built. |
| 45 | **A27: can KPI strikes be voided and disputed too,** or only Security's task and teaching strikes? | To settle when A27 is built. |
| 46 | **A29: how the dashboard writes to the shared memory.** Needed from Bob and Hermes: the bridge endpoint (URL, request format, how writes are audited), a `tony` write credential that Marc installs on the PC himself, and the note format for a new city and a new department (layer, scope, kind, note ID). Do districts go too? | Asked on the command's record (`cmd_94751e61dbe322d7fb9f3557`). Nothing is written until then. |
| 47 | **A29: when the shared memory and the ledger differ** on a city or department (e.g. Bob changes one in the shared memory), how does the change reach the ledger and the dashboard? The ledger is written only through Marc's requests, and Bob never writes it. | The dashboard shows the ledger's cities and departments. |
| 48 | **A30: who keeps each city's jail?** A27's review chain names a Jail Supervisor. One per city, or HQ's for every city? | Nobody: a jail is worked out from the ledger. To settle when A27 is built. |
| 49 | **A31: a StarNet station per department.** Where do the college's agents (dean, professors, new agents without a department) run? Is there a limit on stations per PC (each is its own process and port)? | **Answered (27 Sep):** each city's college has its own station, "the classroom". No limit is needed: CyberStation runs inside the world server, on Hermes, so a station isn't a program of its own. |

Resolved: A1-A31, see `BRIEF-AMENDMENTS.md`.
