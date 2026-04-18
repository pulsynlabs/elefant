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

	/* Ambient glow behind sidebar */
	.app-shell::before {
		content: '';
		position: absolute;
		top: -20%;
		left: -10%;
		width: 60%;
		height: 140%;
		background: radial-gradient(
			ellipse at center,
			rgba(245, 166, 35, 0.06) 0%,
			transparent 70%
		);
		pointer-events: none;
		z-index: 0;
	}

	.app-shell.sidebar-collapsed {
		grid-template-columns: var(--sidebar-width-collapsed) 1fr;
	}

	.sidebar {
		grid-row: 1 / 2;
		grid-column: 1 / 2;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		height: 100vh;
		position: relative;
		z-index: var(--z-sticky);
		transition: width var(--transition-spring);
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
	}

	.content {
		grid-row: 2 / 3;
		overflow-y: auto;
		overflow-x: hidden;
		background-color: var(--color-bg);
		position: relative;
	}

	@media (max-width: 900px) {
		.app-shell {
			grid-template-columns: var(--sidebar-width-collapsed) 1fr;
		}
	}
</style>
