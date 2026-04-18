<script lang="ts">
	import type { ToolCardProps } from './types.js';
	import ToolCardShell from './ToolCardShell.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { getDaemonClient } from '$lib/daemon/client.js';

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

	// Local state for answer interaction
	let answerState = $state<'pending' | 'submitting' | 'answered' | 'error'>('pending');
	let selectedAnswer = $state<string | null>(null);
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

	async function handleAnswer(optionLabel: string): Promise<void> {
		if (answerState === 'submitting') return;

		answerState = 'submitting';
		selectedAnswer = optionLabel;

		const client = getDaemonClient();
		const result = await client.answerQuestion(questionId, [optionLabel]);

		if (result.ok) {
			answerState = 'answered';
		} else {
			answerState = 'error';
			errorMessage = result.error;
		}
	}

	function handleRetry(): void {
		answerState = 'pending';
		errorMessage = null;
		selectedAnswer = null;
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
					<span class="answered-value">{selectedAnswer ?? 'Submitted'}</span>
				</div>
			{:else if answerState === 'error'}
				<div class="error-state">
					<p class="error-text">{errorMessage}</p>
					<Button variant="outline" size="sm" onclick={handleRetry}>Retry</Button>
				</div>
			{:else}
				<div class="options-list" class:disabled={answerState === 'submitting'}>
					{#each firstQuestion.options as option}
						<Button
							variant="outline"
							size="default"
							disabled={answerState === 'submitting'}
							onclick={() => handleAnswer(option.label)}
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
