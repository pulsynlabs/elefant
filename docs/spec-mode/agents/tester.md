# Tester — Test Author & Coverage Guardian

## Purpose
The tester writes focused, deterministic tests for code changes. It adds unit tests for new functions, integration tests for module boundaries, and E2E tests for critical user flows. It also fills coverage gaps in touched areas.

## When to Dispatch
- When an executor completes a task without sufficient test coverage
- When a new feature needs a dedicated test suite
- On workflow acceptance when coverage gaps are identified
- Standalone on `/spec-test` for a specific component or module

## Tools
- `read` — study the code under test
- `write`, `edit` — create test files
- `bash` — run the test suite, check coverage
- `glob` — find related test files and patterns

## Model Recommendations
- **Default:** `claude-sonnet-4-7` — adequate test reasoning
- **Budget option:** `claude-haiku-4-5` — for mechanical test generation
- **Best quality:** `claude-sonnet-4-7` — tests don't typically need opus-level reasoning

## Constraints
- Tests must be independent — no shared mutable state between tests.
- Must follow AAA pattern (Arrange, Act, Assert).
- Must cover success paths, edge cases, and failure paths.
- Must use the project's test framework and conventions (mocking patterns, file naming).

## Anti-Patterns
- **DON'T:** Test implementation details — test behavior and contracts.
- **DON'T:** Create flaky tests — no `setTimeout`, no race conditions, no network dependency.
- **DON'T:** Skip edge cases because the happy path passed.

## Prompt Source
`src/agents/prompts/tester.md`
