<script lang="ts">
	/**
	 * ModelSelector — compact "model pill" that opens a popover for selecting
	 * the active provider/model. Replaces the legacy ProviderSelector (which
	 * was a plain <select>) with a premium inline trigger + floating listbox.
	 *
	 * State source: chatStore.availableProviders / .selectedProvider /
	 * .defaultProvider — written via chatStore.setProvider.
	 *
	 * Provider strings may be namespaced ("anthropic/claude-sonnet-4-5") or
	 * flat ("openai"). Namespaced entries get grouped by their prefix; flat
	 * entries are listed under a single ungrouped section.
	 *
	 * Visuals: Quire tokens only — no hex literals, no Tailwind utilities.
	 */
	import { fade, scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import {
		HugeiconsIcon,
		BotIcon,
		ChevronDownIcon,
		CheckIcon,
	} from '$lib/icons/index.js';
	import { chatStore } from './chat.svelte.js';

	// --- Local state (Svelte 5 runes) -----------------------------------

	let open = $state(false);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let popoverEl = $state<HTMLDivElement | null>(null);
	let popoverRect = $state<{ top: number; left: number; width: number }>({
		top: 0,
		left: 0,
		width: 0,
	});
	/** Index of the option currently focused inside the listbox. -1 = none. */
	let focusedIndex = $state(-1);

	// --- Derived: active selection + grouping ---------------------------

	const activeProvider = $derived(
		chatStore.selectedProvider ??
			chatStore.defaultProvider ??
			(chatStore.availableProviders[0] ?? null),
	);

	const hasProviders = $derived(chatStore.availableProviders.length > 0);

	type Group = {
		label: string | null;
		options: Array<{ value: string; label: string }>;
	};

	/**
	 * Build the listbox sections. Strings containing "/" are grouped by the
	 * portion before the first slash. Strings without "/" go into a single
	 * ungrouped bucket (label = null) so the popover stays flat for them.
	 */
	const groups = $derived.by<Group[]>(() => {
		const namespaced = new Map<string, Group['options']>();
		const flat: Group['options'] = [];

		for (const provider of chatStore.availableProviders) {
			const slash = provider.indexOf('/');
			if (slash > 0) {
				const ns = provider.slice(0, slash);
				const label = provider.slice(slash + 1);
				const bucket = namespaced.get(ns) ?? [];
				bucket.push({ value: provider, label });
				namespaced.set(ns, bucket);
			} else {
				flat.push({ value: provider, label: provider });
			}
		}

		const out: Group[] = [];
		for (const [ns, options] of namespaced) {
			out.push({ label: prettifyNamespace(ns), options });
		}
		if (flat.length > 0) out.push({ label: null, options: flat });
		return out;
	});

	/** Flattened option list — drives keyboard navigation and indexing. */
	const flatOptions = $derived(groups.flatMap((g) => g.options));

	function prettifyNamespace(ns: string): string {
		if (!ns) return ns;
		return ns.charAt(0).toUpperCase() + ns.slice(1);
	}

	function shortLabel(provider: string | null): string {
		if (!provider) return 'No model';
		const slash = provider.indexOf('/');
		return slash > 0 ? provider.slice(slash + 1) : provider;
	}

	// --- Open / close lifecycle -----------------------------------------

	function openPopover(): void {
		if (!hasProviders) return;
		open = true;
		// Pre-focus the active option when opening; fall back to first.
		const activeIdx = flatOptions.findIndex((o) => o.value === activeProvider);
		focusedIndex = activeIdx >= 0 ? activeIdx : 0;
	}

	function closePopover(returnFocus = true): void {
		if (!open) return;
		open = false;
		focusedIndex = -1;
		if (returnFocus) triggerEl?.focus();
	}

	function toggle(): void {
		if (open) closePopover();
		else openPopover();
	}

	function selectOption(value: string): void {
		chatStore.setProvider(value);
		closePopover();
	}

	// --- Position the popover under the trigger -------------------------

	function updatePosition(): void {
		if (!triggerEl) return;
		const rect = triggerEl.getBoundingClientRect();
		popoverRect = {
			top: rect.bottom + 6,
			left: rect.left,
			width: Math.max(rect.width, 220),
		};
	}

	$effect(() => {
		if (!open) return;
		updatePosition();
		const onScroll = () => updatePosition();
		const onResize = () => updatePosition();
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('resize', onResize);
		};
	});

	// --- Click outside to close -----------------------------------------

	$effect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (!target) return;
			if (triggerEl?.contains(target)) return;
			if (popoverEl?.contains(target)) return;
			closePopover(false);
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	});

	// --- Focus management -----------------------------------------------

	$effect(() => {
		if (!open || !popoverEl) return;
		if (focusedIndex < 0) return;
		const node = popoverEl.querySelector<HTMLElement>(
			`[data-option-index="${focusedIndex}"]`,
		);
		node?.focus();
	});

	// --- Keyboard handlers ----------------------------------------------

	function onTriggerKeydown(e: KeyboardEvent): void {
		if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			openPopover();
		}
	}

	function onPopoverKeydown(e: KeyboardEvent): void {
		const total = flatOptions.length;
		if (total === 0) return;

		if (e.key === 'Escape') {
			e.preventDefault();
			closePopover();
			return;
		}

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			focusedIndex = (focusedIndex + 1) % total;
			return;
		}

		if (e.key === 'ArrowUp') {
			e.preventDefault();
			focusedIndex = (focusedIndex - 1 + total) % total;
			return;
		}

		if (e.key === 'Home') {
			e.preventDefault();
			focusedIndex = 0;
			return;
		}

		if (e.key === 'End') {
			e.preventDefault();
			focusedIndex = total - 1;
			return;
		}

		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			const opt = flatOptions[focusedIndex];
			if (opt) selectOption(opt.value);
			return;
		}

		// Tab traps inside the listbox: wrap forward/backward instead of leaving.
		if (e.key === 'Tab') {
			e.preventDefault();
			if (e.shiftKey) {
				focusedIndex = (focusedIndex - 1 + total) % total;
			} else {
				focusedIndex = (focusedIndex + 1) % total;
			}
		}
	}

	/**
	 * Compute the running flat index for an option given the group it lives
	 * in. Lets each row know its own listbox-wide index without the parent
	 * having to thread one through.
	 */
	function flatIndexFor(groupIdx: number, optionIdx: number): number {
		let n = 0;
		for (let i = 0; i < groupIdx; i++) n += groups[i].options.length;
		return n + optionIdx;
	}

	// --- Motion ---------------------------------------------------------
	//
	// Svelte's `scale` / `fade` directives are JS-driven, so a CSS
	// `@media (prefers-reduced-motion: reduce)` rule cannot disable them.
	// Mirror the helper used in ChatView / SpecModeView: read the media
	// query at call time and zero the duration when the user has opted
	// out. The base values below are aligned with Quire motion tokens
	// (`--duration-fast` ≈ 150ms, `--duration-instant` ≈ 50ms — we use
	// 100ms for the exit fade as a midpoint that feels brisk without
	// being abrupt) and the constants are mirrored at call sites with
	// comments tying them back to the tokens.
	function motionDuration(base: number): number {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
			return base;
		}
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : base;
	}

	// Mirrors --duration-fast (150ms) for the popover entrance scale.
	const POPOVER_IN_MS = 150;
	// Slightly faster than entrance (~midpoint of --duration-instant 50ms
	// and --duration-fast 150ms) — the popover should disappear briskly.
	const POPOVER_OUT_MS = 100;
