<script lang="ts">
	import type { ProviderEntry } from '$lib/daemon/types.js';
	import { getDaemonClient } from '$lib/daemon/client.js';
	import Tag from '$lib/components/ui/tag/Tag.svelte';
	import Spinner from '$lib/components/ui/spinner/Spinner.svelte';
	import { HugeiconsIcon, CheckIcon, CrossIcon } from '$lib/icons/index.js';

	type Props = {
		provider: ProviderEntry;
	};

	let { provider }: Props = $props();

	let testStatus = $state<'idle' | 'testing' | 'success' | 'error'>('idle');
	let testMessage = $state('');

	async function handleTest(): Promise<void> {
		testStatus = 'testing';
		testMessage = '';
		try {
			const client = getDaemonClient();
			const health = await client.checkHealth();
			if (health.ok) {
				testStatus = 'success';
				testMessage = 'Connected';
			} else {
				testStatus = 'error';
				testMessage = 'Daemon not responding correctly';
			}
		} catch (error) {
			testStatus = 'error';
			testMessage = error instanceof Error ? error.message : 'Connection failed';
		}
		setTimeout(() => {
			testStatus = 'idle';
			testMessage = '';
		}, 5000);
	}
</script>

<li class="provider-card glass-sm">
	<div class="card-main">
		<div class="card-info">
			<div class="card-header">
				<span class="provider-name">{provider.name}</span>
				<Tag variant={provider.format === 'anthropic' ? 'warning' : 'primary'}>
					{provider.format === 'openai' ? 'OpenAI' : 'Anthropic'}
				</Tag>
			</div>
			<div class="card-details">
				<span class="detail-label mono-label">Model</span>
				<span class="detail-value model-name">{provider.model}</span>
			</div>
			<div class="card-details">
				<span class="detail-label mono-label">Base URL</span>
				<span class="detail-value base-url">{provider.baseURL}</span>
			</div>
		</div>

		<div class="card-actions">
			<button
				class="btn-test"
				onclick={handleTest}
				disabled={testStatus === 'testing'}
				aria-label={`Test connection for ${provider.name}`}
			>
				{#if testStatus === 'testing'}
					<Spinner size="sm" /> Testing…
				{:else}
					Test Connection
				{/if}
			</button>

			{#if testStatus !== 'idle' && testStatus !== 'testing'}
				<div
					class="test-result"
					class:success={testStatus === 'success'}
					class:error={testStatus === 'error'}
					role="status"
					aria-live="polite"
				>
					<span class="status-icon" aria-hidden="true">
						<HugeiconsIcon
							icon={testStatus === 'success' ? CheckIcon : CrossIcon}
							size={14}
							strokeWidth={1.5}
						/>
					</span>
					{testMessage}
				</div>
			{/if}
		</div>
	</div>
</li>

<style>
	.provider-card {
		border-radius: var(--radius-lg);
		padding: var(--space-4) var(--space-5);
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.provider-card:hover {
		border-color: var(--color-border-strong);
		box-shadow: var(--shadow-sm);
	}

	.card-main {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.card-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		flex: 1;
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.provider-name {
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
	}

	.card-details {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.detail-label {
		color: var(--color-text-muted);
		min-width: 56px;
	}

	.detail-value {
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
	}

	.model-name {
		font-family: var(--font-mono);
		color: var(--color-text-primary);
	}

	.base-url {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 300px;
	}

	.card-actions {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.btn-test {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background-color: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-4);
		color: var(--color-text-secondary);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		cursor: pointer;
		white-space: nowrap;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.btn-test:hover:not(:disabled) {
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
	}

	.btn-test:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.test-result {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		white-space: nowrap;
	}

	.status-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}

	.test-result.success {
		color: var(--color-success);
	}

	.test-result.error {
		color: var(--color-error);
		max-width: 200px;
		word-break: break-word;
		white-space: normal;
		text-align: right;
	}
</style>
