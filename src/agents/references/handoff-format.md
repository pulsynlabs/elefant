---
id: handoff-format
title: Handoff Format
description: XML response envelope schema for agent-to-orchestrator handoffs in Elefant.
tags:
  - orchestrator
  - executor
  - format
audience:
  - orchestrator
  - executor
version: 1.0.0
---

# Handoff Format

Every Elefant subagent returns a structured XML envelope at the end of its response. This enables the orchestrator to parse status, artifacts, and next actions without depending on fragile prose matching.

## Overview

The XML response envelope is the contract between a subagent and the orchestrator. Every subagent response MUST end with this envelope. The orchestrator parses it to extract status, artifacts, verification results, and handoff instructions — avoiding fragile prose-based state detection.

The envelope has four mandatory sections (`<status>`, `<agent>`, `<summary>`, `<handoff>`) and two optional sections (`<artifacts>`, `<verification>`).

## Basic Structure

```xml
<elefant_report version="1.0">
  <status>COMPLETE | PARTIAL | BLOCKED</status>
  <agent>[agent-name]</agent>
  <summary>[1-2 sentence summary of what was accomplished]</summary>
  <artifacts>
    <files>
      <file path="[path]" action="created|modified|read">[description]</file>
    </files>
    <commits>
      <commit sha="[sha]">[message]</commit>
    </commits>
  </artifacts>
  <verification>
    <check name="[check-name]" passed="true|false">[evidence]</check>
  </verification>
  <handoff>
    <ready>true|false</ready>
    <next_action>[what the orchestrator should do next]</next_action>
    <blockers>NONE | [description]</blockers>
  </handoff>
</elefant_report>
```

### Required Elements

| Element | Purpose |
|---------|---------|
| `<status>` | Current completion status — must be one of the three values listed below |
| `<agent>` | Which agent type produced this response (e.g. `executor-medium`, `researcher`) |
| `<summary>` | One to two sentences describing what was accomplished |
| `<handoff>` | Next steps for the orchestrator, including readiness and blockers |

### Optional Elements

| Element | Purpose |
|---------|---------|
| `<artifacts>` | When files were changed or commits were made |
| `<verification>` | When verification commands were run and evidence is available |

## Status Values

Only three status values are permitted:

| Status | Meaning | Orchestrator Action |
|--------|---------|---------------------|
| `COMPLETE` | Task fully finished, all deliverables produced, verified | Move to next task |
| `PARTIAL` | Some progress made, but more work needed on the same task | Resume the same task with context |
| `BLOCKED` | Cannot proceed — architectural decision or user input required | Surface the blocker to the user with options |

**When to use each:**

- **COMPLETE:** All acceptance criteria are met. Tests pass. Commits exist. No follow-up work remains.
- **PARTIAL:** A large task was split across sessions, or the agent hit a natural boundary (file count, time). Return PARTIAL with exact resume context.
- **BLOCKED:** Use only for Rule 4 scenarios (see `deviation-rules.md`). Include concrete options. Do NOT use for temporary ambiguity.

## Artifacts Format

When returning `<artifacts>`, both `<files>` and `<commits>` blocks should be populated:

```xml
<artifacts>
  <files>
    <file path="src/feature/index.ts" action="created">Main implementation</file>
    <file path="src/feature/index.test.ts" action="created">Unit tests</file>
    <file path="src/tools/registry.ts" action="modified">Registered new tool</file>
  </files>
  <commits>
    <commit sha="abc1234">feat(feature): add main implementation</commit>
    <commit sha="def5678">test(feature): add unit tests</commit>
  </commits>
</artifacts>
```

**File actions:** Use `created`, `modified`, or `read`. Always provide a brief description of what changed.

**Commit format:** Include the short SHA and the full commit message. Commits follow conventional commit format (see `git-workflow.md`). NEVER include internal task IDs or wave numbers in commit messages.

## Verification Block

When you can provide concrete evidence, include a `<verification>` block:

```xml
<verification>
  <check name="tests" passed="true">bun test — 42 passed, 0 failed</check>
  <check name="typecheck" passed="true">bun run typecheck — clean</check>
  <check name="manual" passed="true">Verified output matches expected format</check>
</verification>
```

**Check names:** Use short, machine-readable names (`tests`, `typecheck`, `build`, `lint`, `manual`).

**Evidence:** Include the command run and its observed output. If a check was not run, mark `passed="false"` and explain why.

## Handoff Block

The `<handoff>` block drives the orchestrator's next action:

```xml
<handoff>
  <ready>true</ready>
  <next_action>W3.T2: Implement section extraction by ## heading</next_action>
  <blockers>NONE</blockers>
</handoff>
```

| Field | Description |
|-------|-------------|
| `<ready>` | `true` if the task is in a completed or handoff-ready state; `false` if blocked |
| `<next_action>` | Concise description of the immediate next step, including file scope and executor tier if known |
| `<blockers>` | `NONE` if unblocked; otherwise, a short description of what's blocking progress |

**When blocked**, include a separate handoff block (outside XML) that presents the orchestrator with concrete options and tradeoffs before returning the XML envelope.

## Complete Example

Here is a realistic executor response for a completed task:

```xml
<elefant_report version="1.0">
  <status>COMPLETE</status>
  <agent>executor-medium</agent>
  <summary>Implemented reference resolver with 3-tier resolution. All 12 tests pass; typecheck clean.</summary>
  <artifacts>
    <files>
      <file path="src/tools/reference/resolver.ts" action="created">3-tier resolver: project > user > builtin</file>
      <file path="src/tools/reference/resolver.test.ts" action="created">12 tests covering all tiers</file>
      <file path="src/tools/reference/types.ts" action="modified">Added ReferenceInfo type</file>
    </files>
    <commits>
      <commit sha="abc1234">feat(reference): implement 3-tier reference resolver</commit>
      <commit sha="def5678">test(reference): add resolver unit tests</commit>
    </commits>
  </artifacts>
  <verification>
    <check name="tests" passed="true">bun test src/tools/reference/ — 12 passed</check>
    <check name="typecheck" passed="true">bun run typecheck — clean</check>
  </verification>
  <handoff>
    <ready>true</ready>
    <next_action>Continue with Task 1.3: Implement reference tool list/load actions. Delegate to executor-medium.</next_action>
    <blockers>NONE</blockers>
  </handoff>
</elefant_report>
```

## Common Mistakes

- **Omitting the XML envelope.** Every response MUST end with the envelope. Orchestrator parses it for state transitions.
- **Using extra status values.** Only `COMPLETE`, `PARTIAL`, and `BLOCKED` are valid. Do not invent new ones.
- **Missing `<handoff>` block.** Even COMPLETE responses need a next action — at minimum, "Proceed with next task" or "Await orchestrator dispatch."
- **Silent <artifacts>.** If you created or modified files, list them. The orchestrator uses this to update the chronicle.
- **Commit messages referencing internal task IDs.** Commits must use universal language — no W1.T2, MH3, or phase references.
