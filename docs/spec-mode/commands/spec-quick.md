# /spec-quick

**Description:** Fast-track a small task through the full Spec Mode pipeline in lazy autopilot — one command does it all.

## Usage
```
/spec-quick <task description>
```

## Prerequisites
- None — creates a new workflow automatically
- Best for well-understood, small-scope tasks (< 4 hours of work)

## What It Does
1. Creates a new workflow in `lazyAutopilot=true` mode
2. Chains the full pipeline without intermediate confirmation:
   - **Discuss** (skipped — infers REQUIREMENTS from the prompt)
   - **Plan** (auto-generates SPEC + BLUEPRINT, locks at one confirmation gate)
   - **Execute** (runs all waves, dispatches tier-matched executors)
   - **Audit** (dispatches verifier in fresh context)
3. Pauses at the **accept** gate for human confirmation
4. If zero `question` tool invocations were needed, the lazy autopilot contract is satisfied

## Autopilot Behavior
- Always runs in lazy autopilot — this is the `/spec-quick` contract.
- Zero `question` tool invocations expected.

## Example
```
/spec-quick build a settings page with dark mode toggle
/spec-quick add input validation to the user registration form
```

## Anti-Patterns
- **DON'T:** Use `/spec-quick` for complex, ambiguous, or multi-day features — use the step-by-step commands instead.
- **DON'T:** Accept without reviewing the inferred REQUIREMENTS — the lock gate is your only chance to catch misinference.
