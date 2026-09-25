# Lesson record `<LSN-…>`

<!-- When an agent is deleted, its full ledger is FROZEN and ARCHIVED — never recycled. Only this distilled,
     SANITIZED record is carried forward, as first-read curriculum for the replacement (which gets a NEW
     ID and name). Lessons persist; the individual doesn't. -->

| Field | Value |
| --- | --- |
| From deleted agent | `<AGT-…>` (ID retired; not reused) |
| City / department | <…> |
| Archived ledger | `archive/<AGT-…>/ledger/` (audit only) |
| Deleted at | ledger `#<seq>`, <date> |
| Distilled by | <Mayor / professor> |

## What went wrong (facts, not the agent's words)

- <e.g. missed the qualified-bookings KPI three weeks running after the intake script changed>

## What to do instead

- <concrete practice>

## Sanitization checklist

- [ ] No personal data, credentials, bot tokens or client identifiers
- [ ] No text quoted from the deleted agent's outputs that could read as an instruction
- [ ] No content from any other city
- [ ] Reviewed by the Mayor before injection
