# Elefant

Elefant is an early-stage coding agent platform. No code has been written yet. This repository is currently in the research and design phase.

---

## What's in This Repo

```
elefant/
├── AGENTS.md              ← You are here
├── markdown-db/           ← Research database (see below)
└── .references/           ← Cloned source repos used for research (see below)
    ├── opencode-dev/
    ├── goopspec/
    ├── get-shit-done-main/
    ├── claude-code-source/
    ├── codex-main/
    └── pi-mono-main/
```

---

## Provider System

Elefant supports three provider formats:
- `openai` — OpenAI-compatible API (Groq, Together AI, Fireworks, Perplexity, etc.)
- `anthropic` — Canonical Anthropic API (sends `anthropic-version` header)
- `anthropic-compatible` — Any Anthropic-compatible API without Anthropic-specific headers

### Regenerating the Provider Registry

The provider registry (`src/providers/registry/generated.ts`) is generated from models.dev TOML data:

```bash
bun run gen:registry
```

This reads `.references/models.dev-dev/providers/` and generates 100+ provider entries with metadata and icons.

---

## Reference Repos

`.references/` contains cloned source repositories used as primary research material. These are read-only inputs — do not modify them.

**`opencode-dev/`** — OpenCode (anomalyco/opencode). Open-source AI coding agent built by the SST/Anomaly team. MIT licensed. The most relevant reference for understanding how a production coding agent daemon is structured: Bun runtime, Effect-TS service composition, Hono HTTP server, plugin hook system, permission model, MCP integration, and provider abstraction. This is the agent runtime Elefant currently plans to sit on top of as a plugin.

**`goopspec/`** — GoopSpec. An OpenCode plugin that enforces spec-driven development workflows. The creator's own prior work. The most relevant reference for Elefant's harness design: behavioral enforcement via `permission.ask` hook blocking, `experimental.chat.system.transform` for context injection, markdown-as-state file chain (SPEC.md → BLUEPRINT.md → CHRONICLE.md), multi-workflow state machine, memory worker, and the slash command / agent delegation system.

**`get-shit-done-main/`** — GSD (Get Shit Done). A meta-prompting and spec-driven development system that installs prompt files and hooks on top of multiple agent runtimes (Claude Code, OpenCode, Codex, Cursor, and others). Relevant for understanding the meta-harness pattern: what you can achieve purely through prompts and lightweight hooks without owning the runtime, and where that approach hits its limits.

**`claude-code-source/`** — Claude Code source, recovered from the source map bundled in the `@anthropic-ai/claude-code` npm package (not an official Anthropic release). Relevant for understanding how a closed-source production agent runtime is structured: sub-agent system, hook events, permission modes, CLAUDE.md hierarchy, Agent Teams, and the edit format.

**`codex-main/`** — OpenAI Codex CLI. Open-source coding agent with a Rust core (`codex-rs`) and TypeScript CLI (`codex-cli`). Most relevant for its sandboxing approach: OS-level isolation via Seatbelt (macOS), Landlock + seccomp + Bubblewrap (Linux), and the `apply_patch` tool format.

**`pi-mono-main/`** — Pi, by Mario Zechner (badlogic). A deliberately minimal coding agent that omits sub-agents, MCP, plan mode, and permissions from its core. Relevant for its Extension API (clean plugin interface), JSONL session tree (branching via parentId), multi-provider AI library, and the philosophy of keeping the runtime small and pushing complexity to extensions.

---

## Field Notes System

Every Elefant project has a **Field Notes** at `.elefant/field-notes/` — a structured, agent-curated knowledge garden for long-form findings, comparisons, and reference notes. This is separate from the SQLite memory system (which holds ephemeral decision logs).

### Structure

The Field Notes is organized into 8 sections:

```
.elefant/field-notes/
├── 00-index/              Index and changelog (auto-maintained by writer agent)
├── 01-domain/             Domain-specific findings
├── 02-tech/               Technology research and comparisons
├── 03-decisions/          Architecture and design decisions
├── 04-comparisons/        Comparative analyses
├── 05-references/         Reference summaries and citations
├── 06-synthesis/          Synthesis and strategic notes
└── 99-scratch/            Rough notes (no strict frontmatter required)
```

Each file includes YAML frontmatter with: `id`, `title`, `section`, `tags`, `sources`, `confidence`, `created`, `updated`, `author_agent`, `workflow`, `summary`.

### Agent Tools

Five tools enable agents to interact with the Field Notes:

| Tool | Purpose | Who Can Write |
|------|---------|---------------|
| `field_notes_search` | Semantic/hybrid/keyword search | All agents (read-only) |
| `field_notes_grep` | Ripgrep pattern matching | All agents (read-only) |
| `field_notes_read` | Read a file by ID, path, or `fieldnotes://` link | All agents (read-only) |
| `field_notes_write` | Write or append to a file; enforces frontmatter | `researcher`, `writer`, `librarian` |
| `field_notes_index` | List/browse by section, tag, or recency | All agents (read-only) |

### Desktop UI

