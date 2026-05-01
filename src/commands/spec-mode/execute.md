# /execute

**Description:** Begin wave-based implementation. Dispatches executor agents per wave, tracks progress, and saves checkpoints at wave boundaries.
**Category:** Spec Mode

## When to Use
After SPEC is locked and BLUEPRINT is ready. This command runs the implementation phase wave by wave.

## Prerequisites
- SPEC must be locked (`spec_locked = true`).
- BLUEPRINT must exist with at least one wave of tasks.
- The workflow must be in `specify` or `execute` phase.

## Process
1. Read the BLUEPRINT via `spec_blueprint.read({ workflowId })`.
2. Read the locked SPEC must-haves via `spec_spec.read({ workflowId, section: "must-haves" })` to keep them in context.
3. For each wave in order:
   a. Call `spec_state({ action: "update-wave", currentWave: N, totalWaves: M })` — emits `wave:started`.
   b. For each task in the wave, dispatch the appropriate executor via `task({ subagent_type: "executor-{tier}", ... })` with the task's action, files, and done criteria.
   c. After each task completes, call `spec_chronicle.append({ kind: "task_completed", payload: { taskId, commitSha, outputs } })`.
   d. Call `spec_tasks.markComplete({ taskId, outputs, commitSha })`.
   e. If a task fails, call `spec_tasks.markBlocked({ taskId, reason })` and either retry with a different tier or present the blocker to the user.
4. After all tasks in a wave complete, call `spec_state({ action: "update-wave", currentWave: N+1 })` — emits `wave:completed`.
5. Save a checkpoint at each wave boundary via `spec_checkpoint.save({ context: { phase, currentWave, completedTasks } })`.
6. When all waves complete (currentWave === totalWaves), the workflow auto-progresses to the audit phase.

## Tools Used
- `spec_blueprint.read` — read the task plan
- `spec_spec.read` — keep must-haves in context
- `spec_state.update-wave` — advance wave counter
- `spec_chronicle.append` — log task events
- `spec_tasks.markComplete` / `spec_tasks.markBlocked` — update task status
- `spec_checkpoint.save` — save progress at wave boundaries
- `task` — dispatch executor agents

## Autopilot Behavior
When `autopilot=true`:
- Execute all waves without pausing for per-task confirmation. Only stop if a task fails and auto-retry is exhausted.
When `lazyAutopilot=true`:
- After the last wave completes, immediately invoke `/audit`.

## Output
- All tasks transitioned to `done` or `blocked`.
- CHRONICLE populated with `task_started`, `task_completed`, and `task_blocked` entries.
- Checkpoints saved at each wave boundary for pause/resume safety.

## Success Criteria
- [ ] Every task in the BLUEPRINT is dispatched to the correct executor tier.
- [ ] Task completions are recorded in CHRONICLE with commit SHAs.
- [ ] Wave transitions emit `wave:started` and `wave:completed` events.
- [ ] A checkpoint exists for each completed wave boundary.
- [ ] Blocked tasks are surfaced with a reason and recovery path.

## Anti-Patterns
**DON'T:** Dispatch all tasks in a wave in parallel if they have sequential dependencies — respect the task ordinal order within a wave.
**DON'T:** Skip checkpoint saves — losing progress mid-wave forces a full wave restart on resume.
**DON'T:** Ignore task failure — every blocker must be logged to CHRONICLE and surfaced to the user.
**DON'T:** Dispatch an executor without reading the task's `files` scope — the executor needs to know which files are in play.
