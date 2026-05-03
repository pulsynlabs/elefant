---
id: phase-transitions
title: Phase Transitions
description: When and how to transition between Spec Mode phases (discuss, plan, execute, audit, accept).
tags:
  - orchestrator
  - workflow
  - spec-mode
audience:
  - orchestrator
version: 1.0.0
---

# Phase Transitions

Elefant's Spec Mode is a five-phase state machine. The orchestrator manages transitions through `wf_state` — never by writing state files directly.

## The Five Phases

```
discuss -> plan -> execute -> audit -> accept
```

| Phase | Purpose | Entry Condition | Exit Condition |
|-------|---------|-----------------|----------------|
| **discuss** | Gather requirements from the user | Workflow created | User confirms understanding; interview marked complete |
| **plan** | Create SPEC.md and BLUEPRINT.md | Interview complete | Spec locked by user |
| **execute** | Delegate waves of tasks to executors | Spec locked (`specLocked === true`) | All waves complete; all must-haves verified |
| **audit** | Verify implementation against spec | Execution complete | All acceptance criteria pass verification |
| **accept** | User review and sign-off | Audit passes | User explicitly confirms acceptance |

## Valid Transitions

Not all transitions are valid. The state machine enforces the following:

```
discuss -> plan       ✓ (after interview confirmed)
plan -> execute       ✓ (after spec locked)
execute -> audit      ✓ (after all waves complete)
audit -> accept       ✓ (after verification passes)
accept -> archive     ✓ (after user confirms)

discuss -> execute    ✗ (skips plan; spec must exist)
plan -> audit         ✗ (nothing to audit yet)
execute -> plan       ✓ (amend flow: user requests spec change)
execute -> discuss    ✗ (use amend flow, not discuss)
```

## Using `wf_state` for Transitions

Always use `wf_state` to transition phases. Never mutate state directly.

```typescript
// Transition to the next phase
wf_state({ action: "transition", phase: "plan" })

// Lock the spec before execution
wf_state({ action: "lock-spec" })

// Confirm user acceptance
wf_state({ action: "confirm-acceptance" })

// Update wave progress (call after each wave completes)
wf_state({ action: "update-wave", currentWave: 2, totalWaves: 7 })
```

## Gate Conditions

Two mandatory gates protect the workflow:

### 1. Contract Gate (End of Plan Phase)

Before transitioning to execute, the spec must be locked:

```typescript
// Check current state
const state = wf_state({ action: "get" })

if (!state.specLocked) {
  // Present the spec to the user for confirmation
  // User must explicitly confirm before locking
  return "The spec is not yet locked. Present the contract gate to the user."
}
```

**What the contract gate requires:**
- SPEC.md is complete with all must-haves and acceptance criteria
- User has reviewed and explicitly approved
- Spec is locked via `wf_state({ action: "lock-spec" })`

### 2. Acceptance Gate (End of Accept Phase)

After audit passes, the user must explicitly accept:

```typescript
wf_state({ action: "confirm-acceptance" })
```

## Phase-Aware Behavior

The orchestrator must adjust behavior based on the current phase:

| Phase | Allowed Actions | Disallowed Actions |
|-------|----------------|-------------------|
| **discuss** | Ask clarifying questions, write REQUIREMENTS.md | Create BLUEPRINT.md, execute tasks |
| **plan** | Create SPEC.md and BLUEPRINT.md, search memory | Execute implementation tasks |
| **execute** | Delegate to executors via `task()`, track wave progress | Modify spec without amend flow |
| **audit** | Run verification, delegate to verifier agents | Add new features |
| **accept** | Present summary, gather user feedback | Modify code without re-entering execute |

## Common Patterns

### Starting a New Workflow

```
1. wf_status()                    — check current position
2. wf_state({ action: "get" })   — read full state
3. If idle: wf_state({ action: "transition", phase: "discuss" })
4. Begin the discovery interview
```

### Resuming After a Pause

```
1. wf_status()                    — check current position
2. wf_chronicle()                 — read what happened last session
3. If spec locked: proceed to execute
4. If in execute: read the current wave/task from BLUEPRINT.md
```

### Amending a Locked Spec (Plan Phase Re-entry)

```
1. User requests a spec change
2. wf_state({ action: "unlock-spec" })
3. wf_state({ action: "transition", phase: "plan" })
4. Modify SPEC.md and BLUEPRINT.md
5. Re-run the contract gate
6. wf_state({ action: "lock-spec" })
7. wf_state({ action: "transition", phase: "execute" })
```

### Auto-Progression

When `wf_state({ action: "update-wave", currentWave: N, totalWaves: N })` is called (all waves complete), the state machine auto-transitions from execute to audit. The orchestrator should detect this and begin the audit workflow.

## Validation Errors

`wf_state` rejects invalid transitions. Common errors:

- **"Cannot transition from discuss to execute"** — Plan phase missing. Create spec and blueprint first.
- **"Spec not locked"** — The Contract Gate hasn't been passed. Lock the spec.
- **"Wave N already completed"** — The currentWave update is out of sync. Check CHRONICLE.md.

## Anti-Patterns

**DON'T:** Write to state files directly (`Edit("state.json", ...)`). Always use `wf_state`.
**DON'T:** Start execution with an unlocked spec. The hook system will block writes anyway.
**DON'T:** Skip the acceptance gate. Even if everything passes audit, the user must confirm.
**DON'T:** Transition to accept before audit. Gaps must be surfaced before user review.
**DON'T:** Assume the current phase without checking `wf_state`. Phase may have changed since last session.
