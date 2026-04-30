# CHRONICLE: MCP Tools Support

**Workflow:** mcp-tools-support
**Branch:** feat/mcp-tools-support
**Created:** 2026-04-29
**Status:** execute phase — Wave 7 wiring and verification complete, acceptance pending

---

## Current State

| Field | Value |
|-------|-------|
| Phase | execute |
| Spec locked | true (workflow state authoritative; SPEC frontmatter is stale) |
| Active wave | Wave 7 complete |
| Active task | acceptance verification pending |
| Mode | standard |
| Depth | deep |
| Autopilot | (per state.json) |
| Last checkpoint | wave-4-complete (from prior workflow — ignore for this workflow) |

---

## Wave Status

| Wave | Name | Status | Tasks |
|------|------|--------|-------|
| 0 | Research | ✅ COMPLETE | 1/1 |
| 1 | Foundation | ⏳ pending | 0/4 |
| 2 | Core MCP Client | ⏳ pending | 0/5 |
| 3 | Selective Tool Loading | ⏳ pending | 0/4 |
| 4 | Run Loop Integration | ⏳ pending | 0/3 |
| 5 | Registry & Discovery | ✅ COMPLETE | 4/4 |
| 6 | Frontend MCP Settings UI | ⏳ pending | 0/5 |
| 7 | Wiring, Verification & Polish | ✅ COMPLETE | 8/8 |

**Total tasks:** 33 (33 done, 0 pending)
**Coverage of must-haves:** 100% (8/8 mapped)

---

## Progress Log

### 2026-04-30 — Wave 7 Tasks 7.1-7.8 Complete

**Tasks 7.1-7.8: Wiring, Verification & Polish** — ✅ DONE by goop-executor-high.

Outcome:

- Added `src/mcp/transport.verify.test.ts` covering stdio transport command/env construction, remote transport construction, StreamableHTTP → SSE fallback, and stdio descendant cleanup on manager shutdown.
- Added `src/mcp/budget.verify.test.ts` with a synthetic 20-tool server fixture. The fixture measures 61,252 estimated full-injection tool tokens and verifies the selective first turn injects only the meta-tool, a >99% reduction (above the 60% requirement).
- Extended `src/config/schema.test.ts` with ConfigManager disk round-trip coverage for full MCP configs plus legacy config loading without `mcp` or `tokenBudgetPercent`.
- Extended `src/server/mcp-routes.test.ts` to cover all configured MCP server routes, including update, delete 404, disconnect, tools, pin/unpin, registry bundled/all, and invalid POST validation.
- Added `src/mcp/e2e.smoke.test.ts`, skipped only in CI, that starts `@modelcontextprotocol/server-filesystem /tmp`, connects through a real `MCPManager`, lists tools, invokes `list_directory`, and shuts down cleanly.
- Added `src/mcp/registry/offline.test.ts` verifying `ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC=1` disables Anthropic/Smithery fetches while bundled registry remains available and powers `source=all` responses.
- Created `.goopspec/mcp-tools-support/UI-WALKTHROUGH.md` for manual Settings → MCP validation.
- Wired MCPManager into daemon creation and app startup: shared manager construction, non-blocking `init()`, Anthropic registry prefetch, MCP route mounting, MCP event SSE endpoint, global volatile status broadcasts, run-route/conversation injection, shutdown hook cleanup, and public package exports.
- Implemented missing `MCPManager.callTool()` execution path with per-server timeout and `resetTimeoutOnProgress: true` options.
- Registered `mcp_search_tools` in per-run tool registries when an MCPManager is available so `tool_list` can discover it; agent-loop still injects it dynamically only in selective mode.

Verification:

- `bun test src/mcp/ src/server/mcp-routes.test.ts src/config/schema.test.ts src/runs/context.test.ts` — PASS, 152 tests, 941 assertions.
- `cd desktop && bun run check` — PASS, 0 errors / 53 warnings (warnings match known Svelte patterns documented in Wave 6).
- `bun run typecheck 2>&1 | grep "src/mcp/\|src/server/mcp\|src/runs/" || echo "No MCP type errors"` — FAIL due to pre-existing `src/runs/*` test/type issues unrelated to MCP; no `src/mcp/` or `src/server/mcp` errors remain after fixes.
- `pgrep -f "modelcontextprotocol/server"` — existing Zed MCP processes were present before/after (`server-sequential-thinking`, `server-puppeteer`); no filesystem smoke-test orphan remained.

