# Open questions for the District Messenger

These are points where the brief is ambiguous. Each one names the interim behaviour the code uses,
so nothing is decided silently. Answer here or via the DM.

| # | Question | Interim behaviour |
|---|---|---|
| 1 | The brief says a deleted agent's **name is retired forever**, but the New Agent form says the name "can repeat across time". Which wins? | Strict: a deleted agent's name can never be reused (case-insensitive). The name generator also never suggests a living agent's, a Mayor's, Marc's or Bob's name. |
| 2 | Graduation is student → probationer. Is that right, with probationer → active and active → senior as promotions? | Yes. The lifecycle strip marks `graduation`, `active` and `promotion` respectively. |
| 3 | After a school-return, does the agent re-graduate to probationer, or return to its previous tier? | Re-graduates to probationer and climbs again, with Marc's intent at each step. |
| 4 | Can an agent miss KPI while still a student (in school)? | No. Strikes apply only to probationer / active / senior. |
| 5 | Can Marc delete or evict an agent **before** a 3rd strike? | No. `agent.deleted` requires 3 strikes. Eviction can be added as its own event if wanted. |
| 6 | One dept-lead per department? | Yes, one. The badge drops on a move or school-return. |
| 7 | Live agent status: should agents report their own status, or only the Mayor? | Only the Mayor writes `agent.status` (the brief: "Mayor writes city events"). |
| 8 | Families for Personal Finance City and GGClutchPlays? | Both `revenue` in `config/seed.json`. |
| 10 | KPI metrics for Personal Finance City and GGClutchPlays? | `city.kpi_pulse` takes any metric name; AI Receptionist uses `qualified_bookings`. |
| 11 | PROPOSAL-2026-09-25-B-REV2 itself was not in the SOUL upload. Is there anything in it beyond what the SOULs show? | Built from the SOULs: district = supervisor that coordinates + QCs; department = scope + own bank; shared notes on the Mnemosyne shared surface (`surface.db`). |
| 23 | **Who decides a professor steps in, and for how long at most?** | The Mayor records it with a duration in hours (max 30 days); it ends on its own. |
| 24 | **Can professors be removed or replaced?** | Not built; nothing retires a professor yet. |
| 25 | **Enforcing "the Mayor does not give orders to shadows".** The ledger records delegations but can't see Telegram or Hermes messages. | Runtime enforcement comes with the shared-surface guard (phase 5) and the SOUL templates (phase 7). |

Resolved: Mayor names (A4), Innovations/Security family (A1), cross-city reach (A2), jail and task strikes (A3, A6), shadows, slots and shadow promotions (A7, A8), caps, delegation and dept-lead count (A9), professors (A10). See `BRIEF-AMENDMENTS.md`.
