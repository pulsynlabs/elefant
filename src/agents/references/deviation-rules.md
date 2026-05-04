---
id: deviation-rules
title: Deviation Rules
description: The 4-rule system for handling deviations during task execution — when to auto-fix vs. stop and ask.
tags:
  - orchestrator
  - executor
  - workflow
audience:
  - orchestrator
  - executor
version: 1.0.0
---

# Deviation Rules

During execution, subagents encounter situations where the plan and reality diverge. These four rules govern when to auto-fix a problem and when to stop and escalate.

Apply these automatically — no confirmation needed for Rules 1-3.

## The Four Rules

| Rule | Trigger | Action |
|------|---------|--------|
| **Rule 1** | Bug found (wrong logic, type error, security vulnerability, infinite loop, race condition) | Auto-fix immediately. Document in the ADL via `wf_adl`. |
| **Rule 2** | Missing critical functionality (error handling, input validation, null checks, auth checks, rate limiting) | Auto-add the safeguard. Document in the ADL via `wf_adl`. |
| **Rule 3** | Blocking technical issue (missing dependency, broken import path, config error, circular dependency) | Auto-fix the blocker. Document in the ADL via `wf_adl`. |
| **Rule 4** | Architectural decision (schema change, new database table, framework/library switch, breaking API change, new infrastructure) | **STOP immediately.** Return status `BLOCKED` with concrete options. Do NOT guess or implement. |

## Rule 4: The Stop-and-Ask Protocol

When you encounter a Rule 4 scenario, you MUST stop. Do not proceed past the decision point. Return:

1. **What decision is needed** — be specific about the exact choice point
2. **2-3 concrete options** — each with brief pros and cons
3. **Your recommendation** — which option you'd choose and why

Example of a correct Rule 4 response:

```
## TASK BLOCKED

**Rule 4 deviation:** The plan calls for storing user preferences as a JSON column,
but we need to query individual preference keys often. This is an architectural
decision about the data model.

**Options:**
| Option | Pros | Cons |
|--------|------|------|
| A: JSON column | Simple schema, no migration churn | Can't index individual keys; slow queries |
| B: Separate preferences table | Indexable, queryable per key | More complex schema, migration needed |
| C: Key-value store (Redis) | Fast reads, purpose-built | New infrastructure, operational complexity |

**Recommendation:** Option B — keeps things in Postgres (no new infra),
gives us queryability, and the migration is straightforward.
```

## Logging Deviations

For any deviation (Rules 1-3 auto-fixes or Rule 4 blocks), log to `wf_adl` with:

- The rule number
- A clear description of the issue encountered
- The action taken (fix applied, or blocked awaiting decision)
- Affected files

```typescript
// Example ADL entry for a Rule 1 auto-fix
wf_adl({
  action: "append",
  type: "deviation",
  description: "Fixed null reference in resolver when directory is missing",
  entry_action: "Added guard clause for undefined dirPath before readdirSync",
  rule: 1,
  files: ["src/tools/reference/resolver.ts"]
})
```

## When to Escalate

**Always escalate to the orchestrator when:**
- The deviation requires a user-facing choice (Rule 4)
- The fix would change the spec contract (amend needed)
- You're unsure which rule applies (default to Rule 4 and ask)

**Never escalate for:**
- Routine bug fixes (fix, log, move on)
- Adding missing validation or error handling (add, log, move on)
- Fixing a broken import or missing dependency (fix, log, move on)
- Test failures caused by your own implementation (fix, log, move on)

## Decision Table

Use this table to quickly classify a situation:

| Situation | Rule | Action |
|-----------|------|--------|
| `undefined is not a function` in production path | Rule 1 | Auto-fix |
| No try/catch around a file read | Rule 2 | Auto-add |
| `Cannot find module './foo.js'` | Rule 3 | Auto-fix |
| "Should we use PostgreSQL or SQLite?" | Rule 4 | Stop, ask |
| User input reaches database without sanitization | Rule 2 | Auto-add validation |
| Need to add a new column to an existing table | Rule 4 | Stop, ask |
| Need to add a field to an existing Zod schema (non-breaking) | Rule 1 | Auto-fix |
| Test assertion is wrong (not the implementation) | Rule 1 | Auto-fix the test |
| Adding a new npm dependency | Rule 4 | Stop, ask |
| Adding an import of an already-installed package | Rule 3 | Auto-fix |
