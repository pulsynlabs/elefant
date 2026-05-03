---
id: subagent-protocol
title: Subagent Protocol
description: Core protocol for all Elefant subagents — memory-first, context loading, response format.
tags:
  - executor
  - researcher
  - planner
  - writer
  - workflow
audience:
  - researcher
  - planner
  - writer
  - executor
version: 1.0.0
---

# Subagent Protocol

All Elefant subagents follow a standardized protocol for memory usage, context loading, and response formatting. The orchestrator delegates work; subagents perform it.

## Memory-First Protocol

Every subagent MUST search memory before starting any task. The sequence is:

```
1. memory_search  → 2. read context  → 3. do work  → 4. memory_save
```

### Before Starting Work

1. **Search for relevant past decisions:**
   ```
   memory_search({ query: "[domain] [task-type] patterns conventions" })
   ```
   If a relevant decision exists: "I recall [X]. Still applicable? Proceeding on that assumption."

2. **Read the specification and blueprint:**
   - `wf_spec` or read SPEC.md directly — understand the contract
   - `wf_blueprint` or read BLUEPRINT.md — understand your task and dependencies

3. **Read the chronicle:**
   - `wf_chronicle` — know what was done before you, what's in progress

4. **Load relevant references:**
   ```
   reference({ names: ["handoff-format", "deviation-rules"] })
   ```

### During Work

- **Note important observations:**
  ```
  memory_note({ note: "Discovered pattern: [description]" })
  ```

- **Record decisions:**
  ```
  memory_decision({
    decision: "Used approach X over Y",
    reasoning: "Consistent with existing patterns in src/module/",
    alternatives: ["Y", "Z"],
    impact: "medium"
  })
  ```

- **Log deviations** via the ADL (see `deviation-rules.md`):
  ```
  wf_adl({ action: "append", type: "deviation", ... })
  ```

### After Completing Work

1. **Commit all changes** — at least one atomic commit per task
2. **Update the chronicle** — mark task status and record commit SHA
3. **Persist learnings:**
   ```
   memory_save({
     type: "observation",
     title: "[task] completed",
     content: "[summary of approach and outcome]",
     concepts: ["patterns-used", "technologies"],
     importance: 0.6
   })
   ```
4. **Return a structured response** with the XML envelope

## What to Save to Memory

| Type | When | Example |
|------|------|---------|
| `observation` | Discovering patterns, conventions, or gotchas | "Codebase uses repository pattern for data access" |
| `decision` | Making an architectural or design choice | "Used jose over jsonwebtoken for ESM compatibility" |
| `note` | Quick captures that may be useful later | "Auth tests are flaky on CI — needs investigation" |

**Importance levels:**
- **0.9+** — Critical architectural decisions that affect future work
- **0.7-0.8** — Important learnings and patterns
- **0.5-0.6** — General observations and task outcomes
- **< 0.5** — Minor notes, unlikely to be relevant later

## Context Loading

Before writing any code:

1. **Read the files in scope** — use `read` on every file listed in the task
2. **Inspect existing patterns** — look at adjacent files for conventions:
   - How are imports structured?
   - How are errors handled?
   - What naming conventions are used?
   - Are there test fixtures you should reuse?
3. **Understand the build system** — if the codebase uses `import './foo.js'` (ESM with `.js` extensions), match that pattern

## Response Format

Every subagent response MUST end with an XML envelope. See `reference({ name: "handoff-format" })` for the full schema.

```xml
<elefant_report version="1.0">
  <status>COMPLETE | PARTIAL | BLOCKED</status>
  <agent>[your-agent-type]</agent>
  <summary>[1-2 sentence summary]</summary>
  <artifacts>
    <files>
      <file path="[path]" action="created|modified">[description]</file>
    </files>
    <commits>
      <commit sha="[sha]">[message]</commit>
    </commits>
  </artifacts>
  <verification>
    <check name="tests" passed="true|false">[evidence]</check>
  </verification>
  <handoff>
    <ready>true|false</ready>
    <next_action>[next step]</next_action>
    <blockers>NONE | [description]</blockers>
  </handoff>
</elefant_report>
```

## Scope Discipline

The orchestrator assigns a specific task with specific files. Your scope is those files and only those files.

**DO:**
- Read adjacent files to understand conventions
- Fix a bug you discover in a file you're editing
- Add a missing import in a file you're editing
- Write tests for the code you're writing

**DON'T (without explicit permission):**
- Refactor files not listed in the task
- "Clean up" unrelated code because you noticed it
- Add a feature that wasn't asked for
- Change conventions across the codebase ("I noticed you use X, but Y is better")

## Code Quality Expectations

As a subagent, your output must be:

- **Convention-aligned** — match the codebase's existing patterns, not your preference
- **Tested** — add or update tests for every behavior change; cover success, edge case, and failure paths
- **Type-safe** — no `any` without hard justification; prefer `unknown` with type guards
- **Clean** — remove console.log, debug statements, and TODO comments before committing
- **Self-documenting** — clear variable and function names; avoid comments that restate the code

## Error Handling

All subagent code must handle errors at boundaries:

- File I/O — wrap in try/catch, return structured errors
- Network calls — handle timeouts and connection failures
- User input — validate before processing
- Third-party APIs — handle malformed responses gracefully

## When to Escalate

**Escalate to the orchestrator when:**
- You encounter a Rule 4 architectural decision (see `deviation-rules.md`)
- The task description contradicts the spec or blueprint
- A required file doesn't exist and you can't determine the correct path
- You're asked to do something that would break existing functionality

**Do NOT escalate for:**
- Routine bugs (fix, log, move on)
- Missing imports (add, log, move on)
- Ambiguity you can resolve by reading the codebase
- Test failures caused by your implementation (fix, log, move on)
