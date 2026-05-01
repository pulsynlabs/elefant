# /resume

**Description:** Resume a paused workflow from the last saved checkpoint. Picks up from the exact phase, wave, and task where execution stopped.
**Category:** Spec Mode

## When to Use
After `/pause` or when restarting a workflow session. Restores the orchestrator's context to the pause point.

## Prerequisites
- A checkpoint must exist for the workflow (`spec_checkpoint.list` returns at least one entry).
- The daemon must have access to the same project.

## Process
1. Call `spec_checkpoint.load({ workflowId })` to get the latest checkpoint.
2. Parse the checkpoint context: `phase`, `currentWave`, `totalWaves`, `completedTasks`, `pendingTasks`.
3. Restore the workflow phase via `spec_state({ action: "transition", to: checkpoint.phase, force: true })` — force-transition because normal phase validation doesn't account for restores.
4. Read the BLUEPRINT via `spec_blueprint.read({ workflowId })` to identify the next uncompleted task.
5. Read the last 5 CHRONICLE entries to rebuild context about what happened before pausing.
6. Read the last 5 ADL entries to recall decisions that were made.
7. Tell the user where they left off: "Resuming at Wave <N>, Task <M>: <task-name>. X tasks completed, Y remaining."
8. Continue execution from the current wave/task — the orchestrator follows the same process as `/execute` from the resume point.
9. Log a CHRONICLE entry: `{ kind: "workflow_resumed" }`.

## Tools Used
- `spec_checkpoint.load` — load the saved checkpoint
- `spec_state.transition` — restore the phase (force)
- `spec_blueprint.read` — find the next task
- `spec_chronicle.read` — rebuild context
- `spec_adl.read` — recall decisions

## Autopilot Behavior
When `autopilot=true` or `lazyAutopilot=true`:
- Resume execution immediately without user confirmation. Continue with the autopilot rules for the current phase.

## Output
- Workflow restored to the paused state.
- A context summary shown to the user.
- A `workflow_resumed` entry in CHRONICLE.

## Success Criteria
- [ ] The workflow phase is restored to the checkpointed value.
- [ ] The exact next task is identified from the BLUEPRINT.
- [ ] Context from CHRONICLE and ADL is available to the orchestrator.
- [ ] The user is told what's happening next.

## Anti-Patterns
**DON'T:** Resume without checking for file changes since the pause — if the codebase changed, tasks may need re-evaluation.
**DON'T:** Skip the force flag on phase transition — normal phase validation will reject the restore.
**DON'T:** Assume the last checkpoint is always the right one — `spec_checkpoint.list` and let the user pick if multiple exist.
**DON'T:** Resume into a phase that no longer applies — verify that the checkpointed phase is still valid for the current workflow schema.
