# /pr-review

**Description:** Review a GitHub pull request end-to-end against the locked SPEC. Dispatches a researcher to fetch PR details and a verifier to check the changes against the validation contract. Presents findings with fix options.
**Category:** Spec Mode

## When to Use
When a PR is ready for review and you want it checked against the spec's acceptance criteria and validation contract, not just a general code review.

## Prerequisites
- A PR URL must be provided as the command argument.
- A SPEC must be locked for the workflow.
- The verifier agent must have access to the PR diff.

## Process
1. Parse the `<pr-url>` from the command args. Validate it matches a GitHub PR URL pattern.
2. Dispatch the `researcher` agent to fetch the PR details:
   - PR title, description, author, changed files, diff.
   - CI status and test results (if available).
   - Review comments already posted.
3. Read the locked SPEC's validation contract via `spec_spec.read({ workflowId, section: "validation-contract" })`.
4. Dispatch the `verifier` agent via `task({ subagent_type: "verifier", contextMode: "none", input: { validationContract, prDiff, prDescription } })`.
5. The verifier checks:
   - Does the PR address every must-have it claims to?
   - Do the changed files match the BLUEPRINT's file scope?
   - Are acceptance criteria satisfied by the changes?
   - Are there regressions (test coverage, breaking changes)?
6. The verifier produces findings with severity classification:
   - **minor:** style/naming issues → auto-fix or comment
   - **moderate:** missing edge case handling → request changes
   - **major:** breaks a must-have → block merge
7. Present findings to the user with suggested fix options:
   - Approve with comments (minor issues only)
   - Request changes (moderate issues)
   - Block merge (major issues)
8. Log the review to ADL: `spec_adl.append({ type: "observation", title: "PR reviewed", body: "PR <url> reviewed. N findings: X minor, Y moderate, Z major." })`.

## Tools Used
- `task` — dispatch researcher and verifier agents
- `spec_spec.read` — read the validation contract
- `spec_adl.append` — log the review decision

## Autopilot Behavior
When `autopilot=true`:
- Run the full review without asking for intermediate confirmations. Present findings at the end.
When `lazyAutopilot=true`:
- Same as autopilot.

## Output
- A structured review report: findings by severity with file paths and line references.
- Fix options (approve / request changes / block) with rationale.
- An ADL entry documenting the review outcome.
- PR comments posted automatically for minor findings (if configured).

## Success Criteria
- [ ] PR diff is fetched and parsed correctly.
- [ ] Every must-have in scope is checked against the PR changes.
- [ ] Findings include specific file paths and line references.
- [ ] The user receives a clear approve/request-changes/block recommendation.

## Anti-Patterns
**DON'T:** Review a PR without reading the locked SPEC — the review must be scoped to the validation contract, not general code quality.
**DON'T:** Post PR comments without user approval — the user should decide which comments to publish.
**DON'T:** Skip the researcher step — the PR diff and metadata must be fetched before the verifier can do its job.
**DON'T:** Mark a finding as "major" without a specific must-have violation — severity must be traceable to a SPEC requirement.
