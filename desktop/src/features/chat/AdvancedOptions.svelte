<script lang="ts">
	import { chatStore } from './chat.svelte.js';
</script>

<div class="advanced-options">
	<h4 class="section-title">Advanced Options</h4>
	<div class="options-grid">
		<div class="option-field">
			<label class="option-label" for="maxIterations">Max iterations</label>
			<input
				id="maxIterations"
				type="number"
				class="option-input"
				min="1"
				max="200"
				value={chatStore.maxIterations}
				oninput={(e) =>
					chatStore.setMaxIterations(
						parseInt((e.currentTarget as HTMLInputElement).value) || 50,
					)}
				aria-describedby="maxIterations-desc"
			/>
			<span id="maxIterations-desc" class="option-hint">1–200</span>
		</div>

		<div class="option-field">
			<label class="option-label" for="maxTokens">Max tokens</label>
			<input
				id="maxTokens"
				type="number"
				class="option-input"
				min="0"
				max="200000"
				placeholder="Default"
				value={chatStore.maxTokens === 0 ? '' : chatStore.maxTokens}
				oninput={(e) =>
					chatStore.setMaxTokens(
						parseInt((e.currentTarget as HTMLInputElement).value) || 0,
					)}
				aria-describedby="maxTokens-desc"
			/>
			<span id="maxTokens-desc" class="option-hint">0 = default</span>
		</div>

		<div class="option-field">
			<label class="option-label" for="temperature">Temperature</label>
			<div class="range-wrapper">
				<input
					id="temperature"
					type="range"
					class="option-range"
					min="0"
					max="2"
					step="0.1"
					value={chatStore.temperature}
					oninput={(e) =>
						chatStore.setTemperature(
							parseFloat((e.currentTarget as HTMLInputElement).value),
						)}
					aria-valuemin={0}
					aria-valuemax={2}
					aria-valuenow={chatStore.temperature}
				/>
				<span class="range-value">{chatStore.temperature.toFixed(1)}</span>
			</div>
		</div>
	</div>
</div>

<style>
	.advanced-options {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.section-title {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		margin: 0;
	}

	.options-grid {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		align-items: flex-end;
	}

	.option-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 120px;
	}

	.option-label {
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		font-weight: var(--font-weight-medium);
	}

	.option-input {
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		padding: var(--space-2) var(--space-3);
		width: 100%;
		outline: none;
		transition: border-color var(--transition-fast);
	}

	.option-input:focus {
		border-color: var(--color-primary);
	}

	.option-hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-disabled);
	}

	.range-wrapper {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.option-range {
		flex: 1;
		accent-color: var(--color-primary);
		cursor: pointer;
	}

	.range-value {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--color-text-primary);
		min-width: 28px;
		text-align: right;
	}
</style>
