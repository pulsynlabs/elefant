<script lang="ts">
	import type { Snippet } from "svelte";

	type Props = {
		sidebar?: Snippet;
		topbar?: Snippet;
		children?: Snippet;
		sidebarCollapsed?: boolean;
	};

	let {
		sidebar,
		topbar,
		children,
		sidebarCollapsed = $bindable(false),
	}: Props = $props();
</script>

<div class="app-shell" class:sidebar-collapsed={sidebarCollapsed}>
	<!-- Sidebar with glass material -->
	<aside class="sidebar glass-md" aria-label="Navigation sidebar">
		{@render sidebar?.()}
	</aside>

	<!-- Main area: topbar + content -->
	<div class="main-area">
		<header class="topbar glass-sm" aria-label="Application toolbar">
			{@render topbar?.()}
		</header>
		<main class="content texture-noise">
			{@render children?.()}
		</main>
	</div>
</div>

<style>
	.app-shell {
		display: grid;
		grid-template-columns: var(--sidebar-width) 1fr;
		grid-template-rows: 1fr;
		height: 100vh;
		width: 100vw;
		overflow: hidden;
		background-color: var(--color-bg);
		color: var(--color-text-primary);
		transition: grid-template-columns var(--transition-spring);
		position: relative;
	}

	/* Aurora light field — gives glass surfaces rich tonal variation to refract */
	.app-shell::before {
		content: '';
		position: absolute;
		inset: -20%;
		pointer-events: none;
		z-index: 0;
		/* Primary indigo orb — left-centre (behind sidebar) */
		background:
			radial-gradient(circle at 12% 45%, rgba(64, 73, 225, 0.28) 0%, transparent 48%),
			radial-gradient(circle at 8%  80%, rgba(48, 56, 200, 0.14) 0%, transparent 40%),
			radial-gradient(circle at 55% 10%, rgba(80, 90, 240, 0.10) 0%, transparent 42%),
			radial-gradient(circle at 90% 60%, rgba(40, 50, 180, 0.08) 0%, transparent 38%);
		filter: blur(40px);
	}

	/* Secondary teal accent orb — top right, very subtle */
	.app-shell::after {
		content: '';
		position: absolute;
		inset: -20%;
		pointer-events: none;
		z-index: 0;
		background:
			radial-gradient(circle at 78% 15%, rgba(80, 200, 255, 0.07) 0%, transparent 38%),
			radial-gradient(circle at 25% 95%, rgba(100, 80, 255, 0.09) 0%, transparent 35%);
		filter: blur(60px);
		mix-blend-mode: screen;
	}

	.app-shell.sidebar-collapsed {
		grid-template-columns: var(--sidebar-width-collapsed) 1fr;
	}

	.sidebar {
		grid-row: 1 / 2;
		grid-column: 1 / 2;
		display: flex;
		flex-direction: column;
		/* `clip` (vs hidden) preserves mix-blend-mode rendering for the
		   .glass-md ::after specular sheen layer. */
		overflow: clip;
		height: 100vh;
		position: relative;
		z-index: var(--z-sticky);
		transition: width var(--transition-spring);
	}

	/* Sidebar solid-surface override — cancels glass-md blur on the sidebar
	   panel so the navigation rail reads as a confident, slightly elevated
	   solid surface rather than a transparent blur rectangle. The glass-md
	   ::before/::after layers live in global glass.css, so we reach them
	   with :global(). */
	:global(.sidebar.glass-md::before) {
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
		background: var(--color-surface);
		opacity: 1;
		border: none;
	}

	:global(.sidebar.glass-md) {
		box-shadow: none;
		border: none;
		border-right: 1px solid var(--color-border);
	}

	:global(.sidebar.glass-md::after) {
		display: none;
	}

	.main-area {
		grid-row: 1 / 2;
		grid-column: 2 / 3;
		display: grid;
		grid-template-rows: var(--topbar-height) 1fr;
		overflow: hidden;
		position: relative;
		z-index: 1;
	}

	.topbar {
		grid-row: 1 / 2;
		display: flex;
		align-items: center;
		padding: 0 var(--space-4);
		gap: var(--space-3);
		height: var(--topbar-height);
		position: sticky;
		top: 0;
		z-index: var(--z-sticky);
		/* Reset the border shorthand from .glass-sm so the topbar reads as a
		   floating glass shelf with only a hairline at its bottom edge. */
		border-top: none;
		border-left: none;
		border-right: none;
		border-radius: 0;
	}

	.content {
		grid-row: 2 / 3;
		overflow-y: auto;
		overflow-x: hidden;
		/* Subtle indigo vignette in the upper-left of the content area —
		   lets the aurora bleed through visually without painting it. */
		background: radial-gradient(
			ellipse at 30% 20%,
			rgba(64, 73, 225, 0.04) 0%,
			var(--color-bg) 60%
		);
		position: relative;
	}

	@media (max-width: 900px) {
		.app-shell {
			grid-template-columns: var(--sidebar-width-collapsed) 1fr;
		}
	}
</style>
