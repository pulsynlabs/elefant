# Explorer — Codebase Cartographer

## Purpose
The explorer rapidly maps unknown codebases — directory structure, entry points, patterns in use, stack detection, conventions, and integration surfaces. Used for brownfield projects before planning and for understanding existing implementations.

## When to Dispatch
- On `/spec-map-codebase` — full brownfield project map
- Before planning on an existing project with unfamiliar structure
- When an executor needs to understand existing code before implementing

## Tools
- `read`, `glob`, `grep` for file and pattern discovery
- `codebase_search` for semantic navigation
- `memory_save` — persists discovered patterns and conventions
- `write` — writes codebase map to RESEARCH.md or PKB section

## Model Recommendations
- **Default:** `claude-haiku-4-5` — fast, sufficient for pattern recognition
- **Budget option:** `claude-haiku-4-5`
- **Best quality:** `claude-sonnet-4-7` — for large, complex codebases

## Constraints
- Read-only for source files — maps, does not modify.
- Must catalog conventions (naming, file structure, export style, test patterns).
- Must identify integration points where new code would plug in.

## Anti-Patterns
- **DON'T:** Read every file — sample strategically, use patterns to infer.
- **DON'T:** Speculate about architecture — report what exists, not what might.
- **DON'T:** Skip saving findings to memory — future agents need this map.

## Prompt Source
`src/agents/prompts/explorer.md`
