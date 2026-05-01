# /audit

**Description:** Dispatch the verifier agent in a fresh context against the locked SPEC's validation contract. Routes failures by severity.
**Category:** Spec Mode

## When to Use
After all waves of `/execute` are complete. This is the quality gate before acceptance.

## Prerequisites
- All waves must be complete (`currentWave === totalWaves`).
- SPEC must be locked.
- CHRONICLE must contain the list of files changed during execution.

## Process
1. Read the locked SPEC's full validation contract (all per-MH VCs + aggregate AVCs) via `spec_spec({ action: "read", workflowId })` — pull every VC entry, not just the per-MH ones.
2. Read the list of changed files from CHRONICLE via `spec_chronicle({ action: "read", workflowId, kind: "task_completed" })` and extract file paths from each entry payload.
3. Dispatch the `verifier` agent via `task({ subagent_type: "verifier", contextMode: "none", input: { validationContract, changedFiles, perMhAcceptanceCriteria } })`. The `contextMode: "none"` is critical — the verifier must not inherit executor reasoning.
4. Parse the verifier's response envelope. The `<verification>` block contains JSON matching `AuditReportSchema` from `src/tools/workflow/verifier-output.ts` — `{ workflowId, auditedAt, results: [{ vcId, status, evidence, severity?, recommendation? }], summary, recommendation }`.
5. Persist the parsed report as a `spec_chronicle_entries` row with `kind: "audit_report"` and `payload: { auditReport }`.
6. Route by `recommendation` (computed by `classifyAuditFailures` in `src/server/audit-router.ts`):
   - **`minor-fix`:** Dispatch `executor-medium` to patch the failing VCs. Re-run `/audit` after the patch lands.
   - **`moderate-fix`:** Dispatch `planner` to amend the SPEC/BLUEPRINT. Re-run `/audit` after amendment.
   - **`accept`:** All VCs pass. Log to CHRONICLE and progress to `/accept`.
7. If any result is `partial`, treat it as moderate at minimum; require explicit user confirmation before continuing.

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
- On full pass, immediately invoke `/accept`.

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
