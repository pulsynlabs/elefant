# /init

**Description:** Generate or refresh the project's AGENTS.md context file. Analyzes the codebase and delegates to the Writer subagent.
**Category:** Utility

## When to Use
When you want to create or refresh the project's AGENTS.md instruction file. This command works both inside and outside a Spec Mode workflow. Use it after adding new scripts, changing conventions, or when the existing AGENTS.md is stale.

## Prerequisites
- A project must be open in the Elefant daemon.
- The Writer subagent profile must be enabled.

## Process
1. Read project config and check `agentsMd.autoUpdate`. If `false`, report: "AGENTS.md auto-update is disabled for this project. Set `agentsMd.autoUpdate: true` to enable." and stop.
2. Call `analyzeCodebase(projectRoot)` to produce a structured `CodebaseDigest` JSON with manifest, scripts, stack signals, config files, CI files, and README summary.
3. Read existing `AGENTS.md` (or `CLAUDE.md`) at the project root, if present. This becomes `priorContent`.
4. Delegate to the Writer subagent via `task({ subagent_type: "writer", ... })` with a structured prompt that includes:
   - `mode: "init"`
   - `projectRoot` — absolute project root path
   - `codebaseDigest` — the full `CodebaseDigest` JSON from step 2
   - `priorContent` — existing AGENTS.md content (null if none exists)
5. The Writer creates or updates `AGENTS.md` at `{projectRoot}/AGENTS.md` using the `write` tool, following the authoring guidance in its prompt (≤200 lines, commands + verification + non-default conventions, no generic filler).
6. Return the writer's summary to the user.

## Tools Used
- `read` — read existing AGENTS.md if present
- `task` — delegate to Writer subagent
- `bash` or instruction service — invoke `analyzeCodebase` to produce the codebase digest

## Output
- Updated or created `AGENTS.md` at the project root (≤200 lines, focused on commands, verification, and conventions that differ from defaults).
- Writer's summary of what was written and why.

## Success Criteria
- [ ] If `agentsMd.autoUpdate` is `false`, command short-circuits with a clear message.
- [ ] `analyzeCodebase` completes and produces a valid `CodebaseDigest`.
- [ ] Writer subagent is invoked with the structured prompt (mode, projectRoot, codebaseDigest, priorContent).
- [ ] Writer creates or updates `AGENTS.md` at the project root.
- [ ] Generated file is ≤200 lines and includes build/test/lint/run commands, verification steps, and at least one repo-specific convention or anti-pattern.
- [ ] If a prior `AGENTS.md` exists, the writer preserves still-valid content and removes stale claims.

## Anti-Patterns
**DON'T:** Generate AGENTS.md content inline in the orchestrator — always delegate to the Writer subagent.
**DON'T:** Skip the `agentsMd.autoUpdate` check — the toggle gates the entire command.
**DON'T:** Call the writer without the structured `CodebaseDigest` — the writer needs manifest, scripts, and stack signals to produce accurate content.
**DON'T:** Truncate or pre-filter the prior AGENTS.md content before passing it to the writer — the writer decides what to keep.
