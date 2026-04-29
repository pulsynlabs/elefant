# /spec-research

**Description:** Launch focused research on a domain, technology, or approach question — standalone, without starting a full workflow.

## Usage
```
/spec-research <research question>
```

## Prerequisites
- None — runs independently of any workflow
- Helpful before `/spec-plan` when the domain is unfamiliar

## What It Does
1. Dispatches `goop-researcher` agent
2. Researcher searches web, documentation, and internal memory
3. Produces structured RESEARCH.md with: findings, sources, confidence scores, recommendations
4. Saves findings to memory with concept tags for future recall
5. Outputs a summary in chat

## Autopilot Behavior
- No autopilot-specific behavior — research is always user-initiated

## Example
```
/spec-research What ORM works best with Bun and SQLite for a type-safe API?
/spec-research Compare SSE vs WebSocket for real-time agent status updates
```

## Anti-Patterns
- **DON'T:** Skip memory_search before external research — the answer may already be in the knowledge base.
- **DON'T:** Accept a recommendation without checking the source confidence score.
