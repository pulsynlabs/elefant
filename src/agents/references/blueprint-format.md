---
id: blueprint-format
title: BLUEPRINT.md Format
description: Structure and conventions for Spec Mode BLUEPRINT.md files — wave architecture, task metadata, executor tier routing.
tags:
  - spec-mode
  - planner
  - orchestrator
audience:
  - orchestrator
  - planner
version: 1.0.0
---

# BLUEPRINT.md Format

The BLUEPRINT.md is the execution plan derived from the SPEC.md contract. It defines waves, tasks, dependencies, executor tier assignments, and verification matrices. The orchestrator reads it to dispatch work; executors read it to understand their task.

## File Header

```markdown
# BLUEPRINT: Feature Name

**Spec Version:** 1.0.0
**Created:** 2026-05-03
**Mode:** standard
**Depth:** standard
**Workflow:** `workflow-id`
**Branch:** `feat/branch-name`
```

## Overview Section

A compact summary with key metrics:

```markdown
**Goal:** One-sentence description of what this blueprint delivers.
**Approach:** One-paragraph summary of the technical approach.

| Metric | Value |
|--------|-------|
| Waves | 7 |
| Total Tasks | 24 |
| Estimated Effort | ~2 days |
```

## Spec Mapping

A traceability table linking every must-have to specific tasks:

```markdown
| Must-Have | Tasks | Coverage |
|-----------|-------|----------|
| MH1: list action | W1.T1, W1.T3, W1.T5 | 100% |
| MH2: load by name | W1.T1, W1.T3, W3.T1 | 100% |

**Total Coverage:** 100%
```

## Wave Architecture Diagram

An ASCII tree showing the full wave structure with execution strategy:

```markdown
Wave 1: Foundation [PARTIAL PARALLEL]
├── 1.1: Create resolver module
├── 1.2: Define type skeleton
├── 1.3: Implement reference tool
├── 1.4: Seed reference directory
└── 1.5: Register tool in registry

Wave 2: Frontmatter & Tags [SEQUENTIAL after W1]
├── 2.1: Define Zod frontmatter schema
├── 2.2: Frontmatter parser integration
└── 2.3: Tag filtering on list action
```

## Wave Section

Each wave is a `##` heading section with this structure:

```markdown
## Wave N: Theme Name

**Goal:** What this wave delivers.
**Execution:** Sequential | Parallel | Partial Parallel
**Depends On:** Wave N-1 | None

### Verification Matrix

| Check | Command | Expected |
|-------|---------|----------|
| Tests | `bun test src/module/` | all pass |
| Typecheck | `bun run typecheck` | clean |
| Build | `bun run build` | succeeds |
```

### Task Table Format

Each task is a `###` heading followed by a metadata table:

```markdown
### Task N.M: Action-Oriented Name

| Attribute | Value |
|-----------|-------|
| **Files** | `path/to/file.ts` (create), `path/to/other.ts` (modify) |
| **Executor** | executor-medium |
| **Spec Refs** | MH2, MH12 |
| **Parallel** | Yes / No |
| **Depends On** | Task N.(M-1) or None |
| **Done When** | Clear, measurable condition |
| **Verify** | Exact command to run |

**Intent:** What this task does and why it matters.
**Deliverables:** Checklist of concrete outputs.
**Acceptance:** How the orchestrator confirms this task is done.
```

### Task Metadata Fields

| Field | Required | Description |
|-------|----------|-------------|
| **Files** | Yes | Exact paths with `(create)`, `(modify)`, or `(delete)` annotation |
| **Executor** | Yes | The correct tier: `executor-low`, `executor-medium`, `executor-high`, `executor-frontend`, or a specialist (`planner`, `researcher`, `writer`, `verifier`, `debugger`, `explorer`) |
| **Spec Refs** | Yes | Which must-haves this task contributes to (MH1, MH2, etc.) |
| **Parallel** | Yes | Whether this task can run concurrently with others in the same wave |
| **Depends On** | Yes | Task ID or `None` |
| **Done When** | Yes | Measurable acceptance condition |
| **Verify** | Yes | Exact command to run for verification |

