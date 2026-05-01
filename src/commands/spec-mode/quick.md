# /quick

**Description:** Fast-track a small task through the full Spec Mode pipeline. Sets lazy autopilot, infers requirements from the initial prompt, and runs the full discuss → plan → execute → audit chain, pausing only at the final accept gate.
**Category:** Spec Mode

## When to Use
For small, well-defined tasks that don't need a formal discovery interview. The command infers everything from the task description and runs the full pipeline with zero intermediate questions.

## Prerequisites
- The task description must be clear enough for the planner to infer must-haves without asking.
- A project must be open.

## Process
1. Set lazy autopilot mode on the workflow: `spec_state({ action: "set-autopilot", autopilot: true, lazy: true })`.
2. Create a new workflow or reuse the active one.
3. Seed REQUIREMENTS directly from the `<task description>` argument without running the discovery interview:
   - Extract the vision from the task description.
   - Infer must-haves (at least one, derived from the description).
   - Set reasonable defaults for constraints, assumptions, and risks.
   - Mark out-of-scope as "inferred — review at accept gate."
4. Write REQUIREMENTS via `spec_requirements.write`.
5. Call `spec_state({ action: "complete-interview" })`.
6. Invoke the `/plan` flow (see `plan.md`). The planner reads the inferred REQUIREMENTS and produces SPEC + BLUEPRINT.
7. Invoke the `/execute` flow (see `execute.md`). Auto-progress through all waves.
8. Invoke the `/audit` flow (see `audit.md`). Auto-route minor failures; halt on major.
9. Pause at the accept gate — show the user the inferred REQUIREMENTS, the completed work summary, and ask for explicit confirmation.
10. On user acceptance, call `spec_state({ action: "confirm-acceptance" })`.

## Tools Used
- `spec_state.set-autopilot` — enable lazy autopilot
- `spec_requirements.write` — seed inferred requirements
- `spec_state.complete-interview` — mark interview complete
- All tools from `/plan`, `/execute`, `/audit`, `/accept`

## Autopilot Behavior
This command IS the lazy autopilot path. It explicitly sets `lazyAutopilot=true` and chains through the full pipeline with:
- No `question` tool invocations (the tool is filtered out of the agent registry).
- Auto-progression at every phase boundary.
- Pause only at the final accept gate.

## Output
- A complete workflow run: REQUIREMENTS, SPEC, BLUEPRINT, CHRONICLE, and audit results.
- All waves and tasks completed (or blocked with documented reasons).
- Paused at accept gate for user confirmation.

## Success Criteria
- [ ] Zero `question` tool invocations recorded in the run trace (AVC6).
- [ ] Full phase sequence recorded in CHRONICLE: discuss → plan → specify → execute → audit → pause:accept.
- [ ] Inferred REQUIREMENTS are presented at the accept gate for user review.
- [ ] The user can accept or reject at the final gate.

## Anti-Patterns
**DON'T:** Use `/quick` for complex multi-wave features — the inference will miss important requirements. Reserve it for tasks that fit in a single wave.
**DON'T:** Skip the accept gate — even in lazy mode, the user must confirm before the workflow closes.
**DON'T:** Ask the user questions during the run — the whole point of lazy autopilot is zero-interaction execution.
**DON'T:** Proceed past the accept gate without showing the inferred REQUIREMENTS — misinference must be catchable.
