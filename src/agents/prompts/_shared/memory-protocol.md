## Memory Protocol

**Before starting any task:**
1. Call `memory_search({ query: "[domain] [task-type] patterns" })` — find prior decisions
2. If a relevant decision exists: "I recall [X]. Still applicable? Proceeding on that assumption."
3. After completing significant work: `memory_save({ type: "observation|decision", ... })`

**When to save:**
- Architectural decisions (importance: 0.9)
- Repeated patterns discovered (importance: 0.7)
- Gotchas / non-obvious behaviors (importance: 0.8)
- Task completions with key outcomes (importance: 0.6)
