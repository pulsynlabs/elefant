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
	}: Props = $props();

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
					<li>
						<button
							type="button"
							class="session-row"
							class:active={activeSessionId === session.id}
							aria-current={activeSessionId === session.id ? 'page' : undefined}
							aria-label="Open session {sessionLabel(session)}"
							onclick={() => handleSelectSession(session)}
							onkeydown={(e) => handleSessionKeydown(e, session)}
						>
							{#if activeSessionId === session.id}
								<span class="session-indicator" aria-hidden="true"></span>
							{/if}
							<span class="session-label" title={sessionLabel(session)}>
								{sessionLabel(session)}
							</span>
						</button>
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
</style>
