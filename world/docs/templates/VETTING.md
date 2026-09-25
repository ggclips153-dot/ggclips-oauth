# Vetting record

<!-- Two kinds of vetting use this record. Fill one per decision; it is referenced from the ledger event
     (exam.graded.examRef, or the deliverable's evidence) and kept with the city's records. -->

## Kind

- [ ] **Graduation** — a professor of the department examines a student (`exam.graded`); the Mayor then appoints.
- [ ] **Earning** — Marc and the Mayor vet a real-revenue deliverable before `intent.grant_earning`.

## Subject

| Field | Value |
| --- | --- |
| Agent | <name> (`<AGT-…>`) |
| City / department | <…> |
| Current tier | <student / active / senior> |
| Week (earning only) | <Monday date> |

## Graduation vetting

| Check | Result | Evidence |
| --- | --- | --- |
| Examined by a professor who teaches this department | <yes/no> | <professor name + ID> |
| Exam result | <pass / fail> | <exam reference> |
| Ledger written daily through school | <yes/no> | <ledger range> |
| Notes for the Mayor | | |

## Earning vetting

| Check | Result | Evidence |
| --- | --- | --- |
| Agent is active or senior | <yes/no> | |
| Revenue is REAL (not synthetic or paper work) | <yes/no> | <invoice / booking / payout ref> |
| Deliverable is the agent's own owner-tagged deciding artifact | <yes/no> | <deliverable #seq> |
| Attribution stays inside the city | <yes/no> | |
| QC reworks this week (more than one loses the credit) | <n> | |
| Not already credited | <yes/no> | |

## Decision

- Decided by: <Mayor> and Marc (via the DM)
- Outcome: <graduate / not yet · credit $<amount> / no credit>
- Ledger event: `#<seq>`
