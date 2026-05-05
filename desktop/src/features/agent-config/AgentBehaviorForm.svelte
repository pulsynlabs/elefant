<script lang="ts">
	// AgentBehaviorForm — edits the generation parameters of a profile.
	//
	// Renders range sliders for temperature and topP with client-side
	// validation that mirrors the daemon's Zod schema. Saves via the
	// agent-config store's `update(agentId, patch)`; on success the store
	// invalidates the cached resolved view so the parent card refetches
	// attribution.

	import type {
		AgentProfile,
		AgentBehavior,
	} from '$lib/types/agent-config.js';
	import { agentConfigStore } from '$lib/stores/agent-config.svelte.js';
	import {
		validateGeneration,
		hasErrors,
		type ValidationErrors,
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
	let temperature = $state(profile.behavior.temperature ?? 1);
	let topP = $state(profile.behavior.topP ?? 1);

	let isSaving = $state(false);
	let serverError = $state<string | null>(null);
	let submittedOnce = $state(false);

	const behaviorDraft = $derived<AgentBehavior>({
		...profile.behavior,
		temperature,
		topP,
	});

	const errors = $derived<ValidationErrors>(validateGeneration(behaviorDraft));

	// Show errors only after first submit, or on a per-field blur.
	let touched = $state<Record<string, boolean>>({});

	function markTouched(field: string): void {
		touched = { ...touched, [field]: true };
	}

	function errorFor(field: string): string | null {
		if (!submittedOnce && !touched[field]) return null;
		return errors[field] ?? null;
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
		temperature = profile.behavior.temperature ?? 1;
		topP = profile.behavior.topP ?? 1;
		touched = {};
		submittedOnce = false;
		serverError = null;
	}
</script>

<form class="form" onsubmit={handleSave} aria-labelledby="behavior-form-title">
	<header class="form-header">
		<h4 id="behavior-form-title" class="form-title">Generation</h4>
		<p class="form-subtitle">
			Sampling parameters for
			<span class="agent-id">{profile.id}</span>.
		</p>
	</header>

	<div class="fields">
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
			{isSaving ? 'Saving…' : 'Save behavior'}
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

	.field-value-readout {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--color-text-primary);
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
