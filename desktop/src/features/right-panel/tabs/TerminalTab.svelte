<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { Spinner } from '$lib/components/ui/spinner';
	import { DAEMON_URL } from '$lib/daemon/client.js';
	import { PtyBridge } from '../terminal/pty-bridge.js';
	import { createRenderer } from '../terminal/renderer.js';
	import type { TerminalRenderer } from '../terminal/renderer.js';

	type Props = {
		/**
		 * Identifies the chat session this terminal belongs to. The
		 * renderer + PTY bridge are torn down and re-created whenever
		 * this changes so a switched session never inherits the
		 * previous shell's WebSocket.
		 */
		sessionId: string;
		/**
		 * Identifies the project this terminal belongs to. Treated the
		 * same as `sessionId` for re-init purposes.
		 */
		projectId: string;
		/**
		 * Called for every byte the user types into the terminal. The
		 * PtyBridge already forwards keystrokes to the PTY WebSocket;
		 * this hook is exposed for parents that want to mirror input
		 * into a logger or replay buffer.
		 */
		onData?: (data: string) => void;
	};

	let { sessionId, projectId, onData }: Props = $props();

	// ── Element refs + lifecycle state ────────────────────────────────────
	//
	// `containerEl` is the DOM node the renderer mounts into. `rootEl` is
	// the outer wrapper used purely for theme resolution — `resolveTheme`
	// reads CSS custom properties from whichever element is passed, and
	// the outer wrapper inherits the document's theme tokens.

	let containerEl = $state<HTMLDivElement | null>(null);
	let rootEl = $state<HTMLDivElement | null>(null);

	// `renderer` is reactive so consumers (and the conditional overlay
	// below) react the moment async creation resolves. `loadError` flips
	// on when both ghostty-web and the xterm fallback throw — getting
	// here means the host environment cannot run any terminal renderer.
	let renderer = $state<TerminalRenderer | null>(null);
	let loadError = $state(false);

	// Per-session lifecycle handles. All five are torn down together by
	// `disposeSession()` and re-created by `initSession()`.
	let unsubscribeData: (() => void) | null = null;
	let bridge: PtyBridge | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Increments every time we kick off a new session init. Captured into
	// the async closure so a stale init that resolves after the user has
	// already switched sessions can detect the race and dispose itself
	// instead of clobbering the live renderer.
	let initToken = 0;

	const FALLBACK_CHAR_WIDTH_PX = 8.5;
	const FALLBACK_LINE_HEIGHT_PX = 20;

	function clearResizeDebounce(): void {
		if (!resizeDebounceTimer) return;
		clearTimeout(resizeDebounceTimer);
		resizeDebounceTimer = null;
	}

	function estimateGridFromContainer(node: HTMLElement): { cols: number; rows: number } {
		const cols = Math.max(2, Math.floor(node.clientWidth / FALLBACK_CHAR_WIDTH_PX));
		const rows = Math.max(2, Math.floor(node.clientHeight / FALLBACK_LINE_HEIGHT_PX));
		return { cols, rows };
	}

	function resolveRendererGrid(currentRenderer: TerminalRenderer): { cols: number; rows: number } {
		const withGrid = currentRenderer as unknown as {
			cols?: number;
			rows?: number;
			terminal?: { cols?: number; rows?: number };
		};

		const cols = withGrid.cols ?? withGrid.terminal?.cols;
		const rows = withGrid.rows ?? withGrid.terminal?.rows;

		if (typeof cols === 'number' && typeof rows === 'number') {
			return {
				cols: Math.max(2, Math.floor(cols)),
				rows: Math.max(2, Math.floor(rows)),
			};
		}

		if (containerEl) {
			return estimateGridFromContainer(containerEl);
		}

		return { cols: 80, rows: 24 };
	}

	function syncResizeToBridge(): void {
		if (!renderer || !bridge) return;
		renderer.fit();
		const { cols, rows } = resolveRendererGrid(renderer);
		bridge.sendResize(cols, rows);
	}

	function scheduleResizeSync(): void {
		if (!renderer || !bridge) return;
		clearResizeDebounce();
		resizeDebounceTimer = setTimeout(() => {
			resizeDebounceTimer = null;
			syncResizeToBridge();
		}, 100);
	}

	/**
	 * Tear down the per-session resources without touching `containerEl`
	 * or `rootEl` — those are owned by the component's lifetime, not the
	 * session's. Safe to call multiple times.
	 */
	function disposeSession(): void {
		// Bump first so any in-flight init checks (`token !== initToken`)
		// fail fast and dispose their half-built renderers.
		initToken += 1;

		clearResizeDebounce();
		resizeObserver?.disconnect();
		resizeObserver = null;

		unsubscribeData?.();
		unsubscribeData = null;

		bridge?.disconnect();
		bridge = null;

		renderer?.dispose();
		renderer = null;
	}

	/**
	 * Spawn a fresh renderer + PTY bridge for the current
	 * `projectId`/`sessionId` pair. Caller must have already called
	 * `disposeSession()` to release any previous instance.
	 */
	async function initSession(): Promise<void> {
		if (!containerEl || !rootEl) {
			loadError = true;
			return;
		}

		// Capture into locals so TypeScript narrows them inside the async
		// flow below — `containerEl`/`rootEl` are reactive `$state` and
		// the type system treats reads after each `await` as possibly-null.
		const container = containerEl;
		const root = rootEl;

		const token = ++initToken;
		// Clear any stale error from a prior init attempt before we begin.
		loadError = false;

		// Snapshot the props at init time. If they change while the async
		// renderer init is in flight, the `$effect` watching them will run
		// `disposeSession()` and bump `initToken`, so the stale closure
		// will bail out below.
		const sessionAtInit = sessionId;
		const projectAtInit = projectId;

		try {
			const created = await createRenderer({ rootEl: root });

			if (token !== initToken) {
				// A newer init started (or session was disposed) while we
				// were awaiting WASM init — throw away the half-built
				// renderer instead of leaking it.
				created.dispose();
				return;
			}

			created.mount(container);
			unsubscribeData = created.onData((chunk) => {
				onData?.(chunk);
			});

			renderer = created;

			bridge = new PtyBridge(projectAtInit, sessionAtInit, String(DAEMON_URL));
			bridge.connect(created);

			resizeObserver = new ResizeObserver(() => {
				scheduleResizeSync();
			});
			resizeObserver.observe(container);
			// Fire immediately so the very first frame already reflects the
			// container's real size — without this users would briefly see
			// the default 80×24 grid before the observer's first callback.
			scheduleResizeSync();

			// Focus the terminal so the user can type as soon as the tab
			// is visible. Harmless when the tab is offscreen — focus()
			// without a visible viewport simply queues for the next paint.
			created.focus();
		} catch (error) {
			if (token !== initToken) return;
			if (import.meta.env.DEV) {
				console.error('[terminal-tab] renderer init failed', error);
			}
			loadError = true;
		}
	}

	// ── Reactive session lifecycle ────────────────────────────────────────
	//
	// One $effect watches BOTH the container/root refs becoming available
	// (component mount) AND the session/project ids changing. On any
	// transition we dispose the previous session and spawn a fresh one,
	// which guarantees a clean shell whenever the user switches sessions
	// without remounting the tab.
	//
	// `untrack` wraps the imperative work so reads inside `disposeSession`
	// / `initSession` (which touch other reactive state) don't widen the
	// effect's dependency graph.

	$effect(() => {
		// Track the dependencies explicitly.
		const haveDom = containerEl !== null && rootEl !== null;
		const sid = sessionId;
		const pid = projectId;

		if (!haveDom) return;
		if (!sid || !pid) return;

		untrack(() => {
			disposeSession();
			void initSession();
		});

		// Effect cleanup: triggered before the next run AND on component
		// destroy. This is what closes the WebSocket and disposes the
		// renderer when the user switches sessions OR closes the panel.
		return () => {
			untrack(() => {
				disposeSession();
			});
		};
	});

	// Hard backstop — Svelte runs $effect cleanups on destroy too, but
	// onDestroy guarantees teardown even if the effect was never reached
	// (e.g. early error before first run).
	onDestroy(() => {
		disposeSession();
	});

	const ariaLabel = $derived(`Terminal for session ${sessionId} in project ${projectId}`);
	const isLoading = $derived(!renderer && !loadError);
