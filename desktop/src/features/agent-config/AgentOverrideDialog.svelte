<script lang="ts">
	// AgentOverrideDialog — launched from the chat composer to set per-run
	// overrides for the NEXT chat POST. Fields are optional; any field
	// left empty falls through to the AdvancedOptions / profile defaults.
	//
	// Confirm writes the shape into `chatStore.setAgentOverride` so the
	// next call to `buildChatRequestFields()` reflects the override. The
	// dialog does not itself send the request — it only stages state.

	import type { AgentRunOverride } from '$lib/types/agent-config.js';
	import {
		validateLimits,
		validateGeneration,
		BEHAVIOR_BOUNDS,
		LIMITS_BOUNDS,
		mergeErrors,
		hasErrors,
		type ValidationErrors,
	} from './validation.js';

	type Props = {
		initialOverride: AgentRunOverride;
		availableProviders: string[];
		onConfirm: (override: AgentRunOverride) => void;
		onCancel: () => void;
	};

	let { initialOverride, availableProviders, onConfirm, onCancel }: Props =
		$props();

	// Keep text inputs as strings so the user can type, erase, and retype
	// without the UI fighting them. Values are parsed at confirm time.
	let providerDraft = $state(initialOverride.provider ?? '');
	let modelDraft = $state(initialOverride.model ?? '');
	let temperatureDraft = $state(
		initialOverride.temperature !== undefined
			? String(initialOverride.temperature)
			: '',
	);
	let topPDraft = $state(
		initialOverride.topP !== undefined ? String(initialOverride.topP) : '',
	);
	let maxTokensDraft = $state(
		initialOverride.maxTokens !== undefined
			? String(initialOverride.maxTokens)
			: '',
	);
	let maxIterationsDraft = $state(
		initialOverride.maxIterations !== undefined
			? String(initialOverride.maxIterations)
			: '',
	);
	let timeoutMsDraft = $state(
		initialOverride.timeoutMs !== undefined
			? String(initialOverride.timeoutMs)
			: '',
	);

	let confirmButtonEl = $state<HTMLButtonElement | null>(null);
	let submitted = $state(false);

	$effect(() => {
		confirmButtonEl?.focus();
	});

	function parseOptionalNumber(raw: string): number | undefined {
		const trimmed = raw.trim();
		if (trimmed.length === 0) return undefined;
		const n = Number(trimmed);
		return Number.isFinite(n) ? n : undefined;
	}

	function parseOptionalInt(raw: string): number | undefined {
		const trimmed = raw.trim();
		if (trimmed.length === 0) return undefined;
		const n = parseInt(trimmed, 10);
		return Number.isFinite(n) ? n : undefined;
	}

	const draft = $derived<AgentRunOverride>({
		provider: providerDraft.trim() || undefined,
		model: modelDraft.trim() || undefined,
		temperature: parseOptionalNumber(temperatureDraft),
		topP: parseOptionalNumber(topPDraft),
		maxTokens: parseOptionalInt(maxTokensDraft),
		maxIterations: parseOptionalInt(maxIterationsDraft),
		timeoutMs: parseOptionalInt(timeoutMsDraft),
	});

	// Only validate fields that are actually set — leaving everything blank
	// is a valid "clear the override" state.
	const errors = $derived<ValidationErrors>(
		mergeErrors(
			draft.maxIterations !== undefined ||
				draft.timeoutMs !== undefined
				? validateLimits({
						maxIterations:
							draft.maxIterations ?? LIMITS_BOUNDS.maxIterations.min,
						timeoutMs: draft.timeoutMs ?? LIMITS_BOUNDS.timeoutMs.min,
						maxConcurrency: LIMITS_BOUNDS.maxConcurrency.min,
					})
				: {},
			validateGeneration({
				temperature: draft.temperature,
				topP: draft.topP,
				maxTokens: draft.maxTokens,
			}),
		),
	);

	// Scope the limit errors to only the fields actually edited; the
	// validator above fills in placeholder values for the untouched ones.
	const scopedErrors = $derived<ValidationErrors>({
		...(draft.maxIterations !== undefined && errors.maxIterations
			? { maxIterations: errors.maxIterations }
			: {}),
		...(draft.timeoutMs !== undefined && errors.timeoutMs
			? { timeoutMs: errors.timeoutMs }
			: {}),
		...(errors.temperature ? { temperature: errors.temperature } : {}),
		...(errors.topP ? { topP: errors.topP } : {}),
		...(errors.maxTokens ? { maxTokens: errors.maxTokens } : {}),
	});

	function errorFor(field: keyof ValidationErrors): string | null {
		if (!submitted) return null;
		return scopedErrors[field] ?? null;
	}

	function handleConfirm(event: Event): void {
		event.preventDefault();
		submitted = true;
		if (hasErrors(scopedErrors)) return;

		// Strip undefined keys so the snapshot is minimal. This also
		// ensures `hasAgentOverride()` returns false when everything is
		// cleared.
		const cleaned: AgentRunOverride = {};
		if (draft.provider !== undefined) cleaned.provider = draft.provider;
		if (draft.model !== undefined) cleaned.model = draft.model;
		if (draft.temperature !== undefined) cleaned.temperature = draft.temperature;
		if (draft.topP !== undefined) cleaned.topP = draft.topP;
		if (draft.maxTokens !== undefined) cleaned.maxTokens = draft.maxTokens;
		if (draft.maxIterations !== undefined)
			cleaned.maxIterations = draft.maxIterations;
		if (draft.timeoutMs !== undefined) cleaned.timeoutMs = draft.timeoutMs;

		onConfirm(cleaned);
	}

	function handleClear(): void {
		providerDraft = '';
		modelDraft = '';
		temperatureDraft = '';
		topPDraft = '';
		maxTokensDraft = '';
		maxIterationsDraft = '';
		timeoutMsDraft = '';
		submitted = false;
		onConfirm({});
	}

	function handleBackdropKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onCancel();
		}
	}

	function handleBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) onCancel();
	}
