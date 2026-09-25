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
| 12 | **Family** for Innovations City and Security City. The brief allows only `revenue`, `claude` or `gemini`, and neither city earns revenue. | `revenue` in `config/seed.json` (not yet seeded on the VPS). Say if you want a different value, or a new family added to the brief. |
| 13 | **Cross-city reach** for Innovations and Security. The brief says only the DM and Bob cross between cities, but Innovations reviews every workflow weekly and Security red-teams everywhere. As separate cities they can't read other cities. | They read only their own city. Findings and proposals go to Marc through the DM. Options: (a) keep that, (b) the DM relays read-only digests to them, (c) grant them cross-city READ like Bob (needs a brief change). |
