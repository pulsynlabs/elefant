# /spec-audit

**Description:** Dispatch the verifier agent in a fresh context against the locked SPEC's validation contract. Routes failures by severity.
**Category:** Spec Mode

## When to Use
After all waves of `/spec-execute` are complete. This is the quality gate before acceptance.

## Prerequisites
- All waves must be complete (`currentWave === totalWaves`).
- SPEC must be locked.
- CHRONICLE must contain the list of files changed during execution.

## Process
1. Read the locked SPEC's full validation contract (all per-MH VCs + aggregate AVCs) via `spec_spec.read({ workflowId, section: "validation-contract" })`.
2. Read the list of changed files from CHRONICLE via `spec_chronicle.read({ workflowId, kind: "file_modified" })`.
3. Dispatch the `verifier` agent via `task({ subagent_type: "verifier", contextMode: "none", input: { validationContract, changedFiles } })`. The `contextMode: "none"` is critical — the verifier must not inherit executor reasoning.
4. The verifier produces structured output: `{ results: Array<{ id, status: "pass"|"fail"|"partial"|"skipped", evidence, severity? }>, summary }`.
5. Route the results by severity:
   - **minor failures:** Dispatch `executor-medium` to patch. Re-run audit after patch.
   - **moderate failures:** Dispatch `planner` to amend the SPEC/BLUEPRINT. Re-run audit after amendment.
   - **major failures:** HALT. Surface to user via `permission:ask`. Do NOT auto-remediate.
   - **partial VCs:** HALT. Require user judgement.
6. If all VCs pass, write the verifier output to the `verifier_runs` table and log to CHRONICLE.

## Tools Used
- `spec_spec.read` — read the validation contract
- `spec_chronicle.read` — gather changed-files list
- `task` — dispatch verifier agent (fresh context)
- `permission:ask` — halt on major/partial failures
- `spec_chronicle.append` — log audit outcome
- `spec_adl.append` — log audit routing decisions

## Autopilot Behavior
When `autopilot=true`:
- Auto-route minor and moderate failures to remediation. Only pause on major failures or partial VCs.
When `lazyAutopilot=true`:
- On full pass, immediately invoke `/spec-accept`.

## Output
- A `verifier_runs` row with per-VC results and evidence.
- A structured audit summary in CHRONICLE.
- If failures exist, a routing decision (patch / amend / halt).

## Success Criteria
- [ ] Verifier is dispatched with `contextMode: "none"` (fresh context — observable in `agent_runs.context_mode`).
- [ ] Every VC in the validation contract has a result with evidence.
- [ ] Major failures halt the workflow and notify the user.
- [ ] A passing audit gates the workflow toward acceptance.

## Anti-Patterns
**DON'T:** Dispatch the verifier with `contextMode: "inherit_session"` — the verifier must not see executor reasoning traces (fresh context only).
**DON'T:** Auto-accept after a failed audit — even minor failures must route through remediation before acceptance.
**DON'T:** Skip the `evidence` field on verifier results — a "pass" without evidence is meaningless.
**DON'T:** Mark a VC as "skipped" without a documented reason in CHRONICLE.
