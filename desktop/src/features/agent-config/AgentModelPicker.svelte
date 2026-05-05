<script lang="ts">
	/**
	 * AgentModelPicker — reusable, Quire-styled, searchable model picker for
	 * the Agent Profiles view.
	 *
	 * Reuses the chat composer's existing model store (`chatStore`) — it does
	 * NOT introduce a parallel fetcher. Models are eager-loaded at app mount
	 * by `App.svelte`, so opening this picker is effectively free.
	 *
	 * Surface tiers:
	 *   - Trigger button : .quire-sm
	 *   - Dropdown panel : .quire-md
	 *   - Provider header: .quire-sm chip (uppercase mono)
	 *   - Model row      : flat with --color-surface-hover on hover
	 *
	 * The picker emits selection via the `onChange` prop only — no DOM events,
	 * no two-way binding. Selecting "Inherit from default" calls onChange(null).
	 */

	import { chatStore, type ModelEntry } from '../chat/chat.svelte.js';
	import {
		HugeiconsIcon,
		SearchIcon,
		CheckIcon,
		ChevronDownIcon,
	} from '$lib/icons/index.js';

	// ── Props ────────────────────────────────────────────────────────────────

	type Props = {
		value: { provider: string; model: string } | null;
		onChange: (value: { provider: string; model: string } | null) => void;
		disabled?: boolean;
	};

	const { value, onChange, disabled = false }: Props = $props();

	// ── Local state ──────────────────────────────────────────────────────────

	let open = $state(false);
	let query = $state('');
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let panelEl = $state<HTMLDivElement | null>(null);
	let searchEl = $state<HTMLInputElement | null>(null);
	let focusedIndex = $state(-1);

	// ── Derived: grouping + filtering ────────────────────────────────────────

	type Group = { provider: string; models: ModelEntry[] };

	/** Stable list of provider groups, alphabetised by provider name. */
	const allGroups = $derived.by<Group[]>(() => {
		const map = new Map<string, ModelEntry[]>();
		for (const m of chatStore.availableModels) {
			const bucket = map.get(m.provider) ?? [];
			bucket.push(m);
			map.set(m.provider, bucket);
		}
		const out: Group[] = [];
		for (const [provider, models] of map) {
			out.push({
				provider,
				models: [...models].sort((a, b) =>
					(a.name || a.id).localeCompare(b.name || b.id),
				),
			});
		}
		out.sort((a, b) => a.provider.localeCompare(b.provider));
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

	/** Flat list of selectable rows — drives keyboard navigation.
	 *  Index 0 is always the "Inherit from default" sentinel; model rows
	 *  follow in the order the groups render. */
	type FlatRow =
		| { kind: 'inherit' }
		| { kind: 'model'; entry: ModelEntry };

	const flatRows = $derived.by<FlatRow[]>(() => {
		const out: FlatRow[] = [{ kind: 'inherit' }];
		for (const g of filteredGroups) {
			for (const m of g.models) out.push({ kind: 'model', entry: m });
		}
		return out;
	});

	const isLoading = $derived(chatStore.modelsLoading);
	const hasModels = $derived(chatStore.availableModels.length > 0);

	const triggerLabel = $derived.by(() => {
		if (!value) return 'Inherit from default';
		// Prefer the registry's display name when we can match the value.
		const match = chatStore.availableModels.find(
			(m) => m.provider === value.provider && m.id === value.model,
		);
		return match?.name || match?.id || value.model;
	});

	const triggerIsMuted = $derived(value === null);

	// ── Open / close ─────────────────────────────────────────────────────────

	function openPanel(): void {
		if (disabled) return;
		open = true;
		query = '';
		focusedIndex = -1;
		requestAnimationFrame(() => searchEl?.focus());
	}

	function closePanel(returnFocus = true): void {
		if (!open) return;
		open = false;
		query = '';
		focusedIndex = -1;
		if (returnFocus) triggerEl?.focus();
	}

	function toggle(): void {
		if (open) closePanel();
		else openPanel();
	}

	function selectRow(row: FlatRow): void {
		if (row.kind === 'inherit') {
			onChange(null);
		} else {
			onChange({ provider: row.entry.provider, model: row.entry.id });
		}
		closePanel();
	}

	function isSelected(entry: ModelEntry): boolean {
		return (
			value !== null &&
			value.provider === entry.provider &&
			value.model === entry.id
		);
	}

	// ── Click outside ────────────────────────────────────────────────────────

	$effect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (!target) return;
			if (triggerEl?.contains(target) || panelEl?.contains(target)) return;
			closePanel(false);
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	});

	// ── Keyboard ─────────────────────────────────────────────────────────────

	function onTriggerKeydown(e: KeyboardEvent): void {
		if (disabled) return;
		if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			openPanel();
		}
	}

	function onPanelKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			closePanel();
			return;
		}

		const total = flatRows.length;
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
		if ((e.key === 'Enter' || e.key === ' ') && focusedIndex >= 0) {
			e.preventDefault();
			const row = flatRows[focusedIndex];
			if (row) selectRow(row);
		}
	}

	function scrollFocusedIntoView(): void {
		requestAnimationFrame(() => {
			panelEl
				?.querySelector<HTMLElement>(`[data-idx="${focusedIndex}"]`)
				?.scrollIntoView({ block: 'nearest' });
		});
	}
