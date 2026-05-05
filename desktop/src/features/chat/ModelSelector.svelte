<script lang="ts">
	/**
	 * ModelSelector — searchable model picker grouped by provider.
	 *
	 * Shows all models fetched from configured providers, grouped under
	 * their provider name. Selecting a model sets both the provider and
	 * model on chatStore so the next send uses that model.
	 */
	import { fade, scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import {
		HugeiconsIcon,
		BotIcon,
		ChevronDownIcon,
		CheckIcon,
		SearchIcon,
	} from '$lib/icons/index.js';

	// Fallback SVG when provider has no registry icon
	const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="11" r="3"/><path d="M12 2v6"/><path d="M4.22 10.22l1.42 1.42M18.36 11.64l1.42-1.42"/></svg>`;
	import { chatStore } from './chat.svelte.js';
	import type { ModelEntry } from './chat.svelte.js';

	// ── Local state ───────────────────────────────────────────────────────────

	let open = $state(false);
	let query = $state('');
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let popoverEl = $state<HTMLDivElement | null>(null);
	let searchEl = $state<HTMLInputElement | null>(null);
	let focusedIndex = $state(-1);
	let popoverRect = $state({ top: 0, left: 0, width: 0, openUpward: false });

	// ── Derived: grouping + filtering ─────────────────────────────────────────

	type Group = { provider: string; models: ModelEntry[] };

	const allGroups = $derived.by<Group[]>(() => {
		const map = new Map<string, ModelEntry[]>();
		for (const m of chatStore.availableModels) {
			const bucket = map.get(m.provider) ?? [];
			bucket.push(m);
			map.set(m.provider, bucket);
		}
		const out: Group[] = [];
		for (const [provider, models] of map) {
			out.push({ provider, models });
		}
		return out;
	});

	const filteredGroups = $derived.by<Group[]>(() => {
		const q = query.trim().toLowerCase();
		if (!q) return allGroups;
		return allGroups
			.map((g) => ({
				provider: g.provider,
				models: g.models.filter(
					(m) =>
						m.name.toLowerCase().includes(q) ||
						m.id.toLowerCase().includes(q) ||
						g.provider.toLowerCase().includes(q),
				),
			}))
			.filter((g) => g.models.length > 0);
	});

	/** Flat list driving keyboard navigation. */
	const flatModels = $derived(filteredGroups.flatMap((g) => g.models));

	const hasModels = $derived(chatStore.availableModels.length > 0);

	const activeModel = $derived(chatStore.selectedModel);

	function triggerLabel(): string {
		if (chatStore.modelsLoading) return 'Loading…';
		if (!hasModels) return 'No models';
		if (!activeModel) return 'Select model';
		return activeModel.name || activeModel.id;
	}

	// ── Open / close ──────────────────────────────────────────────────────────

	function openPopover(): void {
		if (!hasModels && !chatStore.modelsLoading) return;
		open = true;
		query = '';
		focusedIndex = -1;
		// Focus the search input after the DOM updates
		requestAnimationFrame(() => searchEl?.focus());
	}

	function closePopover(returnFocus = true): void {
		if (!open) return;
		open = false;
		query = '';
		focusedIndex = -1;
		if (returnFocus) triggerEl?.focus();
	}

	function toggle(): void {
		if (open) closePopover();
		else openPopover();
	}

	function selectModel(model: ModelEntry): void {
		chatStore.setModel(model);
		closePopover();
	}

	// ── Position ──────────────────────────────────────────────────────────────

	const POPOVER_MAX_HEIGHT = 360;
	const POPOVER_GAP = 6;

	function updatePosition(): void {
		if (!triggerEl) return;
		const rect = triggerEl.getBoundingClientRect();
		const spaceBelow = window.innerHeight - rect.bottom - POPOVER_GAP;
		const spaceAbove = rect.top - POPOVER_GAP;
		const openUpward = spaceBelow < POPOVER_MAX_HEIGHT && spaceAbove > spaceBelow;

		popoverRect = {
			top: openUpward
				? rect.top - POPOVER_GAP   // bottom edge anchored via CSS
				: rect.bottom + POPOVER_GAP,
			left: rect.left,
			width: Math.max(rect.width, 280),
			openUpward,
		};
	}

	$effect(() => {
		if (!open) return;
		updatePosition();
		const onScroll = () => updatePosition();
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('resize', onScroll);
		return () => {
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('resize', onScroll);
		};
	});

	// ── Click outside ─────────────────────────────────────────────────────────

	$effect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (!target) return;
			if (triggerEl?.contains(target) || popoverEl?.contains(target)) return;
			closePopover(false);
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	});

	// ── Keyboard ──────────────────────────────────────────────────────────────

	function onTriggerKeydown(e: KeyboardEvent): void {
		if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			openPopover();
		}
	}

	function onPopoverKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			closePopover();
			return;
		}
		const total = flatModels.length;
		if (total === 0) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			focusedIndex = (focusedIndex + 1) % total;
			scrollFocusedIntoView();
			return;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			focusedIndex = (focusedIndex - 1 + total) % total;
			scrollFocusedIntoView();
			return;
		}
		if (e.key === 'Enter' && focusedIndex >= 0) {
			e.preventDefault();
			const m = flatModels[focusedIndex];
			if (m) selectModel(m);
		}
	}

	function scrollFocusedIntoView(): void {
		requestAnimationFrame(() => {
			popoverEl
				?.querySelector<HTMLElement>(`[data-idx="${focusedIndex}"]`)
				?.scrollIntoView({ block: 'nearest' });
		});
	}

	// ── Flat index helper ─────────────────────────────────────────────────────

	function flatIndexFor(groupIdx: number, modelIdx: number): number {
		let n = 0;
		for (let i = 0; i < groupIdx; i++) n += filteredGroups[i].models.length;
		return n + modelIdx;
	}

	// ── Motion ────────────────────────────────────────────────────────────────

	function motionDuration(base: number): number {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return base;
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : base;
	}
</script>

<div class="model-selector">
	<button
		bind:this={triggerEl}
		type="button"
		class="trigger"
		class:is-open={open}
		class:is-empty={!activeModel}
		disabled={!hasModels && !chatStore.modelsLoading}
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-label="Select model"
		onclick={toggle}
		onkeydown={onTriggerKeydown}
	>
		<span class="trigger-icon" aria-hidden="true">
			{#if activeModel?.iconSvg}
				{@html activeModel.iconSvg}
			{:else}
				<HugeiconsIcon icon={BotIcon} size={14} strokeWidth={1.5} />
			{/if}
		</span>
		<span class="trigger-label">{triggerLabel()}</span>
		<span class="trigger-chevron" class:flipped={open} aria-hidden="true">
			<HugeiconsIcon icon={ChevronDownIcon} size={12} strokeWidth={1.75} />
		</span>
	</button>

	{#if open}
		<div
			bind:this={popoverEl}
			class="popover"
			class:popover-upward={popoverRect.openUpward}
			role="dialog"
			aria-label="Select model"
			style:top={popoverRect.openUpward ? 'auto' : `${popoverRect.top}px`}
			style:bottom={popoverRect.openUpward ? `${window.innerHeight - popoverRect.top}px` : 'auto'}
			style:left="{popoverRect.left}px"
			style:min-width="{popoverRect.width}px"
			onkeydown={onPopoverKeydown}
			in:scale={{ duration: motionDuration(150), start: 0.96, easing: quintOut }}
			out:fade={{ duration: motionDuration(100) }}
		>
			<!-- Search -->
			<div class="search-row">
				<span class="search-icon" aria-hidden="true">
					<HugeiconsIcon icon={SearchIcon} size={14} strokeWidth={1.5} />
				</span>
				<input
					bind:this={searchEl}
					bind:value={query}
					type="text"
					class="search-input"
					placeholder="Search models…"
					autocomplete="off"
					spellcheck="false"
					aria-label="Search models"
				/>
			</div>

			<div class="list" role="listbox" aria-label="Models">
				{#if chatStore.modelsLoading && chatStore.availableModels.length === 0}
					<div class="empty-state">Loading models…</div>
				{:else if filteredGroups.length === 0}
					<div class="empty-state">No models match "{query}"</div>
				{:else}
					{#each filteredGroups as group, gi (group.provider)}
						<div class="group" role="group" aria-label={group.provider}>
							<div class="group-header">
								<span class="group-icon" aria-hidden="true">
									{@html group.models[0]?.iconSvg ?? FALLBACK_SVG}
								</span>
								{group.provider}
							</div>
							{#each group.models as model, mi (model.id)}
								{@const idx = flatIndexFor(gi, mi)}
								{@const isActive = activeModel?.provider === model.provider && activeModel?.id === model.id}
								<button
									type="button"
									class="option"
									class:is-active={isActive}
									class:is-focused={focusedIndex === idx}
									role="option"
									aria-selected={isActive}
									data-idx={idx}
									tabindex={-1}
									onclick={() => selectModel(model)}
									onmouseenter={() => (focusedIndex = idx)}
								>
									<span class="option-name">{model.name || model.id}</span>
									{#if model.name && model.name !== model.id}
										<span class="option-id">{model.id}</span>
									{/if}
									{#if isActive}
										<span class="option-check" aria-hidden="true">
											<HugeiconsIcon icon={CheckIcon} size={13} strokeWidth={2} />
										</span>
									{/if}
								</button>
							{/each}
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.model-selector {
		display: inline-flex;
		align-items: center;
		position: relative;
	}

	/* ── Trigger pill ──────────────────────────────────────────────────────── */

	.trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 28px;
		padding: 0 var(--space-2);
		max-width: 260px;
		background-color: var(--surface-leaf);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-full);
		color: var(--text-prose);
		font-family: inherit;
		font-size: var(--font-size-xs);
		font-weight: 500;
		line-height: 1;
		cursor: pointer;
		outline: none;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.trigger:hover:not(:disabled) {
		background-color: var(--surface-hover);
		border-color: var(--border-emphasis);
	}

	.trigger:focus-visible {
		border-color: var(--border-focus);
		box-shadow: var(--glow-focus);
	}

	.trigger.is-open {
		background-color: var(--surface-hover);
		border-color: var(--border-emphasis);
	}

	.trigger:disabled {
		color: var(--text-muted);
		cursor: not-allowed;
	}

	.trigger-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		color: var(--color-primary);
		flex: 0 0 auto;
		overflow: hidden;
	}

	/* Scale injected SVG to fit the 16×16 box */
	.trigger-icon :global(svg) {
		width: 16px;
		height: 16px;
		display: block;
		flex-shrink: 0;
	}

	.trigger:disabled .trigger-icon {
		color: var(--text-disabled);
	}

	.trigger-label {
		max-width: 26ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.trigger-chevron {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-meta);
		transition: transform var(--transition-fast);
		flex: 0 0 auto;
	}

	.trigger-chevron.flipped {
		transform: rotate(180deg);
	}

	/* ── Popover ───────────────────────────────────────────────────────────── */

	.popover {
		position: fixed;
		z-index: var(--z-dropdown);
		display: flex;
		flex-direction: column;
		max-height: 360px;
		background-color: var(--surface-plate);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-lg);
		transform-origin: top left;
		overflow: hidden;
	}

	.popover-upward {
		transform-origin: bottom left;
	}

	/* ── Search ────────────────────────────────────────────────────────────── */

	.search-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border-hairline);
		flex: 0 0 auto;
	}

	.search-icon {
		display: inline-flex;
		align-items: center;
		color: var(--text-muted);
		flex: 0 0 auto;
	}

	.search-input {
		flex: 1 1 auto;
		min-width: 0;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text-prose);
		font-family: inherit;
		font-size: var(--font-size-sm);
		line-height: 1.4;
	}

	.search-input::placeholder {
		color: var(--text-muted);
	}

	/* ── List ──────────────────────────────────────────────────────────────── */

	.list {
		flex: 1 1 auto;
		overflow-y: auto;
		padding: var(--space-1);
		scrollbar-width: thin;
	}

	.empty-state {
		padding: var(--space-4) var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--text-muted);
		text-align: center;
	}

	.group {
		display: flex;
		flex-direction: column;
	}

	.group + .group {
		margin-top: var(--space-1);
		padding-top: var(--space-1);
		border-top: 1px solid var(--border-hairline);
	}

	.group-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3) var(--space-1);
		font-size: var(--font-size-xs);
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-muted);
		user-select: none;
	}

	.group-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		overflow: hidden;
		opacity: 0.7;
	}

	.group-icon :global(svg) {
		width: 14px;
		height: 14px;
		display: block;
	}

	/* ── Option rows ───────────────────────────────────────────────────────── */

	.option {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--text-prose);
		font-family: inherit;
		font-size: var(--font-size-sm);
		text-align: left;
		cursor: pointer;
		outline: none;
		transition:
			background-color var(--transition-fast),
			color var(--transition-fast);
	}

	.option:hover,
	.option.is-focused {
		background-color: var(--surface-hover);
	}

	.option.is-active {
		background-color: var(--color-primary-subtle);
	}

	.option-name {
		flex: 0 0 auto;
		font-weight: 450;
		white-space: nowrap;
	}

	.option-id {
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-size-xs);
		color: var(--text-muted);
		font-family: var(--font-mono);
	}

	.option-check {
		margin-left: auto;
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		color: var(--color-primary);
	}

	/* ── Reduced motion ────────────────────────────────────────────────────── */

	@media (prefers-reduced-motion: reduce) {
		.trigger,
		.trigger-chevron,
		.option {
			transition: none;
		}
	}
</style>
