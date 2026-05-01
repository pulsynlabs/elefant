<script lang="ts">
	// ModePicker — two-card radiogroup that lets the user choose between
	// Spec Mode (full structured workflow) and Quick Mode (free-form
	// conversation) at session creation.
	//
	// Behaviour
	//   • Selection is controlled internally; the component fires
	//     `onSelect(mode)` whenever the user picks a mode (click,
	//     Enter, Space, Arrow keys).
	//   • Arrow / Home / End keys move BOTH focus and selection,
	//     matching the WAI-ARIA radio group pattern.
	//   • Tab cycles to the next focusable element OUTSIDE the group;
	//     within the group, only the currently selected radio is in
	//     the tab order (roving tabindex).
	//
	// Accessibility
	//   role="radiogroup" with an aria-labelledby pointing at the
	//   visually-hidden group label. Each card is role="radio" with
	//   aria-checked reflecting selection.
	//
	// Styling: Quire tokens only — no hex literals.

	import { HugeiconsIcon, SpecModeIcon, FlashIcon } from '$lib/icons/index.js';
	import {
		applyModeKey,
		resolveInitialMode,
		type SessionMode,
	} from './mode-picker-state.js';

	type Props = {
		defaultMode?: SessionMode;
		onSelect: (mode: SessionMode) => void;
	};

	let { defaultMode = 'quick', onSelect }: Props = $props();

	// Internal selected state. Seeded from the prop on first render and
	// not reset when the prop changes — once the dialog is open the
	// caller should not be racing the user's clicks.
	// svelte-ignore state_referenced_locally
	let selected = $state<SessionMode>(resolveInitialMode(defaultMode));

	// Refs to each radio so keyboard handlers can move focus.
	let specEl = $state<HTMLButtonElement | null>(null);
	let quickEl = $state<HTMLButtonElement | null>(null);

	// Stable id pair so the visually-hidden group label can be
	// referenced via aria-labelledby. Random suffix lets multiple
	// pickers coexist (rare, but cheap insurance).
	const groupLabelId = `mode-picker-label-${Math.random().toString(36).slice(2, 8)}`;

	function elementFor(mode: SessionMode): HTMLButtonElement | null {
		return mode === 'spec' ? specEl : quickEl;
	}

	function selectMode(mode: SessionMode): void {
		selected = mode;
		onSelect(mode);
	}

	function handleKeydown(event: KeyboardEvent, current: SessionMode): void {
		const outcome = applyModeKey(event.key, current);
		if (outcome.kind === 'noop') return;

		// Stop the radiogroup keys from being interpreted by ancestors
		// (e.g. dialog form submit on Enter, or page scroll on Arrow).
		event.preventDefault();

		if (outcome.kind === 'select') {
			selectMode(outcome.mode);
			return;
		}

		// 'move' — change selection AND move DOM focus to that card.
		selectMode(outcome.mode);
		elementFor(outcome.mode)?.focus();
	}
</script>

<div
	class="mode-picker"
	role="radiogroup"
	aria-labelledby={groupLabelId}
>
	<span id={groupLabelId} class="visually-hidden">
		Choose a session mode
	</span>

	<button
		bind:this={specEl}
		type="button"
		class="mode-card"
		class:selected={selected === 'spec'}
		role="radio"
		aria-checked={selected === 'spec'}
		tabindex={selected === 'spec' ? 0 : -1}
		onclick={() => selectMode('spec')}
		onkeydown={(event) => handleKeydown(event, 'spec')}
	>
		<span class="mode-icon" aria-hidden="true">
			<HugeiconsIcon icon={SpecModeIcon} size={22} strokeWidth={1.5} />
		</span>
		<span class="mode-body">
			<span class="mode-title">Spec Mode</span>
			<span class="mode-description">
				Structured workflow with requirements, planning, and verification phases
			</span>
		</span>
	</button>

	<button
		bind:this={quickEl}
		type="button"
		class="mode-card"
		class:selected={selected === 'quick'}
		role="radio"
		aria-checked={selected === 'quick'}
		tabindex={selected === 'quick' ? 0 : -1}
		onclick={() => selectMode('quick')}
		onkeydown={(event) => handleKeydown(event, 'quick')}
	>
		<span class="mode-icon" aria-hidden="true">
			<HugeiconsIcon icon={FlashIcon} size={22} strokeWidth={1.5} />
		</span>
		<span class="mode-body">
			<span class="mode-title">Quick Mode</span>
			<span class="mode-description">
				Free-form conversation — great for exploration and quick tasks
			</span>
		</span>
	</button>
</div>

<style>
	.mode-picker {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
		width: 100%;
	}

	/* Single-column on narrow viewports — cards stack rather than
	   squeeze the description text into a 2-line ribbon. */
	@media (max-width: 520px) {
		.mode-picker {
			grid-template-columns: 1fr;
		}
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.mode-card {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-4);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		cursor: pointer;
		text-align: left;
		font-family: var(--font-sans);
		color: var(--color-text-primary);
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			box-shadow var(--transition-fast),
			transform var(--transition-fast);
	}

	.mode-card:hover:not(.selected) {
		background-color: var(--color-surface-hover);
		border-color: var(--color-border-strong);
	}

	.mode-card:focus-visible {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	.mode-card.selected {
		border-color: var(--color-primary);
		background-color: var(--color-primary-subtle);
	}

	.mode-card.selected:focus-visible {
		box-shadow: var(--glow-focus);
	}

	.mode-card:active {
		transform: translateY(1px);
	}

	.mode-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		border-radius: var(--radius-md);
		background-color: var(--color-surface-elevated);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		transition:
			background-color var(--transition-fast),
			color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.mode-card.selected .mode-icon {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border-color: var(--color-primary);
	}

	.mode-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.mode-title {
		font-size: var(--font-size-base);
		font-weight: var(--font-weight-semibold);
		letter-spacing: var(--tracking-snug);
		color: var(--color-text-primary);
	}

	.mode-description {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: var(--line-height-relaxed);
	}

	@media (prefers-reduced-motion: reduce) {
		.mode-card,
		.mode-icon {
			transition: none;
		}

		.mode-card:active {
			transform: none;
		}
	}
</style>