Remaining gaps:

- Full repository typecheck remains blocked by pre-existing `src/runs/dal.test.ts`, `src/runs/events.test.ts`, `src/runs/integration.test.ts`, and `src/runs/messages.test.ts` errors. These are not MCP-specific and were not changed in this wiring pass.

Files:

- `src/mcp/transport.verify.test.ts` — created.
- `src/mcp/budget.verify.test.ts` — created.
- `src/mcp/e2e.smoke.test.ts` — created.
- `src/mcp/registry/offline.test.ts` — created.
- `src/config/schema.test.ts` — extended.
- `src/server/mcp-routes.test.ts` — extended.
- `src/server/app.ts` — wired MCP startup, routes, and registry prefetch.
- `src/daemon/create.ts` — creates shared MCPManager, broadcasts status events, and shuts down manager.
- `src/server/mcp-routes.ts` — added `/api/mcp/events` SSE endpoint.
- `src/transport/sse-manager.ts` — added volatile project broadcast for global MCP events.
- `src/tools/registry.ts` — registers `mcp_search_tools` for per-run registries with MCP enabled.
- `src/runs/routes.ts` — passes MCPManager through agent-run execution.
- `src/mcp/manager.ts` — implemented `callTool()`.
- `src/index.ts` — exports MCPManager and MCP config types.
- `CHANGELOG.md` — added MCP support entry.

### 2026-04-30 — Wave 5 Tasks 5.1-5.4 Complete

**Tasks 5.1-5.4: Registry & Discovery** — ✅ DONE by goop-executor-medium.

Outcome:

- **T5.1 (Anthropic registry):** Created `src/mcp/registry/types.ts` (`RegistryEntry` interface), `src/mcp/registry/anthropic.ts` (`fetchAnthropicRegistry`, `prefetchAnthropicRegistry`, `invalidateAnthropicCache`). Fetches `api.anthropic.com/mcp-registry/v0/servers` with 24h in-memory cache. Honours `ELEFANT_DISABLE_NONESSENTIAL_TRAFFIC`.
- **T5.2 (Smithery registry):** Created `src/mcp/registry/smithery.ts` (`fetchSmitheryRegistry` with paging, query support, 429 retry with exponential backoff). Sorts verified-first.
- **T5.3 (Bundled JSON):** Created `src/mcp/registry/bundled.json` (34 hand-curated entries: 9 official modelcontextprotocol servers + 25 popular community servers), `src/mcp/registry/bundled.ts` (`getBundledRegistry`). Test validates ≥30 entries, all pass schema check, unique ids/names, stdio entries have commands.
- **T5.4 (Unified routes):** Created `src/server/mcp-routes.ts` with 10 endpoints: server CRUD (GET/POST/PUT/DELETE /api/mcp/servers), connect/disconnect, tools list, pin/unpin, registry browse (GET with source/paging/query), registry refresh (POST). Config path injectable via `options.configPath` for testability. Registered in `src/server/app.ts` when `mcpManager` is provided. SSE wiring documented as T7.8 TODO.

Verification:
- `bun test src/mcp/registry/anthropic.test.ts` — 7 pass
- `bun test src/mcp/registry/smithery.test.ts` — 8 pass
- `bun test src/mcp/registry/bundled.test.ts` — 7 pass
- `bun test src/server/mcp-routes.test.ts` — 12 pass
- `bun run typecheck` — no errors in registry or mcp-routes

### 2026-04-30 — Wave 6 Tasks 6.1-6.5 Complete

**Tasks 6.1-6.5: Frontend MCP Settings UI** — ✅ DONE by goop-executor-frontend.

Outcome:

