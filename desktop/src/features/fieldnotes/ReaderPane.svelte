<!--
@component
ReaderPane — right-pane markdown reader for the Field Notes View.

Composition:
  • Sticky header  → Breadcrumbs + "Open in editor" button
  • FrontmatterPillBar → confidence, tags, sources, updated, author
  • Body grid → TableOfContents (≥1024px) + rendered HTML body

The HTML is server-rendered and sanitized by the daemon (`renderMarkdown`
+ `sanitizeHtml` in `routes-fieldnotes.ts`), so we use `{@html}` without
an extra client-side pass. We post-process the HTML once per file to:
  1. Assign deterministic IDs to h2/h3 (matches TableOfContents slug rule)
  2. Inject a hover-revealed "copy link" button inside each heading

The `fieldnotes://` link copied to the clipboard mirrors the format used
by the daemon for tree/file responses, so chip navigation round-trips.
-->
<script lang="ts">
	import { fade } from 'svelte/transition';
	import { fieldNotesStore } from './fieldnotes-store.svelte.js';
	import {
		HugeiconsIcon,
		LinkIcon,
	} from '$lib/icons/index.js';
	import Breadcrumbs from './Breadcrumbs.svelte';
	import FrontmatterPillBar from './FrontmatterPillBar.svelte';
	import TableOfContents from './TableOfContents.svelte';
	import OpenInEditorButton from './OpenInEditorButton.svelte';

	type Props = {
		projectId: string | null;
	};

	let { projectId }: Props = $props();

	// The container ref must be a $state so TableOfContents picks up the
	// transition from `null` → real element after the body renders.
	let bodyContainer = $state<HTMLDivElement | null>(null);

	let copyToast = $state<string | null>(null);
	let copyToastTimer: ReturnType<typeof setTimeout> | null = null;

	const fileContent = $derived(fieldNotesStore.fileContent);
	const isLoadingFile = $derived(fieldNotesStore.isLoadingFile);
	const selectedFile = $derived(fieldNotesStore.selectedFile);

	/**
	 * Mirror of the daemon's slug rule + heading-id assignment in a single
	 * pass over the rendered HTML string. The output gets piped through
	 * `{@html}` exactly once per file fetch.
	 *
	 * We avoid `MutationObserver` here because the post-processing is
	 * deterministic and idempotent — a fresh string-rewrite per file is
	 * cheaper than re-observing on every node insert.
	 */
	const processedHtml = $derived.by(() => {
		const html = fileContent?.html ?? '';
		if (!html) return '';
		return rewriteHeadings(html);
	});

	function slugify(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, '')
			.trim()
			.replace(/\s+/g, '-')
			.replace(/-+/g, '-');
	}

	/**
	 * Walk the heading tags in the HTML string and rewrite each opening tag
	 * to include `id="<slug>"` plus an inline copy-link button. We leave
	 * existing attributes untouched. Slug collisions are deduped via a
	 * monotonic counter — same approach Markdown rendering libraries use.
	 */
	function rewriteHeadings(html: string): string {
		const seen = new Map<string, number>();
		return html.replace(
			/<(h2|h3)>([\s\S]*?)<\/\1>/g,
			(_, tag: string, inner: string) => {
				const text = inner.replace(/<[^>]+>/g, '').trim();
				let slug = slugify(text);
				if (!slug) slug = `heading-${seen.size + 1}`;
				const count = seen.get(slug) ?? 0;
				const finalSlug = count === 0 ? slug : `${slug}-${count + 1}`;
				seen.set(slug, count + 1);
				const button = `<button type="button" class="heading-anchor-btn" data-anchor="${finalSlug}" aria-label="Copy link to section">#</button>`;
				return `<${tag} id="${finalSlug}" class="field-notes-heading">${inner}${button}</${tag}>`;
			},
		);
	}

	async function copyAnchorLink(anchor: string): Promise<void> {
		const link = fileContent?.fieldnotes_link;
		if (!link) return;
		const fullUri = `${link}#${anchor}`;
		try {
			await navigator.clipboard.writeText(fullUri);
			showToast(`Copied ${fullUri}`);
		} catch {
			showToast('Copy failed — see console');
			console.warn('[field-notes] clipboard copy failed', fullUri);
		}
	}

	function showToast(text: string): void {
		copyToast = text;
		if (copyToastTimer) clearTimeout(copyToastTimer);
		copyToastTimer = setTimeout(() => {
			copyToast = null;
			copyToastTimer = null;
		}, 2400);
	}

	/**
	 * Delegated click for the heading anchor buttons we injected in
	 * `rewriteHeadings`. Bubbling-based dispatch keeps the body re-render
	 * cheap and avoids re-binding handlers per file open.
	 */
	function handleBodyClick(event: MouseEvent): void {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const button = target.closest('.heading-anchor-btn');
		if (!(button instanceof HTMLElement)) return;
		const anchor = button.dataset.anchor;
		if (!anchor) return;
		event.preventDefault();
		void copyAnchorLink(anchor);
	}

	// After each new file load, scroll to the pending anchor (if any). We
	// run on a microtask after `processedHtml` updates so the heading IDs
	// are present in the DOM before we query them.
	$effect(() => {
		const html = processedHtml;
		if (!html || !bodyContainer) return;
		queueMicrotask(() => {
			const anchor = fieldNotesStore.consumePendingAnchor();
			if (!anchor || !bodyContainer) return;
			const target = bodyContainer.querySelector(`#${CSS.escape(anchor)}`);
			if (target instanceof HTMLElement) {
				target.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}
		});
	});
