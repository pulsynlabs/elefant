# /accept

**Description:** Final acceptance gate. Presents the completed work summary and requires explicit user confirmation to close the workflow.
**Category:** Spec Mode

## When to Use
After `/audit` has passed all validation contract assertions. This is the final human checkpoint before archiving the workflow.

## Prerequisites
- All waves must be complete.
- The verifier's audit output must be available and all VCs must be in `pass` or `skipped` status.
- No `partial` or `fail` VCs must remain unresolved.
- The user must be present to confirm (this gate never auto-approves).

## Process
1. Read the current workflow state via `spec_status({ workflowId })`.
2. Read the verifier's latest output via `spec_verifier_runs.latestForWorkflow({ workflowId })`.
3. Read the BLUEPRINT summary (waves completed, tasks done) via `spec_blueprint.read({ workflowId, section: "summary" })`.
4. Present the acceptance summary to the user:
   - **Workflow ID and phase**
   - **Must-haves delivered** (count, list of IDs)
   - **Waves completed** (N/N)
   - **Tasks completed vs blocked**
   - **Audit result** (pass/fail/partial counts)
   - **Files changed** (from CHRONICLE)
5. Ask for explicit confirmation: "Accept this work? Type 'accept' to confirm."
6. On user confirmation:
   - Call `spec_state({ action: "confirm-acceptance" })`.
   - Write a CHRONICLE entry: `{ kind: "workflow_accepted" }`.
   - Run the memory distillation hook (ADL → memory observations).
   - Generate a RETROSPECTIVE and LEARNINGS markdown.
7. Mark the workflow status as `done`.

## Tools Used
- `spec_status` — read workflow state
- `spec_verifier_runs.latestForWorkflow` — read audit results
- `spec_blueprint.read` — read task summary
- `spec_state.confirm-acceptance` — finalize the workflow
- `spec_chronicle.append` — log acceptance
- `spec_adl.append` — log acceptance decisions

## Autopilot Behavior
The accept gate **never auto-approves**, regardless of `autopilot` or `lazyAutopilot` settings. This is the one human confirmation point that always requires explicit user input.

## Output
- `spec_workflows.acceptance_confirmed` set to `true`.
- `spec_workflows.status` set to `done`.
- A CHRONICLE entry recording acceptance.
- RETROSPECTIVE and LEARNINGS documents generated.

## Success Criteria
- [ ] User explicitly confirms acceptance (typed "accept" or clicked confirm).
- [ ] `acceptance_confirmed` is `1` in the database.
- [ ] Workflow status transitions to `done`.
- [ ] CHRONICLE has a `workflow_accepted` entry.
- [ ] Memory distillation hook fires and creates observations from ADL entries.

## Anti-Patterns
**DON'T:** Auto-accept under any autopilot mode — this gate is always manual.
**DON'T:** Accept a workflow with unresolved `partial` VCs — the audit must be fully clean before acceptance.
**DON'T:** Skip the user-facing summary — the user needs to see what they're accepting before confirming.
**DON'T:** Accept without checking the latest verifier run — stale audit results could mask regressions.
