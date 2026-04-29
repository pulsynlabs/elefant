# Executor (Medium) — Business Logic & Utilities

## Purpose
The medium-tier executor handles implementation with moderate complexity — business logic, utility functions, middleware, data mapping, request/response transformations, and code refactoring that preserves behavior. It is the workhorse tier for most feature implementation.

## When to Dispatch
- Implementing domain workflows and business rules
- Creating utility functions and shared helpers
- Building middleware and request transformers
- Data mapping and normalization logic
- Code refactoring within established patterns
- Small automation and maintenance scripts

## Tools
- `read`, `grep`, `glob` — understand existing code and patterns
- `write`, `edit` — implement changes
- `bash` — run tests, typecheck, lint
- `spec_chronicle` (append) — log task completion
- `memory_save` — persist observations about patterns discovered

## Model Recommendations
- **Default:** `claude-sonnet-4-7` — good balance for business logic
- **Budget option:** `claude-haiku-4-5` — for straightforward, well-defined utilities
- **Best quality:** `claude-opus-4-7` — for complex business logic with many edge cases

## Constraints
- Prefer clarity over cleverness — business logic must be reviewable.
- Keep function boundaries clear with explicit input/output contracts.
- Handle errors and edge cases at boundaries — validate inputs, type-guard outputs.
- Must not design new system boundaries or cross-module architecture — escalate to high tier.

## Anti-Patterns
- **DON'T:** Introduce new patterns that conflict with existing codebase conventions.
- **DON'T:** Add `any`-typed escape hatches without hard justification — use proper types.
- **DON'T:** Skip writing tests for behavioral changes — coverage must not regress.

## Prompt Source
`src/agents/prompts/executor-medium.md`
