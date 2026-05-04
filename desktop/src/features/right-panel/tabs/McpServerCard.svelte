<script lang="ts">
	/**
	 * Compact MCP server card for the right-panel MCP tab.
	 *
	 * Layout (≤ 80px tall):
	 *
	 *   ┌──────────────────────────────────────────────┐
	 *   │ ● filesystem                3 tools     [⚡] │  ← row 1
	 *   │   stdio · /usr/local/bin/mcp-fs              │  ← row 2 (meta)
	 *   └──────────────────────────────────────────────┘
	 *
	 * The toggle is a single pill button that flips the **session-scoped**
	 * disable state via the W2.T5 routes. Crucially:
	 *
	 *   - `globalDisabled` (server.enabled === false) takes precedence over
	 *     `sessionDisabled` and locks the toggle — you cannot override a
	 *     global "off" from this quick-access panel; that's a Settings job.
	 *   - `errorFlash` is a transient 1s border-flash applied when an
	 *     enable/disable POST throws, after which the toggle reverts.
	 *
	 * The card itself is presentational: it raises an `onToggle` event with
	 * the **next** desired state and lets the parent (`McpTab.svelte`) own
	 * the optimistic update + rollback.
	 */
	import type { McpServerWithStatus } from '$lib/daemon/types.js';
	import {
		HugeiconsIcon,
		PlugIcon,
		McpServerIcon,
	} from '$lib/icons/index.js';

	type Props = {
		server: McpServerWithStatus;
		/**
		 * Whether this server is disabled for the current session via the
		 * in-memory overlay (W2.T5). Independent from `server.enabled`,
		 * which is the persisted global flag.
		 */
		sessionDisabled: boolean;
		/**
		 * Briefly true (≤ 1s) after a failed toggle attempt so the card
		 * can flash a red border. Parent owns the timeout.
		 */
		errorFlash?: boolean;
		/** Whether the toggle is mid-request (debounce subsequent clicks). */
		busy?: boolean;
		/**
		 * Fired when the user clicks the toggle. Payload is the **next**
		 * desired session-disabled state, so `false` = enable for session,
		 * `true` = disable for session.
		 */
		onToggle: (nextSessionDisabled: boolean) => void;
	};

	let {
		server,
		sessionDisabled,
		errorFlash = false,
		busy = false,
		onToggle,
	}: Props = $props();

	// `globalDisabled` is independent from connection status: a server can
	// be persistently disabled (`enabled: false`) regardless of whether it
	// ever connected. The W2.T5 overlay only matters when the server is
	// globally enabled — disabling globally already removes its tools.
	const globalDisabled = $derived(server.enabled === false);

	// Effective state shown on the dot. Order matters: failed > global >
	// session > status, so users see the most actionable diagnosis first.
	type Effective =
		| 'failed'
		| 'global-disabled'
		| 'session-disabled'
		| 'connecting'
		| 'connected'
		| 'idle';

	const effective = $derived<Effective>(
		server.status === 'failed'
			? 'failed'
			: globalDisabled
				? 'global-disabled'
				: sessionDisabled
					? 'session-disabled'
					: server.status === 'connecting'
						? 'connecting'
						: server.status === 'connected'
							? 'connected'
							: 'idle',
	);

	const dotLabel = $derived<string>(
		{
			failed: 'Failed',
			'global-disabled': 'Disabled (global)',
			'session-disabled': 'Disabled (session)',
			connecting: 'Connecting',
			connected: 'Connected',
			idle: 'Idle',
		}[effective],
	);

	// Short transport+target line. For stdio we render the executable name
	// only (full argv is too long for a 2-line card); for remote servers
	// we render the URL, host-only if available. `$derived.by` accepts a
	// callback — use it whenever the computation has more than one
	// statement or needs early returns.
	const targetSummary = $derived.by<string>(() => {
		if (server.transport === 'stdio') {
			const exe = server.command?.[0] ?? '';
			return exe || 'stdio';
		}
		if (server.url) {
			try {
				return new URL(server.url).host;
			} catch {
				return server.url;
			}
		}
		return server.transport;
	});

	const toolCountLabel = $derived.by<string>(() => {
		const n = server.toolCount ?? 0;
		return `${n} ${n === 1 ? 'tool' : 'tools'}`;
	});

	// Toggle is interactive whenever:
	//   - server is globally enabled (can't override global from here)
	//   - we're not mid-request
	const toggleDisabled = $derived(globalDisabled || busy);

	function handleToggle() {
		if (toggleDisabled) return;
		onToggle(!sessionDisabled);
	}
</script>

<article
	class="server-card"
	class:dimmed={sessionDisabled || globalDisabled}
	class:error-flash={errorFlash}
	aria-label={`MCP server ${server.name}, ${dotLabel}`}
