<script lang="ts">
	import { HugeiconsIcon, CheckIcon, CopyIcon } from '$lib/icons/index.js';

	type Props = {
		content: string;
		small?: boolean;
	};

	let { content, small = false }: Props = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	async function handleCopy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(content);
			copied = true;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				copied = false;
				timer = null;
			}, 2000);
		} catch {
			// Clipboard access failed — silently ignore
		}
	}
</script>

<button
	class="copy-btn"
	class:small
	class:copied
	onclick={handleCopy}
	aria-label={copied ? 'Copied!' : 'Copy to clipboard'}
	title={copied ? 'Copied!' : 'Copy to clipboard'}
>
	<span class="copy-icon" aria-hidden="true">
		{#if copied}
			<HugeiconsIcon icon={CheckIcon} size={small ? 12 : 14} strokeWidth={1.5} />
		{:else}
			<HugeiconsIcon icon={CopyIcon} size={small ? 12 : 14} strokeWidth={1.5} />
		{/if}
	</span>
</button>

<style>
	.copy-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 13px;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.copy-btn.small {
		width: 22px;
		height: 22px;
		font-size: 11px;
	}

	.copy-btn:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
		background-color: var(--color-surface-hover);
	}

	.copy-btn.copied {
		color: var(--color-success);
		border-color: var(--color-success);
		background-color: color-mix(in oklch, var(--color-success) 10%, transparent);
	}

	.copy-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
</style>
