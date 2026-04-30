<script lang="ts">
	import type { RegistryEntry } from '$lib/daemon/types.js';

	type Props = {
		entry: RegistryEntry;
		onAdd: (entry: RegistryEntry) => void;
	};

	let { entry, onAdd }: Props = $props();

	/**
	 * Two-letter fallback derived from displayName when no iconUrl is
	 * available. Trimmed defensively in case the registry returns blank
	 * strings or whitespace-only names.
	 */
	const initials = $derived(
		entry.displayName
			.split(/\s+/)
			.filter(Boolean)
			.map((p) => p[0]?.toUpperCase() ?? '')
			.join('')
			.slice(0, 2) || '?',
	);

	const transportLabel: Record<RegistryEntry['transport'], string> = {
		stdio: 'stdio',
		sse: 'sse',
		'streamable-http': 'http',
	};
</script>

<article class="card">
	<header class="card-header">
		<div class="icon" aria-hidden="true">
			{#if entry.iconUrl}
				<img src={entry.iconUrl} alt="" loading="lazy" />
			{:else}
				<span class="initials">{initials}</span>
			{/if}
		</div>
		<div class="title-block">
			<h4 class="title">{entry.displayName}</h4>
			<span class="transport">{transportLabel[entry.transport]}</span>
		</div>
	</header>

	{#if entry.oneLiner || entry.description}
		<p class="description">
			{entry.oneLiner ?? entry.description}
		</p>
	{/if}

	{#if entry.useCases && entry.useCases.length > 0}
		<ul class="use-cases" role="list">
			{#each entry.useCases.slice(0, 3) as use (use)}
				<li class="use-case">{use}</li>
			{/each}
		</ul>
	{/if}

	<footer class="card-footer">
		<button class="btn-add" type="button" onclick={() => onAdd(entry)}>
			Add
		</button>
	</footer>
</article>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		transition:
			border-color var(--transition-fast),
			transform var(--transition-fast);
	}

	.card:hover {
		border-color: var(--color-border-strong);
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.icon {
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md);
		background-color: var(--color-surface-hover);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		color: var(--color-text-secondary);
	}

	.icon img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.initials {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
	}

	.title-block {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.title {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.transport {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.description {
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		line-height: 1.4;
		margin: 0;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		line-clamp: 3;
		overflow: hidden;
	}

	.use-cases {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: 0;
		margin: 0;
	}

	.use-case {
		font-size: var(--font-size-xs);
		padding: 2px 8px;
		border-radius: var(--radius-full);
		background-color: var(--color-surface-hover);
		color: var(--color-text-muted);
	}

	.card-footer {
		display: flex;
		justify-content: flex-end;
		margin-top: auto;
	}

	.btn-add {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: none;
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition: background-color var(--transition-fast);
	}

	.btn-add:hover {
		background-color: var(--color-primary-hover);
	}
</style>