- Added MCP types to `desktop/src/lib/daemon/types.ts`: `McpServerConfig`, `McpServerWithStatus`, `McpToolEntry`, `RegistryEntry`, `McpRegistryResponse`, `McpStatusEvent`, plus `McpTransport` union.
- Created `desktop/src/lib/services/mcp-service.ts` — typed wrapper over `/api/mcp/*` routes mirroring the `configService` pattern. Includes `subscribeToStatus()` that opens an EventSource on `/api/mcp/events` and dispatches `mcp.status.changed` / `mcp.tools.changed` events to the caller, returning a dispose function.
- Added 9 new icons to `desktop/src/lib/icons/index.ts`: `McpServerIcon`, `PlugIcon`, `PackageIcon`, `CubeIcon`, `LinkIcon`, `ConnectIcon`, `RefreshIcon`, `PinIcon`, `PinOffIcon` — all from `@hugeicons/core-free-icons`. Verified each icon module exists in node_modules.
- Created `MCPStatusBadge.svelte` — small status pill with colored dot + label. `connecting` pulses subtly (respects `prefers-reduced-motion`).
- Created `MCPSettings.svelte` — server list with name, transport icon (PlugIcon for stdio, LinkIcon for remote), status badge, tool count, enable toggle, edit / delete / retry buttons. Subscribes to SSE on mount, unsubscribes on destroy. Empty state copy: "No MCP servers configured. Add one or browse the registry." Inline expandable tool list (chevron toggle) with per-tool pin/unpin (optimistic update + revert on error) and "show more" for descriptions over 200 chars. Live status updates re-fetch the affected server rather than mutating from event payload — daemon is single source of truth.
- Created `MCPServerForm.svelte` — Add / Edit form. Transport-conditional fields: stdio shows command + env pairs; remote shows url + headers pairs. Env / header pairs are add/remove rows. Client-side validation: name regex `[a-zA-Z0-9_-]+`, URL must be http/https, timeout 1000-600000 ms. Inline error text per field (matches ProviderForm pattern). Saves through `mcpService.addServer` / `updateServer`.
- Created `MCPRegistryBrowser.svelte` + `MCPRegistryCard.svelte` — three source tabs (Curated/Community/Bundled), debounced search (300ms), use-case filter chips derived from current entries, paged Smithery view with prev/next, refresh button. Cards show icon (or two-letter initials fallback), displayName, oneLiner, transport tag, "Add" button. Handles loading / error / empty states. Tolerates both sectioned (`{ anthropic: [...] }`) and flat (`{ entries: [...] }`) registry response shapes.
- Added "MCP" tab to `SettingsView.svelte` between "Providers" and "Daemon".

Design choices worth preserving:

- SSE subscription on a single endpoint `/api/mcp/events`. Component manages its own subscription lifecycle (mount/destroy). Daemon publishes named events `mcp.status.changed` and `mcp.tools.changed` — handler refetches affected server rather than trusting payload.
- Optimistic pin toggle: UI updates immediately, reverts on `mcpService.pinTool` failure with toast. Avoids a flash of stale state when the daemon round-trip succeeds (the common case).
- Tools panel lazy-loads on first expand. Subsequent expands reuse cached tool list. `tools.changed` SSE event invalidates cache; if the row is currently expanded, it eagerly refetches.
- Form remount pattern: parent toggles `{#if showForm}`, so capturing initial `editing` / `template` props as `$state` is correct (matches ProviderForm). Generates the same 14 `state_referenced_locally` warnings as the established pattern (intentional — the form is destroyed and recreated when switching between Add and Edit).
- Pre-fill from registry doesn't auto-save. Users may want to tweak env vars, set timeouts, or rename before committing — the form opens with values populated and the user clicks "Add Server".
- Tool name uses monospace font, description uses muted text, pinned tools highlight in primary color (matches the Elefant design system).

Verification:

