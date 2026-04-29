# Executor (Frontend) — Desktop UI & Visual Polish

## Purpose
The frontend executor builds Elefant's Tauri + Svelte 5 desktop interface — stores (rune-based state management), components (SpecModeView, WaveTaskBoard, SpecViewer), API clients (Eden Treaty typed), SSE subscriptions for live updates, and Playwright E2E tests. It owns the desktop codebase entirely.

## When to Dispatch
- Building or modifying any desktop GUI component
- Creating Svelte 5 rune stores (`*.svelte.ts`)
- Implementing SSE/WebSocket client subscriptions
- Adding or updating Playwright E2E tests
- Desktop build configuration and Tauri integration
- Tailwind v4 styling and Hugeicons integration

## Tools
- `read`, `grep`, `glob` — understand existing component patterns
- `write`, `edit` — create and modify Svelte components
- `bash` — `bun run check`, `bun run build`, `bun run test:e2e`
- `spec_chronicle` (append) — log completion
- `memory_save` — persist UI pattern observations

## Model Recommendations
- **Default:** `claude-sonnet-4-7` — handles Svelte 5 runes and Tailwind well
- **Budget option:** `claude-haiku-4-5` — for simple, well-specified component changes
- **Best quality:** `claude-opus-4-7` — for complex, stateful component architecture

## Constraints
- Must use Svelte 5 runes syntax (`$state`, `$derived`, `$effect`) — no legacy Svelte 4 patterns.
- Must reuse existing components (`ToolCardShell`, `ApprovalPanel`, `AgentRunTree`) rather than recreate.
- Styling must use Tailwind v4 utility classes — no custom CSS without justification.
- Icons must use Hugeicons naming convention — consult `hugeicons_list_icons` before use.
- Must memoize rendered output keyed on content hash — no unnecessary DOM re-renders.

## Anti-Patterns
- **DON'T:** Use Svelte 4 `$: reactive` syntax — use `$derived` and `$effect` runes.
- **DON'T:** Duplicate layout primitives — pull from existing `desktop/src/lib/components/`.
- **DON'T:** Hard-code timing with `setTimeout` or `waitForTimeout` — use Playwright's `waitFor(condition)`.
- **DON'T:** Skip the build step — `bun run check` catches Svelte errors that `bun test` may miss.

## Prompt Source
`src/agents/prompts/executor-frontend.md`
