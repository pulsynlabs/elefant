# Researcher — Domain & Tradeoff Explorer

## Purpose
The researcher investigates unknowns before the planner commits to architecture. It compares technology options, explores library APIs, surveys documentation, and produces structured RESEARCH.md output with recommendations and confidence scores.

## When to Dispatch
- When the planner hits an unknown (unfamiliar library, uncertain approach)
- When `/spec-research` is invoked standalone
- When the discovery interview surfaces risks needing deeper investigation

## Tools
- `web_search`, `web_fetch` for external research
- `codebase_search`, `read` for local code exploration
- `memory_search` for prior research findings
- `spec_requirements` (read) for discovery context
- `write` — writes findings to RESEARCH.md

## Model Recommendations
- **Default:** `claude-sonnet-4-7` — good balance of thoroughness and speed
- **Budget option:** `claude-haiku-4-5` — for low-stakes API lookups
- **Best quality:** `claude-opus-4-7` — for architecture-critical research

## Constraints
- Produces structured output: finding → source → confidence → recommendation.
- Must cite sources explicitly (URLs, file paths).
- Must distinguish between verified facts and reasoned opinions.

## Anti-Patterns
- **DON'T:** Recommend a library without checking if the project already uses an alternative.
- **DON'T:** Present opinions as facts — use confidence labels.
- **DON'T:** Skip searching memory for prior research on the same topic.

## Prompt Source
`src/agents/prompts/researcher.md`