- `cd desktop && bun run check` — 0 errors, 53 warnings (all pre-existing pattern: `state_referenced_locally` for form-prop captures matches ProviderForm's pattern; unchanged baseline from before the change).
- `cd desktop && bun run build` — built successfully in 7.01s, no errors.
- `cd desktop && bun test` — 306 pass / 4 fail. The 4 failures are pre-existing on main (verified by stashing all my changes and re-running the full suite — same 4 failures); they are in `projects.svelte.test.ts` and `worktrees.svelte.test.ts`, unrelated to MCP.

Files:

- `desktop/src/lib/daemon/types.ts` — added MCP type block.
- `desktop/src/lib/services/mcp-service.ts` — created.
- `desktop/src/lib/icons/index.ts` — added 9 MCP-related icons.
- `desktop/src/features/settings/MCPStatusBadge.svelte` — created.
- `desktop/src/features/settings/MCPSettings.svelte` — created (server list + inline tools panel + pin toggle).
- `desktop/src/features/settings/MCPServerForm.svelte` — created.
- `desktop/src/features/settings/MCPRegistryBrowser.svelte` — created.
- `desktop/src/features/settings/MCPRegistryCard.svelte` — created.
- `desktop/src/features/settings/SettingsView.svelte` — added "MCP" tab.

### 2026-04-30 — Wave 4 Tasks 4.1-4.3 Complete

**Tasks 4.1-4.3: MCP run-loop integration** — ✅ DONE by goop-executor-high.

Outcome:

- Created `src/mcp/adapter.ts` to convert connected MCP tools into Elefant `ToolDefinition`s named `mcp__<server>__<tool>`.
- Added MCP result serialization for text, image placeholders, resource links, truncation, MCP `isError`, and thrown network/timeout errors.
- Preserved raw `inputJSONSchema` on `ToolDefinition` and through `ToolRegistry.register()` for provider adapters that need raw JSON Schema.
- Added `MCPManager.getTimeout()` and `MCPManager.getPinnedTools()` helpers for adapter timeouts and selective-loading pinned tools.
- Wired optional `mcpManager` support into `runAgentLoop` and `conversation.ts`: inline mode injects all MCP tools; selective mode injects `mcp_search_tools`, always-load/pinned/discovered tools, and appends the MCP manifest to the outgoing system context.
- Rebuilds the effective MCP tool list on every loop iteration so tools discovered by `mcp_search_tools` are available on the next provider call.

Verification:

- `bun test src/mcp/adapter.test.ts` — 7 pass, 0 fail.
- `bun test src/server/agent-loop.test.ts` — 20 pass, 0 fail.
- `bun run typecheck 2>&1 | grep "src/mcp/\|src/server/agent" || echo "No integration type errors"` — `No integration type errors`.
- `bun test` — FAIL due to pre-existing unrelated failures in database migration expectations, compaction manager fixtures, desktop Playwright/Svelte test loading, and sidebar child-run chain state. MCP adapter and agent-loop tests pass in the full run.

Files:

- `src/mcp/adapter.ts` — created.
- `src/mcp/adapter.test.ts` — created.
- `src/mcp/manager.ts` — added timeout and pinned-tool accessors.
- `src/server/agent-loop.ts` — added MCP selective/inline tool-list construction and manifest injection.
- `src/server/agent-loop.test.ts` — added MCP run-loop integration coverage.
- `src/server/conversation.ts` — registers MCP adapter tools when a live manager is supplied.
- `src/tools/registry.ts` and `src/types/tools.ts` — preserve optional raw JSON schema metadata.

### 2026-04-30 — Wave 2 Task 2.5 In Progress

**Task 2.5: SIGTERM/SIGINT cleanup with descendant pid kill** — implementation started by goop-executor-high.

Observation:

- `MCPManager` is not yet instantiated in `src/daemon/server-entry.ts` or exposed through the daemon object returned by `src/daemon/create.ts`.
- Daemon signal handlers call `gracefulShutdown(reason, daemon)` and the shutdown hook registry can close services that are registered during daemon creation, but no live `mcpManager` instance exists to call at this point.

TODO for T7.8 wiring task:

- Instantiate and initialise the shared `MCPManager` in daemon/app wiring.
- Register `mcpManager.shutdown()` in the daemon shutdown path (SIGTERM, SIGINT, and manual `/api/daemon/shutdown`) once the shared manager instance exists.

### 2026-04-29 — Wave 1 Task 1.2 Complete

**Task 1.2: MCP config schema (Zod)** — ✅ DONE by goop-executor-medium.

Outcome:

- Added `mcpStdioConfigSchema`, `mcpRemoteConfigSchema`, `mcpServerSchema` (Zod discriminated union on `transport`) to `src/config/schema.ts`.
- Extended `configSchema` with `mcp: z.array(mcpServerSchema).optional().default([])` and `tokenBudgetPercent: z.number().min(0).max(100).optional().default(10)`.
- Exported types `McpServerConfig`, `McpStdioConfig`, `McpRemoteConfig` alongside existing config types.
- Added 18 new tests in `src/config/schema.test.ts` covering: valid stdio/SSE/streamable-http configs, discriminator logic, missing fields, invalid transport, invalid name regex, invalid UUID, strict mode rejection of extra props, backward compatibility (no `mcp` field defaults to `[]`), backward compatibility (no `tokenBudgetPercent` defaults to `10`), same-name entries accepted at schema level (uniqueness enforced at application level).
- Updated `src/config/index.ts` barrel exports with new schemas and types.
- Fixed 6 test files that use `ElefantConfig` type annotation to include new `mcp: []` and `tokenBudgetPercent: 10` fields.

Verification:

- `bun test src/config/schema.test.ts` — 57 tests, 0 fail, 93 expect calls.
- `bun test src/config/schema.test.ts src/plugins/example.test.ts src/plugins/isolation.test.ts src/plugins/loader.test.ts src/providers/router.test.ts` — 68 tests, 0 fail across 5 files.
- `bun run typecheck` — pre-existing errors remain (unrelated to MCP changes); no new MCP-specific type errors.

Modified files:
- `src/config/schema.ts` — added 3 MCP schemas + extended configSchema + exported types
- `src/config/schema.test.ts` — added 18 MCP tests
- `src/config/index.ts` — added MCP schema/type exports
- `src/test/helpers.ts` — added mcp/tokenBudgetPercent defaults
- `src/plugins/example.test.ts` — added mcp/tokenBudgetPercent defaults
- `src/plugins/isolation.test.ts` — added mcp/tokenBudgetPercent defaults
- `src/plugins/loader.test.ts` — added mcp/tokenBudgetPercent defaults
- `src/providers/router.test.ts` — added mcp/tokenBudgetPercent defaults to 4 config fixtures
- `src/server/app.test.ts` — added mcp/tokenBudgetPercent defaults

### 2026-04-29 — Wave 1 Task 1.3 Complete

**Task 1.3: SDK Bun compatibility spike** — ✅ DONE by goop-executor-high.

Outcome:

- Created `scripts/mcp-spike.ts` using the official `@modelcontextprotocol/sdk` stdio client transport.
- Verified `bun run scripts/mcp-spike.ts` connects to `bunx @modelcontextprotocol/server-filesystem /tmp`.
- Listed 14 filesystem MCP tools and successfully invoked `list_directory` with `{ path: "/tmp" }`.
- Documented results in `.goopspec/mcp-tools-support/SPIKE-RESULTS.md`.
- No fallback ADL entry required because the spike succeeded.

Verification:

- `bun run scripts/mcp-spike.ts` — PASS.
- `bun run typecheck` — FAIL due to unrelated pre-existing type errors in existing test/source files; no spike-specific type error observed.

### 2026-04-29 — Workflow Initialised

- REQUIREMENTS.md captured via Lazy Autopilot discovery.
- Workflow `mcp-tools-support` created on branch `feat/mcp-tools-support`.
- Phase: plan; depth: deep.

### 2026-04-29 — Wave 0 (Research) Complete

**Task 0.1: Produce RESEARCH.md** — ✅ DONE by goop-planner.

Key findings persisted to `.goopspec/mcp-tools-support/RESEARCH.md`:

- **OpenCode MCP** mapped: Effect-TS service, official `@modelcontextprotocol/sdk`, three transports, lazy lifecycle, full OAuth (out of scope for us). Pattern: try StreamableHTTP → fall back to SSE for remote URLs.
- **Claude Code MCP + selective loading** mapped: the lazy mechanism is `defer_loading: true` on tool definitions + `tool_reference` blocks in conversation history + `ToolSearchTool` meta-tool. Critically, the **server-side expansion of `tool_reference` is Anthropic-API-specific**, so Elefant cannot adopt it as-is for multi-provider support. We design a **client-side equivalent**: manifest in system prompt + `mcp_search_tools` meta-tool + per-RunContext discovery state.
- **Codex MCP** mapped: uses Rust `rmcp` crate; confirms StreamableHTTP as canonical remote transport; introduces elicitations (out of scope for Phase 1).
- **Registry research** verified live:
  - Anthropic registry (`https://api.anthropic.com/mcp-registry/v0/servers?...`) returns rich metadata including pre-fetched `toolNames` per server. Recommended **primary**.
  - Smithery (`https://registry.smithery.ai/servers`) has 5,065 entries. Recommended **secondary** for browse.
  - Anthropic registry has zero stdio entries → **bundled JSON fallback essential** (recommended for ≥30 entries including official `@modelcontextprotocol/server-*`).
- **Elefant codebase reality check**: daemon framework is **Elysia (not Hono)** — REQUIREMENTS.md was outdated. Run loop in `src/server/agent-loop.ts` is clean enough to integrate MCP via the existing `ToolRegistry` + `ToolExecutor` interface — no large refactor expected.
- **8 architectural decisions (AD-1..AD-8) captured** in RESEARCH.md §8, ready to persist via `memory_decision` and to ADL during T1.1.

### 2026-04-29 — SPEC.md and BLUEPRINT.md Created

- SPEC.md: 8 must-haves with full acceptance criteria; out-of-scope explicit; constraints captured (Elysia not Hono); traceability matrix 100%.
- BLUEPRINT.md: 8 waves, 33 tasks. Each task has `Executor` field per planner protocol:
  - `goop-executor-low`: T1.1, T1.4, T5.3, T7.6, T7.7 (mechanical / read-only / data-only / docs)
  - `goop-executor-medium`: T1.2, T2.4, T3.2, T3.4, T4.3, T5.1, T5.2, T5.4, T7.1, T7.3, T7.4 (business logic, schema, services within established patterns)
  - `goop-executor-high`: T1.3 (risk-gating spike), T2.1 (architectural), T2.2 (multi-transport), T2.3 (concurrency-sensitive), T2.5 (process management), T3.1 (token math), T3.3 (meta-tool), T4.1 (adapter design), T4.2 (run loop hook), T7.2 (perf benchmark), T7.5 (e2e), T7.8 (mandatory wiring)
  - `goop-executor-frontend`: T6.1, T6.2, T6.3, T6.4, T6.5 (Svelte UI)
- All 8 must-haves traced to ≥1 task.
- Per-wave deep-mode questions documented in BLUEPRINT.md (5-6 per wave).
- Wiring task (T7.8) explicitly addresses checklist patterns 1, 3, 5.

### 2026-04-29 — CHRONICLE.md Initialised

- This file created.
- Awaiting Contract Gate: orchestrator presents SPEC summary + wave overview to user; on confirm, locks spec via `goop_state` and proceeds with `/goop-execute`.

---

## Next Action

**Orchestrator handoff:** Present Contract Gate (must-haves, out-of-scope, wave summary) → user confirms → lock SPEC via `goop_state action=lock-spec` → run `/goop-execute` to begin Wave 1.

**First execution wave (Wave 1) is fully parallel** — orchestrator can dispatch T1.1, T1.2, T1.3, T1.4 concurrently.

**Critical risk gate:** T1.3 (SDK Bun spike) must succeed before Wave 2 commits. If it fails, deviation Rule 4 applies — STOP and consult user about hand-rolled fallback.

---

## Decision Log (cross-reference)

Key decisions captured in RESEARCH.md §8, to be persisted to ADL via T1.1:

- **AD-1**: Use official `@modelcontextprotocol/sdk` for transports.
- **AD-2**: Client-side selective tool loading via `mcp_search_tools` meta-tool (vs Anthropic-only `defer_loading`).
- **AD-3**: Auto-threshold for selective loading (default 10% of context window).
- **AD-4**: Hybrid registry: Anthropic primary + Smithery secondary + bundled fallback.
- **AD-5**: MCPManager mirrors ProviderRouter pattern; integrates into Elysia daemon.
- **AD-6**: Tool naming convention `mcp__<server>__<tool>`.
- **AD-7**: stdio supports macOS + Linux only in Phase 1 (no Windows).
- **AD-8**: MCP descriptions hard-capped at 2048 chars (matches Claude Code).

---

## Blockers

None.

---

## Files Created This Workflow

| File | Purpose | Created |
|------|---------|---------|
| `.goopspec/mcp-tools-support/REQUIREMENTS.md` | Discovery output | 2026-04-29 (pre-workflow) |
| `.goopspec/mcp-tools-support/RESEARCH.md` | Wave 0 synthesis | 2026-04-29 |
| `.goopspec/mcp-tools-support/SPEC.md` | The contract | 2026-04-29 |
| `.goopspec/mcp-tools-support/BLUEPRINT.md` | Execution plan | 2026-04-29 |
| `.goopspec/mcp-tools-support/CHRONICLE.md` | This file | 2026-04-29 |

---

*Updated by goop-planner 2026-04-29.*
*Next update: orchestrator after Contract Gate.*