</script>

<div class="model-selector">
	<button
		bind:this={triggerEl}
		type="button"
		class="trigger"
		class:is-open={open}
		class:is-empty={!activeProvider}
		disabled={!hasProviders}
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls="model-selector-listbox"
		aria-label={hasProviders
			? `Select AI model. Current: ${activeProvider ?? 'none'}`
			: 'No AI models configured'}
		onclick={toggle}
		onkeydown={onTriggerKeydown}
	>
		<span class="trigger-icon" aria-hidden="true">
			<HugeiconsIcon icon={BotIcon} size={14} strokeWidth={1.5} />
		</span>
		<span class="trigger-label">
			{hasProviders ? shortLabel(activeProvider) : 'No models'}
		</span>
		<span class="trigger-chevron" class:flipped={open} aria-hidden="true">
			<HugeiconsIcon icon={ChevronDownIcon} size={12} strokeWidth={1.75} />
		</span>
	</button>

	{#if open && hasProviders}
		<div
			bind:this={popoverEl}
			id="model-selector-listbox"
			class="popover"
			role="listbox"
			tabindex="-1"
			aria-label="Select AI model"
			style:top="{popoverRect.top}px"
			style:left="{popoverRect.left}px"
			style:min-width="{popoverRect.width}px"
			onkeydown={onPopoverKeydown}
			in:scale={{ duration: motionDuration(POPOVER_IN_MS), start: 0.96, easing: quintOut }}
			out:fade={{ duration: motionDuration(POPOVER_OUT_MS) }}
		>
			{#each groups as group, gi (group.label ?? `__flat-${gi}`)}
				<div class="group" role="group" aria-label={group.label ?? 'Models'}>
					{#if group.label}
						<div class="group-header">{group.label}</div>
					{/if}
					{#each group.options as option, oi (option.value)}
						{@const idx = flatIndexFor(gi, oi)}
						{@const isActive = option.value === activeProvider}
						<button
							type="button"
							class="option"
							class:is-active={isActive}
							role="option"
							aria-selected={isActive}
							data-option-index={idx}
							tabindex={focusedIndex === idx ? 0 : -1}
							onclick={() => selectOption(option.value)}
							onmouseenter={() => (focusedIndex = idx)}
						>
							<span class="option-label">{option.label}</span>
							{#if isActive}
								<span class="option-check" aria-hidden="true">
									<HugeiconsIcon
										icon={CheckIcon}
										size={14}
										strokeWidth={2}
									/>
								</span>
							{/if}
						</button>
					{/each}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.model-selector {
		display: inline-flex;
		align-items: center;
		position: relative;
	}

	/* ----- Trigger pill -------------------------------------------------- */

	.trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 28px;
		padding: 0 var(--space-2) 0 var(--space-2);
		max-width: 240px;
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
			box-shadow var(--transition-fast),
			color var(--transition-fast);
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

	.trigger:disabled,
	.trigger.is-empty:disabled {
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
	}

	.trigger:disabled .trigger-icon {
		color: var(--text-disabled);
	}

	.trigger-label {
		max-width: 22ch;
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

	/* ----- Popover ------------------------------------------------------- */

	.popover {
		position: fixed;
		z-index: var(--z-dropdown);
		max-height: 320px;
		overflow-y: auto;
		padding: var(--space-1);
		background-color: var(--surface-plate);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-lg);
		transform-origin: top left;
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
		padding: var(--space-2) var(--space-3) var(--space-1);
		font-size: var(--font-size-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
		user-select: none;
	}

	/* ----- Option rows --------------------------------------------------- */

	.option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--text-prose);
		font-family: inherit;
		font-size: var(--font-size-sm);
		font-weight: 400;
		line-height: 1.3;
		text-align: left;
		cursor: pointer;
		outline: none;
		transition:
			background-color var(--transition-fast),
			color var(--transition-fast);
	}

	.option:hover,
	.option:focus-visible {
		background-color: var(--surface-hover);
	}

	.option:focus-visible {
		box-shadow: inset 0 0 0 1px var(--border-emphasis);
	}

	.option.is-active {
		background-color: var(--color-primary-subtle);
		color: var(--text-prose);
	}

	.option.is-active:hover,
	.option.is-active:focus-visible {
		background-color: var(--color-primary-subtle);
	}

	.option-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		flex: 1 1 auto;
	}

	.option-check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-primary);
		flex: 0 0 auto;
	}

	/* ----- Reduced motion ----------------------------------------------- */

	@media (prefers-reduced-motion: reduce) {
		.trigger,
		.trigger-chevron,
		.option {
			transition: none;
		}
	}
</style>