</script>

<section class="reader-pane" aria-label="Field note reader">
	{#if !selectedFile}
		<div class="reader-empty">
			<p class="empty-headline">Open a file</p>
			<p class="empty-body">
				Select a field note from the tree on the left to read it here.
			</p>
		</div>
	{:else if isLoadingFile && !fileContent}
		<div class="reader-loading" aria-busy="true" aria-live="polite">
			<div class="skeleton-line skeleton-title" aria-hidden="true"></div>
			<div class="skeleton-line skeleton-meta" aria-hidden="true"></div>
			<div class="skeleton-line skeleton-paragraph" aria-hidden="true"></div>
			<div class="skeleton-line skeleton-paragraph" aria-hidden="true"></div>
			<div class="skeleton-line skeleton-paragraph short" aria-hidden="true"></div>
		</div>
	{:else if fileContent}
		<header class="reader-sticky-header">
			<div class="reader-header-row">
				<Breadcrumbs path={fileContent.path} title={fileContent.frontmatter.title} />
				{#if projectId}
					<OpenInEditorButton {projectId} filePath={fileContent.path} />
				{/if}
			</div>
			<h1 class="reader-title">{fileContent.frontmatter.title}</h1>
		</header>

		<FrontmatterPillBar frontmatter={fileContent.frontmatter} />

		<div class="reader-body-grid">
			<!--
				The container intercepts bubbled clicks from the heading-anchor
				buttons we inject in `rewriteHeadings`. Those buttons are real
				`<button type="button">` elements — keyboard activation reaches
				the same handler natively, so no separate `onkeydown` is needed.
				`svelte-ignore` skips the false-positive a11y warning the
				delegation pattern triggers.
			-->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="field-notes-body"
				bind:this={bodyContainer}
				onclick={handleBodyClick}
			>
				{@html processedHtml}
			</div>
			<div class="reader-toc-rail">
				<TableOfContents
					container={bodyContainer}
					contentKey={fileContent.path}
				/>
			</div>
		</div>
	{/if}

	{#if copyToast}
		<output
			class="copy-toast"
			aria-live="polite"
			transition:fade={{ duration: 150 }}
		>
			<HugeiconsIcon icon={LinkIcon} size={12} strokeWidth={1.6} />
			<span>{copyToast}</span>
		</output>
	{/if}
</section>

<style>
	.reader-pane {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
		background-color: var(--surface-substrate);
		overflow-y: auto;
	}

	/* --- Empty state ----------------------------------------------------- */
	.reader-empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-9) var(--space-6);
		text-align: center;
	}

	.empty-headline {
		font-family: var(--font-display);
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--text-prose);
		letter-spacing: var(--tracking-tight);
		margin: 0 0 var(--space-2) 0;
	}

	.empty-body {
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		color: var(--text-muted);
		margin: 0;
		max-width: 36ch;
		line-height: var(--leading-relaxed);
	}

	/* --- Loading skeleton ----------------------------------------------- */
	.reader-loading {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-6) var(--space-7);
		max-width: 72ch;
		width: 100%;
		margin: 0 auto;
	}

	.skeleton-line {
		height: 12px;
		border-radius: var(--radius-sm);
		background-color: var(--surface-hover);
		animation: skeleton-pulse 1.6s var(--ease-standard) infinite;
	}

	.skeleton-title { width: 50%; height: 22px; }
	.skeleton-meta { width: 30%; height: 8px; }
	.skeleton-paragraph { width: 100%; }
	.skeleton-paragraph.short { width: 60%; }

	@keyframes skeleton-pulse {
		0%, 100% { opacity: 0.6; }
		50% { opacity: 1; }
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-line { animation: none; }
	}

	/* --- Sticky header --------------------------------------------------- */
	.reader-sticky-header {
		position: sticky;
		top: 0;
		z-index: var(--z-sticky);
		background-color: var(--surface-substrate);
		border-bottom: 1px solid var(--border-hairline);
		padding: var(--space-4) var(--space-6) var(--space-3);
		backdrop-filter: blur(8px);
	}

	.reader-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-width: 0;
		margin-bottom: var(--space-2);
	}

	.reader-title {
		font-family: var(--font-display);
		font-size: clamp(22px, 2.6vw, 32px);
		font-weight: var(--font-weight-semibold);
		color: var(--text-prose);
		letter-spacing: var(--tracking-tight);
		line-height: var(--leading-tight);
		font-optical-sizing: auto;
		margin: 0;
		overflow-wrap: anywhere;
	}

	/* --- Body + TOC grid ------------------------------------------------- */
	.reader-body-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-6);
		padding: var(--space-6) var(--space-6) var(--space-9);
	}

	@media (min-width: 1024px) {
		.reader-body-grid {
			grid-template-columns: minmax(0, 1fr) 200px;
			max-width: calc(72ch + 200px + var(--space-6));
			margin: 0 auto;
			padding-left: var(--space-7);
			padding-right: var(--space-7);
		}
	}

	.reader-toc-rail {
		display: none;
	}

	@media (min-width: 1024px) {
		.reader-toc-rail {
			display: block;
			position: sticky;
			top: calc(var(--space-4) * 2 + 60px);
			align-self: start;
			max-height: calc(100vh - 160px);
			overflow-y: auto;
		}
	}

	/* --- Field notes body prose ----------------------------------------- */
	/*
	 * `field-notes-body` styles target the daemon-rendered HTML. We use
	 * :global because the children come from {@html} and Svelte's scoped
	 * CSS doesn't reach them.
	 */
	.field-notes-body {
		max-width: 72ch;
		font-family: var(--font-body);
		font-size: var(--font-size-base);
		line-height: var(--leading-relaxed);
		color: var(--text-prose);
		min-width: 0;
	}

	.field-notes-body :global(h1) {
		font-family: var(--font-display);
		font-size: clamp(22px, 2.4vw, 28px);
		font-weight: var(--font-weight-semibold);
		margin: var(--space-7) 0 var(--space-3);
		color: var(--text-prose);
		letter-spacing: var(--tracking-tight);
		font-optical-sizing: auto;
	}

	.field-notes-body :global(.field-notes-heading) {
		position: relative;
		font-family: var(--font-display);
		color: var(--text-prose);
		letter-spacing: var(--tracking-tight);
		font-optical-sizing: auto;
		scroll-margin-top: 96px;
	}

	.field-notes-body :global(h2.field-notes-heading) {
		font-size: clamp(18px, 2vw, 22px);
		font-weight: var(--font-weight-semibold);
		margin: var(--space-7) 0 var(--space-3);
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--border-hairline);
	}

	.field-notes-body :global(h3.field-notes-heading) {
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-medium);
		letter-spacing: var(--tracking-snug);
		margin: var(--space-5) 0 var(--space-2);
	}

	.field-notes-body :global(.heading-anchor-btn) {
		opacity: 0;
		margin-left: var(--space-2);
		padding: 0 6px;
		border: none;
		background: transparent;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.75em;
		cursor: pointer;
		border-radius: var(--radius-xs);
		transition:
			opacity var(--transition-fast),
			color var(--transition-fast),
			background-color var(--transition-fast);
		vertical-align: middle;
	}

	.field-notes-body :global(.field-notes-heading:hover .heading-anchor-btn),
	.field-notes-body :global(.heading-anchor-btn:focus-visible) {
		opacity: 1;
		color: var(--color-primary);
	}

	.field-notes-body :global(.heading-anchor-btn:hover) {
		background-color: var(--surface-hover);
	}

	.field-notes-body :global(.heading-anchor-btn:focus-visible) {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.field-notes-body :global(p) {
		margin: 0 0 var(--space-4);
	}

	.field-notes-body :global(ul),
	.field-notes-body :global(ol) {
		margin: 0 0 var(--space-4);
		padding-left: var(--space-6);
	}

	.field-notes-body :global(li) {
		margin: var(--space-1) 0;
	}

	.field-notes-body :global(blockquote) {
		margin: var(--space-4) 0;
		padding: var(--space-2) var(--space-4);
		border-left: 2px solid var(--border-emphasis);
		color: var(--text-meta);
		font-style: italic;
	}

	.field-notes-body :global(blockquote p:last-child) {
		margin-bottom: 0;
	}

	.field-notes-body :global(hr) {
		border: none;
		border-top: 1px solid var(--border-hairline);
		margin: var(--space-6) 0;
	}

	.field-notes-body :global(a) {
		color: var(--color-primary);
		text-decoration: none;
		transition:
			color var(--transition-fast),
			text-decoration-color var(--transition-fast);
	}

	.field-notes-body :global(a:hover) {
		color: var(--color-primary-hover);
		text-decoration: underline;
		text-decoration-color: var(--color-primary);
		text-underline-offset: 2px;
	}

	.field-notes-body :global(a:focus-visible) {
		outline: none;
		box-shadow: var(--glow-focus);
		border-radius: var(--radius-xs);
	}

	.field-notes-body :global(code) {
		font-family: var(--font-mono);
		font-size: 0.9em;
		padding: 1px 6px;
		border-radius: var(--radius-xs);
		background-color: var(--surface-leaf);
		border: 1px solid var(--border-hairline);
		color: var(--text-prose);
	}

	.field-notes-body :global(pre) {
		margin: var(--space-4) 0;
		padding: var(--space-4);
		border-radius: var(--radius-md);
		background-color: var(--surface-leaf);
		border: 1px solid var(--border-hairline);
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		line-height: var(--leading-snug);
	}

	.field-notes-body :global(pre code) {
		background: transparent;
		border: none;
		padding: 0;
		font-size: inherit;
	}

	.field-notes-body :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: var(--space-4) 0;
		font-size: var(--font-size-sm);
	}

	.field-notes-body :global(th),
	.field-notes-body :global(td) {
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border-hairline);
		text-align: left;
	}

	.field-notes-body :global(th) {
		background-color: var(--surface-leaf);
		color: var(--text-prose);
		font-weight: var(--font-weight-semibold);
		border-bottom-color: var(--border-edge);
	}

	.field-notes-body :global(strong) {
		color: var(--text-prose);
		font-weight: var(--font-weight-semibold);
	}

	.field-notes-body :global(em) {
		color: var(--text-meta);
	}

	/* --- Copy toast ------------------------------------------------------ */
	.copy-toast {
		position: fixed;
		bottom: var(--space-7);
		right: var(--space-7);
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--border-emphasis);
		border-radius: var(--radius-md);
		background-color: var(--surface-overlay);
		color: var(--text-prose);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		box-shadow: var(--shadow-md);
		z-index: var(--z-toast);
		max-width: 60ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		backdrop-filter: blur(8px);
	}
</style>
