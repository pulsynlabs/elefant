# /help

**Description:** List all Spec Mode commands with one-line descriptions, queried from the command discovery API.
**Category:** Spec Mode

## When to Use
When you need to discover available Spec Mode commands or remember their exact triggers and arguments.

## Prerequisites
- The command registry (`COMMANDS_REGISTRY.json`) must exist in the daemon's source tree.

## Process
1. Query the command discovery API: `GET /api/commands?category=spec-mode`.
2. Format the response as a grouped help listing:

```
## Spec Mode Commands

### Workflow Pipeline
- `/discuss [session-name]` — Start discovery interview. Gather requirements, constraints, risks.
- `/plan` — Create SPEC + BLUEPRINT from REQUIREMENTS. Lock spec before execute.
- `/execute` — Begin wave-based implementation. Dispatches executor agents per wave.
- `/audit` — Dispatch verifier in fresh context against validation contract.
- `/accept` — Final acceptance gate. Requires user confirmation.

### State & Navigation
- `/status` — Show current workflow phase, wave progress, spec lock state.
- `/amend` — Propose a change to a locked spec via the amendment flow.
- `/pause` — Save checkpoint and pause. Generates HANDOFF.md.
- `/resume` — Resume from last checkpoint.

### Specialized Agents
- `/quick <task>` — Fast-track a small task. Runs full pipeline in lazy autopilot.
- `/research <topic>` — Dispatch researcher agent on a specific topic.
- `/debug` — Dispatch debugger with scientific debugging workflow.
- `/map-codebase` — Dispatch explorer to map codebase and build knowledge base.
- `/pr-review <pr-url>` — Review a GitHub PR end-to-end with fix options.

### Meta
- `/help` — List all Spec Mode commands with descriptions (this command).

Type any command to start, e.g., `/discuss my-feature`.
```

3. If the API is unavailable, fall back to reading `COMMANDS_REGISTRY.json` directly from the daemon's source tree.

## Tools Used
- `GET /api/commands` — query command metadata (fallback: direct file read)
- `COMMANDS_REGISTRY.json` — source of truth for command definitions

## Autopilot Behavior
No autopilot continuation — this is a read-only help command.

## Output
A formatted listing of all 15 commands with descriptions, grouped by category.

## Success Criteria
- [ ] All 15 command names are listed with their descriptions.
- [ ] Commands are grouped into logical categories (Workflow Pipeline, State & Navigation, Specialized Agents, Meta).
- [ ] Argument placeholders (e.g., `<task>`, `<pr-url>`) are shown where applicable.

## Anti-Patterns
**DON'T:** Hard-code the command list — always query the API or registry so new commands are automatically included.
**DON'T:** Show internal tool names or DB field names — this is a user-facing help listing.
**DON'T:** Omit commands that are in the registry — even auxiliary commands deserve a line.
**DON'T:** Use emojis in the command listing — keep it readable in terminal and GUI chat.
