# /status

**Description:** Show the current workflow phase, wave progress, spec lock state, and a human-readable status table.
**Category:** Spec Mode

## When to Use
Any time you want to check where the workflow stands. Safe to run at any phase — no side effects.

## Prerequisites
- A workflow must exist and be active for the current project.

## Process
1. Call `spec_status({ workflowId })` to get the full state payload.
2. Format the response as a human-readable table:

```
## Spec Mode Status — <workflowId>

| Field | Value |
|-------|-------|
| Phase | discuss / plan / execute / audit / accept |
| Mode | quick / standard / comprehensive / milestone |
| Depth | shallow / standard / deep |
| Autopilot | on / off |
| Lazy Autopilot | on / off |
| Spec Locked | yes / no |
| Acceptance | pending / confirmed |
| Interview | complete / pending |
| Current Wave | N / M |
| Tasks Done | X / Y |
| Last Activity | ISO timestamp |

## Document Status
| Document | Exists | Last Updated |
|----------|--------|-------------|
| REQUIREMENTS | yes/no | timestamp |
| SPEC | yes/no | timestamp |
| BLUEPRINT | yes/no | timestamp |
| CHRONICLE | N entries | — |
| ADL | N entries | — |
```

3. If the workflow is in `execute` phase, also show the current task breakdown:
   - Pending tasks, in-progress tasks, completed tasks, blocked tasks.
4. If the spec is locked, show a lock indicator and the last amendment timestamp (if any).

## Tools Used
- `spec_status` — get full workflow state

## Autopilot Behavior
No autopilot continuation — this is a read-only status command. Always returns the table and stops.

## Output
A formatted status table displayed to the user in the chat.

## Success Criteria
- [ ] All fields from `spec_workflows` are displayed.
- [ ] Document presence/absence is accurately reflected.
- [ ] Task breakdown is shown when in execute phase.
- [ ] Lock state is clearly indicated.

## Anti-Patterns
**DON'T:** Mutate state during a status check — this is read-only.
**DON'T:** Omit fields that are null/empty — show them as "—" or "pending" for clarity.
**DON'T:** Auto-advance to another phase after showing status — stay where you are.
**DON'T:** Show internal DB IDs — the user-facing table should use human-readable names.
