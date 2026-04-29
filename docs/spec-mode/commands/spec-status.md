# /spec-status

**Description:** Display the full status snapshot for the active or specified workflow.

## Usage
```
/spec-status [workflow-id]
```

## Prerequisites
- None — works in any phase for any workflow

## What It Does
1. Calls `spec_status({ workflowId })` (or uses active workflow if none specified)
2. Returns: phase, mode, depth, autopilot flags, spec locked/acceptance state, current wave/total, last activity
3. Also includes: task completion counts, phase transition history, last 3 ADL entries
4. Renders as a formatted status card in chat or the Spec Mode panel

## Autopilot Behavior
- No autopilot-specific behavior — this is a read-only query.

## Example
```
/spec-status
/spec-status my-auth-workflow
```

## Anti-Patterns
- **DON'T:** Assume status output means the workflow is healthy — it's a snapshot, not a health check.
- **DON'T:** Parse status output in agent logic — use `spec_status` tool directly for structured data.
