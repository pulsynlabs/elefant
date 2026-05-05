---
id: agents-md-system
title: AGENTS.md System
description: How Elefant loads, injects, and maintains AGENTS.md context files — loading algorithm, write guard, Writer invocation, per-project toggle, and file format guidance.
tags:
  - instruction
  - agents-md
  - context-loading
  - writer
audience:
  - orchestrator
  - writer
  - executor
version: 1.0.0
---

# AGENTS.md System

Elefant's hierarchical instruction-file system for injecting project-specific context into agent sessions.

## Loading Algorithm

Root AGENTS.md loads at session start via the `pkb-context-transform` hook, which calls `instruction.resolveRoot()` and injects `Instructions from: {path}\n{content}` into `ctx.system`.

Lazy loading triggers when file tools (read/write/edit/apply_patch) touch a file. `applyInstructionGuard` walks up from the file's directory to project root, discovering AGENTS.md/CLAUDE.md files not yet in `alreadyLoaded`. Newly-found files append `<system-reminder>\n{content}\n</system-reminder>` to tool output.

Deduplication uses `alreadyLoaded: Set<string>` (per run, shared across all tool calls) to prevent re-injection. An mtime-keyed in-memory Map caches content; `invalidate(path)` clears one entry after write-back. Files are capped at 32KiB (Codex-aligned). CLAUDE.md serves as fallback if no AGENTS.md exists.

**Code pointer:** `src/instruction/resolver.ts`, `src/instruction/loader.ts`, `src/instruction/guard.ts`

## Write Guard

The guard wraps four file tools: `createReadTool`, `createWriteTool`, `createEditTool`, and `createApplyPatchTool`. When a tool operates on a file, the guard checks for instruction files in the ancestry and appends `<system-reminder>\nInstructions from: {path}\n{content}\n</system-reminder>` to the tool output.

The format is byte-for-byte compatible with OpenCode's read tool format. The guard is read-only — it never blocks or modifies the underlying file operation, only enriches the output with context.

**Code pointer:** `src/instruction/guard.ts`, `src/tools/registry.ts` (`createToolRegistryForRun`)

## Writer Invocation

The Writer subagent triggers in two modes: `/init` command (mode: `"init"`) or `spec:acceptance_confirmed` event (mode: `"update"`). The writer receives `{ projectRoot, codebaseDigest, priorContent, mode }` from `analyzeCodebase()`, plus optional `chronicleSummary` for update mode.

Output is capped at ≤200 lines (Claude Code-aligned). If exceeded, a WARNING suffix appears on tool output. Update semantics require the writer to refresh existing content, remove stale commands, and add new anti-patterns derived from the chronicle.

**Code pointer:** `src/instruction/acceptance-trigger.ts`, `src/agents/prompts/writer.md` (AGENTS.md Authoring section)

## Per-Project Toggle

The `agentsMd.autoUpdate: boolean` config key (default: `true`) gates Writer invocation at workflow acceptance and `/init` execution. Loading (root and lazy) always runs when files exist regardless of this toggle.

Set via project config JSON/YAML. When `false`, the `/init` command short-circuits with: "AGENTS.md auto-update is disabled for this project. Set `agentsMd.autoUpdate: true` to enable."

**Code pointer:** `src/config/schema.ts` (`agentsMdConfigSchema`)

## File Format Guidance

Keep files ≤200 lines. Focus on: commands (build/test/lint), verification steps, and conventions that differ from defaults. Include project-specific anti-patterns with concrete examples.

Exclude: generic descriptions, file trees, vague rules ("write clean code"), and README reproduction. Use root AGENTS.md for repo-wide invariants; subdirectory files for local specialization.

Per [Claude Code guidance](https://docs.anthropic.com/claude-code), concise instruction files outperform verbose ones. Prioritize actionable commands over prose.
