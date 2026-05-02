<script lang="ts">
	import type { ServerConfig, ServerHealthStatus } from '$lib/types/server.js';

	type Props = {
		server: ServerConfig;
		status: ServerHealthStatus;
		isActive: boolean;
		onSelect: (id: string) => void;
		onEdit: (id: string) => void;
		onRemove: (id: string) => void;
		onSetDefault: (id: string) => void;
	};

	let { server, status, isActive, onSelect, onEdit, onRemove, onSetDefault }: Props = $props();

	let menuOpen = $state(false);

	const statusColor = $derived(
		status === 'connected'
			? 'var(--color-success)'
			: status === 'reconnecting'
				? 'var(--color-warning)'
				: status === 'disconnected'
					? 'var(--color-error)'
					: 'var(--text-disabled)',
	);

	const statusLabel = $derived(
		status === 'connected'
			? 'Connected'
			: status === 'reconnecting'
				? 'Reconnecting'
				: status === 'disconnected'
					? 'Disconnected'
					: 'Unknown',
	);

	function toggleMenu(event: MouseEvent): void {
		event.stopPropagation();
		menuOpen = !menuOpen;
	}

	function closeMenu(): void {
		menuOpen = false;
	}

	function handleMenuKey(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			menuOpen = false;
		}
	}

	function handleSelect(): void {
		if (!isActive) onSelect(server.id);
	}

	function handleRowKey(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleSelect();
		}
	}

	function handleEdit(): void {
		closeMenu();
		onEdit(server.id);
	}

	function handleRemove(): void {
		closeMenu();
		onRemove(server.id);
	}

	function handleSetActive(): void {
		closeMenu();
		onSelect(server.id);
	}

	function handleSetDefault(): void {
		closeMenu();
		onSetDefault(server.id);
	}
</script>

<svelte:window onkeydown={handleMenuKey} />

<div
	class="server-row"
	class:active={isActive}
	role="button"
	tabindex="0"
	aria-label="Server {server.displayName}, {statusLabel}{isActive ? ', active' : ''}"
	onclick={handleSelect}
	onkeydown={handleRowKey}
>
	{#if isActive}
		<span class="active-stripe" aria-hidden="true"></span>
	{/if}

	<span
		class="status-dot"
		style="background-color: {statusColor};"
		title={statusLabel}
		aria-hidden="true"
	></span>

	<span class="display-name">{server.displayName}</span>

	<span class="badge locality" class:remote={!server.isLocal}>
		{server.isLocal ? 'Local' : 'Remote'}
	</span>

	{#if server.isDefault}
		<span class="badge default-badge">Default</span>
	{/if}

	<span class="server-url" title={server.url}>{server.url}</span>

	<div class="action-menu-wrap">
		<button
			class="action-menu-trigger"
			type="button"
			aria-label="Server actions for {server.displayName}"
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			onclick={toggleMenu}
		>
			<span aria-hidden="true">⋮</span>
		</button>

		{#if menuOpen}
			<button
				class="menu-overlay"
				type="button"
				aria-label="Close menu"
				onclick={closeMenu}
			></button>
			<div class="action-menu" role="menu">
				<button class="menu-item" type="button" role="menuitem" onclick={handleEdit}>
					Edit
				</button>
				{#if !isActive}
					<button class="menu-item" type="button" role="menuitem" onclick={handleSetActive}>
						Set as active
					</button>
				{/if}
				{#if !server.isDefault}
					<button class="menu-item" type="button" role="menuitem" onclick={handleSetDefault}>
						Set as default
					</button>
				{/if}
				<button
					class="menu-item destructive"
					type="button"
					role="menuitem"
					onclick={handleRemove}
				>
					Remove
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.server-row {
		position: relative;
		display: grid;
		grid-template-columns: auto 1fr auto auto minmax(0, 1.5fr) auto;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		min-height: 56px;
		background-color: transparent;
		border: none;
		border-bottom: 1px solid var(--border-hairline);
		color: var(--text-prose);
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		font-size: var(--font-size-sm);
		transition:
			background-color var(--transition-base),
			color var(--transition-base);
	}

	.server-row:last-child {
		border-bottom: none;
	}

	.server-row:hover:not(.active) {
		background-color: var(--surface-hover);
	}

	.server-row:focus-visible {
		outline: 2px solid var(--border-focus);
		outline-offset: -2px;
	}

	.server-row.active {
		background-color: var(--surface-leaf);
	}

	.active-stripe {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 3px;
		background-color: var(--color-primary);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		transition: background-color var(--transition-base);
	}

	.display-name {
		font-weight: 500;
		color: var(--text-prose);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2px var(--space-2);
		border-radius: var(--radius-full);
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.badge.locality {
		background-color: rgba(64, 73, 225, 0.14);
		color: var(--color-primary);
	}

	.badge.locality.remote {
		background-color: rgba(255, 255, 255, 0.06);
		color: var(--text-meta);
	}

	.badge.default-badge {
		background-color: rgba(34, 197, 94, 0.14);
		color: var(--color-success);
	}

	.server-url {
		font-size: 11px;
		color: var(--text-muted);
		font-family: var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.action-menu-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}

	.action-menu-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background-color: transparent;
		color: var(--text-meta);
		font-size: 16px;
		line-height: 1;
		cursor: pointer;
		transition:
			background-color var(--transition-base),
			color var(--transition-base),
			border-color var(--transition-base);
	}

	.action-menu-trigger:hover,
	.action-menu-trigger:focus-visible {
		background-color: var(--surface-hover);
		color: var(--text-prose);
		border-color: var(--border-edge);
		outline: none;
	}

	.menu-overlay {
		position: fixed;
		inset: 0;
		z-index: var(--z-dropdown);
		background: transparent;
		border: none;
		padding: 0;
		margin: 0;
		cursor: default;
	}

	.action-menu {
		position: absolute;
		top: calc(100% + var(--space-1));
		right: 0;
		z-index: calc(var(--z-dropdown) + 1);
		min-width: 180px;
		padding: var(--space-1);
		background-color: var(--surface-plate);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.menu-item {
		display: block;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border: none;
		border-radius: var(--radius-sm);
		background-color: transparent;
		color: var(--text-prose);
		font-family: inherit;
		font-size: var(--font-size-sm);
		text-align: left;
		cursor: pointer;
		transition:
			background-color var(--transition-base),
			color var(--transition-base);
	}

	.menu-item:hover,
	.menu-item:focus-visible {
		background-color: var(--surface-hover);
		outline: none;
	}

	.menu-item.destructive {
		color: var(--color-error);
	}

	.menu-item.destructive:hover,
	.menu-item.destructive:focus-visible {
		background-color: rgba(239, 68, 68, 0.10);
	}

	/* ── Mobile ≥44px touch targets ─────────────────────────────────── */
	@media (max-width: 640px) {
		.server-row {
			grid-template-columns: auto 1fr auto;
			grid-template-rows: auto auto;
			gap: var(--space-2) var(--space-3);
			padding: var(--space-3) var(--space-4);
		}

		.status-dot {
			grid-row: 1 / 3;
		}

		.display-name {
			grid-column: 2 / 3;
			grid-row: 1;
		}

		.action-menu-wrap {
			grid-column: 3;
			grid-row: 1 / 3;
		}

		.badge.locality,
		.badge.default-badge {
			display: none;
		}

		.server-url {
			grid-column: 2 / 3;
			grid-row: 2;
		}

		.action-menu-trigger {
			width: 44px;
			height: 44px;
		}

		.menu-item {
			min-height: 44px;
			display: flex;
			align-items: center;
		}
	}
</style>
