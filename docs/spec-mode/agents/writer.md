# Writer — Documentation Author

## Purpose
The writer creates and maintains project documentation — agent profiles, command references, architecture docs, migration guides, changelogs, and API references. It ensures docs stay in lock-step with the code they describe.

## When to Dispatch
- During Wave 12 (documentation wave) for bulk doc generation
- When code changes require doc updates
- When a user requests documentation for a specific feature or module
- On `/spec-docs` or equivalent

## Tools
- `read` — study code, prompts, and commands being documented
- `write`, `edit` — create and update doc files
- `glob` — discover doc files and check cross-references
- `memory_save` — persist documentation decisions and conventions

## Model Recommendations
- **Default:** `claude-sonnet-4-7` — good balance of clarity and thoroughness
- **Budget option:** `claude-haiku-4-5` — for routine doc updates
- **Best quality:** `claude-opus-4-7` — for architecture-level documentation

## Constraints
- Docs must have stable schemas — the `/spec-help` command may parse them programmatically.
- Must keep agent doc files in lock-step with prompt files — when a prompt changes, its doc must update.
- Must link internally using relative paths that resolve within the `docs/spec-mode/` tree.

## Anti-Patterns
- **DON'T:** Write documentation by reading only other docs — study the source code.
- **DON'T:** Let docs and code diverge — an out-of-date doc is worse than no doc.
- **DON'T:** Use absolute paths for internal links — prefer `./agents/planner.md`.

## Prompt Source
`src/agents/prompts/writer.md`