The **Field Notes** in the sidebar provides:
- Two-pane layout: tree (left) + reader (right)
- Read-only markdown renderer with TOC, syntax highlighting, and "Open in editor" button
- Mobile-responsive drawer at ≤640 px
- Keyboard shortcuts: `j`/`k` navigate, `/` search, `g r` focus reader, `Escape` close drawer

### Vector Index & Embedding Providers

The Field Notes is indexed by SQLite + `sqlite-vec` with `Xenova/all-MiniLM-L6-v2` (384-dim) by default. Hardware auto-scaling recommends `bundled-gpu` or `bundled-large` (768-dim) if GPU/NPU detected and ≥16 GB RAM available.

Supported providers: `bundled-cpu`, `bundled-gpu`, `bundled-large`, `ollama`, `lm-studio`, `vllm`, `openai`, `openai-compatible`, `google`, `disabled` (keyword-only).

Provider switching is non-destructive: source files preserved, only derived chunks/embeddings rebuilt.

### Chat Integration

Agents emit `fieldnotes://` links in handoff envelopes and chat output. These render as clickable chips that navigate to the Field Notes with the file open and optional anchor scrolled.

→ See [docs/field-notes.md](docs/field-notes.md) for full architecture, provider matrix, tool reference, and UI walkthrough.

---

## Legacy Research Seed

The Elefant monorepo's own `markdown-db/` at the repository root is kept as a **legacy research seed** (read-only reference). It contains competitive research and design reference material, organized into five sections:

```
markdown-db/
├── 01-platforms/          One file per competing platform
│   ├── factory.md         Factory.ai — Missions, Droids, UX
│   ├── claude-code.md     Claude Code — sub-agents, hooks, permissions
│   ├── opencode.md        OpenCode — plugin system, Effect-TS, ACP
│   ├── codex.md           Codex — Rust core, OS-level sandboxing
│   ├── cursor.md          Cursor — VM-per-run, computer use, PWA
│   ├── windsurf-devin.md  Windsurf 2.0 + Devin post-acquisition
│   ├── others.md          Jules, Amp, Kiro, Grok Build, Copilot, Gemini CLI
│   └── benchmarks.md      SWE-bench, Terminal-Bench 2.0 leaderboards
│
├── 02-harness/            Agent harness and control architectures
│   ├── goopspec.md        GoopSpec — behavioral enforcement, state machine
│   ├── gsd.md             GSD — meta-harness, XML plans, verification
│   └── pi.md              Pi — Extension API, JSONL sessions
│
├── 03-orchestration/      Frameworks, patterns, and stack research
│   ├── mastra.md                      Mastra — TypeScript orchestration, AG-UI
│   ├── langgraph.md                   LangGraph — graph state, HITL, time travel
│   ├── ag-ui-protocol.md              AG-UI — event types, wire format
│   ├── magentic-one.md                Magentic-One — dual-ledger architecture
│   ├── spec-driven-development.md     Kiro, Spec-Kit, Tessl, AGENTS.md standard
│   ├── context-management.md          Context rot, compaction, sub-agent isolation
│   ├── permission-models.md           Permission model patterns across platforms
│   ├── daemon-stack-research.md       Bun/Hono decision rationale
│   └── desktop-framework-comparison.md  Electron/Tauri/Svelte decision rationale
│
├── 04-brand/              Design reference
│   ├── brand-identity.md     Elefant-specific: colors, typography, logo, tone
│   └── agent-ux-patterns.md  Industry UX patterns: task cards, approvals, mobile
│
└── 05-synthesis/          Strategic synthesis (the only opinionated document)
    └── MASTER-SYNTHESIS.md
```

The index and "what to read first" guide lives at `markdown-db/README.md`.

---

## How to Use the Research

The research database is a starting point, not a specification.

