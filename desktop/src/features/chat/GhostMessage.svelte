<script lang="ts">
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	type Props = {
		/** The undone user prompt text — shown as a truncated single-line preview. */
		userContent: string;
		/** Called when the user clicks the inline "Redo" affordance. */
		onRedo: () => void;
		/** Called once the dissolve fade-out has finished, signalling the parent to drop this entry from the DOM. */
		onDismiss: () => void;
	};

	let { userContent, onRedo, onDismiss }: Props = $props();

	// `dissolving` flips when the 4s timer fires; the CSS transition then runs
	// the actual fade-out, after which we hand back to the parent via onDismiss.
	let dissolving = $state(false);

	const DISSOLVE_DELAY_MS = 4000;
	const FADE_OUT_MS = 250; // matches --duration-base

	let timer: ReturnType<typeof setTimeout> | null = null;
	let fadeTimer: ReturnType<typeof setTimeout> | null = null;

	function clearTimers() {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		if (fadeTimer !== null) {
			clearTimeout(fadeTimer);
			fadeTimer = null;
		}
	}

	function startTimer() {
		clearTimers();
		timer = setTimeout(() => {
			dissolving = true;
			// Hand back to parent only after the CSS opacity transition completes.
			fadeTimer = setTimeout(() => {
				onDismiss();
			}, FADE_OUT_MS);
		}, DISSOLVE_DELAY_MS);
	}

	function pauseTimer() {
		// Only meaningful while we haven't begun the dissolve transition yet.
		if (!dissolving && timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	}

	function resumeTimer() {
		if (!dissolving && timer === null) {
			startTimer();
		}
	}

	function handleRedo() {
		clearTimers();
		onRedo();
		// Ghost is done — parent removes it immediately, no fade.
		onDismiss();
	}

	$effect(() => {
		startTimer();
		return () => {
			clearTimers();
		};
	});
</script>

<!--
  GhostMessage — ephemeral tombstone for an undone user+assistant pair.
  Renders inline in the message list. Auto-dissolves after 4s; hovering
  pauses the countdown. The "Redo" affordance restores the pair via the
  parent's onRedo callback and dismisses immediately.
-->
<div
	class="ghost"
	class:ghost--dissolving={dissolving}
	role="status"
	aria-live="polite"
	transition:slide={{ duration: 150, easing: cubicOut }}
	onmouseenter={pauseTimer}
	onmouseleave={resumeTimer}
>
	<span class="ghost-label">↩ Removed</span>
	<span class="ghost-preview" title={userContent}>{userContent}</span>
	<button
		type="button"
		class="ghost-redo"
		onclick={handleRedo}
		aria-label="Redo this message"
	>
		<span aria-hidden="true">↩</span>
		Redo
	</button>
</div>

<style>
	/* Card surface — dimmed substrate with a dashed hairline so it reads
	   as removed-but-still-present. Opacity sits at 1 at rest; only the
	   dissolve state fades the whole card. */
	.ghost {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-3) var(--space-4);
		background-color: color-mix(in oklch, var(--surface-hover) 70%, transparent);
		border: 1px dashed var(--border-hairline);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-sm);
		opacity: 1;
		transition: opacity var(--duration-base) var(--ease-out-expo);
	}

	.ghost--dissolving {
		opacity: 0;
	}

	/* "↩ Removed" — small, uppercase, muted. Anchors the row at the left. */
	.ghost-label {
		flex: 0 0 auto;
		font-family: var(--font-sans);
		font-size: var(--font-size-xs);
		font-weight: 500;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
		white-space: nowrap;
	}

	/* Single-line truncated preview of the undone prompt. Flexes to fill
	   available space; the title attribute exposes the full text on hover. */
	.ghost-preview {
		flex: 1 1 auto;
		min-width: 0;
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		color: var(--text-disabled);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Redo button — text-only at rest, gains a primary-tinted shell on
	   hover. Sits at the trailing edge of the row. */
	.ghost-redo {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-3);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		font-weight: 500;
		color: var(--color-primary);
		background-color: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.ghost-redo:hover {
		color: var(--text-prose);
		background-color: var(--color-primary-subtle);
		border-color: var(--color-primary);
	}

	.ghost-redo:focus-visible {
		outline: 2px solid var(--border-emphasis);
		outline-offset: 2px;
	}
</style>
