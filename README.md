# Elefant

**Open-source AI coding agent platform** — Bun-native daemon, SQLite-backed state, hook-enforced behavior, and a Tauri + Svelte 5 desktop app.

Elefant is in active development. The core agent runtime (Bun daemon, Elysia HTTP server, hook system, tool registry, permission model, provider abstraction) is shipped. Spec Mode — the structured, spec-driven development workflow — is in its final integration wave.

---

## Architecture

```
┌────────────────────────────────────────────────┐
│  Desktop App (Tauri v2 + Svelte 5 runes)       │
│  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ Chat     │  │Spec Mode │  │ Settings     │  │
│  └──────────┘  └──────────┘  └─────────────┘  │
└──────────────────┬─────────────────────────────┘
                   │ HTTP + SSE/WebSocket
┌──────────────────▼─────────────────────────────┐
│  Daemon (Bun + Elysia on localhost:1337)        │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ Agent    │ │ Tool     │ │ Permission     │  │
│  │ Loop     │ │ Registry │ │ Gate           │  │
│  └──────────┘ └──────────┘ └────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ Hook     │ │ State    │ │ Compaction     │  │
│  │ System   │ │ Manager  │ │ Manager        │  │
│  └──────────┘ └──────────┘ └────────────────┘  │
│  ┌──────────────────────────────────────────┐   │
│  │  SQLite (.elefant/db.sqlite per-project) │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## Spec Mode

Elefant ships with **Spec Mode** — a structured, spec-driven development workflow built into
the desktop app and daemon.

- Type `/spec-quick <task>` for instant structured delivery
- Type `/spec-discuss` to start a full discovery interview
- Use the Spec Mode panel in the desktop app for GUI-driven workflows
- 13 specialist agents, configurable per role in Settings → Agent Config

[→ Spec Mode Documentation](docs/spec-mode/README.md)

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) >= 1.3.0
- Git

### Development

```bash
git clone https://github.com/your-org/elefant.git
cd elefant
bun install
bun run dev          # Start the daemon in watch mode
```

### Desktop App

```bash
cd desktop
bun install
bun run dev          # Start Tauri dev server
```

### Running Tests

```bash
bun test             # Full daemon test suite
bun run typecheck    # TypeScript strict mode check
bun run validate:prompts  # Validate agent prompt files
bash bench/run-spec-mode-bench.sh  # Hook performance benchmarks
```

### CLI

```bash
bun run start        # Start the Elefant daemon
bun run stop         # Stop the daemon
bun run status       # Check daemon status
```

---

## What's in This Repo

```
elefant/
├── AGENTS.md              ← Agent instructions and project context
├── package.json           ← Daemon dependencies (Bun, Elysia, Zod)
├── tsconfig.json          ← TypeScript strict mode config
│
├── src/                   ← Daemon source
│   ├── daemon/            ← Entry point, server lifecycle
│   ├── state/             ← State manager, migrations, legacy migration
│   ├── db/                ← Migrations, repository layer
│   │   └── repo/spec/     ← Spec Mode repositories (workflows, docs, tasks, chronicle, adl)
│   ├── tools/             ← Tool registry and implementations
│   │   └── spec/          ← Spec Mode tools (11 spec_* tools)
│   │   └── task/          ← Agent dispatch tool
│   ├── hooks/             ← Hook system (permission:ask, tool:before, context:transform, session:pre_compact)
│   ├── permissions/       ← Permission classifier and orchestrator gate
│   ├── compaction/        ← Compaction manager and spec-mode survival block
│   ├── transport/         ← SSE/WebSocket publishing
│   ├── server/            ← Elysia routes (agents, projects, spec-mode API, slash commands)
│   └── agents/            ← Agent prompts (13 agents) and slash command files
│       ├── prompts/       ← 13 agent prompt markdown files
│       └── commands/      ← 15 slash command markdown files
│
├── desktop/               ← Tauri v2 + Svelte 5 desktop app
│   └── src/
│       ├── lib/
│       │   ├── api/       ← Eden Treaty typed API clients
│       │   ├── stores/    ← Svelte 5 rune stores
│       │   └── components/
│       │       └── spec-mode/  ← Spec Mode GUI components
│       └── features/
│           └── spec-mode/ ← SpecModeView, settings
│
├── docs/                  ← Documentation
│   ├── spec-mode/         ← Spec Mode documentation set
│   │   ├── README.md
│   │   ├── architecture.md
│   │   ├── tools.md
│   │   ├── migration.md
│   │   ├── agents/        ← 13 agent profiles
│   │   └── commands/      ← 15 command references
│   └── adr/               ← Architecture decision records
│
├── bench/                 ← Performance benchmarks
├── scripts/               ← Validation and utility scripts
├── test/                  ← Integration test fixtures
│
├── markdown-db/           ← Competitive research database (read-only)
└── .references/           ← Cloned source repos used for research (read-only)
```

---

## Design Philosophy

- **Hook-first enforcement** — Behavioral guardrails live in hooks (`permission:ask`, `tool:before`, `context:transform`, `session:pre_compact`) so they survive prompt drift.
- **DB-backed state** — Spec mode state lives in SQLite, not markdown files in the project tree. Human-readable renderings are generated on demand.
- **Single source of truth** — The daemon owns state. The desktop is a view. CLI/MCP exposure goes through the same daemon API.
- **Provider-agnostic** — Agent configs target any model provider Elefant supports.
- **No breaking changes** — Users not using Spec Mode see zero behavior change in chat sessions.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Daemon runtime | Bun >= 1.3 |
| HTTP framework | Elysia (type-safe, Eden Treaty) |
| Database | SQLite via `bun:sqlite` (WAL mode, per-project) |
| Desktop framework | Tauri v2 |
| UI framework | Svelte 5 (runes mode) |
| Styling | Tailwind v4 |
| Icons | Hugeicons |
| Testing | Bun test + Playwright (E2E) |
| TypeScript | Strict mode throughout |

---

## License

MIT
