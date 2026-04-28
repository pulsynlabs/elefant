<script lang="ts">
	import type { ToolCardProps } from './types.js';
	import ToolCardShell from './ToolCardShell.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { getDaemonClient } from '$lib/daemon/client.js';
	import { HugeiconsIcon, CheckSquareIcon, UncheckSquareIcon } from '$lib/icons/index.js';

	let { toolCall }: ToolCardProps = $props();

	// Extract question data from toolCall arguments
	const questions = $derived(toolCall.arguments.questions as Array<{
		question: string;
		header: string;
		options: Array<{ label: string; description?: string }>;
		multiple: boolean;
	}> | undefined);
	const firstQuestion = $derived(questions?.[0]);
	const questionId = $derived(toolCall.id);
	const isMultiple = $derived(firstQuestion?.multiple ?? false);

	// Local state for answer interaction
	let answerState = $state<'pending' | 'submitting' | 'answered' | 'error'>('pending');
	let selectedAnswers = $state<string[]>([]);
	let errorMessage = $state<string | null>(null);

	// Derive status from toolCall.result if present (already answered via tool result)
	const toolResult = $derived(toolCall.result);
	const displayStatus = $derived<'running' | 'success' | 'error'>(
		answerState === 'error' ? 'error' :
		answerState === 'answered' || toolResult ? 'success' :
		answerState === 'submitting' ? 'running' :
		'running' // pending shows as running (waiting for user)
	);

	// Update state when tool result arrives (daemon answered)
	$effect(() => {
		if (toolResult && answerState !== 'answered') {
			answerState = toolResult.isError ? 'error' : 'answered';
			if (toolResult.isError) {
				errorMessage = toolResult.content;
			}
		}
	});

	/**
	 * Submit answers to the daemon via DaemonClient.
	 */
	async function submitAnswers(answers: string[]): Promise<void> {
		const client = getDaemonClient();
		const result = await client.answerQuestion(questionId, answers);

		if (result.ok) {
			answerState = 'answered';
		} else {
			answerState = 'error';
			errorMessage = result.error;
		}
	}

	/**
	 * Single-select: clicking an option submits immediately.
	 */
	async function handleSingleAnswer(optionLabel: string): Promise<void> {
		if (answerState === 'submitting') return;

		answerState = 'submitting';
		selectedAnswers = [optionLabel];
		await submitAnswers([optionLabel]);
	}

	/**
	 * Multi-select: toggle an option in the selection set.
	 */
	function toggleOption(label: string): void {
		if (selectedAnswers.includes(label)) {
			selectedAnswers = selectedAnswers.filter(l => l !== label);
		} else {
			selectedAnswers = [...selectedAnswers, label];
		}
	}

	/**
	 * Multi-select: submit all selected options.
	 */
	async function handleMultiSubmit(): Promise<void> {
		if (answerState === 'submitting' || selectedAnswers.length === 0) return;

		answerState = 'submitting';
		await submitAnswers(selectedAnswers);
	}

	function handleRetry(): void {
		answerState = 'pending';
		errorMessage = null;
		selectedAnswers = [];
	}
</script>

<ToolCardShell
	toolName="question"
	status={displayStatus}
	subtitle={firstQuestion?.header}
	errorMessage={errorMessage ?? undefined}
>
	{#if firstQuestion}
		<div class="question-content">
			<span class="question-header">{firstQuestion.header}</span>
			<p class="question-text">{firstQuestion.question}</p>

			{#if answerState === 'answered' || toolResult}
				<div class="answered-state">
					<span class="answered-label">Answered:</span>
					<span class="answered-value">
						{selectedAnswers.length > 0 ? selectedAnswers.join(', ') : (toolResult?.content ?? 'Submitted')}
					</span>
				</div>
			{:else if answerState === 'error'}
				<div class="error-state">
					<p class="error-text">{errorMessage}</p>
					<Button variant="outline" size="sm" onclick={handleRetry}>Retry</Button>
				</div>
			{:else if isMultiple}
				<!-- Multi-select: checkboxes + submit button -->
				<div class="options-list" class:disabled={answerState === 'submitting'}>
					{#each firstQuestion.options as option}
						{@const isSelected = selectedAnswers.includes(option.label)}
						<button
							class="option-checkbox"
							class:selected={isSelected}
							disabled={answerState === 'submitting'}
							onclick={() => toggleOption(option.label)}
							aria-pressed={isSelected}
							type="button"
						>
							<span class="checkbox-indicator" aria-hidden="true">
								<HugeiconsIcon
									icon={isSelected ? CheckSquareIcon : UncheckSquareIcon}
									size={16}
									strokeWidth={1.5}
								/>
							</span>
							<span class="option-inner">
								<span class="option-label">{option.label}</span>
								{#if option.description}
									<span class="option-description">{option.description}</span>
								{/if}
							</span>
						</button>
					{/each}
					<Button
						variant="default"
						size="sm"
						disabled={answerState === 'submitting' || selectedAnswers.length === 0}
						onclick={handleMultiSubmit}
					>
						{answerState === 'submitting' ? 'Submitting…' : `Submit (${selectedAnswers.length} selected)`}
					</Button>
				</div>
			{:else}
				<!-- Single-select: click to submit immediately -->
				<div class="options-list" class:disabled={answerState === 'submitting'}>
					{#each firstQuestion.options as option}
						<Button
							variant="outline"
							size="default"
							disabled={answerState === 'submitting'}
							onclick={() => handleSingleAnswer(option.label)}
							class="option-button"
						>
							<span class="option-label">{option.label}</span>
							{#if option.description}
								<span class="option-description">{option.description}</span>
							{/if}
						</Button>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<div class="question-error">Invalid question data</div>
	{/if}
</ToolCardShell>

<style>
	.question-content {
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.question-header {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.question-text {
		font-size: var(--font-size-sm);
		color: var(--color-text-primary);
		margin: 0;
		line-height: 1.5;
	}

	.options-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.options-list.disabled {
		opacity: 0.7;
		pointer-events: none;
	}

	:global(.option-button) {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		height: auto;
		padding: var(--space-2) var(--space-3);
		text-align: left;
	}

	.option-label {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
	}

	.option-description {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-weight: var(--font-weight-normal);
	}

	/* Multi-select checkbox-style buttons */
	.option-checkbox {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		transition: background-color var(--transition-fast), border-color var(--transition-fast);
		font-family: var(--font-sans);
		color: var(--color-text-primary);
	}

	.option-checkbox:hover:not(:disabled) {
		background-color: var(--color-surface-hover);
		border-color: var(--color-border-strong);
	}

	.option-checkbox.selected {
		border-color: var(--color-primary);
		background-color: var(--color-primary-subtle);
	}

	.option-checkbox:focus-visible {
		outline: 2px solid var(--color-border-focus);
		outline-offset: 2px;
	}

	.option-checkbox:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.checkbox-indicator {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		color: var(--color-primary);
		flex-shrink: 0;
	}

	.option-inner {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.answered-state {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background-color: color-mix(in oklch, var(--color-success) 8%, transparent);
		border: 1px solid color-mix(in oklch, var(--color-success) 25%, transparent);
		border-radius: var(--radius-md);
	}

	.answered-label {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.answered-value {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-success);
	}

	.error-state {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background-color: color-mix(in oklch, var(--color-error) 8%, transparent);
		border: 1px solid color-mix(in oklch, var(--color-error) 25%, transparent);
		border-radius: var(--radius-md);
	}

	.error-text {
		font-size: var(--font-size-sm);
		color: var(--color-error);
		margin: 0;
	}

	.question-error {
		padding: var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-error);
	}
</style>
