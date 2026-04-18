<script lang="ts">
	import { navigationStore } from "$lib/stores/navigation.svelte.js";
	import { HugeiconsIcon, ChatIcon, SettingsIcon, ModelsIcon, AboutIcon } from "$lib/icons/index.js";
	import type { IconSvgElement } from "$lib/icons/index.js";

	type Props = {
		collapsed?: boolean;
	};

	let { collapsed = false }: Props = $props();

	const navItems: { id: 'chat' | 'settings' | 'models' | 'about'; label: string; icon: IconSvgElement }[] = [
		{ id: "chat", label: "Chat", icon: ChatIcon },
		{ id: "settings", label: "Settings", icon: SettingsIcon },
		{ id: "models", label: "Models", icon: ModelsIcon },
		{ id: "about", label: "About", icon: AboutIcon },
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
						<HugeiconsIcon icon={item.icon} size={18} strokeWidth={1.5} />
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
		position: relative;
	}

	/* Vertical accent line — left edge */
	.sidebar-nav::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		width: 2px;
		height: 100%;
		background: linear-gradient(
			to bottom,
			transparent 0%,
			var(--color-primary) 20%,
			var(--color-primary) 80%,
			transparent 100%
		);
		opacity: 0.6;
		pointer-events: none;
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
		box-shadow: var(--glow-primary);
		transition: box-shadow var(--transition-fast);
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
		flex: 1;
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
			background-color var(--transition-fast),
			box-shadow var(--transition-fast);
		white-space: nowrap;
		overflow: hidden;
		position: relative;
	}

	.nav-item:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.nav-item.active {
		color: var(--color-primary);
		background-color: var(--color-primary-subtle);
		box-shadow: inset 2px 0 0 var(--color-primary), var(--glow-primary);
	}

	.nav-item:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
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