</script>

<div class="terminal-tab" bind:this={rootEl}>
	<div
		bind:this={containerEl}
		class="terminal-container"
		role="application"
		aria-label={ariaLabel}
	></div>

	{#if isLoading}
		<div class="terminal-overlay" role="status" aria-live="polite">
			<Spinner size="md" tone="muted" />
			<span class="overlay-text">Starting terminal…</span>
		</div>
	{:else if loadError}
		<div class="terminal-overlay" role="alert">
			<span class="overlay-text overlay-text-error">Terminal unavailable</span>
		</div>
	{/if}
</div>

<style>
	.terminal-tab {
		/* Fill the tab content area provided by RightPanel. The wrapper is
		   the theme-resolution root for `resolveTheme`, so it must also
		   inherit the document's CSS custom properties (it does, by virtue
		   of being a descendant of `:root`). */
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		height: 100%;
		background-color: var(--surface-substrate);
		padding: var(--space-2);
	}

	.terminal-container {
		/* The renderer paints into this element. position:relative is
		   required by xterm.js — it positions internal elements
		   absolutely and the FitAddon reads dimensions from the
		   offsetParent. */
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		width: 100%;
		font-family: var(--font-mono);
		/* Renderers manage their own scrollback; clip anything that would
		   otherwise spill past the panel column. */
		overflow: hidden;
	}

	/* xterm injects its own DOM. Tweak the surrounding chrome — never the
	   cell colours, which the renderer's theme drives. */
	.terminal-container :global(.xterm) {
		padding: 0;
	}

	/* Selection tint matches the Quire primary at low opacity. xterm
	   already paints the selection through its theme; this rule covers
	   any DOM-level fallback selection (rare, but it kicks in on the
	   helper textarea xterm uses for IME). */
	.terminal-container :global(.xterm .xterm-selection div) {
		background-color: var(--color-primary-subtle) !important;
	}

	/* Scrollbar — tinted to the panel chrome so it reads as part of the
	   terminal, not a browser default. Dual-tracked: `scrollbar-*` for
	   Firefox, `-webkit-scrollbar` for Chromium/WebKit. Track stays on
	   the substrate so it visually merges with the terminal background;
	   thumb uses `--border-edge` to match the panel hairlines. */
	.terminal-container :global(.xterm-viewport) {
		background-color: transparent !important;
		scrollbar-color: var(--border-edge) transparent;
		scrollbar-width: thin;
	}

	.terminal-container :global(.xterm-viewport::-webkit-scrollbar) {
		width: 6px;
	}

	.terminal-container :global(.xterm-viewport::-webkit-scrollbar-track) {
		background-color: transparent;
	}

	.terminal-container :global(.xterm-viewport::-webkit-scrollbar-thumb) {
		background-color: var(--border-edge);
		border-radius: var(--radius-full);
	}

	.terminal-container :global(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
		background-color: var(--border-emphasis);
	}

	.terminal-overlay {
		/* Sits on top of the renderer container while it is loading or
		   when initialisation has failed. `pointer-events: none` keeps it
		   from swallowing clicks that should reach the renderer the moment
		   it appears — the spinner is informational, not interactive. */
		position: absolute;
		inset: var(--space-2);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		pointer-events: none;
		background-color: color-mix(in oklch, var(--surface-substrate) 88%, transparent);
		border-radius: var(--radius-sm);
	}

	.overlay-text {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text-meta);
		letter-spacing: 0.02em;
	}

	.overlay-text-error {
		color: var(--text-muted);
	}
</style>
