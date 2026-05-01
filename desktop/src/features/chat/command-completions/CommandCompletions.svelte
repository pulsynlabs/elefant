<script lang="ts">
	// Slash command completions overlay.
	//
	// Renders a fuzzy-matched dropdown of available commands sourced from the
	// canonical daemon registry via `commandsStore`. Designed to be mounted
	// from `MessageInput.svelte` which forwards keyboard events through
	// `handleKeydown` and listens for `onSelect` / `onDismiss`.
	//
	// Accessibility:
	//   - role="listbox" with role="option" rows
	//   - aria-activedescendant on the listbox tracks the highlighted item
	//   - The trigger characters that match the query are wrapped in <mark>
	//
	// The overlay does not own focus — it stays attached to the input so
	// keystrokes flow through naturally, mirroring the IDE / shell convention.

	import { onMount } from 'svelte';
	import { commandsStore } from '$lib/stores/commands.svelte.js';
	import { rankCommands, type Command, type RankedCommand } from './fuzzy.js';

	type Props = {
		query: string;
		onSelect: (trigger: string) => void;
		onDismiss: () => void;
	};

	let { query, onSelect, onDismiss }: Props = $props();

	let listEl: HTMLUListElement | undefined = $state(undefined);
	let highlightedIndex = $state(0);

	// Kick off the initial fetch on first mount; subsequent mounts are no-ops.
	onMount(() => {
		void commandsStore.load();
	});

	const ranked: RankedCommand[] = $derived(rankCommands(commandsStore.commands, query));

	// Reset / clamp the highlight whenever the visible list changes so the
	// user never lands on a stale row after typing further characters.
	$effect(() => {
		const len = ranked.length;
		if (len === 0) {
			highlightedIndex = 0;
			return;
		}
		if (highlightedIndex >= len) highlightedIndex = 0;
		if (highlightedIndex < 0) highlightedIndex = len - 1;
	});

	// Scroll the highlighted row into view; the overlay has limited height
	// and the user may have arrowed past the visible window.
	$effect(() => {
		if (!listEl) return;
		const item = listEl.querySelector<HTMLElement>(`[data-index="${highlightedIndex}"]`);
		item?.scrollIntoView({ block: 'nearest' });
	});

	function highlightNext(): void {
		if (ranked.length === 0) return;
		highlightedIndex = (highlightedIndex + 1) % ranked.length;
	}

	function highlightPrev(): void {
		if (ranked.length === 0) return;
		highlightedIndex = (highlightedIndex - 1 + ranked.length) % ranked.length;
	}

	function selectHighlighted(): boolean {
		if (ranked.length === 0) return false;
		const choice = ranked[highlightedIndex];
		if (!choice) return false;
		onSelect(choice.command.trigger);
		return true;
	}

	/**
	 * Public keyboard hook for the parent input. Returns true if the event
	 * was consumed (caller should preventDefault); false otherwise so the
	 * input can apply default behaviour (typing, submit, etc.).
	 */
	export function handleKeydown(event: KeyboardEvent): boolean {
		if (event.key === 'ArrowDown') {
			highlightNext();
			return true;
		}
		if (event.key === 'ArrowUp') {
			highlightPrev();
			return true;
		}
		if (event.key === 'Tab') {
			if (event.shiftKey) highlightPrev();
			else highlightNext();
			return true;
		}
		if (event.key === 'Enter') {
			// Enter only commits when an item is highlighted AND the list is
			// non-empty. The parent uses the boolean return to decide whether
			// to suppress the input's submit handler.
			if (ranked.length === 0) return false;
			return selectHighlighted();
		}
		if (event.key === 'Escape') {
			onDismiss();
			return true;
		}
		return false;
	}

	/** True when there is at least one match — parent uses this to decide
	 *  whether to render the overlay at all. */
	export function hasResults(): boolean {
		return ranked.length > 0;
	}

	function onItemClick(index: number): void {
		highlightedIndex = index;
		selectHighlighted();
	}

	function onItemPointerEnter(index: number): void {
		highlightedIndex = index;
	}

	function activeOptionId(): string | undefined {
		if (ranked.length === 0) return undefined;
		const choice = ranked[highlightedIndex];
		if (!choice) return undefined;
		return `command-completion-${choice.command.trigger.replace(/[^\w-]/g, '_')}`;
	}

	/**
	 * Split a trigger string into highlighted / plain segments based on the
	 * matched indices supplied by the ranker. Returns an array of segments
	 * the template renders sequentially.
	 */
	function highlightSegments(
		trigger: string,
		matchIndices: readonly number[],
	): Array<{ text: string; matched: boolean }> {
		if (matchIndices.length === 0) {
			return [{ text: trigger, matched: false }];
		}
		const set = new Set(matchIndices);
		const segments: Array<{ text: string; matched: boolean }> = [];
		let buffer = '';
		let bufferMatched = trigger.length > 0 && set.has(0);
		for (let i = 0; i < trigger.length; i++) {
			const matched = set.has(i);
			if (matched === bufferMatched) {
				buffer += trigger[i];
			} else {
				if (buffer.length > 0) segments.push({ text: buffer, matched: bufferMatched });
				buffer = trigger[i] ?? '';
				bufferMatched = matched;
			}
		}
		if (buffer.length > 0) segments.push({ text: buffer, matched: bufferMatched });
		return segments;
	}
