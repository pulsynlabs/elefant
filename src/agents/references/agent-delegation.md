---
id: agent-delegation
title: Agent Delegation
description: When and how to delegate to specialized Elefant agents — tier routing, prompt structure, delegation anti-patterns.
tags:
  - orchestrator
  - workflow
audience:
  - orchestrator
version: 1.0.0
---

# Agent Delegation

The orchestrator NEVER writes implementation files. All code, research, planning, writing, verification, and debugging work must be delegated to the correct specialist agent via the `task()` function.

## When to Delegate

| Work Type | Delegate To | Example |
|-----------|-------------|---------|
| Implementation (code, config, build) | executor-{low,medium,high,frontend} | Write a resolver, implement a tool, fix a bug |
| Research (explore alternatives, compare) | researcher | "What's the best OAuth library for Bun?" |
| Planning (specs, blueprints) | planner | Create SPEC.md and BLUEPRINT.md |
| Writing (docs, references, changelogs) | writer | Author reference markdown files |
| Verification (audit against spec) | verifier | Check all must-haves are implemented |
| Debugging (root cause analysis) | debugger | "Why is the resolver returning null?" |
| Exploration (codebase mapping) | explorer | Map the agent prompt assembly pipeline |

## The `task()` Function

```typescript
task({
  subagent_type: "executor-medium",
  description: "W5.T1: Author handoff-format.md reference",
  prompt: `
    ## TASK
    [Clear, specific task description]

    ## FILES
    src/agents/references/handoff-format.md (replace existing placeholder)

    ## SOURCE MATERIAL
    - Load `handoff-format` reference: `reference({ name: "handoff-format" })`

    ## ACCEPTANCE
    - Valid YAML frontmatter with tags and audience as list syntax
    - Full XML envelope schema documented
    - No terminology from external workflow systems

    ## VERIFY
    bun test src/tools/reference/frontmatter.test.ts

    ## CONSTRAINTS
    - Must NOT use GoopSpec terminology
    - Must NOT write placeholder content
    - One commit per completed task
  `
})
```

## Tier Routing Table

Choose the correct executor tier based on task complexity:

| Tier | When to Use | Example Tasks |
|------|-------------|---------------|
| **executor-low** | Mechanical, pattern-following work | Rename a type, add a field to a schema, update snapshots, seed fixture data |
| **executor-medium** | Standard implementation with moderate complexity | Write a tool action, create reference files, implement a resolver, write middleware |
| **executor-high** | Complex, architectural, or cross-cutting work | Design a new service layer, implement auth, refactor the prompt assembly pipeline, wire system prompt injection |
| **executor-frontend** | UI and frontend work | Create components, style layouts, implement client-side state, write Playwright tests |

**When in doubt, round up.** An executor-high can handle medium tasks; an executor-low on a high task wastes tokens and produces inadequate results.

## Specialist Routing

| Specialist | When to Use | Key Capabilities |
|-----------|-------------|-----------------|
| **planner** | Creating or revising SPEC.md and BLUEPRINT.md | Wave decomposition, task scoping, executor tier assignment, dependency analysis |
| **researcher** | Investigating technology choices, library comparisons, domain research | Multi-source analysis, tradeoff documentation, recommendation with evidence |
| **writer** | Authoring documentation, references, changelogs | Following markdown conventions, audience-targeted writing, Field Notes publishing |
| **verifier** | Auditing implementation against spec | Spec traceability checking, acceptance criteria verification, gap analysis |
| **debugger** | Root cause analysis of bugs | Hypothesis formation, experiment design, minimal reproduction |
| **explorer** | Mapping unfamiliar codebases | Pattern discovery, convention extraction, integration point identification |

## Prompt Structure

Every delegation prompt must include:

1. **TASK** — what to do, in one clear sentence
2. **FILES** — exact file paths, with "create", "replace", or "modify" annotations
3. **ACCEPTANCE** — measurable criteria for done-ness
4. **VERIFY** — the exact command to run to confirm the work
5. **CONSTRAINTS** (when applicable) — specific things to avoid or boundaries to respect

## Delegation Anti-Patterns

**DON'T: Edit implementation files yourself.**
```
// WRONG: orchestrator directly edits files
Edit("src/tools/reference/index.ts", ...)
```

**DON'T: Delegate without specifying exact files.**
```
// WRONG: vague scope
task({ prompt: "Implement the reference tool" })
```

**DON'T: Delegate without acceptance criteria.**
```
// WRONG: no criteria
task({ prompt: "Write the handoff-format.md reference" })
```

**DON'T: Use the wrong tier for the task.**
```
// WRONG: executor-low for a complex resolver
task({ subagent_type: "executor-low", prompt: "Design the auth service" })
```

**DON'T: Dispatch without must-have mapping.**
```
// WRONG: no spec traceability
task({ prompt: "Add a login endpoint" })
```

**DON'T: Assume an executor has context from your session.**
```
// WRONG: relying on unstated knowledge
task({ prompt: "Fix the bug we discussed earlier" })
```

**DON'T: Delegate multiple unrelated tasks in one dispatch.**
```
// WRONG: three separate things in one prompt
task({ prompt: "1. Fix the bug in resolver.ts. 2. Add a new API endpoint. 3. Update the README." })
```

## Managing Delegated Work

After dispatching a task:

1. **Parse the XML envelope** — extract status, artifacts, commits
2. **If COMPLETE** — verify the output, update `wf_chronicle`, proceed to next task
3. **If PARTIAL** — note what's complete and what remains, resume in next dispatch
4. **If BLOCKED** — surface the blocker to the user with the executor's options; do NOT attempt to resolve it silently

When a wave is fully delegated and all tasks return COMPLETE, run the wave's verification matrix before marking the wave complete.

## Recovering from `ORCHESTRATOR_NO_WRITE`

If you receive a `ORCHESTRATOR_NO_WRITE` error (the hook system correctly blocked you from writing to an implementation directory), do not retry. Delegate:

```
"The permission gate correctly blocked direct implementation.
Dispatching executor-medium with the same file scope and acceptance criteria."
```

Then call `task()` with the same task that was blocked.
