# /spec-accept

**Description:** Run the final acceptance gate — confirm all must-haves are met and close the workflow.

## Usage
```
/spec-accept [workflow-id]
```

## Prerequisites
- Workflow must be in `audit` or `accept` phase
- All audit results must be `pass` or `skipped` (no `partial` or `fail`)
- SPEC must still be locked

## What It Does
1. Reads the latest verifier run for the workflow
2. Checks if the accept gate is eligible (all VCs pass/skipped)
3. If eligible:
   - Sets `acceptance_confirmed = true`
   - Sets workflow `status = done`
   - Emits final phase transition
   - Distills remaining ADL entries into memory
4. If not eligible: returns 409 with the VC IDs that need attention

## Autopilot Behavior
- **Manual:** User confirms with explicit "accept"
- **Autopilot:** Pauses at accept gate — human must confirm
- **Lazy Autopilot:** Pauses at accept gate — human must confirm (acceptance is NEVER automatic)

## Example
```
/spec-accept my-auth-workflow
```

## Anti-Patterns
- **DON'T:** Accept if any VC has `partial` or `fail` status — the gate will refuse.
- **DON'T:** Try to auto-confirm acceptance — the gate requires explicit human input regardless of autopilot mode.
