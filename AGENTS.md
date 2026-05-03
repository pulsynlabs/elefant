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

## The Research Database

`markdown-db/` contains competitive research and design reference material, organized into five sections:

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
