<script lang="ts">
	import { HugeiconsIcon, ChevronDownIcon } from '$lib/icons/index.js';

	export type SelectOption = {
		value: string;
		label: string;
	};

	type Props = {
		value?: string;
		options: SelectOption[];
		id?: string;
		disabled?: boolean;
		placeholder?: string;
		'aria-label'?: string;
		class?: string;
	};

	let {
		value = $bindable(''),
		options,
		id,
		disabled = false,
		placeholder,
		'aria-label': ariaLabel,
		class: className = '',
	}: Props = $props();
</script>

<div class="select-wrapper {className}" class:disabled>
	<select
		{id}
		class="select-field"
		bind:value
		{disabled}
		aria-label={ariaLabel}
	>
		{#if placeholder && !value}
			<option value="" disabled selected>{placeholder}</option>
		{/if}
		{#each options as opt (opt.value)}
			<option value={opt.value}>{opt.label}</option>
		{/each}
	</select>
	<span class="select-chevron" aria-hidden="true">
		<HugeiconsIcon icon={ChevronDownIcon} size={14} strokeWidth={1.8} />
	</span>
</div>

<style>
	.select-wrapper {
		position: relative;
		display: inline-flex;
		align-items: center;
		width: 100%;
	}

	.select-field {
		appearance: none;
		-webkit-appearance: none;
		-moz-appearance: none;
		width: 100%;
		padding: 6px 36px 6px 12px;
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-md);
		background-color: var(--surface-plate);
		/* Override the global forms.css inline-SVG chevron — we render our own. */
		background-image: none;
		color: var(--text-prose);
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		line-height: 1.4;
		cursor: pointer;
		outline: none;
		transition:
			border-color var(--duration-fast) var(--ease-out-expo),
			box-shadow var(--duration-fast) var(--ease-out-expo);
	}

	.select-field:hover:not(:disabled) {
		border-color: var(--border-emphasis);
	}

	.select-field:focus,
	.select-field:focus-visible {
		outline: none;
		border-color: var(--border-focus);
		box-shadow: var(--glow-focus);
	}

	.select-field:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Native option list — honoured on most Chromium/Gecko popups. */
	.select-field option {
		background-color: var(--surface-leaf);
		color: var(--text-prose);
	}

	.select-chevron {
		position: absolute;
		right: 10px;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		pointer-events: none;
		transition: color var(--duration-fast) var(--ease-out-expo);
	}

	.select-wrapper:focus-within .select-chevron {
		color: var(--color-primary);
	}

	.select-wrapper.disabled .select-chevron {
		opacity: 0.5;
	}

	@media (prefers-reduced-motion: reduce) {
		.select-field,
		.select-chevron {
			transition: none;
		}
	}
</style>
