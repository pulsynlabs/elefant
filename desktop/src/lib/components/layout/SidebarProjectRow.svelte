<script lang="ts">
	// SidebarProjectRow — a single expandable project entry in the sidebar.
	//
	// Renders:
	//   [avatar]  Project name      [+]  [chevron]
	//     └─ (when expanded) list of sessions with active indicator
	//
	// Interaction:
	//   - Clicking the row body toggles expand/collapse (and on first expand,
	//     triggers loadSessions for that project).
	//   - Clicking the `+` icon button creates a new session, selects it, and
	//     navigates to chat. It stops propagation so the row does not also
	//     toggle.
	//   - Clicking a session row calls onSelectSession with the session id.
	//   - Active project + active session are visually highlighted.
	//
	// Callbacks are plain props (Svelte 5 idiom — no createEventDispatcher).

	import type { Project, Session } from '$lib/types/project.js';
	import ProjectAvatar from '../../../features/projects/ProjectAvatar.svelte';
	import SidebarChildRunChain from './SidebarChildRunChain.svelte';
	import type {
		SidebarChildRunRow,
		SidebarRunStatusVariant,
	} from './sidebar-child-run-chain-state.js';
	import {
		HugeiconsIcon,
		ChevronRightIcon,
		ChevronDownIcon,
		PlusIcon,
	} from '$lib/icons/index.js';

	type Props = {
		project: Project;
		sessions: Session[] | undefined;
		expanded: boolean;
		isActiveProject: boolean;
		activeSessionId: string | null;
		onToggle: (project: Project) => void;
		onSelectSession: (project: Project, session: Session) => void;
		onNewSession: (project: Project) => void;
		/**
		 * Rows of the active child-run chain to render beneath the
		 * active session row. Empty array when no chain applies.
		 * Caller is responsible for visibility logic via
		 * `computeSidebarChildRunChain`.
		 */
		childRunChainRows?: SidebarChildRunRow[];
		/** Active child run id (for highlight in the chain). */
		activeChildRunId?: string | null;
		/** Callback when a child-run row in the chain is activated. */
		onSelectChildRun?: (runId: string) => void;
		/**
		 * Resolver for the indicator variant of a chain row. Parent
		 * owns the logic (it has access to store selectors); we just
		 * pass it through to the chain component.
		 */
		childRunStatusVariant?: (
			row: SidebarChildRunRow,
		) => SidebarRunStatusVariant;
		/**
		 * Aggregate ("rollup") status variant for the active session
		 * row — reflects the most attention-worthy state across the
		 * active child chain. `'none'` hides the indicator. Rendered
		 * on the session row itself so the user can tell at a glance
		 * that a sub-agent wants attention.
		 */
		sessionRollupVariant?: SidebarRunStatusVariant;
	};

	let {
		project,
		sessions,
		expanded,
		isActiveProject,
		activeSessionId,
		onToggle,
		onSelectSession,
		onNewSession,
		childRunChainRows = [],
		activeChildRunId = null,
		onSelectChildRun,
		childRunStatusVariant,
		sessionRollupVariant = 'none',
	}: Props = $props();

	// Default variant resolver: if the caller doesn't supply one
	// (e.g., projects with no active chain), every row is quiet.
	const resolveChildRunVariant = $derived(
		childRunStatusVariant ?? ((): SidebarRunStatusVariant => 'none'),
	);

	function rollupLabel(variant: SidebarRunStatusVariant): string {
		switch (variant) {
			case 'running':
				return 'Child run running';
			case 'blocked':
				return 'Child run awaiting answer';
			case 'error':
				return 'Child run error';
			case 'unseen':
				return 'Child run has new output';
			case 'none':
			default:
				return '';
		}
	}

	function handleSelectChildRun(runId: string): void {
		onSelectChildRun?.(runId);
	}

	// Truncate a session's display string. Falls back to id if no title field.
	function sessionLabel(session: Session): string {
		// The Session type doesn't guarantee a title, so use a sensible
		// fallback chain.
		const maybeTitle = (session as Session & { title?: string }).title;
		const label = maybeTitle && maybeTitle.trim().length > 0
			? maybeTitle
			: `Session ${session.id.slice(0, 8)}`;
		return label;
	}

	function handleRowClick(): void {
		onToggle(project);
	}

	function handleRowKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onToggle(project);
		}
	}

	function handleNewSession(event: MouseEvent): void {
		event.stopPropagation();
		onNewSession(project);
	}

	function handleSelectSession(session: Session): void {
		onSelectSession(project, session);
	}

	function handleSessionKeydown(event: KeyboardEvent, session: Session): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onSelectSession(project, session);
		}
	}
</script>

