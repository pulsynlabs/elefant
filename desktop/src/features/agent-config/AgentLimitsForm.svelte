<script lang="ts">
	// AgentLimitsForm — edits the limits and generation block of a profile.
	//
	// Renders number inputs and range sliders with client-side validation
	// that mirrors the daemon's Zod schema. Saves via the agent-config
	// store's `update(agentId, patch)`; on success the store invalidates
	// the cached resolved view so the parent card refetches attribution.

	import type {
		AgentProfile,
		AgentBehavior,
		AgentLimits,
	} from '$lib/types/agent-config.js';
	import { agentConfigStore } from '$lib/stores/agent-config.svelte.js';
	import {
		validateLimits,
		validateGeneration,
		mergeErrors,
		hasErrors,
		type ValidationErrors,
		LIMITS_BOUNDS,
		BEHAVIOR_BOUNDS,
	} from './validation.js';

	type Props = {
		profile: AgentProfile;
		onSaved?: (profile: AgentProfile) => void;
		onCancel?: () => void;
	};

	let { profile, onSaved, onCancel }: Props = $props();

	// Local draft state — initialized from the profile but decoupled so
	// the user can type without triggering upstream updates on every keystroke.
	let maxIterations = $state(profile.limits.maxIterations);
	let timeoutMs = $state(profile.limits.timeoutMs);
	let maxConcurrency = $state(profile.limits.maxConcurrency);
	let temperature = $state(profile.behavior.temperature ?? 1);
	let topP = $state(profile.behavior.topP ?? 1);
	let maxTokensText = $state(
		profile.behavior.maxTokens !== undefined
			? String(profile.behavior.maxTokens)
			: '',
	);

	let isSaving = $state(false);
	let serverError = $state<string | null>(null);
	let submittedOnce = $state(false);

	const timeoutSeconds = $derived((timeoutMs / 1000).toFixed(1));

	const parsedMaxTokens = $derived<number | undefined>(
		maxTokensText.trim().length === 0 ? undefined : Number(maxTokensText),
	);

	const limitsDraft = $derived<AgentLimits>({
		maxIterations,
		timeoutMs,
		maxConcurrency,
	});

	const behaviorDraft = $derived<AgentBehavior>({
		...profile.behavior,
		temperature,
		topP,
		maxTokens: parsedMaxTokens,
	});

	const errors = $derived<ValidationErrors>(
		mergeErrors(
			validateLimits(limitsDraft),
			validateGeneration(behaviorDraft),
		),
	);

	// Show errors only after first submit, or on a per-field blur.
	let touched = $state<Record<string, boolean>>({});

	function markTouched(field: string): void {
		touched = { ...touched, [field]: true };
	}

	function errorFor(field: string): string | null {
		if (!submittedOnce && !touched[field]) return null;
		return errors[field] ?? null;
	}

	function parseIntOr(raw: string, fallback: number): number {
		const n = parseInt(raw, 10);
		return Number.isFinite(n) ? n : fallback;
	}

	function parseFloatOr(raw: string, fallback: number): number {
		const n = parseFloat(raw);
		return Number.isFinite(n) ? n : fallback;
	}

	async function handleSave(event: Event): Promise<void> {
		event.preventDefault();
		submittedOnce = true;
		if (hasErrors(errors)) return;

		isSaving = true;
		serverError = null;
		try {
			const updated = await agentConfigStore.update(profile.id, {
				limits: limitsDraft,
				behavior: behaviorDraft,
			});
			if (!updated) {
				serverError = agentConfigStore.lastError ?? 'Failed to save';
				return;
			}
			onSaved?.(updated);
		} finally {
			isSaving = false;
		}
	}

	function handleReset(): void {
		maxIterations = profile.limits.maxIterations;
		timeoutMs = profile.limits.timeoutMs;
		maxConcurrency = profile.limits.maxConcurrency;
		temperature = profile.behavior.temperature ?? 1;
		topP = profile.behavior.topP ?? 1;
		maxTokensText =
			profile.behavior.maxTokens !== undefined
				? String(profile.behavior.maxTokens)
				: '';
		touched = {};
		submittedOnce = false;
		serverError = null;
	}
</script>

