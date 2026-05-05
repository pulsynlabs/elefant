<!--
@component
TableOfContents — heading outline with scroll-spy.

Reads `<h2>` and `<h3>` elements from a container ref (the rendered
field-notes-body div) after each render and renders a sticky outline. An
IntersectionObserver tracks which heading is currently in view so the
active item can be highlighted as the reader scrolls.

Heading IDs are generated client-side (the daemon's tiny markdown renderer
doesn't slugify), and we mirror the same slug rule the heading-anchor
post-processor in `ReaderPane.svelte` uses, so #anchor URLs round-trip.
-->
<script lang="ts">
	type Heading = { id: string; text: string; level: 2 | 3 };

	type Props = {
		/** The reader body element to scan for headings. */
		container: HTMLElement | null;
		/** Reactive token that bumps when content changes (e.g. file path). */
		contentKey: string | number;
		/** Optional callback when a heading is selected. */
		onSelect?: (id: string) => void;
	};

	let { container, contentKey, onSelect }: Props = $props();

	let headings = $state<Heading[]>([]);
	let activeId = $state<string | null>(null);
	let observer: IntersectionObserver | null = null;

	function rescan(): void {
		if (!container) {
			headings = [];
			return;
		}
		const nodes = container.querySelectorAll<HTMLHeadingElement>('h2, h3');
		const next: Heading[] = [];
		for (const node of nodes) {
			if (!node.id) continue; // ReaderPane assigns ids; skip if missing
			next.push({
				id: node.id,
				text: node.textContent?.trim() ?? '',
				level: node.tagName === 'H2' ? 2 : 3,
			});
		}
		headings = next;
		// Pre-seed activeId so the first heading is highlighted on first paint.
		activeId = next[0]?.id ?? null;
	}

	function attachObserver(): void {
		observer?.disconnect();
		observer = null;
		if (!container || headings.length === 0) return;

		// Trigger when a heading crosses the top 30% of the viewport. This
		// gives the active item a perceptible "lock-in" zone while the user
		// scrolls without flicker between adjacent headings.
		observer = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((e) => e.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
				if (visible[0]) {
					activeId = visible[0].target.id;
				}
			},
			{ rootMargin: '0px 0px -70% 0px', threshold: [0, 1] },
		);

		for (const heading of headings) {
			const el = container.querySelector(`#${CSS.escape(heading.id)}`);
			if (el) observer.observe(el);
		}
	}

	// Re-scan whenever the content key changes (new file opened) or the
	// container ref appears. We deliberately read `contentKey` to register
	// the dependency even though it's not used directly.
	$effect(() => {
		void contentKey;
		// Defer to next tick so the parent's {@html} render has flushed.
		queueMicrotask(() => {
			rescan();
			attachObserver();
		});
	});

	$effect(() => {
		return () => {
			observer?.disconnect();
			observer = null;
		};
	});

	function jumpTo(id: string): void {
		if (!container) return;
		const target = container.querySelector(`#${CSS.escape(id)}`);
		if (!(target instanceof HTMLElement)) return;
		target.scrollIntoView({ behavior: 'smooth', block: 'start' });
		activeId = id;
		onSelect?.(id);
	}
</script>

{#if headings.length > 0}
	<aside class="toc" aria-label="Table of contents">
		<p class="toc-title">On this page</p>
		<ol class="toc-list">
			{#each headings as heading (heading.id)}
				<li class="toc-item" data-level={heading.level}>
					<button
						type="button"
						class="toc-link"
						class:active={activeId === heading.id}
						onclick={() => jumpTo(heading.id)}
					>
						{heading.text || heading.id}
					</button>
				</li>
			{/each}
		</ol>
	</aside>
{/if}

<style>
	.toc {
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
		color: var(--text-meta);
		min-width: 0;
	}

	.toc-title {
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		font-weight: var(--font-weight-medium);
		text-transform: uppercase;
		letter-spacing: var(--tracking-widest);
		color: var(--text-muted);
		margin: 0 0 var(--space-2) 0;
		padding: 0 var(--space-2);
	}

	.toc-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		border-left: 1px solid var(--border-hairline);
	}

	.toc-item[data-level='3'] {
		padding-left: var(--space-3);
	}

	.toc-link {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		padding: 4px var(--space-2);
		margin: 0;
		color: var(--text-meta);
		font-family: inherit;
		font-size: inherit;
		line-height: var(--leading-snug);
		cursor: pointer;
		border-left: 2px solid transparent;
		margin-left: -1px;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast),
			background-color var(--transition-fast);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.toc-link:hover {
		color: var(--text-prose);
		background-color: var(--surface-hover);
	}

	.toc-link:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
		border-radius: var(--radius-xs);
	}

	.toc-link.active {
		color: var(--color-primary);
		border-left-color: var(--color-primary);
		font-weight: var(--font-weight-medium);
	}
</style>
