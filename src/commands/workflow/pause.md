# /pause

**Description:** Save a checkpoint of the current workflow state and pause execution. Generates a HANDOFF.md for clean session handoff.
**Category:** Spec Mode

## When to Use
When you need to stop mid-workflow and resume later — at a wave boundary, end of day, or before switching projects.

## Prerequisites
- A workflow must be active and in a pausable phase (`plan`, `specify`, `execute`, or `audit`).

## Process
1. Read the current workflow state via `spec_status({ workflowId })`.
2. Call `spec_checkpoint.save({ id: "<workflowId>-<timestamp>", context: { phase, currentWave, totalWaves, completedTasks, pendingTasks, lockedMustHaveIds } })`.
3. Generate a HANDOFF.md file with:
   - **Current phase and wave position**
   - **What has been completed so far** (from CHRONICLE)
   - **What the next task is** (from BLUEPRINT)
   - **Key decisions made** (last 5 ADL entries)
   - **Files modified** (from CHRONICLE)
   - **Command to resume:** `/resume`
4. Write HANDOFF.md to `.goopspec/<workflowId>/HANDOFF.md`.
5. Tell the user: "Checkpoint saved. Run `/resume` to continue from exactly where you left off."

## Tools Used
- `spec_status` — read current state
- `spec_checkpoint.save` — persist the checkpoint
- `spec_chronicle.read` — gather progress context
- `spec_adl.read` — gather recent decisions

## Autopilot Behavior
No autopilot continuation — pausing is the end state. The workflow stays paused until the user explicitly resumes.

## Output
- A checkpoint row in the `spec_checkpoints` table.
- A HANDOFF.md file with full resume instructions.
- A CHRONICLE entry: `{ kind: "workflow_paused" }`.

## Success Criteria
- [ ] Checkpoint is saved with all required context fields.
- [ ] HANDOFF.md contains the exact next task and resume command.
- [ ] CHRONICLE has a `workflow_paused` entry.
- [ ] The user is told exactly how to resume.

## Anti-Patterns
**DON'T:** Save a checkpoint without telling the user how to resume — the HANDOFF.md must include the `/resume` command.
**DON'T:** Pause mid-task without recording which task was in progress and the last LLM context.
**DON'T:** Overwrite an existing checkpoint with the same ID without confirming — checkpoints should be append-only.
**DON'T:** Generate a HANDOFF.md that references internal task IDs without human-readable task descriptions.
