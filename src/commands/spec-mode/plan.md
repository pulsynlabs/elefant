# /plan

**Description:** Create a locked SPEC and executable BLUEPRINT from the REQUIREMENTS document.
**Category:** Spec Mode

## When to Use
After `/discuss` has produced a confirmed REQUIREMENTS document. This command transforms requirements into a formal specification contract and a task-level execution plan.

## Prerequisites
- REQUIREMENTS must exist and `spec_workflows.interview_complete` must be `true`.
- The workflow must not already have a locked SPEC (unless amending).

## Process
1. Read the REQUIREMENTS document via `spec_requirements.read({ workflowId })`.
2. Run `memory_search({ query: "<workflow topic> patterns conventions" })` to surface relevant prior decisions.
3. Dispatch the `planner` agent via `task({ subagent_type: "planner", ... })`. The planner:
   - Extracts must-haves with traceable IDs (MH1, MH2…).
   - Writes acceptance criteria and validation contract assertions for each must-have.
   - Decomposes the work into waves and tasks in a BLUEPRINT with per-task executor tier, files, and done criteria.
   - Produces a wave sequencing diagram showing the critical path.
4. Write the SPEC via `spec_spec.write({ workflowId, content })`.
5. Write the BLUEPRINT via `spec_blueprint.write({ workflowId, content })`.
6. Present a **Contract Gate** to the user — show the must-have list with acceptance criteria and ask for explicit confirmation.
7. On user confirmation, call `spec_spec.lock({ workflowId })` which validates that every must-have has at least one validation contract entry.
8. Log the lock event to CHRONICLE.

## Tools Used
- `spec_requirements.read` — read the requirements
- `spec_spec.write` — persist the specification
- `spec_spec.lock` — lock the specification contract
- `spec_blueprint.write` — persist the execution blueprint
- `memory_search` — surface prior decisions and patterns
- `task` — dispatch the planner subagent

## Autopilot Behavior
When `autopilot=true`:
- Run the full planning flow without pausing at the contract gate. The SPEC is automatically locked.
When `lazyAutopilot=true`:
- Immediately invoke `/execute` after SPEC lock.

## Output
- A locked SPEC document with must-haves, acceptance criteria, and validation contracts.
- A BLUEPRINT with waves and tasks, each with executor assignment and done criteria.
- `spec_workflows.spec_locked` set to `true`.

## Success Criteria
- [ ] SPEC contains at least one must-have with a traceable ID (MH1, MH2…).
- [ ] Every must-have has at least one acceptance criterion and one validation contract assertion.
- [ ] BLUEPRINT contains at least one wave with at least one task.
- [ ] `spec_workflows.spec_locked` is `1` after the contract gate confirms.
- [ ] SPEC lock writes a `spec:locked` event and a CHRONICLE entry.

## Anti-Patterns
**DON'T:** Lock the spec before the user has reviewed the must-have list — the contract gate is the last human check before implementation starts.
**DON'T:** Write BLUEPRINT tasks without explicit executor tier assignments — the orchestrator needs to know which agent to dispatch.
**DON'T:** Skip the `memory_search` call — prior decisions on similar features can prevent re-litigating settled tradeoffs.
**DON'T:** Accept a must-have without at least one acceptance criterion — the verifier later needs concrete pass/fail conditions.
