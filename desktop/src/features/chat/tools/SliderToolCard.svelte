<script lang="ts">
	import type { ToolCardProps } from './types.js';
	import ToolCardShell from './ToolCardShell.svelte';
	import { Slider } from '$lib/components/ui/slider/index.js';
	import { getDaemonClient } from '$lib/daemon/client.js';
	import {
		buildSubmitEnvelope,
		deriveDisplayStatus,
		parseSliderArgs,
		type SliderAnswerState,
	} from './slider-tool-card-state.js';
	import { formatValue } from '$lib/components/ui/slider/slider-state.js';

	let { toolCall }: ToolCardProps = $props();

	const parsed = $derived(parseSliderArgs(toolCall.arguments));
	const sliderId = $derived(toolCall.id);

	let answerState = $state<SliderAnswerState>('pending');
	let submittedValue = $state<number | null>(null);
	let errorMessage = $state<string | null>(null);

	const toolResult = $derived(toolCall.result);
	const displayStatus = $derived(
		deriveDisplayStatus(
			answerState,
			Boolean(toolResult),
			Boolean(toolResult?.isError),
		),
	);

	// If a tool_result lands (daemon returned a value before the user
	// interacted, or this is a historical message) flip into the
	// terminal state. We only mutate when the local state is still
	// pre-terminal so a freshly submitted card doesn't get clobbered.
	$effect(() => {
		if (toolResult && answerState !== 'submitted' && answerState !== 'error') {
			if (toolResult.isError) {
				answerState = 'error';
				errorMessage = toolResult.content;
			} else {
				answerState = 'submitted';
			}
		}
	});

	async function handleSubmit(value: number): Promise<void> {
		if (answerState === 'submitting' || answerState === 'submitted') return;

		answerState = 'submitting';
		submittedValue = value;
		const envelope = buildSubmitEnvelope(toolCall, value);

		const client = getDaemonClient();
		const result = await client.answerSlider(envelope.sliderId, envelope.value);

		if (result.ok) {
			answerState = 'submitted';
		} else {
			answerState = 'error';
			errorMessage = result.error;
		}
	}

	function handleRetry(): void {
		answerState = 'pending';
		errorMessage = null;
		submittedValue = null;
	}
</script>

<ToolCardShell
	toolName="slider"
	status={displayStatus}
	subtitle={parsed.ok ? parsed.value.label : undefined}
	errorMessage={errorMessage ?? undefined}
>
	{#if !parsed.ok}
		<div class="slider-tool-error" role="alert">{parsed.error}</div>
	{:else if answerState === 'submitted' || (toolResult && !toolResult.isError)}
		<div class="slider-tool-answered">
			<span class="answered-label">Submitted:</span>
			<span class="answered-value">
				{#if submittedValue !== null}
					{formatValue(submittedValue, parsed.value.step, parsed.value.unit)}
				{:else}
					{toolResult?.content ?? '—'}
				{/if}
			</span>
		</div>
	{:else if answerState === 'error'}
		<div class="slider-tool-error-state">
			<p class="error-text">{errorMessage ?? 'Failed to submit value.'}</p>
			<button type="button" class="retry-button" onclick={handleRetry}>Retry</button>
		</div>
	{:else}
		<div class="slider-tool-body" data-slider-id={sliderId}>
			<Slider
				label={parsed.value.label}
				min={parsed.value.min}
				max={parsed.value.max}
				step={parsed.value.step}
				default={parsed.value.default}
				unit={parsed.value.unit}
				disabled={answerState === 'submitting'}
				submitLabel={answerState === 'submitting' ? 'Submitting…' : 'Submit'}
				onSubmit={handleSubmit}
			/>
		</div>
	{/if}
</ToolCardShell>

<style>
	.slider-tool-body {
		padding: var(--space-3);
	}

	.slider-tool-answered {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		margin: var(--space-3);
		background-color: color-mix(in oklch, var(--color-success) 8%, transparent);
		border: 1px solid color-mix(in oklch, var(--color-success) 25%, transparent);
		border-radius: var(--radius-md);
	}

	.answered-label {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.answered-value {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-success);
		font-variant-numeric: tabular-nums;
	}

	.slider-tool-error-state {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		margin: var(--space-3);
		background-color: color-mix(in oklch, var(--color-error) 8%, transparent);
		border: 1px solid color-mix(in oklch, var(--color-error) 25%, transparent);
		border-radius: var(--radius-md);
	}

	.error-text {
		font-size: var(--font-size-sm);
		color: var(--color-error);
		margin: 0;
	}

	.slider-tool-error {
		padding: var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-error);
	}

	.retry-button {
		align-self: flex-start;
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-primary);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-1) var(--space-3);
		cursor: pointer;
		transition: background-color var(--transition-fast), border-color var(--transition-fast);
	}

	.retry-button:hover {
		background-color: var(--color-surface-hover);
		border-color: var(--color-border-strong);
	}

	.retry-button:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
		border-color: var(--border-focus);
	}
</style>
