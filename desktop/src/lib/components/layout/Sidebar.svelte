<script lang="ts">
	// Sidebar — project-aware navigator.
	//
	// Structure:
	//   ┌────────────────────┐
	//   │   [E] Elefant      │  ← brand
	//   ├────────────────────┤
	//   │ PROJECTS           │  ← list / avatars
	//   │  • project-alpha   │
	//   │  • project-beta    │
	//   │   └─ session 1…    │
	//   │   └─ session 2…    │
	//   ├────────────────────┤
	//   │ ⚙ Settings         │  ← pinned bottom
	//   │ ▦ Models           │
	//   │ ⓘ About            │
	//   └────────────────────┘
	//
	// Collapsed mode: only the project avatars in the top section and icon-only
	// bottom nav are shown. Clicking an avatar selects that project and opens
	// its chat (behaviour documented below so the interaction is predictable).
	//
	// Wiring notes:
	//   - Chat nav item is intentionally absent. Chat is reached by selecting a
	//     session under a project (or by creating a new one via the `+` button).
	//   - `projectsStore.loadSessions` is only called the first time a project
	//     is expanded — subsequent expands reuse the cache.
	//   - `selectProject` is called whenever a session belonging to a
	//     non-active project is picked, so the rest of the UI stays in sync.

	import { navigationStore } from '$lib/stores/navigation.svelte.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import type { Project, Session } from '$lib/types/project.js';
	import {
		HugeiconsIcon,
		SettingsIcon,
		ModelsIcon,
		AboutIcon,
		AgentsIcon,
		RunsIcon,
		WorktreesIcon,
	} from '$lib/icons/index.js';
	import { clearConversation } from '../../../features/chat/chat.svelte.js';
	import { agentConfigStore } from '$lib/stores/agent-config.svelte.js';
	import { agentRunsStore } from '$lib/stores/agent-runs.svelte.js';
	import { worktreesStore } from '$lib/stores/worktrees.svelte.js';
	import type { IconSvgElement } from '$lib/icons/index.js';
	import ProjectAvatar from '../../../features/projects/ProjectAvatar.svelte';
	import SidebarProjectRow from './SidebarProjectRow.svelte';

	type Props = {
		collapsed?: boolean;
	};

	let { collapsed = false }: Props = $props();

	// Which project rows are currently expanded. Keyed by project id; a project
	// is expanded iff its id maps to `true` here.
	let expandedProjectIds = $state<Record<string, boolean>>({});

	type BottomNavItem = {
		id: 'settings' | 'models' | 'about' | 'agent-config' | 'agent-runs' | 'worktrees';
		label: string;
		icon: IconSvgElement;
	};

	const bottomNavItems: BottomNavItem[] = [
		{ id: 'agent-config', label: 'Agent Config', icon: AgentsIcon },
		{ id: 'agent-runs', label: 'Runs', icon: RunsIcon },
		{ id: 'worktrees', label: 'Worktrees', icon: WorktreesIcon },
		{ id: 'settings', label: 'Settings', icon: SettingsIcon },
		{ id: 'models', label: 'Models', icon: ModelsIcon },
		{ id: 'about', label: 'About', icon: AboutIcon },
	];

	function toggleProject(project: Project): void {
		const wasExpanded = expandedProjectIds[project.id] === true;
		expandedProjectIds = {
			...expandedProjectIds,
			[project.id]: !wasExpanded,
		};
		// Load sessions lazily — only the first time we expand a project and
		// only if we don't already have them cached.
		if (!wasExpanded && projectsStore.sessionsByProject[project.id] === undefined) {
			void projectsStore.loadSessions(project.id);
		}
	}

	function openSession(project: Project, session: Session): void {
		// Only switch the active project when the user picks a different project.
		if (projectsStore.activeProjectId !== project.id) {
			void projectsStore.selectProject(project.id);
		}
		// Clear chat before selecting so the $effect in ChatView sees the change
		// and clears messages. Calling clearConversation here as well is defensive
		// belt-and-suspenders for cases where ChatView isn't mounted yet.
		clearConversation();
		projectsStore.selectSession(session.id);
		navigationStore.navigate('chat');
	}

	async function createNewSession(project: Project): Promise<void> {
		// Ensure the newly-created session lands under the correct active
		// project, then navigate into chat.
		if (projectsStore.activeProjectId !== project.id) {
			await projectsStore.selectProject(project.id);
		}
		try {
			await projectsStore.createSession(project.id);
			// Clear chat so the new session starts with an empty message list.
			clearConversation();
			// Make sure the project row is expanded so the user sees the new
			// session appear at the top of the list.
			if (expandedProjectIds[project.id] !== true) {
				expandedProjectIds = { ...expandedProjectIds, [project.id]: true };
			}
			navigationStore.navigate('chat');
		} catch {
			// Errors are surfaced via projectsStore.lastError; no-op here.
		}
	}

	// Collapsed-mode avatar click: select the project and open chat. We do not
	// auto-expand the sidebar from here (that would fight the user's collapse
	// choice). The user sees their selection reflected in the TopBar / chat.
	async function handleAvatarClick(project: Project): Promise<void> {
		await projectsStore.selectProject(project.id);
		navigationStore.navigate('chat');
	}
</script>

