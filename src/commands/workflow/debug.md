# /debug

**Description:** Dispatch the debugger agent with a scientific debugging workflow: hypothesis formation, controlled experiments, root cause identification, and fix.
**Category:** Spec Mode

## When to Use
When you have a reproducible bug and want a systematic investigation rather than guesswork. The debugger follows the scientific method.

## Prerequisites
- A reproducible bug description or error trace.
- Access to the affected codebase and test infrastructure.

## Process
1. Gather the bug description from the user: what happened, what was expected, how to reproduce.
2. Dispatch the `debugger` agent via `task({ subagent_type: "debugger", input: { bugDescription, reproSteps, relevantFiles } })`.
3. The debugger agent follows the scientific method:
   a. **Observe:** Read the error trace, logs, and affected code paths.
   b. **Hypothesize:** Form at least one specific hypothesis about the root cause.
   c. **Experiment:** Design and run controlled experiments using `bash` commands (run tests, add logging, inspect state).
   d. **Analyze:** Compare experimental results against the hypothesis. Refine or discard.
   e. **Root Cause:** Identify the specific line(s) of code responsible for the bug.
   f. **Fix:** Propose and apply a minimal fix. Dispatch an `executor-{tier}` for the actual code change.
   g. **Verify:** Run the reproduction steps against the fix to confirm the bug is resolved.
4. The debugger writes its investigation log to CHRONICLE.
5. Present the root cause analysis and fix summary to the user.

## Tools Used
- `task` — dispatch debugger agent
- `bash` — run experiments and verification commands
- `wf_chronicle.append` — log investigation steps

## Autopilot Behavior
When `autopilot=true`:
- The debugger runs the full scientific loop without asking for confirmation at each step. The fix is auto-applied by the executor.
When `lazyAutopilot=true`:
- Same as autopilot: full auto-investigation and auto-fix.

## Output
- Root cause analysis with the specific file and line(s) identified.
- A minimal fix applied to the codebase (via executor dispatch).
- Verification evidence (passing reproduction test).
- CHRONICLE entry with investigation log.

## Success Criteria
- [ ] At least one hypothesis is explicitly stated before experiments begin.
- [ ] Experiments are documented with commands run and results observed.
- [ ] The root cause is traced to a specific code location.
- [ ] The fix is verified by running the original reproduction steps.

## Anti-Patterns
**DON'T:** Jump to a fix without forming a hypothesis — the debugger must state "I think the bug is X because Y" before changing code.
**DON'T:** Run destructive experiments without backing up state — use git branches or worktrees for safe investigation.
**DON'T:** Skip verification — always re-run the reproduction steps after applying the fix.
**DON'T:** Accept "it works now" as evidence — the verification must include the specific reproduction scenario, not just a generic test pass.
