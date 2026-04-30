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
	<!-- Sidebar — Quire md surface (bound editorial sheet, no blur) -->
	<aside class="sidebar quire-md" aria-label="Navigation sidebar">
		{@render sidebar?.()}
	</aside>

	<!-- Main area: topbar + content -->
	<div class="main-area">
		<header class="topbar quire-sm" aria-label="Application toolbar">
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
		background-color: var(--surface-substrate);
		color: var(--text-prose);
		transition: grid-template-columns var(--transition-spring);
		position: relative;
	}

	/* Single indigo ambient field — Quire Rule 4: accent metal is restrained.
	   One primary glow per view; no competing teal/purple secondaries.
	   Derived entirely from --color-primary via color-mix so it tracks both
	   themes without literal rgba authoring. */
	.app-shell::before {
		content: '';
		position: absolute;
		inset: -20%;
		pointer-events: none;
		z-index: 0;
		background:
			radial-gradient(
				circle at 12% 45%,
				color-mix(in oklch, var(--color-primary) 22%, transparent) 0%,
				transparent 48%
			),
			radial-gradient(
				circle at 8% 80%,
				color-mix(in oklch, var(--color-primary) 11%, transparent) 0%,
				transparent 40%
			),
			radial-gradient(
				circle at 55% 10%,
				color-mix(in oklch, var(--color-primary) 8%, transparent) 0%,
				transparent 42%
			);
		filter: blur(40px);
	}

	.app-shell.sidebar-collapsed {
		grid-template-columns: var(--sidebar-width-collapsed) 1fr;
	}

	.sidebar {
		grid-row: 1 / 2;
		grid-column: 1 / 2;
		display: flex;
		flex-direction: column;
		overflow: clip;
		height: 100vh;
		position: relative;
		z-index: var(--z-sticky);
		transition: width var(--transition-spring);
	}

	/* Sidebar override — the navigation rail reads as a confident, lifted
	   editorial sheet bound by a single hairline on its trailing edge.
	   We keep the .quire-md tinted fill and inset highlights from quire.css
	   but neutralise the outer shadow and border-radius so the sidebar
	   meets the screen edge cleanly. */
	:global(.sidebar.quire-md) {
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.05),
			inset 0 -1px 0 rgba(0, 0, 0, 0.18);
		border: none;
		border-right: 1px solid var(--border-edge);
		border-radius: 0;
	}

	:global([data-theme="light"] .sidebar.quire-md) {
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.7),
			inset 0 -1px 0 rgba(64, 73, 225, 0.04);
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
		padding: 0 0 0 var(--space-4);
		gap: var(--space-3);
		height: var(--topbar-height);
		position: sticky;
		top: 0;
		z-index: var(--z-sticky);
		/* Reset the border shorthand from .quire-sm so the topbar reads as a
		   bound editorial shelf with only a hairline at its bottom edge. */
		border-top: none;
		border-left: none;
		border-right: none;
		border-radius: 0;
	}

	.content {
		grid-row: 2 / 3;
		overflow-y: auto;
		overflow-x: hidden;
		/* Subtle indigo vignette upper-left — lets the ambient field bleed
		   through visually without painting it. Tokenised via color-mix. */
		background: radial-gradient(
			ellipse at 30% 20%,
			color-mix(in oklch, var(--color-primary) 4%, transparent) 0%,
			var(--surface-substrate) 60%
		);
		position: relative;
	}

	@media (max-width: 900px) {
		.app-shell {
			grid-template-columns: var(--sidebar-width-collapsed) 1fr;
		}
	}
</style>
