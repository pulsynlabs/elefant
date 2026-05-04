<script lang="ts">
	import {
		HugeiconsIcon,
		UncheckSquareIcon,
		CheckSquareIcon,
		InProgressIcon,
		CloseIcon,
		SpecModeIcon,
	} from '$lib/icons/index.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import {
		sessionTodosStore,
		type TodoItem,
		type TodoStatus,
	} from '$lib/stores/session-todos.svelte.js';

	// Hard cap (spec): if the agent floods the list, render a slice with a
	// "showing N of M" notice rather than blocking the UI. v1 has no
	// virtualization; 500 keeps render under a few ms while still showing
	// useful context. Past 500 items, the list is almost always machine
	// noise and the user would scroll the older entries off-screen anyway.
	const MAX_RENDER = 500;

	// Bind the store to whichever (projectId, sessionId) is active. When the
	// user switches sessions, this $effect re-runs, the store clears its
	// previous list, and re-bootstraps. Detaching (null session) clears the
	// list and tears down the SSE.
	$effect(() => {
		sessionTodosStore.setActiveSession(
			projectsStore.activeProjectId,
			projectsStore.activeSessionId,
		);
	});

	// Tear down on component unmount so the SSE doesn't leak when the panel
	// is closed entirely. Lazy-mount means this only runs once the user has
	// activated the Todos tab at least once during the session.
	$effect(() => {
		return () => {
			sessionTodosStore.clear();
		};
	});

	const visibleTodos = $derived(sessionTodosStore.todos.slice(0, MAX_RENDER));
	const overflow = $derived(Math.max(0, sessionTodosStore.todos.length - MAX_RENDER));

	// Status → icon + token color. Centralized so the same mapping is used
	// for the badge layer and (potentially) for accessibility text.
	const STATUS_META: Record<
		TodoStatus,
		{ icon: typeof CheckSquareIcon; tone: string; label: string }
	> = {
		pending: { icon: UncheckSquareIcon, tone: 'var(--text-meta)', label: 'Pending' },
		in_progress: { icon: InProgressIcon, tone: 'var(--color-primary)', label: 'In progress' },
		completed: { icon: CheckSquareIcon, tone: 'var(--color-success)', label: 'Completed' },
		cancelled: { icon: CloseIcon, tone: 'var(--text-meta)', label: 'Cancelled' },
	};

	function statusMeta(status: TodoStatus) {
		return STATUS_META[status] ?? STATUS_META.pending;
	}

	// Priority → background. Low priority renders no badge per the brief
	// (signal-noise: most agent todos are low-priority by default).
	function priorityBackground(priority: TodoItem['priority']): string | null {
		switch (priority) {
			case 'high':
				return 'var(--color-error)';
			case 'medium':
				return 'var(--color-warning)';
			default:
				return null;
		}
	}
</script>

<div class="todos-tab" role="region" aria-label="Session todos">
	{#if visibleTodos.length === 0}
		<div class="empty-state">
			<HugeiconsIcon icon={SpecModeIcon} size={28} strokeWidth={1.4} />
			<p class="empty-title">No tasks yet</p>
			<p class="empty-body">
				Tasks assigned by the agent will appear here.
			</p>
		</div>
	{:else}
		{#if overflow > 0}
			<div class="overflow-notice" role="status">
				Showing {MAX_RENDER} of {sessionTodosStore.todos.length} tasks
			</div>
		{/if}
		<ul class="todo-list">
			{#each visibleTodos as todo (todo.id)}
				{@const meta = statusMeta(todo.status)}
				{@const priorityBg = priorityBackground(todo.priority)}
				<li
					class="todo-item"
					class:todo-cancelled={todo.status === 'cancelled'}
					class:todo-completed={todo.status === 'completed'}
				>
					<span
						class="todo-status"
						aria-label={meta.label}
						style:color={meta.tone}
						class:todo-status-spin={todo.status === 'in_progress'}
					>
						<HugeiconsIcon icon={meta.icon} size={14} strokeWidth={1.6} />
					</span>
					<span class="todo-content">{todo.content}</span>
					{#if priorityBg && todo.status !== 'completed' && todo.status !== 'cancelled'}
						<span
							class="todo-priority"
							style:background-color={priorityBg}
							aria-label={`${todo.priority} priority`}
						>
							{todo.priority}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.todos-tab {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: 0;
		padding: var(--space-2) 0;
	}

	/* ─── Empty state ────────────────────────────────────────────────── */

	.empty-state {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-6);
		color: var(--text-meta);
		text-align: center;
	}

	.empty-title {
		margin: 0;
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0.02em;
		color: var(--text-prose);
	}

	.empty-body {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		max-width: 28ch;
	}

	/* ─── Overflow notice ───────────────────────────────────────────── */

	.overflow-notice {
		margin: 0 var(--space-3) var(--space-2);
		padding: var(--space-2) var(--space-3);
		font-size: 11px;
		color: var(--text-meta);
		background-color: var(--surface-recess, var(--surface-hover));
		border-radius: var(--radius-sm);
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	/* ─── List ──────────────────────────────────────────────────────── */

	.todo-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.todo-item {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		font-size: 13px;
		line-height: 1.4;
		color: var(--text-prose);
		border-bottom: 1px solid var(--border-edge, var(--border-hairline));
	}

	.todo-item:last-child {
		border-bottom: none;
	}

	.todo-completed {
		color: var(--text-meta);
	}

	.todo-cancelled {
		color: var(--text-meta);
	}

	.todo-cancelled .todo-content {
		text-decoration: line-through;
		text-decoration-thickness: 1px;
	}

	.todo-status {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		flex: 0 0 auto;
		/* Pull icon up half a line-height so it visually centers with the
		   first line of (potentially wrapping) content text. */
		margin-top: 1px;
	}

	/* Subtle rotation gives the in_progress state visible motion without
	   demanding attention. Honors prefers-reduced-motion via the global
	   guard in tokens.css. */
	.todo-status-spin {
		animation: todo-spin 1.6s linear infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.todo-status-spin {
			animation: none;
		}
	}

	@keyframes todo-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.todo-content {
		min-width: 0;
		/* Two-line clamp with ellipsis. Keeps long agent prose from blowing
		   up the row height while still surfacing enough to be useful at a
		   glance. The non-prefixed properties are intentionally omitted —
		   webkit-line-clamp is the supported path across modern browsers. */
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-overflow: ellipsis;
		word-break: break-word;
	}

	.todo-priority {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 var(--space-2);
		min-height: 18px;
		font-size: 10px;
		font-weight: 600;
		line-height: 1;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: white;
		border-radius: var(--radius-sm);
		margin-top: 1px;
	}
</style>
