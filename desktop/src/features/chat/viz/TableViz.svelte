<script lang="ts">
	// Table viz renderer — semantic <table> with Quire surface tiers
	// and a horizontal scroll wrapper so wide tables stay inside the
	// chat bubble on narrow viewports without forcing layout shift on
	// the surrounding text. The daemon-side Zod schema validates the
	// payload; this component trusts the shape but defends against
	// missing or non-primitive cell values via `getCellValue`.

	import type { VizRendererProps } from './types.js';
	import { getCellValue } from './table-state.js';

	let { envelope }: VizRendererProps = $props();

	interface TableData {
		cols: string[];
		rows: Record<string, unknown>[];
	}

	const data = $derived(envelope.data as unknown as TableData);
</script>

<div class="table-viz">
	{#if envelope.title}
		<p class="table-title">{envelope.title}</p>
	{/if}
	<div class="scroll-x">
		<table>
			<thead>
				<tr>
					{#each data.cols as col (col)}
						<th scope="col">{col}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each data.rows as row, i (i)}
					<tr>
						{#each data.cols as col (col)}
							<td>{getCellValue(row, col)}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.table-viz {
		margin: var(--space-2) 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.table-title {
		margin: 0;
		color: var(--text-meta);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.scroll-x {
		overflow-x: auto;
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		background: var(--surface-leaf);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
	}

	th,
	td {
		padding: var(--space-2) var(--space-3);
		text-align: left;
		border-bottom: 1px solid var(--border-hairline);
		vertical-align: top;
	}

	th {
		background: var(--surface-plate);
		color: var(--text-meta);
		font-weight: 600;
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	td {
		color: var(--text-prose);
	}

	tbody tr:last-child td {
		border-bottom: none;
	}

	tbody tr:hover td {
		background: var(--surface-hover);
	}
</style>
