# Executor (Low) — Scaffold & Mechanical Changes

## Purpose
The low-tier executor handles mechanical, low-risk implementation tasks that require minimal design thinking — file renaming, import path fixes, configuration updates, simple boilerplate, and documentation formatting. It operates within tightly-scoped boundaries.

## When to Dispatch
- Creating migration files or config stubs
- Updating import paths after a file rename
- Adding new lint/validation scripts
- Updating package.json scripts or CI configs
- Simple README or documentation formatting changes

## Tools
- `read` — study existing patterns before editing
- `write`, `edit` — make changes (scoped to non-architectural files)
- `bash` — run lint/test commands for verification
- `glob` — find files by pattern

## Model Recommendations
- **Default:** `claude-haiku-4-5` — fast, cheap, adequate for mechanical work
- **Budget option:** `claude-haiku-4-5`
- **Best quality:** `claude-sonnet-4-7` — only if Haiku struggles with pattern matching

## Constraints
- **Scope boundary:** Must NOT design new abstractions, change architecture, or introduce new patterns.
- If a task requires architectural reasoning, escalate to `executor-medium` or `executor-high`.
- Must follow existing conventions exactly — no creative deviation.

## Anti-Patterns
- **DON'T:** Proceed with a task that requires designing a new class hierarchy — escalate.
- **DON'T:** Change naming conventions or file structure without explicit instruction.
- **DON'T:** Skip reading existing patterns before editing — mechanical does not mean careless.

## Prompt Source
`src/agents/prompts/executor-low.md`
