# /spec-pause

**Description:** Save a checkpoint of the current workflow state and pause execution for later resumption.

## Usage
```
/spec-pause [checkpoint-name]
```

## Prerequisites
- Workflow must be active (not idle, not accepted)
- Must be in `execute` or `audit` phase (phases with in-progress work)

## What It Does
1. Calls `spec_checkpoint.save({ id: <checkpoint-name>, context: <full workflow state> })`
2. Snapshots: current phase, current wave, task statuses, agent run references
3. Sets workflow to a paused state
4. Saves checkpoint to the `spec_checkpoints` table
5. Emits checkpoint-saved confirmation

## Autopilot Behavior
- **Manual:** User-initiated only — autopilot never pauses itself without instruction
- **Autopilot/Lazy:** Pause is always explicit — no auto-pause behavior

## Example
```
/spec-pause before-refactoring-wave-4
```

## Anti-Patterns
- **DON'T:** Rely on checkpoints as version control — they are session state, not code history.
- **DON'T:** Leave old checkpoints accumulating — list with `spec_checkpoint.list` and clean up occasionally.
