# /discuss

**Description:** Start a discovery interview to gather requirements, constraints, risks, and out-of-scope items for a new workflow.
**Category:** Spec Mode

## When to Use
When starting a new Spec Mode workflow and you need to capture the user's vision before planning. This is the entry point for the full pipeline.

## Prerequisites
- A project must be open in the Elefant daemon.
- No existing workflow with the same ID for this project.

## Process
1. Call `spec_state({ action: "get" })` — if `interviewComplete` is already `true`, ask the user whether to start fresh (reset) or resume the existing interview.
2. Ask the user 6 discovery questions via the `question` tool:
   - **Vision:** What should this feature accomplish? One-sentence statement.
   - **Must-Haves:** What are the non-negotiable requirements? List them.
   - **Constraints:** Technical, practical, or organizational constraints.
   - **Out of Scope:** What should explicitly NOT be built in this phase?
   - **Assumptions:** What are you assuming is true? Identify at least 3 and their consequences if false.
   - **Risks:** What could go wrong? Rate impact and likelihood for each.
3. Synthesize answers into a structured REQUIREMENTS document with: Vision Statement, Must-Haves (with acceptance criteria), Out of Scope, Constraints, Assumptions (table with "If False" column), Risks (table with Impact/Likelihood/Mitigation).
4. Write the document via `spec_requirements.write({ workflowId, content })`.
5. Call `spec_state({ action: "complete-interview" })`.
6. Present the synthesized REQUIREMENTS to the user for confirmation.
7. **Memory protocol:** Save discovery to memory so subsequent workflows on this project surface it via `memory_search`. Call `memory_save({ type: "note", title: "Discovery: <workflowId>", importance: 7, concepts: ["spec-mode", "<workflowId>", "discovery"], content: "<vision> | Must-haves: <mh-titles> | Out of scope: <oos> | Risks: <risk-titles>" })`. The exact structured payload is built by `onDiscoveryComplete` in `src/state/spec-memory-hooks.ts`; agents should call `memory_save` directly with that envelope when running outside the daemon hook path.

## Tools Used
- `spec_state` — read current state, complete interview
- `spec_requirements.write` — persist the REQUIREMENTS document
- `question` — ask discovery questions (disabled in lazy autopilot)

## Autopilot Behavior
When `autopilot=true` or `lazyAutopilot=true`:
- In **Autopilot:** Ask discovery questions but auto-finalize at the end without per-answer confirmation. Pause at the REQUIREMENTS summary gate.
- In **Lazy Autopilot:** Skip the question tool entirely. Infer requirements from the initial prompt that triggered the workflow. Immediately invoke `/plan` after interview completion.

## Output
- A populated REQUIREMENTS document in `.goopspec/<workflowId>/REQUIREMENTS.md` (rendered from DB).
- `spec_workflows.interviewComplete` set to `true`.
- A CHRONICLE entry recording the discovery session.

## Success Criteria
- [ ] All 6 discovery areas are addressed in REQUIREMENTS (vision, must-haves, constraints, OOS, assumptions, risks).
- [ ] `spec_workflows.interview_complete` is `1` after completion.
- [ ] REQUIREMENTS document is readable as standalone markdown.
- [ ] Autopilot mode proceeds to `/plan` without manual intervention.

## Anti-Patterns
**DON'T:** Start planning before the interview is complete — the planner needs REQUIREMENTS as input.
**DON'T:** Accept vague must-haves ("make it good") — push for measurable acceptance criteria.
**DON'T:** Skip the "If False" column on assumptions — this is what turns assumptions into risk mitigations.
**DON'T:** Overwhelm the user with more than 1 question at a time — use the question tool with single-question payloads.