<form class="form" onsubmit={handleSave} aria-labelledby="limits-form-title">
	<header class="form-header">
		<h4 id="limits-form-title" class="form-title">Limits &amp; Generation</h4>
		<p class="form-subtitle">
			Caps and generation parameters for
			<span class="agent-id">{profile.id}</span>.
		</p>
	</header>

	<div class="fields">
		<!-- Limits -->
		<div class="field">
			<label class="field-label" for="max-iterations-{profile.id}">
				Max iterations
			</label>
			<input
				id="max-iterations-{profile.id}"
				class="input"
				class:input-invalid={errorFor('maxIterations')}
				type="number"
				min={LIMITS_BOUNDS.maxIterations.min}
				max={LIMITS_BOUNDS.maxIterations.max}
				step="1"
				value={maxIterations}
				oninput={(e) =>
					(maxIterations = parseIntOr(
						(e.currentTarget as HTMLInputElement).value,
						maxIterations,
					))}
				onblur={() => markTouched('maxIterations')}
				aria-invalid={errorFor('maxIterations') ? 'true' : undefined}
				aria-describedby="max-iterations-hint-{profile.id}"
			/>
			<p id="max-iterations-hint-{profile.id}" class="field-hint">
				{#if errorFor('maxIterations')}
					<span class="error">{errorFor('maxIterations')}</span>
				{:else}
					{LIMITS_BOUNDS.maxIterations.min}–{LIMITS_BOUNDS.maxIterations.max}
				{/if}
			</p>
		</div>

		<div class="field">
			<label class="field-label" for="timeout-{profile.id}">
				Timeout (ms)
				<span class="field-label-suffix">≈ {timeoutSeconds}s</span>
			</label>
			<input
				id="timeout-{profile.id}"
				class="input"
				class:input-invalid={errorFor('timeoutMs')}
				type="number"
				min={LIMITS_BOUNDS.timeoutMs.min}
				max={LIMITS_BOUNDS.timeoutMs.max}
				step="1000"
				value={timeoutMs}
				oninput={(e) =>
					(timeoutMs = parseIntOr(
						(e.currentTarget as HTMLInputElement).value,
						timeoutMs,
					))}
				onblur={() => markTouched('timeoutMs')}
				aria-invalid={errorFor('timeoutMs') ? 'true' : undefined}
				aria-describedby="timeout-hint-{profile.id}"
			/>
			<p id="timeout-hint-{profile.id}" class="field-hint">
				{#if errorFor('timeoutMs')}
					<span class="error">{errorFor('timeoutMs')}</span>
				{:else}
					{LIMITS_BOUNDS.timeoutMs.min}–{LIMITS_BOUNDS.timeoutMs.max}
				{/if}
			</p>
		</div>

		<div class="field">
			<label class="field-label" for="concurrency-{profile.id}">
				Max concurrency
			</label>
			<input
				id="concurrency-{profile.id}"
				class="input"
				class:input-invalid={errorFor('maxConcurrency')}
				type="number"
				min={LIMITS_BOUNDS.maxConcurrency.min}
				max={LIMITS_BOUNDS.maxConcurrency.max}
				step="1"
				value={maxConcurrency}
				oninput={(e) =>
					(maxConcurrency = parseIntOr(
						(e.currentTarget as HTMLInputElement).value,
						maxConcurrency,
					))}
				onblur={() => markTouched('maxConcurrency')}
				aria-invalid={errorFor('maxConcurrency') ? 'true' : undefined}
				aria-describedby="concurrency-hint-{profile.id}"
			/>
			<p id="concurrency-hint-{profile.id}" class="field-hint">
				{#if errorFor('maxConcurrency')}
					<span class="error">{errorFor('maxConcurrency')}</span>
				{:else}
					{LIMITS_BOUNDS.maxConcurrency.min}–{LIMITS_BOUNDS.maxConcurrency.max}
				{/if}
			</p>
		</div>

		<!-- Generation params -->
		<div class="field">
			<label class="field-label" for="temperature-{profile.id}">
				Temperature
				<span class="field-value-readout">{temperature.toFixed(2)}</span>
			</label>
			<input
				id="temperature-{profile.id}"
				class="range"
				type="range"
				min={BEHAVIOR_BOUNDS.temperature.min}
				max={BEHAVIOR_BOUNDS.temperature.max}
				step={BEHAVIOR_BOUNDS.temperature.step}
				value={temperature}
				oninput={(e) =>
					(temperature = parseFloatOr(
						(e.currentTarget as HTMLInputElement).value,
						temperature,
					))}
				onblur={() => markTouched('temperature')}
				aria-valuemin={BEHAVIOR_BOUNDS.temperature.min}
				aria-valuemax={BEHAVIOR_BOUNDS.temperature.max}
				aria-valuenow={temperature}
			/>
			{#if errorFor('temperature')}
				<p class="field-hint">
					<span class="error">{errorFor('temperature')}</span>
				</p>
			{/if}
		</div>

		<div class="field">
			<label class="field-label" for="topp-{profile.id}">
				Top P
				<span class="field-value-readout">{topP.toFixed(2)}</span>
			</label>
			<input
				id="topp-{profile.id}"
				class="range"
				type="range"
				min={BEHAVIOR_BOUNDS.topP.min}
				max={BEHAVIOR_BOUNDS.topP.max}
				step={BEHAVIOR_BOUNDS.topP.step}
				value={topP}
				oninput={(e) =>
					(topP = parseFloatOr(
						(e.currentTarget as HTMLInputElement).value,
						topP,
					))}
				onblur={() => markTouched('topP')}
				aria-valuemin={BEHAVIOR_BOUNDS.topP.min}
				aria-valuemax={BEHAVIOR_BOUNDS.topP.max}
				aria-valuenow={topP}
			/>
			{#if errorFor('topP')}
				<p class="field-hint">
					<span class="error">{errorFor('topP')}</span>
				</p>
			{/if}
		</div>

		<div class="field">
			<label class="field-label" for="max-tokens-{profile.id}">
				Max tokens
				<span class="field-label-suffix">optional</span>
			</label>
			<input
				id="max-tokens-{profile.id}"
				class="input"
				class:input-invalid={errorFor('maxTokens')}
				type="number"
				min={BEHAVIOR_BOUNDS.maxTokens.min}
				max={BEHAVIOR_BOUNDS.maxTokens.max}
				step="1"
				placeholder="Default"
				value={maxTokensText}
				oninput={(e) =>
					(maxTokensText = (e.currentTarget as HTMLInputElement).value)}
				onblur={() => markTouched('maxTokens')}
				aria-invalid={errorFor('maxTokens') ? 'true' : undefined}
				aria-describedby="max-tokens-hint-{profile.id}"
			/>
			<p id="max-tokens-hint-{profile.id}" class="field-hint">
				{#if errorFor('maxTokens')}
					<span class="error">{errorFor('maxTokens')}</span>
				{:else}
					Leave blank to use the provider default.
				{/if}
			</p>
		</div>
	</div>

	{#if serverError}
		<div class="server-error" role="alert">
			{serverError}
		</div>
	{/if}

	<footer class="form-actions">
		{#if onCancel}
			<button
				type="button"
				class="button button-secondary"
				onclick={onCancel}
				disabled={isSaving}
			>
				Cancel
			</button>
		{/if}
		<button
			type="button"
			class="button button-secondary"
			onclick={handleReset}
			disabled={isSaving}
		>
			Reset
		</button>
		<button
			type="submit"
			class="button button-primary"
			disabled={isSaving || hasErrors(errors)}
		>
			{isSaving ? 'Saving…' : 'Save limits'}
		</button>
	</footer>
</form>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	.form-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.form-title {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-snug);
		margin: 0;
	}

	.form-subtitle {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin: 0;
	}

	.agent-id {
		font-family: var(--font-mono);
		color: var(--color-text-secondary);
	}

	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: var(--space-4);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.field-label {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-secondary);
	}

	.field-label-suffix {
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs, 10px);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: var(--tracking-widest);
	}

	.field-value-readout {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--color-text-primary);
	}

	.input {
		background-color: var(--color-surface-elevated);
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

	.range {
		accent-color: var(--color-primary);
		cursor: pointer;
	}

	.range:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 4px;
	}

	.field-hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-disabled);
		margin: 0;
	}

	.error {
		color: var(--color-error, #b23a3a);
	}

	.server-error {
		padding: var(--space-3);
		border: 1px solid color-mix(
			in srgb,
			var(--color-error, #b23a3a) 50%,
			transparent
		);
		border-radius: var(--radius-md);
		background-color: color-mix(
			in srgb,
			var(--color-error, #b23a3a) 12%,
			transparent
		);
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-3);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
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
</style>