</script>

<div class="picker">
	<button
		bind:this={triggerEl}
		type="button"
		class="trigger quire-sm"
		class:muted={triggerIsMuted}
		class:open
		{disabled}
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls="agent-model-picker-panel"
		onclick={toggle}
		onkeydown={onTriggerKeydown}
	>
		<span class="trigger-label">{triggerLabel}</span>
		<HugeiconsIcon
			icon={ChevronDownIcon}
			size={14}
			strokeWidth={2}
			class="trigger-chevron"
		/>
	</button>

	{#if open}
		<div
			bind:this={panelEl}
			id="agent-model-picker-panel"
			class="panel quire-md"
			role="listbox"
			aria-label="Select model"
			tabindex="-1"
			onkeydown={onPanelKeydown}
		>
			<div class="search">
				<HugeiconsIcon
					icon={SearchIcon}
					size={14}
					strokeWidth={2}
					class="search-icon"
				/>
				<input
					bind:this={searchEl}
					bind:value={query}
					type="text"
					placeholder="Search models or providers…"
					class="search-input"
					aria-label="Filter models"
					autocomplete="off"
					spellcheck="false"
				/>
			</div>

			<div class="list" role="presentation">
				{#if isLoading && !hasModels}
					<div class="empty">Loading models…</div>
				{:else if !hasModels}
					<div class="empty">No models configured</div>
				{:else}
					<!-- "Inherit from default" sentinel — always at index 0 -->
					{@const inheritFocused = focusedIndex === 0}
					<button
						type="button"
						class="row inherit"
						class:focused={inheritFocused}
						class:selected={value === null}
						role="option"
						aria-selected={value === null}
						data-idx="0"
						onclick={() => selectRow({ kind: 'inherit' })}
						onmouseenter={() => (focusedIndex = 0)}
					>
						<span class="row-label">Inherit from default</span>
						{#if value === null}
							<HugeiconsIcon
								icon={CheckIcon}
								size={14}
								strokeWidth={2}
								class="row-check"
							/>
						{/if}
					</button>

					{#if filteredGroups.length === 0}
						<div class="empty subdued">No models match "{query}"</div>
					{:else}
						{#each filteredGroups as group (group.provider)}
							<div class="group">
								<div class="group-header quire-sm">
									{group.provider}
								</div>
								<div class="group-rows">
									{#each group.models as entry (entry.provider + ':' + entry.id)}
										{@const idx = flatRows.findIndex(
											(r) =>
												r.kind === 'model' &&
												r.entry.provider === entry.provider &&
												r.entry.id === entry.id,
										)}
										{@const focused = idx >= 0 && focusedIndex === idx}
										{@const selected = isSelected(entry)}
										<button
											type="button"
											class="row"
											class:focused
											class:selected
											role="option"
											aria-selected={selected}
											data-idx={idx}
											onclick={() => selectRow({ kind: 'model', entry })}
											onmouseenter={() => (focusedIndex = idx)}
										>
											<span class="row-name">{entry.name || entry.id}</span>
											{#if entry.name && entry.name !== entry.id}
												<span class="row-id">{entry.id}</span>
											{/if}
											{#if selected}
												<HugeiconsIcon
													icon={CheckIcon}
													size={14}
													strokeWidth={2}
													class="row-check"
												/>
											{/if}
										</button>
									{/each}
								</div>
							</div>
						{/each}
					{/if}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.picker {
		position: relative;
		display: inline-block;
		width: 100%;
		max-width: 320px;
	}

	/* ── Trigger ──────────────────────────────────────────────────────── */

	.trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-height: 32px;
		padding: var(--space-1-5) var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--text-prose);
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.trigger:hover:not([disabled]) {
		border-color: var(--border-emphasis);
	}

	.trigger:focus-visible {
		outline: 1px solid var(--border-focus);
		outline-offset: 2px;
	}

	.trigger[disabled] {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.trigger.muted .trigger-label {
		color: var(--text-muted);
		font-family: var(--font-body);
		font-style: italic;
	}

	.trigger-label {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.trigger :global(.trigger-chevron) {
		flex: 0 0 auto;
		color: var(--text-muted);
		transition: transform var(--transition-fast);
	}

	.trigger.open :global(.trigger-chevron) {
		transform: rotate(180deg);
	}

	/* ── Panel ────────────────────────────────────────────────────────── */

	.panel {
		position: absolute;
		top: calc(100% + var(--space-1));
		left: 0;
		right: 0;
		min-width: 280px;
		max-height: 360px;
		display: flex;
		flex-direction: column;
		padding: var(--space-2);
		z-index: 50;
		overflow: hidden;
	}

	/* ── Search ───────────────────────────────────────────────────────── */

	.search {
		position: relative;
		display: flex;
		align-items: center;
		padding: 0 var(--space-1);
		margin-bottom: var(--space-2);
		border-bottom: 1px solid var(--border-hairline);
	}

	.search :global(.search-icon) {
		flex: 0 0 auto;
		color: var(--text-muted);
		margin-right: var(--space-2);
	}

	.search-input {
		flex: 1 1 auto;
		min-width: 0;
		padding: var(--space-1-5) 0;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text-prose);
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
	}

	.search-input::placeholder {
		color: var(--text-muted);
	}

	/* ── List ─────────────────────────────────────────────────────────── */

	.list {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding-right: var(--space-1);
	}

	.empty {
		padding: var(--space-3) var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--text-muted);
		text-align: center;
	}

	.empty.subdued {
		font-style: italic;
	}

	/* ── Group header (Quire SM chip style) ──────────────────────────── */

	.group {
		margin-top: var(--space-2);
	}

	.group:first-of-type {
		margin-top: var(--space-3);
	}

	.group-header {
		display: inline-block;
		padding: 2px var(--space-2);
		margin: 0 var(--space-1) var(--space-1);
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs, 10px);
		font-weight: 600;
		letter-spacing: var(--tracking-widest);
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.group-rows {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	/* ── Row ──────────────────────────────────────────────────────────── */

	.row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-height: 32px;
		padding: var(--space-1-5) var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-leaf);
		color: var(--text-prose);
		text-align: left;
		cursor: pointer;
		transition: background-color var(--transition-fast);
	}

	.row:hover,
	.row.focused {
		background-color: var(--color-surface-hover);
	}

	.row.selected {
		background-color: color-mix(
			in oklch,
			var(--color-primary, #4049e1) 12%,
			var(--surface-plate)
		);
	}

	.row:focus-visible {
		outline: 1px solid var(--border-focus);
		outline-offset: -1px;
	}

	.row-label {
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		color: var(--text-prose);
	}

	.row-name {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--text-prose);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-id {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 14ch;
	}

	.row :global(.row-check) {
		color: var(--color-primary, #4049e1);
		flex: 0 0 auto;
	}

	.row.inherit {
		grid-template-columns: 1fr auto;
		font-style: italic;
		color: var(--text-meta);
		margin-bottom: var(--space-1);
		border-bottom: 1px solid var(--border-hairline);
		border-radius: 0;
		padding-bottom: var(--space-2);
	}

	.row.inherit .row-label {
		color: inherit;
	}

	/* ── Reduced motion ───────────────────────────────────────────────── */

	@media (prefers-reduced-motion: reduce) {
		.trigger :global(.trigger-chevron),
		.row,
		.trigger {
			transition: none;
		}
	}
</style>
