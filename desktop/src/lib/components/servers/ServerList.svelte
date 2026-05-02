<script lang="ts">
	import type { ServerConfig, ServerHealthStatus } from '$lib/types/server.js';
	import ServerRow from './ServerRow.svelte';

	type Props = {
		servers: ServerConfig[];
		statuses: Record<string, ServerHealthStatus>;
		activeId: string | null;
		onSelect: (id: string) => void;
		onEdit: (id: string) => void;
		onRemove: (id: string) => void;
		onSetDefault: (id: string) => void;
		onAdd: () => void;
	};

	let { servers, statuses, activeId, onSelect, onEdit, onRemove, onSetDefault, onAdd }: Props =
		$props();

	const STATUS_RANK: Record<ServerHealthStatus, number> = {
		connected: 0,
		reconnecting: 1,
		disconnected: 2,
		unknown: 3,
	};

	function statusFor(id: string): ServerHealthStatus {
		return statuses[id] ?? 'unknown';
	}

	const sortedServers = $derived(
		[...servers]
			.map((server, originalIndex) => ({ server, originalIndex }))
			.sort((a, b) => {
				// Active server always first
				if (a.server.id === activeId && b.server.id !== activeId) return -1;
				if (b.server.id === activeId && a.server.id !== activeId) return 1;

				// Then by health status rank
				const rankA = STATUS_RANK[statusFor(a.server.id)];
				const rankB = STATUS_RANK[statusFor(b.server.id)];
				if (rankA !== rankB) return rankA - rankB;

				// Stable within group via original index
				return a.originalIndex - b.originalIndex;
			})
			.map((entry) => entry.server),
	);
</script>

<div class="server-list" role="list" aria-label="Configured daemon servers">
	{#if sortedServers.length === 0}
		<div class="empty-state">
			<p class="empty-text">No servers configured</p>
		</div>
	{:else}
		{#each sortedServers as server (server.id)}
			<div role="listitem">
				<ServerRow
					{server}
					status={statusFor(server.id)}
					isActive={server.id === activeId}
					{onSelect}
					{onEdit}
					{onRemove}
					{onSetDefault}
				/>
			</div>
		{/each}
	{/if}

	<button class="add-server-cta" type="button" onclick={onAdd}>
		<span class="add-icon" aria-hidden="true">+</span>
		<span class="add-label">Add server</span>
	</button>
</div>

<style>
	.server-list {
		display: flex;
		flex-direction: column;
	}

	.empty-state {
		padding: var(--space-6) var(--space-4);
		text-align: center;
		border-bottom: 1px solid var(--border-hairline);
	}

	.empty-text {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-muted);
	}

	.add-server-cta {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 48px;
		padding: var(--space-3) var(--space-4);
		margin: var(--space-3);
		border: 1px dashed var(--border-edge);
		border-radius: var(--radius-md);
		background-color: transparent;
		color: var(--text-meta);
		font-family: inherit;
		font-size: var(--font-size-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			background-color var(--transition-base),
			color var(--transition-base),
			border-color var(--transition-base);
	}

	.add-server-cta:hover,
	.add-server-cta:focus-visible {
		background-color: var(--surface-hover);
		color: var(--text-prose);
		border-color: var(--border-emphasis);
		outline: none;
	}

	.add-icon {
		font-size: 16px;
		line-height: 1;
		font-weight: 400;
	}

	@media (max-width: 640px) {
		.add-server-cta {
			min-height: 48px;
		}
	}
</style>