</script>

{#if ranked.length > 0}
	<div
		class="command-completions"
		role="presentation"
		data-testid="command-completions"
	>
		<ul
			bind:this={listEl}
			class="command-list"
			role="listbox"
			aria-label="Slash command completions"
			aria-activedescendant={activeOptionId()}
			tabindex="-1"
		>
			{#each ranked as { command, matchIndices }, index (command.trigger)}
				{@const segments = highlightSegments(command.trigger, matchIndices)}
				{@const isHighlighted = index === highlightedIndex}
				<li
					id={`command-completion-${command.trigger.replace(/[^\w-]/g, '_')}`}
					class="command-item"
					class:highlighted={isHighlighted}
					role="option"
					aria-selected={isHighlighted}
					data-index={index}
					data-testid={`command-completion-${command.trigger}`}
					onpointerenter={() => onItemPointerEnter(index)}
					onmousedown={(event) => {
						// mousedown (not click) so the input keeps focus before the
						// event listener replaces its value. Without this, blur
						// would fire mid-handler and re-render the textarea empty.
						event.preventDefault();
						onItemClick(index);
					}}
				>
					<span class="trigger">
						{#each segments as segment, segIdx (segIdx)}
							{#if segment.matched}
								<mark class="match">{segment.text}</mark>
							{:else}<span>{segment.text}</span>{/if}
						{/each}
					</span>
					<span class="description">{command.description}</span>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.command-completions {
		position: absolute;
		bottom: calc(100% + var(--space-2));
		left: 0;
		right: 0;
		z-index: var(--z-popover, 50);
		background-color: var(--surface-overlay);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
		backdrop-filter: blur(14px) saturate(1.4);
		-webkit-backdrop-filter: blur(14px) saturate(1.4);
	}

	.command-list {
		list-style: none;
		margin: 0;
		padding: var(--space-1);
		max-height: 280px;
		overflow-y: auto;
		scrollbar-width: thin;
	}

	.command-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background-color var(--transition-fast);
	}

	.command-item.highlighted {
		background-color: var(--color-primary-subtle);
	}

	.trigger {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--text-prose);
		font-weight: 500;
	}

	.match {
		background: none;
		color: var(--color-primary);
		font-weight: 700;
		text-decoration: underline;
		text-underline-offset: 2px;
		text-decoration-thickness: 1px;
	}

	.description {
		font-size: var(--font-size-xs);
		color: var(--text-meta);
		font-family: var(--font-sans);
		line-height: 1.35;
	}

	.command-item.highlighted .description {
		color: var(--text-prose);
	}

	@media (prefers-reduced-motion: reduce) {
		.command-item {
			transition: none;
		}
	}
</style>
