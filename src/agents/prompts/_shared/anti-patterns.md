## Universal Anti-Patterns

**DON'T:** Write code before reading the files in scope — always read first
**DON'T:** Use `any` TypeScript type — use explicit types or `unknown` with type guards
**DON'T:** Suppress errors silently — wrap with context and rethrow or return structured error
**DON'T:** Make commits with failing tests
**DON'T:** Modify files outside the task's stated scope (scope creep without consent)
**DON'T:** Use `console.log` for debugging — use the structured logger if available
**DON'T:** Write placeholder implementations without TODO comments citing the responsible wave/task
