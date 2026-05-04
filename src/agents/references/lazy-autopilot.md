---
id: lazy-autopilot
title: Lazy Autopilot Mode
description: How Lazy Autopilot works — infer everything from the initial prompt, skip all questions, run the full pipeline unattended.
tags:
  - spec-mode
  - orchestrator
  - workflow
audience:
  - orchestrator
version: 1.0.0
---

# Lazy Autopilot Mode

Lazy Autopilot is a Spec Mode execution mode that minimizes user interaction. When active, the orchestrator infers decisions from the initial prompt, skips all questions, and runs the full pipeline from discuss through accept with minimal pauses.

## When It's Active

Lazy Autopilot is active when `workflow.lazyAutopilot === true` in the workflow state. It is typically set at workflow creation time.

To check:

```typescript
const state = await wf_state({ action: "get" })
if (state.autopilot && state.autopilot.lazy) {
  // Lazy Autopilot mode is active
}
```

## What Changes

### No Discovery Questions

In normal Spec Mode, the discuss phase involves an interactive interview with the user. In Lazy Autopilot, the orchestrator infers all requirements from the initial prompt alone. No `question()` calls.

**Normal mode:**
```
Orchestrator: "Should the tool support multi-load?"
User: "Yes, with separators."
```

**Lazy Autopilot mode:**
```
Orchestrator: [reads prompt, infers multi-load is needed, adds to REQUIREMENTS.md directly]
```

### Inferred Branch Name

Instead of asking the user for a branch name, the orchestrator derives it from the prompt or the workflow ID:

```
Prompt: "Build a reference tool"
→ Branch: feat/reference-tool
```

### Auto-Generated REQUIREMENTS.md

Instead of building REQUIREMENTS.md through interactive Q&A, the orchestrator generates it directly from the prompt. The output is the same structure — just populated without back-and-forth.

### Auto-Proceed Through Phases

Once the spec is written and locked, the orchestrator proceeds directly to execute without asking. The pipeline runs:

```
discuss (auto) → plan (auto) → execute (auto) → audit (auto) → accept (paused)
```

Each phase transition happens automatically when conditions are met.

### Delegation Runs Full

The orchestrator dispatches all waves sequentially without asking for confirmation between waves. If a wave returns COMPLETE, the next wave dispatches immediately.

## What Stays the Same

### The Acceptance Gate

Even in Lazy Autopilot, the final accept phase **pauses for user review**. The orchestrator presents:

```markdown
## Delivery Summary

**Workflow:** reference-tool
**Waves Completed:** 7 of 7
**Commits:** 24
**Tests:** All passing
**Spec Coverage:** 100%

### What Was Built
- Reference tool with list, load, multi-load, section extraction
- 16 bundled reference markdown files
- Tag-based filtering and audience-targeted auto-loading
- Unified legacy reference tool

### Verification
- `bun test` — all 142 tests pass
- `bun run typecheck` — clean
- `bun run build` — succeeds

Please confirm acceptance.
```

The user must explicitly accept before the workflow is archived.

### Rule 4 Blockers

Even in Lazy Autopilot, if an executor returns `BLOCKED` for a Rule 4 architectural decision, the orchestrator stops and surfaces the blocker to the user. Lazy mode doesn't override architectural decisions.

### Commit Quality

Lazy Autopilot doesn't skip testing, type-checking, or atomic commits. Quality gates remain the same.

### Spec Lock

The spec still must be locked before execution begins. The difference is that locking happens automatically (the orchestrator locks it) rather than waiting for user confirmation.

## Orchestrator Behavior in Lazy Autopilot

```
1. Read initial prompt
2. Set mode: wf_state({ action: "set-autopilot", autopilot: true, lazy: true })
3. Generate REQUIREMENTS.md from prompt (no questions)
4. Transition to plan
5. Generate SPEC.md and BLUEPRINT.md (delegate to planner)
6. Lock spec: wf_state({ action: "lock-spec" })
7. Transition to execute
8. Dispatch all waves sequentially:
   - For each wave: dispatch tasks, collect results, verify
   - On COMPLETE: log to chronicle, advance to next wave
   - On BLOCKED (Rule 4): stop and surface to user
9. Transition to audit
10. Delegate verification to verifier agent
11. Transition to accept
12. Present delivery summary to user
13. Wait for explicit acceptance
```

## When NOT to Use Lazy Autopilot

Lazy Autopilot is not appropriate when:
- The task is ambiguous and cannot be fully inferred from the prompt
- The user has not provided enough detail to generate a complete spec
- The work involves novel architecture that benefits from user input
- The user explicitly wants to be consulted during planning

In these cases, use standard Spec Mode with interactive discussion.

## Anti-Patterns

**DON'T:** Skip the acceptance gate. Even in lazy mode, the user must confirm.
**DON'T:** Make architectural decisions (Rule 4) without user input. Lazy mode defers to the user on Rule 4.
**DON'T:** Ask questions in lazy mode. The whole point is zero interaction. If you need to ask a question, lazy mode is the wrong mode.
**DON'T:** Generate a spec from an ambiguous prompt. If the prompt is truly insufficient, exit lazy mode and enter standard discussion.