<nav class="sidebar-nav" class:collapsed aria-label="Main navigation">
	<!-- Logo/Brand -->
	<div class="sidebar-brand">
		<div class="brand-mark">E</div>
		{#if !collapsed}
			<span class="brand-name">Elefant</span>
		{/if}
	</div>

	<!-- Top section: projects -->
	<div class="sidebar-top">
		{#if collapsed}
			<ul class="avatar-stack" role="list" aria-label="Projects">
				{#each projectsStore.projects as project (project.id)}
					<li>
						<button
							type="button"
							class="avatar-button"
							class:active={projectsStore.activeProjectId === project.id}
							aria-label={project.name}
							aria-current={projectsStore.activeProjectId === project.id
								? 'page'
								: undefined}
							title={project.name}
							onclick={() => handleAvatarClick(project)}
						>
							<ProjectAvatar
								projectId={project.id}
								name={project.name}
								size={28}
							/>
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<div class="section-label">Projects</div>
			<ul class="project-list" role="list">
				{#if projectsStore.projects.length === 0}
					<li class="empty-state">No projects yet</li>
				{:else}
					{#each projectsStore.projects as project (project.id)}
						<li>
							<SidebarProjectRow
								{project}
								sessions={projectsStore.sessionsByProject[project.id]}
								expanded={expandedProjectIds[project.id] === true}
								isActiveProject={projectsStore.activeProjectId === project.id}
								activeSessionId={projectsStore.activeSessionId}
								onToggle={toggleProject}
								onSelectSession={openSession}
								onNewSession={(p) => void createNewSession(p)}
							/>
						</li>
					{/each}
				{/if}
			</ul>
		{/if}
	</div>

	<!-- Bottom section: pinned nav -->
	<ul class="bottom-nav" role="list">
		{#each bottomNavItems as item (item.id)}
			<li>
				<button
					type="button"
					class="nav-item"
					class:active={navigationStore.isActive(item.id)}
					onclick={() => navigationStore.navigate(item.id)}
					title={collapsed ? item.label : undefined}
					aria-label={item.label}
					aria-current={navigationStore.isActive(item.id) ? 'page' : undefined}
				>
					<span class="nav-icon" aria-hidden="true">
						<HugeiconsIcon icon={item.icon} size={18} strokeWidth={1.5} />
					</span>
					{#if !collapsed}
						<span class="nav-label">{item.label}</span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.sidebar-nav {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: var(--space-3) 0;
		overflow: hidden;
		position: relative;
	}

	/* Vertical accent line — left edge */
	.sidebar-nav::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		width: 2px;
		height: 100%;
		background: linear-gradient(
			to bottom,
			transparent 0%,
			var(--color-primary) 20%,
			var(--color-primary) 80%,
			transparent 100%
		);
		opacity: 0.6;
		pointer-events: none;
	}

	.sidebar-brand {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		margin-bottom: var(--space-3);
		height: 48px;
		flex-shrink: 0;
	}

	.brand-mark {
		width: 28px;
		height: 28px;
		border-radius: var(--radius-md);
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: var(--font-weight-bold);
		font-size: var(--font-size-lg);
		flex-shrink: 0;
		font-family: var(--font-mono);
		box-shadow: var(--glow-primary);
		transition: box-shadow var(--transition-fast);
	}

	.brand-name {
		font-weight: var(--font-weight-semibold);
		font-size: var(--font-size-md);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-tight);
		white-space: nowrap;
		overflow: hidden;
	}

	.sidebar-top {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 0 var(--space-2);
	}

	.section-label {
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-2xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: var(--tracking-widest);
		text-transform: uppercase;
		color: var(--color-text-disabled);
	}

	.project-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.empty-state {
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-style: italic;
	}

	/* --- Collapsed mode: avatar column --------------------------------- */
	.avatar-stack {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
	}

	.avatar-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		border: 1px solid transparent;
		border-radius: var(--radius-lg);
		background: transparent;
		cursor: pointer;
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.avatar-button:hover {
		border-color: var(--color-border);
	}

	.avatar-button:focus-visible {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	.avatar-button.active {
		border-color: var(--color-primary);
		box-shadow: var(--glow-primary);
	}

	/* --- Bottom-pinned navigation -------------------------------------- */
	.bottom-nav {
		list-style: none;
		margin: 0;
		padding: var(--space-2) var(--space-2) 0 var(--space-2);
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex-shrink: 0;
		border-top: 1px solid var(--color-border);
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		text-align: left;
		font-size: var(--font-size-md);
		font-family: var(--font-sans);
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast),
			box-shadow var(--transition-fast);
		white-space: nowrap;
		overflow: hidden;
		position: relative;
	}

	.nav-item:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.nav-item.active {
		color: var(--color-primary);
		background-color: var(--color-primary-subtle);
		box-shadow: inset 2px 0 0 var(--color-primary), var(--glow-primary);
	}

	.nav-item:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.nav-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		color: currentColor;
	}

	.nav-label {
		font-weight: var(--font-weight-medium);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sidebar-nav.collapsed .nav-item {
		justify-content: center;
		padding: var(--space-2);
	}

	.sidebar-nav.collapsed .sidebar-brand {
		justify-content: center;
		padding: var(--space-3) var(--space-2);
	}

	.sidebar-nav.collapsed .sidebar-top {
		padding: var(--space-2) 0;
	}
</style>
