# Changelog

## Unreleased

### Breaking Changes

- **Field Notes rebrand**: The Research Base subsystem has been renamed to **Field Notes** across the entire codebase.
  - Agent tools: `research_search`, `research_grep`, `research_read`, `research_write`, `research_index` → `field_notes_search`, `field_notes_grep`, `field_notes_read`, `field_notes_write`, `field_notes_index`
  - URI scheme: `research://` → `fieldnotes://`
  - HTTP API: `/v1/research/*` → `/v1/fieldnotes/*`
  - On-disk path: `.elefant/markdown-db/` → `.elefant/field-notes/`, `research-index.sqlite` → `field-notes-index.sqlite`
  - UI: "Research" sidebar label → "Field Notes"; settings tab → "Field Notes"
  - Agent reference files renamed: `research-base-workflow.md` → `field-notes-workflow.md`, etc.

### Added

#### LSP Deep Integration

- Agents now receive **live LSP diagnostic feedback** after every `write` or `edit` tool call. Type errors, undefined references, and other language-server diagnostics appear directly in the tool result — agents self-correct without human intervention.
- Added **`lsp_diagnostics` tool** — agents can explicitly query all current diagnostics across the workspace, with optional `filePath` and `severity` filters (`error | warning | information | hint | all`).
- Added **language-agnostic LSP server registry** (`src/lsp/servers.ts`) supporting 10 built-in language servers: TypeScript/JavaScript, Python (pyright + pylsp), Go (gopls), Rust (rust-analyzer), CSS, HTML, JSON, YAML, and Markdown. Servers spawn lazily and degrade gracefully when binaries are missing.
- Added `textDocument/didChange` and `textDocument/didSave` notifications so language servers always see the file content agents just wrote, not stale disk state.
- Added **LSP diagnostic squiggles** in the desktop diff viewer — the `EditToolCard` and `WriteToolCard` now show inline error/warning markers in CodeMirror's modified pane via `@codemirror/lint`.
- Retired `ELEFANT_EXPERIMENTAL_LSP` feature flag — LSP is now always-on for all supported languages.

#### Research Base System

- Added per-project **Research Base** at `.elefant/markdown-db/` — a structured, versionable, agent-curated knowledge garden for long-form findings, comparisons, and reference notes.
- Added bundled vector index: **SQLite + `sqlite-vec`** at `.elefant/research-index.sqlite` with zero-config setup.
- Added default embedder: **`bundled-cpu`** — `Xenova/all-MiniLM-L6-v2` (384-dim) via `@xenova/transformers`, running on CPU with WebGPU acceleration where available.
- Added hardware auto-scaling: profiles host machine (RAM, GPU, NPU) on first run and recommends embedding tier (`bundled-cpu`, `bundled-gpu`, `bundled-large`).
- Added 10 configurable embedding providers: `bundled-cpu`, `bundled-gpu`, `bundled-large`, `ollama`, `lm-studio`, `vllm`, `openai`, `openai-compatible`, `google`, `disabled` (keyword-only).
- Added provider switching: non-destructive, preserves source files and chunks, rebuilds index in background with progress events.
- Added **5 new agent tools**: `research_search` (hybrid semantic/keyword RRF), `research_grep` (ripgrep scoped to Research Base), `research_read` (by id/path/`research://` link), `research_write` (enforces frontmatter schema), `research_index` (list/browse by section/tag/recency).
- Added YAML frontmatter schema: `id`, `title`, `section`, `tags`, `sources`, `confidence`, `created`, `updated`, `author_agent`, `workflow`, `summary` — auto-filled and validated by `research_write`.
- Added daemon REST/SSE/WS API: `/v1/research/{tree,file,search,status,reindex,index/progress,open-in-editor}` with WebSocket events for indexing progress and provider changes.
- Added **Desktop Research View** — two-pane sidebar (tree + reader) with read-only markdown rendering, TOC, syntax highlighting, "Open in editor" escape hatch, and frontmatter pill-bar.
- Added mobile responsiveness: Research View drawer at ≤640px, keyboard navigation (`j`/`k` navigate, `/` search, `g r` focus reader, `Escape` close).
- Added **Settings → Research Base** tab: provider configuration, hardware tier indicator, enable/disable toggle, reindex button, last-indexed timestamp, editor override, "open in OS file manager".
- Added `research://` URI scheme for deep-linking: `research://<workflow>/<section>/<filename>.md[#anchor]` renders as clickable chips in chat output.
- Added file watcher on `.elefant/markdown-db/` per active project; debounced 500 ms incremental re-index.
- Added markdown-aware chunking: H2/H3 boundaries, ≤512 tokens, 1-sentence overlap; frontmatter is metadata, never embedded as content.
- Added index health endpoint: reports total docs, total chunks, last-indexed timestamp, embedding provider, drift count, disk size.
- Added fallback to ripgrep + BM25-style scoring when vector index is disabled; search degrades gracefully.
- Added migration helper: `scripts/migrate-markdown-db.ts` rewrites in-repo references from legacy `markdown-db/` to `.elefant/markdown-db/`; legacy Elefant-monorepo seed kept as soft-alias.
- Added **ADR-0006**: documents sqlite-vec + transformers.js as defaults; rationale for rejected alternatives (LanceDB, Qdrant, Chroma, FAISS); fallback strategies.
- Added updated agent prompts: researcher, writer, and librarian agents now write to and cite from the Research Base; shared snippet `_shared/research-base-protocol.md` included in all three.
- Added privacy guarantees: zero outbound traffic in `bundled-*` and `disabled` modes; remote providers gated behind explicit warning in Settings.
- Added cross-platform support: macOS, Linux, Windows; Linux is primary CI target; Windows path handling explicitly tested.

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

