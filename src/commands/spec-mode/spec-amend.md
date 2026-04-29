# /spec-amend

**Description:** Propose and apply a change to a locked specification through the amendment flow. Temporarily lifts and re-asserts the spec lock within a single transaction.
**Category:** Spec Mode

## When to Use
When the SPEC is locked but a must-have, acceptance criterion, or out-of-scope item needs to change. Amendment uses a snapshot-before/snapshot-after pattern to maintain auditability.

## Prerequisites
- SPEC must be locked (`spec_locked = true`).
- The amendment must have a clear rationale.
- The workflow must be in a phase where amendments are allowed (`plan`, `specify`, or `execute`).

## Process
1. Ask the user what they want to change: which must-have, acceptance criterion, or constraint, and why.
2. Read the current SPEC via `spec_spec.read({ workflowId })` to show the current state.
3. Formulate the amendment payload:
   - **rationale:** why the change is needed
   - **target:** which document section is changing
   - **change:** the exact old → new content
4. Call `spec_spec.amend({ workflowId, amendment: { rationale, change } })`. This:
   - Begins a transaction.
   - Snapshots the current locked state.
   - Temporarily clears `spec_locked`.
   - Applies the change.
   - Re-asserts `spec_locked`.
   - Inserts a `spec_amendments` row with prior_state and new_state JSON.
   - Emits `spec:amended` event.
5. Show the diff of the change to the user: old state vs new state.
6. Log the amendment to CHRONICLE and ADL.

## Tools Used
- `spec_spec.read` — read current spec
- `spec_spec.amend` — apply the amendment transactionally
- `spec_chronicle.append` — log the amendment
- `spec_adl.append` — record the deviation as a decision

## Autopilot Behavior
When `autopilot=true`:
- If the amendment reason is auto-generated (e.g., from audit moderate failure routing), apply without user confirmation.
When `lazyAutopilot=true`:
- Same as autopilot: auto-apply if internally triggered.

## Output
- A `spec_amendments` row with prior and new state snapshots.
- Updated SPEC document reflecting the change.
- A diff view presented to the user.
- CHRONICLE and ADL entries documenting the amendment.

## Success Criteria
- [ ] Amendment is applied atomically — partial changes never persist.
- [ ] `spec_amendments` row contains both prior_state and new_state JSON.
- [ ] `spec:amended` event is emitted and consumable by listeners.
- [ ] The spec lock is re-asserted after the amendment completes.

## Anti-Patterns
**DON'T:** Amend the spec outside the amendment flow — direct writes to a locked spec are rejected at the repo layer.
**DON'T:** Skip the rationale — every amendment must have a documented reason so future readers understand why it changed.
**DON'T:** Apply multiple amendments in a single transaction — each logical change gets its own amendment row for auditability.
**DON'T:** Forget to re-lock the spec — the amendment flow must always end with `spec_locked = true`.
