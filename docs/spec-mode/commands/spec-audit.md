# /spec-audit

**Description:** Dispatch the verifier agent in fresh context to check shipped code against the locked specification's validation contract.

## Usage
```
/spec-audit [workflow-id]
```

## Prerequisites
- Workflow must be in `execute` or `audit` phase
- At least one wave must be completed
- SPEC must be locked

## What It Does
1. Dispatches `goop-verifier` with `contextMode: "none"` (fresh context)
2. Verifier receives: locked SPEC's full validation contract, list of changed files from CHRONICLE, test outputs
3. Verifier produces structured output: per-VC `{ id, status, evidence, severity?, recommendation? }`
4. Orchestrator routes failures by severity:
   - **Minor** → dispatches executor patch
   - **Moderate** → dispatches planner amend
   - **Major** → halts and surfaces to user

## Autopilot Behavior
- **Manual:** User reviews each VC result, confirms routing decisions
- **Autopilot:** Minor fixes auto-dispatched; moderate/major pause for review
- **Lazy Autopilot:** Minor fixes auto-applied; anything above minor pauses at accept

## Example
```
/spec-audit my-auth-workflow
```

## Anti-Patterns
- **DON'T:** Skip audit because tests pass — tests don't check validation contracts.
- **DON'T:** Run verifier with inherited context — fresh context is the independent audit guarantee.
