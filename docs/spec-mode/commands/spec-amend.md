# /spec-amend

**Description:** Propose and apply changes to a locked specification through the formal amendment flow.

## Usage
```
/spec-amend [workflow-id] [change description]
```

## Prerequisites
- SPEC must be locked
- Workflow must be in `plan`, `specify`, `execute`, or `audit` phase
- Amendment must include a rationale

## What It Does
1. User describes the amendment (e.g., "Add must-have MH-4: Rate limiting")
2. In a single transaction:
   a. Snapshots current locked state (must-haves, ACs, VCs, out-of-scope)
   b. Temporarily lifts the spec lock
   c. Applies the change (add/remove/modify must-haves, ACs, VCs, etc.)
   d. Re-asserts the spec lock
   e. Inserts an amendment row with prior_state + new_state JSON snapshots + rationale
3. Emits `spec:amended` hook event
4. If the workflow is mid-execute, the planner may re-assess affected waves

## Autopilot Behavior
- **Manual:** User reviews amendment before it's applied
- **Autopilot:** Amendment auto-applied if described in detail; pauses if ambiguous
- **Lazy Autopilot:** Amendment must be explicit — lazy mode won't infer amendments

## Example
```
/spec-amend my-auth-workflow Add must-have MH-6: Implement password reset flow
```

## Anti-Patterns
- **DON'T:** Amend the spec mid-execute without considering impact on already-completed waves.
- **DON'T:** Use amend as a substitute for good planning — frequent amendments signal weak initial SPECs.
