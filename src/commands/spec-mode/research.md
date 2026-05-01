# /research

**Description:** Dispatch the researcher agent on a specific topic. Saves findings to `.goopspec/<workflowId>/research/<topic-slug>.md` and logs the research decision to ADL.
**Category:** Spec Mode

## When to Use
When you need deep domain exploration before planning — technology tradeoffs, library comparisons, architectural patterns, or competitive analysis.

## Prerequisites
- A topic must be provided as the command argument (e.g., `/research "WebSocket vs SSE for real-time events"`).
- A workflow should exist (or a new one is created for the research session).

## Process
1. Parse the `<topic>` from the command args.
2. Generate a topic slug: lowercase, hyphen-separated, max 50 chars.
3. Ensure the research output directory exists: `.goopspec/<workflowId>/research/`.
4. Dispatch the `researcher` agent via `task({ subagent_type: "researcher", input: { topic, outputPath: ".goopspec/<workflowId>/research/<topic-slug>.md" } })`.
5. The researcher agent:
   - Searches for prior related memory via `memory_search`.
   - Explores relevant codebase areas (if applicable).
   - Compares alternatives with pros/cons tables.
   - Documents tradeoffs and provides a recommendation.
   - Writes findings to the output markdown file.
6. Log the research dispatch to ADL: `spec_adl.append({ type: "decision", title: "Research dispatched", body: "Researcher dispatched for topic: <topic>. Output: research/<topic-slug>.md" })`.
7. Present the research summary path to the user: "Research saved to `.goopspec/<workflowId>/research/<topic-slug>.md`."

## Tools Used
- `task` — dispatch researcher agent
- `spec_adl.append` — log the research decision
- `memory_search` — check for prior research on the same topic

## Autopilot Behavior
When `autopilot=true`:
- Research runs without interaction. Results are saved and the workflow continues to the next action.
When `lazyAutopilot=true`:
- Same as autopilot.

## Output
- A research markdown file at `.goopspec/<workflowId>/research/<topic-slug>.md`.
- An ADL entry documenting the research dispatch.
- Research findings are available for injection into future planner contexts.

## Success Criteria
- [ ] Research file exists at the expected path with substantive content.
- [ ] ADL has a research dispatch entry with the topic and output path.
- [ ] Research includes at least one alternatives comparison with pros/cons.
- [ ] A recommendation is stated (or an explicit "no recommendation — tradeoffs documented").

## Anti-Patterns
**DON'T:** Dispatch research without a specific topic — the researcher needs a focused question to produce useful output.
**DON'T:** Skip the ADL entry — research dispatches are decisions that should be traceable.
**DON'T:** Overwrite existing research on the same topic without asking — check for prior files first.
**DON'T:** Use the researcher for codebase mapping — that's what `/map-codebase` and the explorer agent are for.
