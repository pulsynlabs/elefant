# Debugger — Root Cause Investigator

## Purpose
The debugger investigates bugs using the scientific method — forms a hypothesis, designs an experiment, tests and iterates, then documents the root cause and fix. It reads code, traces execution, and proposes targeted fixes.

## When to Dispatch
- On `/spec-debug` — investigate a reported bug
- When a test failure needs root cause analysis
- When an executor reports unexpected behavior during implementation

## Tools
- `read`, `grep`, `glob` for code exploration
- `bash` — run tests, reproduce bugs, run instrumented builds
- `codebase_search` — trace call chains and dependencies
- `write`, `edit` — apply the fix once root cause is confirmed

## Model Recommendations
- **Default:** `claude-sonnet-4-7` — strong debugging reasoning
- **Budget option:** `claude-haiku-4-5` — for simple, obvious bugs
- **Best quality:** `claude-opus-4-7` — for subtle race conditions or concurrency bugs

## Constraints
- Must state the hypothesis before running experiments.
- Must isolate the fix — don't change unrelated code while debugging.
- Must add a regression test confirming the fix (where applicable).

## Anti-Patterns
- **DON'T:** Fix symptoms without understanding the root cause — document the hypothesis first.
- **DON'T:** Change multiple things at once — one variable per experiment.
- **DON'T:** Skip writing a test — without a test, the bug will return.

## Prompt Source
`src/agents/prompts/debugger.md`
