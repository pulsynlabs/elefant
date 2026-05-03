<!--
@component
ResearchChip — inline chip that renders a `research://` URI or
`.elefant/markdown-db/**.md` reference inside chat output.

Lazy-fetches the file's frontmatter title via the research client and
swaps the placeholder text in once it lands. Click navigates to the
Research View, opens the file, and (if the URI carries a `#anchor`)
scrolls the reader to that heading slug.

Designed to be mounted as a normal Svelte component — not via
{@html} — so it gets full reactive lifecycle and onclick wiring. The
`MarkdownRenderer` link snippet detects research URIs by href and
emits this component instead of a plain anchor.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { HugeiconsIcon, ResearchIcon } from '$lib/icons/index.js';
	import { researchClient } from '$lib/daemon/research-client.js';
	import { researchStore } from '../research/research-store.svelte.js';
	import { navigationStore } from '$lib/stores/navigation.svelte.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import { parseResearchLink } from '../../../../src/research/link.js';

	type Props = {
		/** The full URI as it appeared in the chat — `research://...` or
		 * a `.elefant/markdown-db/...` relative path. Always non-empty. */
		uri: string;
		/** Optional override label. When omitted, the chip starts with a
		 * shortened URI and replaces it with the file title once the
		 * lazy fetch completes. */
		label?: string;
	};

	let { uri, label }: Props = $props();

	const parsed = $derived(parseResearchLink(uri));

	// Display text falls back through three tiers:
	//   1. explicit `label` prop (highest priority — author intent)
	//   2. fetched frontmatter title (after the lazy meta fetch resolves)
	//   3. shortened URI (immediate, no network)
	let resolvedTitle = $state<string | null>(null);
	let resolvedSection = $state<string | null>(null);
	let isLoading = $state(false);
	let hasError = $state(false);

	const shortPath = $derived(
		parsed.ok ? parsed.data.path.split('/').pop() ?? parsed.data.path : uri,
	);

	const displayText = $derived(label ?? resolvedTitle ?? shortPath);

	onMount(() => {
		if (!parsed.ok) return;
		const projectId = projectsStore.activeProjectId;
		if (!projectId) return;
		// Race-tolerant: if the chip unmounts before the fetch lands,
		// the assignment to `resolvedTitle` is harmless because Svelte
		// drops state mutations on unmounted components.
		isLoading = true;
		researchClient
			.getFile(projectId, parsed.data.path, true)
			.then((file) => {
				resolvedTitle = file.frontmatter.title ?? null;
				// `section` is reflected from frontmatter; fall back to
				// the first path segment so the chip always shows
				// something useful.
				resolvedSection =
					file.frontmatter.section ?? parsed.data.path.split('/')[0] ?? null;
			})
			.catch(() => {
				// Silent: chips degrade to the shortened URI on error.
				// We still surface a tooltip so users can debug 404s.
				hasError = true;
			})
			.finally(() => {
				isLoading = false;
			});
	});

	function handleClick(event: MouseEvent): void {
		// `preventDefault` is no longer strictly necessary for a
		// `<button>` (no default navigation) but kept for parity in
		// case the chip is ever wrapped inside a form.
		event.preventDefault();
		if (!parsed.ok) return;

		const projectId = projectsStore.activeProjectId;
		if (!projectId) return;

		navigationStore.goToResearch();
		void researchStore.openFile(
			projectId,
			parsed.data.path,
			parsed.data.anchor ?? undefined,
		);
	}

	const titleAttr = $derived.by(() => {
		if (hasError) return `Failed to load: ${uri}`;
		if (resolvedTitle) {
			const sec = resolvedSection ? ` · ${resolvedSection}` : '';
			return `${resolvedTitle}${sec}\n${uri}`;
		}
		return uri;
	});
</script>

<!-- A button (not anchor) because the chip dispatches via the navigation
     store rather than navigating to a real URL — `href="#"` would scroll
     to the top in the absence of `preventDefault`. We style it to look
     like an inline link so it still reads as navigational. -->
<button
	type="button"
	class="research-chip"
	class:loading={isLoading}
	class:error={hasError}
	title={titleAttr}
	onclick={handleClick}
	data-research-uri={uri}
>
	<span class="chip-icon" aria-hidden="true">
		<HugeiconsIcon icon={ResearchIcon} size={12} strokeWidth={1.75} />
	</span>
	<span class="chip-text">{displayText}</span>
	{#if resolvedSection}
		<span class="chip-section" aria-hidden="true">{resolvedSection}</span>
	{/if}
</button>

<style>
	/*
	 * Subtle inline badge — reads as part of running text, not a full
	 * button. Hairline border, primary-subtle wash, gently lifts on
	 * hover without changing color saturation enough to distract.
	 */
	.research-chip {
		/* Reset native button chrome before re-styling as an inline chip. */
		appearance: none;
		font: inherit;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 1px 6px 1px 5px;
		margin: 0 1px;
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
		line-height: var(--leading-snug);
		color: var(--color-primary);
		background-color: var(--color-primary-subtle);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-sm);
		text-decoration: none;
		cursor: pointer;
		vertical-align: baseline;
		white-space: nowrap;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			box-shadow var(--transition-fast),
			transform var(--transition-fast);
	}

	.research-chip:hover {
		background-color: color-mix(
			in oklch,
			var(--color-primary) 18%,
			var(--surface-leaf)
		);
		border-color: var(--border-emphasis);
		box-shadow: var(--shadow-xs);
		transform: translateY(-1px);
	}

	.research-chip:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.research-chip.loading {
		opacity: 0.75;
	}

	.research-chip.error {
		color: var(--color-error);
		border-color: color-mix(in oklch, var(--color-error) 35%, transparent);
		background-color: color-mix(in oklch, var(--color-error) 8%, transparent);
	}

	.chip-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 12px;
		height: 12px;
		flex-shrink: 0;
		color: currentColor;
	}

	.chip-text {
		font-weight: var(--font-weight-medium);
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 32ch;
	}

	.chip-section {
		display: inline-flex;
		align-items: center;
		padding: 0 4px;
		margin-left: 2px;
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		font-weight: var(--font-weight-normal);
		color: var(--text-muted);
		background-color: color-mix(
			in oklch,
			var(--color-primary) 8%,
			transparent
		);
		border-radius: var(--radius-xs);
		letter-spacing: var(--tracking-wide);
	}

	@media (prefers-reduced-motion: reduce) {
		.research-chip {
			transition: none;
		}

		.research-chip:hover {
			transform: none;
		}
	}
</style>
