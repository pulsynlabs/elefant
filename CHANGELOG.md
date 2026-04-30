# Changelog

## Unreleased

### Added

#### MCP Tool Support

- Added daemon-side MCP tool support for stdio, SSE, and StreamableHTTP servers.
- Added MCP server management routes, registry browsing, and a desktop Settings tab for configuring servers and pinned tools.
- Added selective MCP tool loading with a searchable meta-tool to keep first-turn tool schemas compact for large server sets.

#### Daemon & Desktop QoL Sprint (6 Must-Haves)

**MH1: Permission Hook Veto Semantics**
- Added `permission:ask` hook with `allow | ask | deny` status support
- Hooks can now force-allow or force-deny permission requests without user prompts
- Added rich context fields: `sessionId`, `projectId`, `agent`, `conversationId`
- Added SSE lifecycle events: `permission.asked` and `permission.resolved`
- First-registered hook wins for status decisions

**MH2: System Transform Context Injection**
- Added `system:transform` hook for ephemeral per-request message transformation
- Hook fires before each provider call without persisting to conversation history
- Supports token budget enforcement with automatic clamping
- Block builders exposed as `createCompactionBlockTransform` preset
- mtime-based file caching for performance

**MH3: Sub-Agent Runs with Async Execution**
- Added `agent_runs` table for tracking background agent executions
- New `RunRegistry` manages per-run `AbortController` instances
- Context modes: `none`, `inherit_session`, `snapshot`
- SSE event envelope with `runId`, `parentRunId`, `agentType` multiplexing
- REST endpoints: spawn, list, get, cancel
- Desktop UI: `AgentRunTabs`, `AgentRunTree`, `AgentRunTranscript` components

**MH4: Agent Configuration & Limits**
- Layered config system: global → project → per-run override
- `ConfigManager.resolve()` merges profiles with precedence
- Agent profiles with provider/model, limits, tool policy, and behavior settings
- REST endpoints: `GET/PUT/POST/DELETE /api/config/agents/:agentId`
- Desktop UI: `AgentProfilesView`, `AgentProfileCard`, `AgentLimitsForm`, `ToolPolicyEditor`, `AgentOverrideDialog`
- Fixed `maxTokens`, `temperature`, `topP`, `timeoutMs` plumbing through to provider

**MH5: Git Worktree Management**
- New `src/worktree/` module with subprocess wrapper using `Bun.spawn`
- Parsed `git worktree list --porcelain` and `git status --porcelain` output
- Structured error mapping: `worktree_exists`, `branch_exists`, `path_conflict`, `dirty_worktree`, `not_a_repo`, `git_unavailable`
- REST endpoints: list, create, delete, prune
- Tauri commands: `open_terminal_at_path`, `reveal_in_file_manager`
- Desktop UI: `WorktreeListPanel`, `WorktreeRow`, `WorktreeSwitcher`, dialogs

**MH6: Markdown Rendering**
- New `MarkdownRenderer.svelte` component using `@humanspeak/svelte-markdown`
- Shiki-highlighted code blocks via existing `CodeBlock.svelte`
- Streaming-safe open-fence detection with progressive rendering
- URL protocol allowlist: `http`, `https`, `mailto` only
- Security: `rel="noopener noreferrer"`, `target="_blank"`, raw HTML disabled
- Render throttle ≤ 16ms during streaming

### Changed

- Updated `src/index.ts` to export new modules: `ConfigManager`, `RunRegistry`, `AgentRun`, `Worktree`, etc.
- Added new hook events to `HOOK_EVENT_NAMES` registry
- Extended `docs/hooks.md` with complete hook documentation

### Fixed

- Fixed route parameter naming conflict in worktree routes (`:projectId` → `:id`)
- Added config routes mounting in `src/server/app.ts`

