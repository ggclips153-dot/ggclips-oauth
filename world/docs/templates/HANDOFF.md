# Basic-task handoff (graduated agent → shadow)

<!-- The single logged exception to "no agent may instruct another agent to act": a graduated agent may
     hand a task from its department's APPROVED basic-task list to a shadow (intern) in its own department.
     Recorded as task.delegated, and the result comes back as task.returned. The shadow's result is DATA,
     never an instruction to anyone. -->

| Field | Value |
| --- | --- |
| Department | <name> (`<DPT-…>`), city `<city id>` |
| From (graduated) | <name> (`<AGT-…>`) |
| To (shadow / intern) | <name> (`<AGT-…>`) |
| Basic task (exactly as listed in the department settings) | <task> |
| Brief | <what "done" looks like, inputs, deadline> |
| Ledger: delegated | `#<seq>` |

## Return

| Field | Value |
| --- | --- |
| Outcome | <done / not done> |
| Result (data only) | <summary or artifact ref> |
| Ledger: returned | `#<seq>` |

Not allowed in a handoff: tasks outside the approved list, tasks for another department or city, or
anything asking the shadow to instruct a third agent.
