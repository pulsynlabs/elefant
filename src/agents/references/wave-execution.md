---
id: wave-execution
title: Wave Execution Protocol
description: How to execute waves of tasks — sequential waves, parallel tasks within a wave, delegation patterns.
tags:
  - orchestrator
  - executor
  - workflow
audience:
  - orchestrator
  - executor
version: 1.0.0
---

# Wave Execution Protocol

Waves are the organizing unit of Elefant's execution phase. A wave is a themed group of tasks that produces a cohesive, testable increment. Waves execute sequentially; tasks within a wave may run in parallel when marked as independent.

## Wave Structure

Each wave in BLUEPRINT.md follows this structure:

```markdown
## Wave N: Theme Name

**Goal:** One-sentence summary of what this wave delivers.
**Execution:** Sequential | Parallel | Partial Parallel
**Depends On:** Wave N-1 | None

### Task N.1: Task Name
| Attribute | Value |
|-----------|-------|
| Files | path/to/file.ts |
| Executor | executor-medium |
| Parallel | Yes/No |
| Depends On | Task N.0 or None |

**Intent:** What this task does and why.
**Deliverables:** Checklist of concrete outputs.
**Acceptance:** How to verify the task is done.
**Verify:** Command to run for verification.
```

## Delegation via `task()`

All implementation work is delegated through the `task()` function. The orchestrator NEVER edits implementation files directly.

```typescript
task({
  subagent_type: "executor-medium",    // correct tier for the task
  description: "W5.T1: Author handoff-format.md",
  prompt: `
    ## TASK
    Write the handoff-format.md reference file with valid frontmatter.

    ## FILES
    src/agents/references/handoff-format.md

    ## SOURCE
    Use the `handoff-format` reference: `reference({ name: "handoff-format" })`

    ## ACCEPTANCE
    - Valid YAML frontmatter (tags, audience use list syntax)
    - Full XML envelope schema documented
    - No terminology from external workflow systems

    ## VERIFY
    bun test src/tools/reference/frontmatter.test.ts
  `
})
```

Every delegation must include:
- **Exact file paths** — never "the auth directory" or "the usual places"
- **Must-have mapping** — which spec requirements this task fulfills
- **Verification command** — the exact command to run to prove completion
- **Acceptance criteria** — what "done" looks like in measurable terms

## Parallel vs. Sequential Execution

### Sequential Tasks (Default)

Tasks marked `Parallel: No` or with explicit dependencies must run one at a time:

```
Task 2.1 complete -> Task 2.2 starts -> Task 2.3 starts
```

Wait for the executor's COMPLETE status before dispatching the next task.

### Parallel Tasks

Tasks marked `Parallel: Yes` with no cross-dependencies can be dispatched simultaneously:

```typescript
// Dispatch Wave 5 tasks in parallel
await Promise.all([
  task({ subagent_type: "executor-medium", description: "W5.T1: ...", prompt: promptT1 }),
  task({ subagent_type: "executor-medium", description: "W5.T2: ...", prompt: promptT2 }),
  task({ subagent_type: "executor-medium", description: "W5.T3: ...", prompt: promptT3 }),
])
```

**Parallel safety rules:**
- Tasks must touch completely disjoint file sets (no merge conflicts)
- No task may depend on another parallel task's output
- All tasks must be marked `Parallel: Yes` in BLUEPRINT.md
- Each task commits independently

## Wave Completion Criteria

A wave is complete when:

1. Every task in the wave returns `status: COMPLETE`
2. All commits for the wave are pushed (or at least staged)
3. The wave's verification matrix passes (all checks green)
4. `wf_chronicle` updated with all task outcomes

Mark wave completion:

```typescript
wf_state({ action: "update-wave", currentWave: 5, totalWaves: 7 })
```

## Progress Tracking with `wf_chronicle`

The chronicle is the append-only log that tracks what happened during execution:

```typescript
// After each task completes:
wf_chronicle({
  wave: 5,
  task: "5.1",
  status: "COMPLETE",
  agent: "executor-medium",
  commit: "abc1234",
  summary: "Authored 8 orchestrator + agent-protocol references"
})
```

The orchestrator reads `wf_chronicle` before each session to understand:
- Which waves are fully complete
- Which task is currently in progress
- What commits were produced
- Any blockers or deviations encountered

## Checkpoint Saving

At natural boundaries (wave completion, significant milestone), save a checkpoint:

```typescript
wf_checkpoint({
  action: "save",
  id: "wave-5-complete",
  context: {
    wave: 5,
    completedTasks: ["5.1", "5.2", "5.3"],
    commits: ["abc1234", "def5678", "ghi9012"],
    nextTask: "6.1",
    notes: "All 16 bundled references created. Frontmatter validates. Ready for Wave 6."
  }
})
```

## Wave Execution Flow

The orchestrator follows this loop for each wave:

1. **Read the wave from BLUEPRINT.md** — tasks, dependencies, executors
2. **Load wave-appropriate references** — inject guidance into executor context
3. **Dispatch tasks** — sequentially or in parallel per the wave's execution mode
4. **Collect responses** — parse XML envelopes, verify status
5. **Handle blockers** — if BLOCKED, surface to user; do not skip
6. **Verify wave complete** — run the wave's verification matrix
7. **Update state** — mark wave complete via `wf_state` + log to `wf_chronicle`
8. **Save checkpoint** — preserve context for the next session

## Common Mistakes

**DON'T:** Dispatch the next wave before the current wave's verification passes. A partially-working wave creates cascading issues.
**DON'T:** Run parallel tasks that modify the same file. Serialize those or accept that one will lose.
**DON'T:** Skip `wf_chronicle` updates. A missing entry makes the next session blind.
**DON'T:** Dispatch an executor without the correct tier. An executor-low on a high-complexity task wastes tokens and time.
**DON'T:** Mark a wave complete from a summary without checking commits and test results.
