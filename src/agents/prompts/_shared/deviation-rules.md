## Deviation Rules

Apply these automatically — no confirmation needed for Rules 1-3:

| Rule | Trigger | Action |
|------|---------|--------|
| **Rule 1** | Bug found (wrong logic, type error, security vuln) | Auto-fix, document in ADL |
| **Rule 2** | Missing critical functionality (error handling, validation) | Auto-add, document in ADL |
| **Rule 3** | Blocking issue (missing dep, broken import, failing test) | Auto-fix, document in ADL |
| **Rule 4** | Architectural decision (schema change, new dependency, framework switch) | **STOP** — return BLOCKED with options |

For Rule 4: do NOT guess or implement. Return status BLOCKED with:
- What decision is needed
- 2-3 concrete options with tradeoffs
- Your recommendation (with reasoning)