<div class="project-row" class:expanded>
	<button
		type="button"
		class="project-header"
		class:active={isActiveProject}
		aria-expanded={expanded}
		aria-label="{project.name}, {expanded ? 'collapse' : 'expand'} sessions"
		onclick={handleRowClick}
		onkeydown={handleRowKeydown}
	>
		<span class="project-avatar" aria-hidden="true">
			<ProjectAvatar projectId={project.id} name={project.name} size={24} />
		</span>
		<span class="project-name" title={project.name}>{project.name}</span>
		<span class="project-header-actions">
			<span
				role="button"
				tabindex="0"
				class="header-icon-button new-session-button"
				aria-label="New session in {project.name}"
				onclick={handleNewSession}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						e.stopPropagation();
						onNewSession(project);
					}
				}}
			>
				<HugeiconsIcon icon={PlusIcon} size={14} strokeWidth={1.5} />
			</span>
			<span class="chevron" aria-hidden="true">
				<HugeiconsIcon
					icon={expanded ? ChevronDownIcon : ChevronRightIcon}
					size={14}
					strokeWidth={1.5}
				/>
			</span>
		</span>
	</button>

	{#if expanded}
		<ul class="session-list" role="list">
			{#if sessions === undefined}
				<li class="session-placeholder">Loading…</li>
			{:else if sessions.length === 0}
				<li class="session-placeholder">No sessions yet</li>
			{:else}
				{#each sessions as session (session.id)}
					{@const isActiveSession = activeSessionId === session.id}
					{@const rollupVariant = isActiveSession
						? sessionRollupVariant
						: 'none'}
					<li>
						<button
							type="button"
							class="session-row"
							class:active={isActiveSession}
							aria-current={isActiveSession ? 'page' : undefined}
							aria-label="Open session {sessionLabel(session)}"
							onclick={() => handleSelectSession(session)}
							onkeydown={(e) => handleSessionKeydown(e, session)}
						>
							{#if isActiveSession}
								<span class="session-indicator" aria-hidden="true"></span>
							{/if}
							<span class="session-label" title={sessionLabel(session)}>
								{sessionLabel(session)}
							</span>
							{#if rollupVariant !== 'none'}
								<span
									class="session-rollup-dot rollup-{rollupVariant}"
									role="img"
									aria-label={rollupLabel(rollupVariant)}
									title={rollupLabel(rollupVariant)}
								></span>
							{/if}
						</button>
						{#if isActiveSession && childRunChainRows.length > 0}
							<SidebarChildRunChain
								rows={childRunChainRows}
								{activeChildRunId}
								getStatusVariant={resolveChildRunVariant}
								onSelectRun={handleSelectChildRun}
							/>
						{/if}
					</li>
				{/each}
			{/if}
		</ul>
	{/if}
</div>

<style>
	.project-row {
		display: flex;
		flex-direction: column;
	}

	.project-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		text-align: left;
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.project-header:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.project-header:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.project-header.active {
		color: var(--color-primary);
		background-color: var(--color-primary-subtle);
		box-shadow: inset 2px 0 0 var(--color-primary);
	}

	.project-avatar {
		display: inline-flex;
		flex-shrink: 0;
	}

	.project-name {
		flex: 1;
		min-width: 0;
		font-weight: var(--font-weight-medium);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.project-header-actions {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	.header-icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		opacity: 0;
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			opacity var(--transition-fast);
	}

	.project-header:hover .header-icon-button,
	.project-header:focus-visible .header-icon-button,
	.header-icon-button:focus-visible,
	.project-row.expanded .header-icon-button {
		opacity: 1;
	}

	.header-icon-button:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-elevated);
		border-color: var(--color-border);
	}

	.header-icon-button:focus-visible {
		outline: none;
		color: var(--color-text-primary);
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	.chevron {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		color: var(--color-text-muted);
		transition: transform var(--transition-fast);
	}

	.session-list {
		list-style: none;
		margin: var(--space-1) 0 var(--space-1) 0;
		padding: 0 0 0 var(--space-6);
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.session-placeholder {
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-style: italic;
	}

	.session-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-1) var(--space-2);
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		text-align: left;
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.session-row:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.session-row:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.session-row.active {
		color: var(--color-primary);
		background-color: var(--color-primary-subtle);
	}

	.session-indicator {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background-color: var(--color-primary);
		flex-shrink: 0;
		box-shadow: var(--glow-primary);
	}

	.session-label {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Rollup indicator on the session row itself — appears when any
	   run in the active child chain has a notable status. Priority is
	   already resolved upstream; we only pick the color here. */
	.session-rollup-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		flex-shrink: 0;
		border-radius: var(--radius-full);
		background-color: var(--color-text-muted);
	}

	.rollup-running {
		width: 8px;
		height: 8px;
		background-color: var(--color-primary);
		box-shadow: var(--glow-primary);
		animation: pulse 1.5s ease-in-out infinite;
	}

	.rollup-blocked {
		background-color: var(--color-warning);
	}

	.rollup-error {
		background-color: var(--color-error);
	}

	.rollup-unseen {
		background-color: var(--color-info);
	}

	@media (prefers-reduced-motion: reduce) {
		.rollup-running {
			animation: none;
		}
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
</style>
