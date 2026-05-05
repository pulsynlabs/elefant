<!--
@component
Breadcrumbs — splits a section-relative path into clickable parents.

For Research Base files, the path is `<section>/<filename>` (no nested
subfolders are part of MVP). The section segment is humanized via the same
casing rule the daemon uses (`02-tech` → `Tech`). The leaf segment is the
file title (passed in by the parent); we strip the `.md` extension if the
caller hands us the bare filename instead.

Clicking a section is a no-op today (the tree pane is already filtered by
section visually); we expose the optional `onSectionClick` so a future
section-filter affordance can wire in without an API change.
-->
<script lang="ts">
	import { HugeiconsIcon, ChevronRightIcon } from '$lib/icons/index.js';

	type Props = {
		/** Section-relative path, e.g. `02-tech/sqlite-vec.md`. */
		path: string;
		/** Display title for the leaf segment. Defaults to the filename. */
		title?: string;
		/** Optional callback when a section crumb is clicked. */
		onSectionClick?: (section: string) => void;
	};

	let { path, title, onSectionClick }: Props = $props();

	const parts = $derived(path.split('/').filter((p) => p.length > 0));
	const sectionSegment = $derived(parts.length > 1 ? parts[0] : null);
	const leafFile = $derived(parts[parts.length - 1] ?? '');
	const leafLabel = $derived(title ?? leafFile.replace(/\.md$/u, ''));

	function humanizeSection(section: string): string {
		return section
			.replace(/^\d+-/u, '')
			.replace(/-/g, ' ')
			.replace(/\b\w/g, (c) => c.toUpperCase());
	}
</script>

<nav class="breadcrumbs" aria-label="Breadcrumb">
	<ol class="crumb-list">
		<li class="crumb crumb-root">
			<span class="crumb-label">Research</span>
		</li>

		{#if sectionSegment}
			<li class="crumb-separator" aria-hidden="true">
				<HugeiconsIcon icon={ChevronRightIcon} size={12} strokeWidth={1.6} />
			</li>
			<li class="crumb">
				{#if onSectionClick}
					<button
						type="button"
						class="crumb-link"
						onclick={() => onSectionClick?.(sectionSegment)}
					>
						{humanizeSection(sectionSegment)}
					</button>
				{:else}
					<span class="crumb-label">{humanizeSection(sectionSegment)}</span>
				{/if}
			</li>
		{/if}

		<li class="crumb-separator" aria-hidden="true">
			<HugeiconsIcon icon={ChevronRightIcon} size={12} strokeWidth={1.6} />
		</li>
		<li class="crumb crumb-current" aria-current="page">
			<span class="crumb-label crumb-leaf">{leafLabel}</span>
		</li>
	</ol>
</nav>

<style>
	.breadcrumbs {
		min-width: 0;
	}

	.crumb-list {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
		color: var(--text-meta);
		min-width: 0;
	}

	.crumb {
		display: inline-flex;
		align-items: center;
		min-width: 0;
	}

	.crumb-separator {
		display: inline-flex;
		align-items: center;
		color: var(--text-muted);
		opacity: 0.6;
	}

	.crumb-label {
		color: var(--text-meta);
	}

	.crumb-root .crumb-label {
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		font-weight: var(--font-weight-medium);
		text-transform: uppercase;
		letter-spacing: var(--tracking-widest);
		color: var(--text-muted);
	}

	.crumb-link {
		background: none;
		border: none;
		padding: 2px var(--space-1);
		margin: 0;
		color: var(--text-meta);
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
		cursor: pointer;
		border-radius: var(--radius-xs);
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.crumb-link:hover {
		color: var(--color-primary);
		background-color: var(--surface-hover);
	}

	.crumb-link:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.crumb-current .crumb-leaf {
		color: var(--text-prose);
		font-weight: var(--font-weight-medium);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 32ch;
	}
</style>