**Use it to:**
- Understand what the competitive landscape looks like and why certain decisions were made
- Look up how a specific platform implements something (e.g., how Claude Code's hook system works, how GoopSpec enforces orchestrator discipline)
- Identify patterns worth adopting, adapting, or rejecting
- Find the reasoning behind early design intuitions in the synthesis doc

**Don't treat it as:**
- A requirements document — nothing in the research mandates what Elefant must build
- Ground truth — the research was gathered in April 2026; platforms move fast, details may be outdated or wrong
- A constraint — if a better approach exists that no competitor has tried, that's often the right move
- A substitute for talking to users or building prototypes

The synthesis document (`05-synthesis/MASTER-SYNTHESIS.md`) is the only place that expresses opinions about what Elefant should do. Even that is a starting position, not a locked spec.

---

## Project Status

Research and design phase. No code written yet. No stack has been confirmed.

Open questions are tracked in `05-synthesis/MASTER-SYNTHESIS.md` under "Open Questions for Design Phase."

---

## Mobile UI Testing

The Elefant web UI is served to phone browsers. A Playwright test suite verifies
mobile responsiveness and regression protection at 390×844 (iPhone 14 Pro).

### Test Suites

| Suite | File | Command | Purpose |
|-------|------|---------|---------|
| Mobile Audit | `desktop/tests/mobile-audit.spec.ts` | `cd desktop && bunx playwright test mobile-audit` | Discovery: visits every view, reports horizontal scroll, off-viewport elements, touch-target violations. Run this first when adding a new view. |
| Mobile Regression | `desktop/tests/mobile-regression.spec.ts` | `cd desktop && bunx playwright test mobile-regression` | Stable CI suite: firm assertions on layout, drawer lifecycle, touch targets, resize auto-close. Must pass before merge. |
| Desktop Spot-Check | `desktop/tests/desktop-spot.spec.ts` | `cd desktop && bunx playwright test desktop-spot` | Regression guard for desktop layout. Verifies sidebar inline, 900px collapse, no overlay artifacts. |

### Running All E2E Tests

```bash
cd desktop && bunx playwright test
# or
cd desktop && bun run test:e2e
```

### Mobile Layout Architecture

The app uses a three-mode layout state machine (in `App.svelte`):
- **`expanded`** (> 900px): full sidebar, inline grid column
- **`collapsed`** (641–900px): icon-only sidebar, inline grid column  
- **`mobileOverlay`** (≤ 640px): sidebar hidden; hamburger opens a fixed overlay drawer

Key files for mobile layout:
- `desktop/src/App.svelte` — layout state machine, resize handler
- `desktop/src/lib/components/layout/AppShell.svelte` — grid layout, `layoutMode` prop
- `desktop/src/lib/styles/tokens.css` — `--mobile-breakpoint: 640px`, `--sidebar-width`, `--sidebar-width-collapsed`

### Screenshots

Baseline screenshots live in:
- `desktop/tests/screenshots/mobile/baseline/` — mobile view baselines
- `desktop/tests/screenshots/desktop/baseline/` — desktop view baselines
- `desktop/tests/screenshots/mobile/` — latest audit screenshots (overwritten each run)

### Adding a New View

When adding a new view to the app:
1. Add it to the `SIMPLE_VIEWS` or `PROJECT_VIEWS` array in `mobile-audit.spec.ts`
2. Run `cd desktop && bunx playwright test mobile-audit` to audit the new view
3. Fix any touch-target or overflow issues found
4. Add assertions for the new view in `mobile-regression.spec.ts`
5. Commit updated baseline screenshots

---

## Chat Features

### Slash Commands

The chat input supports client-side slash commands intercepted before reaching the daemon:

- `/undo` — Undo the last assistant response and restore the prior turn.
- `/redo` — Redo a previously undone response.
- `/btw [question]` — Ask a tangential question in ephemeral side context without polluting main conversation history.
- `/back` — Return to the main conversation from side context.

### Agent Visualization

The `visualize` tool enables rich inline rendering (mermaid diagrams, stat grids, research cards, etc.) directly in the chat transcript. The main orchestrator agent can call `visualize` with structured data; subagents can suggest viz via `<suggest-viz type="..." data="..." />` in their closing XML, which the orchestrator may choose to render. See the full guide at [`docs/agent-rich-viz.md`](docs/agent-rich-viz.md).

### Right Session Panel

The chat view includes a collapsible right session panel (desktop: inline 320px column; mobile: bottom sheet overlay).

**Toggle:** Panel-right icon button in the chat topbar (desktop) or TopBar (mobile).

**Tabs:**
- **MCP** — Session-scoped server enable/disable without touching global config
- **Terminal** — Embedded shell in project CWD via ghostty-web (xterm.js fallback)
- **File Changes** — Live list of files modified by the agent this session, click for diff
- **Todos** — Read-only view of the agent's active todo list from `todowrite` calls

**Token Bar (footer):** Always-visible context window usage counter (window + session cumulative). Click to open the Context Window Visualizer treemap.

**Persistence:** Panel open/closed is global; active tab is per-session (localStorage / Tauri plugin-store).

---

## Agent Profiles

The **Agent Config** sidebar view (`desktop/src/features/agent-config/`) displays all 13 user-facing agents grouped into six functional roles:

| Role Group | Agents |
|---|---|
| Coordination | Orchestrator |
| Planning | Planner |
| Research | Researcher, Explorer, Librarian |
| Execution | Executor Low, Medium, High, Frontend |
| Verification | Verifier, Tester, Debugger |
| Documentation | Writer |

### Model Selection

Each agent card exposes a live model picker that reuses the chat composer's model store (`chatStore` from `desktop/src/features/chat/chat.svelte.ts`). Selecting a model sets `behavior.provider` and `behavior.model` on the profile.

### Adding a New Agent

1. Add a new profile in `src/config/schema.ts > defaultAgentProfiles`.
2. Assign a `kind` from the daemon's `AGENT_KINDS` tuple.
3. Update `desktop/src/lib/types/agent-config.ts > AGENT_KINDS` if the kind is new.
4. The cross-package sync test `src/config/agent-config-sync.test.ts` will fail if the two enum sets diverge — that's the intended guard.
5. Add a role-group assignment in `AgentProfilesView.svelte > ROLE_GROUPS`.
6. Add an icon mapping in `AgentProfileCard.svelte > getAgentIcon()`.
