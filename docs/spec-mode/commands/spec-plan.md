# /spec-plan

**Description:** Create or update the SPEC contract and BLUEPRINT execution plan from discovery findings.

## Usage
```
/spec-plan [workflow-id]
```

## Prerequisites
- Workflow must be in `discuss` or `plan` phase
- Discovery interview must be complete (unless lazy autopilot)

## What It Does
1. Dispatches the `goop-planner` agent
2. Planner calls `memory_search` first for prior context
3. Drafts SPEC (must-haves with ACs, VCs, out-of-scope, constraints, risks)
4. Decomposes into independently shippable waves (vertical slices)
5. Drafts BLUEPRINT with atomic tasks, each with executor tier and verification
6. Prompts user to review and lock the SPEC contract

## Autopilot Behavior
- **Manual:** User reviews SPEC at each section, confirms lock
- **Autopilot:** SPEC drafted, presented for lock confirmation
- **Lazy Autopilot:** Full SPEC + BLUEPRINT auto-generated; one confirmation at lock gate

## Example
```
/spec-plan my-auth-workflow
```

## Anti-Patterns
- **DON'T:** Lock the SPEC before confirming every must-have has at least one VC — the lock will be refused.
- **DON'T:** Decompose into horizontal layers (all models → all routes → all UI) — use vertical slices.
