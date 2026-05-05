---
id: memory-usage
title: Memory Usage
description: How to use Elefant's persistent memory system — save, search, note, and decision patterns.
tags:
  - memory
  - workflow
audience:
  - all
version: 1.0.0
---

# Memory Usage

Elefant's persistent memory system preserves decisions, patterns, and observations across sessions. It uses semantic search (not just keyword matching) so related context surfaces even when terminology differs.

## Core Protocol

```
+================================================================+
|  MEMORY IS THE FIRST AND LAST STEP.                            |
|  Search before starting work. Save after completing it.        |
|  Every subagent follows this protocol.                         |
+================================================================+
```

### Before Starting Any Task

1. **Search memory for relevant prior decisions:**
   ```
   memory_search({ query: "[domain] [task-type] patterns conventions" })
   ```
   If a relevant decision exists, acknowledge it: "I recall [X] from a previous session. Still applicable? Proceeding on that assumption."

2. **Use specific queries:**
   - Good: `"reference tool resolver three-tier pattern"`
   - Good: `"auth implementation JWT decision"`
   - Bad: `"stuff about auth"`

3. **Filter by type when you know what you're looking for:**
   ```
   memory_search({
     query: "executor patterns",
     types: ["decision", "observation"],
     concepts: ["executor", "implementation"]
   })
   ```

### After Completing Significant Work

1. **Save architectural decisions:**
   ```
   memory_decision({
     decision: "Used X over Y",
     reasoning: "X integrates better with the existing Effect-TS service layer and avoids an extra dependency",
     alternatives: ["Y", "Z"],
     impact: "high",
     concepts: ["architecture", "dependency", "service-layer"]
   })
   ```

2. **Save important observations:**
   ```
   memory_save({
     type: "observation",
     title: "Task 2.1: Implemented reference resolver",
     content: "Three-tier resolver (project > user > builtin) mirrors the skill tool pattern. Used flat .md files (not directory-based). Key gotcha: frontmatter parsing must handle CRLF line endings.",
     facts: [
       "Resolver follows 3-tier priority: project > user > builtin",
       "Reference files are flat .md, not directory-based like skills",
       "Frontmatter parser handles both LF and CRLF"
     ],
     concepts: ["reference-tool", "resolver", "frontmatter"],
     importance: 0.7,
     sourceFiles: ["src/tools/reference/resolver.ts", "src/tools/reference/frontmatter.ts"]
   })
   ```

3. **Capture quick notes:**
   ```
   memory_note({
     note: "The reference frontmatter test fixtures need updating when the Zod schema changes — check types.test.ts",
     concepts: ["reference-tool", "testing", "frontmatter"]
   })
   ```

## Memory Types

| Type | Tool | Use Case | Importance |
|------|------|----------|------------|
| **Note** | `memory_note` | Quick captures, temporary reminders, one-off observations | 0.3-0.5 |
| **Observation** | `memory_save` (type: "observation") | Patterns discovered, gotchas, task outcomes, conventions found | 0.6-0.8 |
| **Decision** | `memory_decision` | Architectural choices, technology selections, design tradeoffs | 0.8-1.0 |
| **Todo** | `memory_save` (type: "todo") | Track follow-up work across sessions | 0.5-0.7 |

## Importance Guidelines

| Level | When to Use | Effect |
|-------|-------------|--------|
| **0.9-1.0** | Critical architectural decisions, breaking changes, fundamental design choices | Always surfaced in related searches |
| **0.7-0.8** | Important patterns, non-obvious behaviors, gotchas, significant task outcomes | Surfaced for closely related queries |
| **0.5-0.6** | General observations, routine task completions | Background context |
| **0.3-0.4** | Minor notes, temporary reminders | Rarely surfaced; may be pruned |

## Concept Tagging

Tag every memory with concepts for semantic search. Use consistent, lowercase, hyphenated concept names:

```
concepts: ["authentication", "jwt", "session-management", "middleware"]
```

**Good concept tags:**
- `"reference-tool"`, `"resolver"`, `"frontmatter"`
- `"task-execution"`, `"wave-delegation"`, `"spec-mode"`
- `"field-notes"`, `"field-notes"`, `"search-patterns"`

**Bad concept tags:**
- `"stuff"`, `"misc"`, `"other"` (too vague)
- `"Reference Tool Implementation"` (use kebab-case)
- `"REALLY IMPORTANT"` (use importance field, not tags)

## What NOT to Store

**NEVER store in memory:**
- API keys, passwords, tokens, or secrets of any kind
- Private keys or certificate contents
- Personal identifiable information (PII)
- Large code blocks (store file paths instead — use `sourceFiles`)
- Content inside `<private>` tags in prompts

## Search Tips

1. **Be specific with queries** — the system uses hybrid semantic + keyword matching
2. **Use the `concepts` filter** when you know the domain:
   ```
   memory_search({ query: "reference tool", concepts: ["reference-tool", "frontmatter"] })
   ```
3. **Filter by type** to get only decisions or only observations
4. **Set `minImportance`** to avoid noise when looking for critical decisions
5. **Search before every significant task** — even if you think you remember, check

## When to Forget

Delete memories when they become:
- Outdated (implementation changed, decision reversed)
- Incorrect (mistaken observation)
- Superseded (newer memory covers the same ground more accurately)

```
memory_forget({ id: 123 })                    // delete by ID
memory_forget({ query: "old resolver pattern", confirm: true })  // delete by query
```

## Integration with Elefant Workflow

Memory integrates with the full workflow:

| Phase | Memory Action |
|-------|---------------|
| **discuss** | Search for prior context about the domain or user preferences |
| **plan** | Save architectural decisions and constraints; record why certain approaches were chosen |
| **execute** | Save observations about codebase patterns, gotchas discovered, and task outcomes |
| **audit** | Save verification findings and any gaps found |
| **accept** | Record the final summary of what was delivered and key decisions made |