>
	<div class="card-row primary">
		<span
			class={`status-dot status-dot-${effective}`}
			class:pulse={effective === 'connecting'}
			aria-hidden="true"
		></span>

		<span class="server-name" title={server.name}>{server.name}</span>

		<span class="tool-count" aria-label={toolCountLabel}>
			{toolCountLabel}
		</span>

		<button
			type="button"
			class="toggle"
			class:toggle-on={!sessionDisabled && !globalDisabled}
			class:toggle-off={sessionDisabled || globalDisabled}
			disabled={toggleDisabled}
			aria-pressed={!sessionDisabled && !globalDisabled}
			aria-label={
				globalDisabled
					? `${server.name} is globally disabled. Enable in Settings to toggle for this session.`
					: sessionDisabled
						? `Enable ${server.name} for this session`
						: `Disable ${server.name} for this session`
			}
			title={
				globalDisabled
					? 'Globally disabled — change in Settings'
					: sessionDisabled
						? 'Enable for this session'
						: 'Disable for this session'
			}
			onclick={handleToggle}
		>
			<HugeiconsIcon icon={PlugIcon} size={14} strokeWidth={1.6} />
		</button>
	</div>

	<div class="card-row meta">
		<HugeiconsIcon
			icon={McpServerIcon}
			size={11}
			strokeWidth={1.5}
			color="var(--text-muted)"
		/>
		<span class="meta-text">
			<span class="transport">{server.transport}</span>
			<span class="meta-sep" aria-hidden="true">·</span>
			<span class="target" title={targetSummary}>{targetSummary}</span>
			{#if globalDisabled}
				<span class="scope-badge scope-global">global</span>
			{:else if sessionDisabled}
				<span class="scope-badge scope-session">session</span>
			{:else if server.status === 'failed' && server.error}
				<span class="scope-badge scope-error" title={server.error}>error</span>
			{/if}
		</span>
	</div>
</article>

<style>
	.server-card {
		/* Hard ceiling per spec (compact, ≤ 80px). The card is two flex
		   rows — primary (≈ 22px) + meta (≈ 16px) — plus padding. The
		   max-height clamp prevents long names from blowing out the row. */
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-height: 80px;
		padding: var(--space-2) var(--space-3);
		background-color: var(--surface-leaf);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-md, 6px);
		transition:
			border-color var(--transition-fast),
			background-color var(--transition-fast),
			opacity var(--transition-fast);
	}

	.server-card.dimmed {
		/* Visually inert when disabled (session or global). Still readable
		   so users can see what's there, but clearly second-class. */
		opacity: 0.55;
	}

	.server-card.error-flash {
		/* 1-second red border flash after a failed toggle. Parent toggles
		   the prop off after the timeout so the card returns to normal. */
		border-color: var(--color-error);
		background-color: color-mix(
			in oklch,
			var(--color-error) 6%,
			var(--surface-leaf)
		);
	}

	.card-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.card-row.primary {
		min-height: 22px;
	}

	.card-row.meta {
		min-height: 16px;
		color: var(--text-muted);
		font-size: 11px;
		line-height: 1.2;
	}

	.status-dot {
		display: inline-block;
		flex: 0 0 auto;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background-color: var(--text-disabled);
	}

	.status-dot-connected {
		background-color: var(--color-success);
		/* Subtle ring so the dot reads even on busy backgrounds. */
		box-shadow: 0 0 0 2px
			color-mix(in oklch, var(--color-success) 25%, transparent);
	}

	.status-dot-connecting {
		background-color: var(--color-warning);
	}

	.status-dot-failed {
		background-color: var(--color-error);
		box-shadow: 0 0 0 2px
			color-mix(in oklch, var(--color-error) 25%, transparent);
	}

	.status-dot-session-disabled,
	.status-dot-global-disabled,
	.status-dot-idle {
		background-color: var(--text-meta);
	}

	/* Pulse for `connecting`. Disabled when the user prefers reduced motion. */
	.status-dot.pulse {
		animation: dot-pulse 1.4s ease-in-out infinite;
	}

	@keyframes dot-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.status-dot.pulse {
			animation: none;
		}
	}

	.server-name {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-prose);
	}

	.tool-count {
		flex: 0 0 auto;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--text-meta);
		white-space: nowrap;
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		width: 28px;
		height: 22px;
		padding: 0;
		background: transparent;
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-full, 999px);
		color: var(--text-meta);
		cursor: pointer;
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.toggle:hover:not(:disabled) {
		color: var(--text-prose);
		background-color: var(--surface-hover);
	}

	.toggle:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.toggle:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.toggle-on {
		color: var(--color-primary-foreground);
		background-color: var(--color-primary);
		border-color: var(--color-primary);
	}

	.toggle-on:hover:not(:disabled) {
		background-color: var(--color-primary-hover);
		border-color: var(--color-primary-hover);
		color: var(--color-primary-foreground);
	}

	/* `.toggle-off` is the .toggle base style — no override needed. The
	   class is still applied in markup for symmetry with `.toggle-on` so
	   future style hooks (e.g. a "danger" theme for session-disabled) have
	   a clear attachment point. */

	.meta-text {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
	}

	.transport {
		flex: 0 0 auto;
		text-transform: lowercase;
		font-variant-numeric: tabular-nums;
	}

	.meta-sep {
		flex: 0 0 auto;
		opacity: 0.6;
	}

	.target {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.scope-badge {
		flex: 0 0 auto;
		margin-left: var(--space-1);
		padding: 0 6px;
		border-radius: var(--radius-full, 999px);
		border: 1px solid transparent;
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.02em;
		line-height: 1.4;
		text-transform: uppercase;
	}

	.scope-session {
		color: var(--text-meta);
		background-color: var(--surface-hover);
		border-color: var(--border-edge);
	}

	.scope-global {
		color: var(--text-meta);
		background-color: color-mix(
			in oklch,
			var(--text-meta) 12%,
			transparent
		);
		border-color: color-mix(in oklch, var(--text-meta) 25%, transparent);
	}

	.scope-error {
		color: var(--color-error);
		background-color: color-mix(
			in oklch,
			var(--color-error) 12%,
			transparent
		);
		border-color: color-mix(in oklch, var(--color-error) 30%, transparent);
		text-transform: uppercase;
	}
</style>
