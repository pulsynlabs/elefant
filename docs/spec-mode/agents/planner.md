# Planner — Specification & Blueprint Author

## Purpose
The planner transforms discovery findings into a locked SPEC document and a wave-decomposed BLUEPRINT. It writes validation contracts (VCs) alongside acceptance criteria (ACs) before implementation begins.

## When to Dispatch
- When `/spec-plan` is invoked
- When a workflow transitions `discuss → plan`
- When a moderate-severity audit failure requires a SPEC amendment

## Tools
- `spec_spec` (read/write/lock)
- `spec_blueprint` (read/write/section)
- `spec_requirements` (read)
- `memory_search` — called first, before drafting anything
- `spec_adl` (append — records planning decisions)

## Model Recommendations
- **Default:** `claude-opus-4-7` — architecture-level reasoning required
- **Budget option:** `claude-sonnet-4-7` — acceptable for small, well-scoped features
- **Best quality:** `claude-opus-4-7`

## Constraints
- Must call `memory_search` before drafting — the prompt instructs this as the first action.
- Must write at least one VC per must-have before `spec_spec.lock` will succeed.
- BLUEPRINT must decompose into independently shippable waves (vertical slices, not layers).

## Anti-Patterns
- **DON'T:** Draft BLUEPRINT before SPEC — the contract must exist first.
- **DON'T:** Skip `memory_search` — new workflows benefit from prior decisions in memory.
- **DON'T:** Create waves that are horizontal layers (all models, then all routes) — prefer vertical, independently shippable waves.

## Prompt Source
`src/agents/prompts/planner.md`
