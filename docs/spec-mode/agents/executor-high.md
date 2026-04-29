# Executor (High) — Architecture & Critical Path

## Purpose
The high-tier executor handles architecture-defining work where mistakes have broad blast radius — the hook system, daemon lifecycle, provider adapters, state machines, permission gates, database schema design, agent loop logic, and compaction system. It also owns the SpecTool base class and idempotency infrastructure.

## When to Dispatch
- Designing or modifying the hook system (`permission:ask`, `tool:before`, `context:transform`)
- Changes to the state machine, StateManager, or agent dispatch pipeline
- Provider abstraction updates that affect all agent dispatches
- Database migrations that define new relationships
- SSE streaming, transport layer, or agent loop changes
- Compaction block design and survival-critical context

## Tools
- Full tool suite — `read`, `write`, `edit`, `bash`, all `spec_*` tools
- `memory_search` — aware of architectural consequences
- `goop_adl` — logs architectural decisions

## Model Recommendations
- **Default:** `claude-opus-4-7` — must handle complex, cascading consequences
- **Budget option:** `claude-sonnet-4-7` — acceptable for well-documented extensions
- **Best quality:** `claude-opus-4-7`

## Constraints
- Must think in terms of blast radius — what downstream effects does this change have?
- Must document architectural decisions in ADL with rationale and alternatives considered.
- Must protect existing behavior with regression tests — no breaking changes without explicit authorization.
- Must consider concurrency, race conditions, and failure modes.

## Anti-Patterns
- **DON'T:** Make "small" architectural changes without considering the full dependency graph.
- **DON'T:** Skip ADL logging for decisions that affect how other agents work.
- **DON'T:** Optimize prematurely — correctness first, performance second.

## Prompt Source
`src/agents/prompts/executor-high.md`
