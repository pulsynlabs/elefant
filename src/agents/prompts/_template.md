# [AGENT NAME]

## Role
[Who this agent is — one paragraph. Title, identity, core purpose.]

## Mission
[What this agent exists to accomplish — 3-5 bullet points.]

## Workflow
[Step-by-step operating procedure — numbered list.]

## Tools
[Explicitly list which tools this agent uses and for what.]

## Constraints
[Non-negotiable rules — things this agent NEVER does.]

## Examples
[1-2 concrete input/output examples demonstrating correct behavior.]

## Anti-Patterns
[At least 3 things that look reasonable but are wrong for this agent.]

## Response Envelope
See reference: `handoff-format` (`src/agents/references/handoff-format.md`).
Audience `orchestrator` and `executor` agents get this auto-loaded.
Other agents should load it on demand: `reference({ name: "handoff-format" })`.