</script>

<svelte:window onkeydown={handleBackdropKeydown} />

<div
	class="backdrop"
	role="presentation"
	onclick={handleBackdropClick}
>
	<form
		class="dialog"
		role="dialog"
		aria-modal="true"
		aria-labelledby="override-title"
		aria-describedby="override-description"
		onsubmit={handleConfirm}
	>
		<header class="dialog-header">
			<h2 id="override-title" class="dialog-title">Run with override</h2>
			<p id="override-description" class="dialog-description">
				These values apply to the <strong>next</strong> chat request only.
				Leave a field blank to use the profile default.
			</p>
		</header>

		<div class="fields">
			<div class="field">
				<label class="field-label" for="override-provider">Provider</label>
				{#if availableProviders.length > 0}
					<select
						id="override-provider"
						class="input"
						bind:value={providerDraft}
					>
						<option value="">Default</option>
						{#each availableProviders as provider (provider)}
							<option value={provider}>{provider}</option>
						{/each}
					</select>
				{:else}
					<input
						id="override-provider"
						class="input"
						type="text"
						placeholder="e.g. anthropic"
						bind:value={providerDraft}
					/>
				{/if}
			</div>

			<div class="field">
				<label class="field-label" for="override-model">Model</label>
				<input
					id="override-model"
					class="input"
					type="text"
					placeholder="e.g. claude-opus-4-7"
					bind:value={modelDraft}
				/>
			</div>

			<div class="field">
				<label class="field-label" for="override-temperature">
					Temperature
				</label>
				<input
					id="override-temperature"
					class="input"
					class:input-invalid={errorFor('temperature')}
					type="number"
					min={BEHAVIOR_BOUNDS.temperature.min}
					max={BEHAVIOR_BOUNDS.temperature.max}
					step={BEHAVIOR_BOUNDS.temperature.step}
					placeholder="Default"
					bind:value={temperatureDraft}
				/>
				{#if errorFor('temperature')}
					<p class="field-hint error">{errorFor('temperature')}</p>
				{/if}
			</div>

			<div class="field">
				<label class="field-label" for="override-topp">Top P</label>
				<input
					id="override-topp"
					class="input"
					class:input-invalid={errorFor('topP')}
					type="number"
					min={BEHAVIOR_BOUNDS.topP.min}
					max={BEHAVIOR_BOUNDS.topP.max}
					step={BEHAVIOR_BOUNDS.topP.step}
					placeholder="Default"
					bind:value={topPDraft}
				/>
				{#if errorFor('topP')}
					<p class="field-hint error">{errorFor('topP')}</p>
				{/if}
			</div>

			<div class="field">
				<label class="field-label" for="override-max-tokens">Max tokens</label>
				<input
					id="override-max-tokens"
					class="input"
					class:input-invalid={errorFor('maxTokens')}
					type="number"
					min={BEHAVIOR_BOUNDS.maxTokens.min}
					max={BEHAVIOR_BOUNDS.maxTokens.max}
					step="1"
					placeholder="Default"
					bind:value={maxTokensDraft}
				/>
				{#if errorFor('maxTokens')}
					<p class="field-hint error">{errorFor('maxTokens')}</p>
				{/if}
			</div>

			<div class="field">
				<label class="field-label" for="override-max-iterations">
					Max iterations
				</label>
				<input
					id="override-max-iterations"
					class="input"
					class:input-invalid={errorFor('maxIterations')}
					type="number"
					min={LIMITS_BOUNDS.maxIterations.min}
					max={LIMITS_BOUNDS.maxIterations.max}
					step="1"
					placeholder="Default"
					bind:value={maxIterationsDraft}
				/>
				{#if errorFor('maxIterations')}
					<p class="field-hint error">{errorFor('maxIterations')}</p>
				{/if}
			</div>

			<div class="field">
				<label class="field-label" for="override-timeout">
					Timeout (ms)
				</label>
				<input
					id="override-timeout"
					class="input"
					class:input-invalid={errorFor('timeoutMs')}
					type="number"
					min={LIMITS_BOUNDS.timeoutMs.min}
					max={LIMITS_BOUNDS.timeoutMs.max}
					step="1000"
					placeholder="Default"
					bind:value={timeoutMsDraft}
				/>
				{#if errorFor('timeoutMs')}
					<p class="field-hint error">{errorFor('timeoutMs')}</p>
				{/if}
			</div>
		</div>

		<footer class="dialog-actions">
			<button
				type="button"
				class="button button-ghost"
				onclick={handleClear}
			>
				Clear override
			</button>
			<div class="actions-right">
				<button
					type="button"
					class="button button-secondary"
					onclick={onCancel}
				>
					Cancel
				</button>
				<button
					type="submit"
					class="button button-primary"
					bind:this={confirmButtonEl}
					disabled={hasErrors(scopedErrors)}
				>
					Apply to next run
				</button>
			</div>
		</footer>
	</form>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal, 1000);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
		background-color: color-mix(in srgb, var(--color-bg) 70%, transparent);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		animation: fade-in var(--transition-fast) ease-out;
	}

	.dialog {
		width: 100%;
		max-width: 560px;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-6);
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-xl);
		animation: scale-in var(--transition-fast) ease-out;
		max-height: 90vh;
		overflow-y: auto;
	}

	.dialog-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.dialog-title {
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-snug);
		margin: 0;
	}

	.dialog-description {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: var(--line-height-relaxed);
		margin: 0;
	}

	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--space-4);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field-label {
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		font-weight: var(--font-weight-medium);
	}

	.input {
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		padding: var(--space-2) var(--space-3);
		outline: none;
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.input:focus-visible {
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	.input-invalid,
	.input-invalid:focus-visible {
		border-color: var(--color-error, #b23a3a);
		box-shadow: none;
	}

	.field-hint {
		font-size: var(--font-size-xs);
		margin: 0;
	}

	.error {
		color: var(--color-error, #b23a3a);
	}

	.dialog-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
	}

	.actions-right {
		display: flex;
		gap: var(--space-3);
	}

	.button {
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.button:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.button:disabled {
		cursor: progress;
		opacity: 0.65;
	}

	.button-ghost {
		border: 1px solid transparent;
		background: transparent;
		color: var(--color-text-muted);
	}

	.button-ghost:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.button-secondary {
		border: 1px solid var(--color-border-strong);
		background: transparent;
		color: var(--color-text-primary);
	}

	.button-secondary:hover:not(:disabled) {
		background-color: var(--color-surface-hover);
	}

	.button-primary {
		border: 1px solid var(--color-primary);
		background-color: var(--color-primary);
		color: var(--color-primary-foreground, #fff);
	}

	.button-primary:hover:not(:disabled) {
		background-color: color-mix(in srgb, var(--color-primary) 90%, black);
	}

	@keyframes fade-in {
		from { opacity: 0; }
		to   { opacity: 1; }
	}

	@keyframes scale-in {
		from { opacity: 0; transform: scale(0.96); }
		to   { opacity: 1; transform: scale(1); }
	}

	@media (prefers-reduced-motion: reduce) {
		.backdrop, .dialog {
			animation: none;
		}
	}

	@media (max-width: 520px) {
		.dialog {
			padding: var(--space-5);
		}

		.dialog-actions {
			flex-direction: column-reverse;
			align-items: stretch;
		}

		.actions-right {
			justify-content: stretch;
		}

		.button {
			flex: 1;
		}
	}
</style>
