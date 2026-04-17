<script lang="ts">
	import { navigationStore } from "$lib/stores/navigation.svelte.js";

	type Props = {
		collapsed?: boolean;
	};

	let { collapsed = false }: Props = $props();

	// Inline SVG icons (Svelte 5 compatible)
	const icons = {
		chat: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
		settings: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
		models: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 4v16"/><path d="M4 9h16"/></svg>`,
		about: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
	};

	const navItems = [
		{ id: "chat" as const, label: "Chat", icon: icons.chat },
		{ id: "settings" as const, label: "Settings", icon: icons.settings },
		{ id: "models" as const, label: "Models", icon: icons.models },
		{ id: "about" as const, label: "About", icon: icons.about },
	];
</script>

<nav class="sidebar-nav" class:collapsed aria-label="Main navigation">
	<!-- Logo/Brand -->
	<div class="sidebar-brand">
		<div class="brand-mark">E</div>
		{#if !collapsed}
			<span class="brand-name">Elefant</span>
		{/if}
	</div>

	<!-- Navigation Items -->
	<ul class="nav-items" role="list">
		{#each navItems as item}
			<li>
				<button
					class="nav-item"
					class:active={navigationStore.isActive(item.id)}
					onclick={() => navigationStore.navigate(item.id)}
					title={collapsed ? item.label : undefined}
					aria-label={item.label}
					aria-current={navigationStore.isActive(item.id)
						? "page"
						: undefined}
				>
					<span class="nav-icon" aria-hidden="true">
						{@html item.icon}
					</span>
					{#if !collapsed}
						<span class="nav-label">{item.label}</span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.sidebar-nav {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: var(--space-3) 0;
		overflow: hidden;
	}

	.sidebar-brand {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		margin-bottom: var(--space-4);
		height: 48px;
	}

	.brand-mark {
		width: 28px;
		height: 28px;
		border-radius: var(--radius-md);
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: var(--font-weight-bold);
		font-size: var(--font-size-lg);
		flex-shrink: 0;
		font-family: var(--font-mono);
	}

	.brand-name {
		font-weight: var(--font-weight-semibold);
		font-size: var(--font-size-md);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-tight);
		white-space: nowrap;
		overflow: hidden;
	}

	.nav-items {
		list-style: none;
		padding: 0 var(--space-2);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		text-align: left;
		font-size: var(--font-size-md);
		font-family: var(--font-sans);
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast);
		white-space: nowrap;
		overflow: hidden;
	}

	.nav-item:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.nav-item.active {
		color: var(--color-primary);
		background-color: var(--color-primary-subtle);
	}

	.nav-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		color: currentColor;
	}

	.nav-label {
		font-weight: var(--font-weight-medium);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sidebar-nav.collapsed .nav-item {
		justify-content: center;
		padding: var(--space-2);
	}

	.sidebar-nav.collapsed .sidebar-brand {
		justify-content: center;
		padding: var(--space-3) var(--space-2);
	}
</style>
