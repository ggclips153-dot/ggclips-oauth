# Ledger retention

<!-- Draft for Marc. Items marked OPEN are not decided and are listed in docs/OPEN-QUESTIONS.md. -->

## What is kept, and for how long

| Record | Kept | Notes |
| --- | --- | --- |
| World EVENT LEDGER (`data/world.db`) | Forever | Append-only and hash-chained; `npm run verify` checks it. Never edited or pruned. |
| Currency ledger | Forever | Part of the world ledger. |
| Surface-guard decisions | Forever | Append-only table beside the ledger. |
| An agent's daily ledger | While the agent lives | Written daily, no exceptions. |
| A deleted agent's ledger | Frozen and archived | Audit only; never recycled into another agent. |
| Lesson records | Forever | Free curriculum for replacements. |
| Backups of `data/world.db` | OPEN | How often, where, and how many to keep. |

## Moving the world

The world is one folder. Stop the server, copy `world/` (including `data/` and `config/`), run
`npm run verify` on the new host, then start it.
