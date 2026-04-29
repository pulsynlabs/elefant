# /spec-execute

**Description:** Begin wave-based implementation of the locked blueprint, dispatching tier-matched executors for each task.

## Usage
```
/spec-execute [workflow-id]
```

## Prerequisites
- SPEC must be locked (`spec_locked = true`)
- BLUEPRINT must exist with at least one wave
- Workflow must be in `specify` or `execute` phase

## What It Does
1. Transitions workflow to `execute` phase
2. For each wave (sequential by default, parallel where specified):
   a. Emits `wave:started` event
   b. For each task in the wave, dispatches `task({ subagent_type: executor-{tier} })`
   c. Waits for task completion (reports commit SHA, outputs)
   d. Updates kanban status in real-time via SSE
3. After all waves complete, transitions to `audit` phase (or auto-dispatches `/spec-audit` in autopilot)

## Autopilot Behavior
- **Manual:** Confirms wave start, reviews each task completion, confirms phase progression
- **Autopilot:** Runs waves end-to-end, pauses if a task fails or blocks
- **Lazy Autopilot:** Full auto-execution; pauses only on task failure requiring human input

## Example
```
/spec-execute my-auth-workflow
```

## Anti-Patterns
- **DON'T:** Skip to the next wave while tasks in the current wave are still pending.
- **DON'T:** Dispatch the wrong executor tier — task.executor field specifies the correct tier.
