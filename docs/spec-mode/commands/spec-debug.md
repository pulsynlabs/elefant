# /spec-debug

**Description:** Debug a specific bug or issue using the scientific method — hypothesis, experiment, root cause, fix.

## Usage
```
/spec-debug <bug description or issue reference>
```

## Prerequisites
- Must have access to the relevant codebase
- Bug description should include reproduction steps if known
- Can run within or outside an active workflow

## What It Does
1. Dispatches `goop-debugger` agent
2. Debugger forms a hypothesis about the root cause
3. Designs and runs experiments (reproduce, isolate, trace)
4. Confirms or revises hypothesis based on results
5. Once root cause is confirmed, applies a targeted fix
6. Adds a regression test to prevent recurrence
7. Documents findings in CHRONICLE or issue tracker

## Autopilot Behavior
- **Manual:** User confirms the fix before it's applied
- **Autopilot:** Fix auto-applied with regression test added
- **Lazy Autopilot:** Fix auto-applied with regression test

## Example
```
/spec-debug Login fails with 500 error when email contains a plus sign
/spec-debug Task list doesn't update via SSE after wave completion
```

## Anti-Patterns
- **DON'T:** Fix symptoms without identifying the root cause — document the hypothesis.
- **DON'T:** Change multiple things at once — each experiment tests one variable.
- **DON'T:** Skip the regression test — without it, the bug will return.