### Optional Task Metadata

| Field | Description |
|-------|-------------|
| **Estimated** | Time estimate (e.g., `~30 min`) |
| **Risk** | Specific risks for this task |
| **Notes** | Additional context for the executor |

## Executor Tier Selection

Choose the right tier based on task complexity:

| Tier | When | Example Tasks |
|------|------|---------------|
| executor-low | Mechanical, pattern-following | Rename a type, add a field to a schema, update snapshots |
| executor-medium | Standard implementation | Write a tool action, create reference files, implement a resolver |
| executor-high | Complex, cross-cutting | Design a service layer, implement auth, wire prompt injection |
| executor-frontend | UI and frontend work | Create components, style layouts, write Playwright tests |
| planner | Specs and blueprints | Create or revise SPEC.md and BLUEPRINT.md |
| researcher | Technology investigation | Compare libraries, research approaches |
| writer | Documentation and references | Author markdown files, write changelogs |
| verifier | Audit and verification | Check implementation against spec |
| debugger | Root cause analysis | Investigate bugs |
| explorer | Codebase mapping | Discover patterns and conventions |

## Verification Matrices

Every wave has a verification matrix. The blueprint also has a global one:

```markdown
## Verification Checklist (Blueprint-Wide)

- [ ] All N waves marked complete in CHRONICLE
- [ ] Every must-have (MH1-MHN) verified against acceptance criteria
- [ ] `bun test` passes (full suite)
- [ ] `bun run typecheck` clean
- [ ] `bun run build` succeeds
```

## Deviation Protocol

Every blueprint includes the deviation rules reference:

```markdown
| Rule | Trigger | Action |
|------|---------|--------|
| **Rule 1** | Bug found | Auto-fix, log to ADL |
| **Rule 2** | Missing critical functionality | Auto-add, log to ADL |
| **Rule 3** | Blocking technical issue | Auto-fix, log to ADL |
| **Rule 4** | Architectural decision needed | STOP, ask user |
```

## Wave Questions Section

Each wave ends with open questions the planner identified:

```markdown
### Wave N Questions

1. Should references use flat .md files or directory-based layout?
2. Which resolver pattern is most appropriate?
```

The orchestrator resolves these before dispatching the wave.

## Execution Notes

Guidance for the orchestrator and executors:

```markdown
### For Orchestrator
- Delegate ALL code tasks to executor agents
- Track wave progress in CHRONICLE.md
- Save checkpoint at wave boundaries

### For Executor Agents
- Read SPEC.md and CHRONICLE.md before starting
- Follow existing codebase conventions
- Co-locate tests with implementation
- Return XML envelope at end of each task
```

## Handoff Protocol

At wave boundaries:

```markdown
1. Update CHRONICLE.md with completed task IDs and commits
2. Save checkpoint: wave-N-complete
3. Run wave verification matrix; require all green
4. If context near threshold, generate handoff and suggest new session
```

## Complete Example Task

```markdown
### Task 1.1: Create 3-tier resolver module

| Attribute | Value |
|-----------|-------|
| **Files** | `src/tools/reference/resolver.ts` (create), `src/tools/reference/resolver.test.ts` (create) |
| **Executor** | executor-medium |
| **Spec Refs** | MH2, MH12 |
| **Parallel** | Yes |
| **Depends On** | None |
| **Done When** | Resolver returns highest-priority match by tier |
| **Verify** | `bun test src/tools/reference/resolver.test.ts` |

**Intent:** Implement `resolveReference(name)` and `listReferences()` that scan project, user, and builtin tiers in priority order.

**Deliverables:**
- [ ] `ReferenceInfo` type with name, description, source, path
- [ ] `resolveReference(name, opts)` honoring tier priority
- [ ] `listReferences(opts)` with deduplication
- [ ] Unit tests covering all three tiers, overrides, and missing cases

**Acceptance:** Resolver returns the correct tier and handles missing directories gracefully.
```
