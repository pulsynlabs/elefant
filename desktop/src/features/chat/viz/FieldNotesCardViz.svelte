<script lang="ts">
	// Field notes card viz renderer.
	//
	// Premium bento grid for field-notes-style results: each card carries
	// a title, a summary clamped to three lines, an optional confidence
	// pill (high/med/low — derived from a 0–1 score), an optional tag
	// row truncated to four chips with a "+N" overflow marker, and an
	// optional source. `fieldnotes://` sources mount the existing
	// `FieldNotesChip` so the chip resolves the file's frontmatter title
	// and routes to the Field Notes View on click; everything else falls
	// back to a plain external anchor with rel=noopener.
	//
	// Layout uses CSS grid `auto-fit, minmax(240px, 1fr)` so the bento
	// gracefully collapses from a 3-up wide layout to a single column
	// on narrow transcripts (mobile). Tokens only — zero hex.

	import type { VizRendererProps } from './types.js';
	import FieldNotesChip from '../FieldNotesChip.svelte';
	import {
		confidenceColorToken,
		formatConfidence,
		isFieldNotesUri,
		truncateTags,
	} from './fieldnotes-card-state.js';

	let { envelope }: VizRendererProps = $props();

	interface FieldNotesCard {
		title: string;
		summary: string;
		url?: string;
		confidence?: number;
		tags?: string[];
	}

	// Daemon-side Zod has already validated the envelope's payload;
	// the cast surfaces the typed shape and the `?? []` keeps a
	// malformed envelope from crashing the transcript.
	const cards = $derived(
		(envelope.data as { cards?: FieldNotesCard[] }).cards ?? [],
	);

	const TAG_LIMIT = 4;
</script>

{#if envelope.title}
	<p class="rc-section-title">{envelope.title}</p>
{/if}

<div
	class="rc-grid"
	role="list"
	aria-label={envelope.title ?? envelope.intent}
>
	{#each cards as card, i (i)}
		<article class="rc-card" role="listitem">
			<header class="rc-header">
				<h4 class="rc-title">{card.title}</h4>
				{#if card.confidence !== undefined}
					<span
						class="rc-confidence"
						style="color: {confidenceColorToken(card.confidence)}"
						aria-label="Confidence: {formatConfidence(card.confidence)}"
					>
						{formatConfidence(card.confidence)}
					</span>
				{/if}
			</header>

			<p class="rc-summary">{card.summary}</p>

			{#if card.tags && card.tags.length > 0}
				<div class="rc-tags" aria-label="Tags">
					{#each truncateTags(card.tags, TAG_LIMIT) as tag (tag)}
						<span class="rc-tag">{tag}</span>
					{/each}
					{#if card.tags.length > TAG_LIMIT}
						<span class="rc-tag rc-tag--more"
							>+{card.tags.length - TAG_LIMIT}</span
						>
					{/if}
				</div>
			{/if}

			{#if card.url}
				<footer class="rc-footer">
					{#if isFieldNotesUri(card.url)}
						<FieldNotesChip uri={card.url} />
					{:else}
						<a
							class="rc-link"
							href={card.url}
							target="_blank"
							rel="noopener noreferrer"
							title={card.url}
						>
							{card.url}
						</a>
					{/if}
				</footer>
			{/if}
		</article>
	{/each}
</div>

<style>
	.rc-section-title {
		color: var(--text-meta);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--space-2) 0;
	}

	.rc-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: var(--space-3);
		margin: var(--space-2) 0;
	}

	.rc-card {
		background: var(--surface-leaf);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		box-shadow: var(--shadow-xs);
		transition: border-color var(--transition-fast);
	}

	.rc-card:hover {
		border-color: var(--border-edge);
	}

	.rc-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.rc-title {
		color: var(--text-prose);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: 600;
		line-height: 1.3;
		margin: 0;
		flex: 1;
	}

	.rc-confidence {
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		flex-shrink: 0;
		line-height: 1.4;
	}

	.rc-summary {
		color: var(--text-meta);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		line-height: 1.5;
		margin: 0;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.rc-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.rc-tag {
		background: var(--surface-hover);
		color: var(--text-muted);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		line-height: 1.4;
	}

	.rc-tag--more {
		background: transparent;
		border: 1px solid var(--border-hairline);
	}

	.rc-footer {
		margin-top: auto;
		min-width: 0;
	}

	.rc-link {
		color: var(--color-primary);
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: block;
		max-width: 100%;
	}

	.rc-link:hover {
		text-decoration: underline;
	}
</style>
