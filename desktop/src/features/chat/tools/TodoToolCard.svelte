<script lang="ts">
	import type { ToolCardProps } from './types.js';
	import ToolCardShell from './ToolCardShell.svelte';
	import { HugeiconsIcon, CheckIcon, CrossIcon, type IconSvgElement } from '$lib/icons/index.js';

	let { toolCall }: ToolCardProps = $props();

	const status = $derived<'running' | 'success' | 'error'>(
		!toolCall.result ? 'running' : toolCall.result.isError ? 'error' : 'success'
	);

	const errorMessage = $derived(
		toolCall.result?.isError ? toolCall.result.content : undefined
	);

	type ParsedTodo = {
		status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
		priority: 'high' | 'medium' | 'low';
		content: string;
	};

	function parseTodoText(text: string): ParsedTodo[] {
		if (!text || text === '(no todos)') return [];
		return text.split('\n').filter(Boolean).map(line => {
			const statusMatch = line.match(/^\[([ ~x/])\]\s+/);
			const statusChar = statusMatch?.[1] ?? ' ';
			const statusMap: Record<string, ParsedTodo['status']> = {
				' ': 'pending',
				'~': 'in_progress',
				'x': 'completed',
				'/': 'cancelled'
			};
			const todoStatus = statusMap[statusChar] ?? 'pending';

			// Remove status prefix and priority suffix
			const content = line
				.replace(/^\[[ ~x/]\]\s+/, '')
				.replace(/\s+\([!·↓]\)$/, '');

			// Detect priority from suffix
			const prioritySuffix = line.match(/\(([!·↓])\)$/)?.[1];
			const priorityMap: Record<string, ParsedTodo['priority']> = {
				'!': 'high',
				'·': 'medium',
				'↓': 'low'
			};
			const priority = prioritySuffix ? (priorityMap[prioritySuffix] ?? 'medium') : 'medium';

			return { status: todoStatus, priority, content };
		});
	}

	const todos = $derived(
		toolCall.result?.content && !toolCall.result.isError
			? parseTodoText(toolCall.result.content)
			: []
	);

	const taskCount = $derived(todos.length);

	// Glyph for non-terminal states (pending/in_progress) — text symbols.
	// Terminal states (completed/cancelled) render via Hugeicons below.
	const statusGlyph: Record<'pending' | 'in_progress', string> = {
		pending: '○',
		in_progress: '◐',
	};

	const terminalStatusIcon: Record<'completed' | 'cancelled', IconSvgElement> = {
		completed: CheckIcon,
		cancelled: CrossIcon,
	};
</script>

<ToolCardShell
	toolName={toolCall.name}
	{status}
	{errorMessage}
	subtitle={status !== 'running' ? `${taskCount} task${taskCount === 1 ? '' : 's'}` : undefined}
>
	{#snippet children()}
		{#if status !== 'running'}
			<div class="todo-body">
				{#if taskCount === 0}
					<span class="todo-empty">No tasks</span>
				{:else}
					<div class="todo-list">
						{#each todos as todo}
							<div
								class="todo-item"
								class:completed={todo.status === 'completed'}
								class:cancelled={todo.status === 'cancelled'}
							>
								<span
									class="todo-status-icon"
									class:pending={todo.status === 'pending'}
									class:in-progress={todo.status === 'in_progress'}
									class:completed={todo.status === 'completed'}
									class:cancelled={todo.status === 'cancelled'}
								>
									{#if todo.status === 'completed' || todo.status === 'cancelled'}
										<HugeiconsIcon
											icon={terminalStatusIcon[todo.status]}
											size={14}
											strokeWidth={1.5}
										/>
									{:else}
										{statusGlyph[todo.status]}
									{/if}
								</span>
								<span class="todo-content">{todo.content}</span>
								{#if todo.priority === 'high'}
									<span class="todo-priority high">!</span>
								{:else if todo.priority === 'low'}
									<span class="todo-priority low">↓</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/snippet}
</ToolCardShell>

<style>
	.todo-body {
		padding: var(--space-3);
	}

	.todo-empty {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-style: italic;
	}

	.todo-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.todo-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 24px;
	}

	.todo-item.completed {
		opacity: 0.6;
	}

	.todo-item.cancelled {
		opacity: 0.4;
	}

	.todo-status-icon {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		text-align: center;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		line-height: 1;
	}

	.todo-status-icon.pending {
		color: var(--color-text-muted);
	}

	.todo-status-icon.in-progress {
		color: var(--color-primary);
		animation: pulse-opacity 1.5s ease-in-out infinite;
	}

	.todo-status-icon.completed {
		color: var(--color-success);
	}

	.todo-status-icon.cancelled {
		color: var(--color-text-disabled, var(--color-text-muted));
	}

	@keyframes pulse-opacity {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	.todo-content {
		flex: 1;
		font-size: var(--font-size-sm);
		color: var(--color-text-primary);
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.todo-item.completed .todo-content,
	.todo-item.cancelled .todo-content {
		text-decoration: line-through;
	}

	.todo-priority {
		flex-shrink: 0;
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-bold);
		line-height: 1;
	}

	.todo-priority.high {
		color: var(--color-error);
	}

	.todo-priority.low {
		color: var(--color-text-disabled, var(--color-text-muted));
	}
</style>
