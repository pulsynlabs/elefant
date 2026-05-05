<script lang="ts">
	// AgentProfilesView — premium role-grouped roster of agent profiles.
	//
	// Profiles are bucketed into six role groups (Coordination, Planning,
	// Research, Execution, Verification, Documentation), each with a
	// kind-coloured accent rail, editorial heading, agent count, and an
	// auto-fill card grid. `default` and `custom` kinds are intentionally
	// hidden — they are schema fallbacks, not user-facing agents.
	//
	// Persistence is delegated to `agentConfigStore`. The card slot
	// (`AgentProfileCard`) is preserved unchanged; this component owns
	// page-level layout only.

	import { onMount } from 'svelte';
	import { agentConfigStore } from '$lib/stores/agent-config.svelte.js';
	import type { AgentKind, AgentProfile } from '$lib/types/agent-config.js';
	import { HugeiconsIcon, RefreshIcon } from '$lib/icons/index.js';
	import AgentProfileCard from './AgentProfileCard.svelte';

	type Props = {
		// Optional initial-expanded card id — useful when deep-linking from
		// elsewhere in the app (e.g. the override dialog offers "edit profile").
		initialExpandedId?: string;
	};

	let { initialExpandedId }: Props = $props();

	onMount(() => {
		void agentConfigStore.refresh();
	});

	const profiles = $derived(agentConfigStore.profiles);
	const isLoading = $derived(agentConfigStore.isLoading);
	const lastError = $derived(agentConfigStore.lastError);

	// ─── Role grouping ─────────────────────────────────────────────────
	// Six buckets per DESIGN_SPEC §2. Each bucket lists the kinds it
	// accepts. Order here is the rendered order on the page (top→bottom).
	// Hidden kinds (`default`, `custom`) are filtered out before grouping.

	type RoleGroupId =
		| 'coordination'
		| 'planning'
		| 'research'
		| 'execution'
		| 'verification'
		| 'documentation';

	type RoleGroupDef = {
		id: RoleGroupId;
		label: string;
		rubric: string;
		kinds: readonly AgentKind[];
		// CSS custom-property value used for the accent rail. References
		// existing tokens — no new colors introduced.
		accent: string;
	};

	const ROLE_GROUPS: readonly RoleGroupDef[] = [
		{
			id: 'coordination',
			label: 'Coordination',
			rubric: 'Delegates work across the agent swarm',
			kinds: ['orchestrator'],
			accent: 'var(--color-primary)',
		},
		{
			id: 'planning',
			label: 'Planning',
			rubric: 'Breaks goals into executable tasks',
			kinds: ['planner'],
			accent: 'var(--color-info)',
		},
		{
			id: 'research',
			label: 'Research',
			rubric: 'Gathers context and maps the unknown',
			kinds: ['researcher', 'explorer', 'librarian'],
			accent: 'var(--color-primary-muted)',
		},
		{
			id: 'execution',
			label: 'Execution',
			rubric: 'Runs code, writes files, ships features',
			// All four executor tiers (low/medium/high/frontend) share
			// kind `executor` on the wire — they are distinguished by
			// profile id, not kind. Bucketing by kind correctly catches
			// all four tiers in this group.
			kinds: ['executor'],
			accent: 'var(--color-success)',
		},
		{
			id: 'verification',
			label: 'Verification',
			rubric: 'Validates correctness and catches regressions',
			kinds: ['verifier', 'tester', 'debugger'],
			accent: 'var(--color-warning)',
		},
		{
			id: 'documentation',
			label: 'Documentation',
			rubric: 'Explains, documents, and communicates',
			kinds: ['writer'],
			accent: 'var(--color-primary)',
		},
	] as const;

	type RenderedGroup = RoleGroupDef & { items: AgentProfile[] };

	// Hide schema-only kinds from the rendered roster.
	const visibleProfiles = $derived<AgentProfile[]>(
		profiles.filter((p) => p.kind !== 'default' && p.kind !== 'custom'),
	);

	const groupedProfiles = $derived<RenderedGroup[]>(
		ROLE_GROUPS.map((group) => ({
			...group,
			items: visibleProfiles.filter((p) => group.kinds.includes(p.kind)),
		})).filter((g) => g.items.length > 0),
	);

	// Total user-facing count for the page header summary line.
	const totalCount = $derived(visibleProfiles.length);

	async function handleRetry(): Promise<void> {
		await agentConfigStore.refresh();
	}
</script>

<section class="view" aria-labelledby="agent-profiles-title">
	<header class="view-header">
		<div class="view-heading">
			<h2 id="agent-profiles-title" class="view-title">Agent Profiles</h2>
			<p class="view-subtitle">
				Configure the agents Elefant can run. Each profile layers on top of
				the global default — project overrides win where set.
			</p>
		</div>
		<button
			type="button"
			class="quire-sm refresh-button"
			onclick={handleRetry}
			disabled={isLoading}
			aria-label="Refresh profiles"
		>
			<span class="refresh-icon" class:is-spinning={isLoading} aria-hidden="true">
				<HugeiconsIcon icon={RefreshIcon} size={14} strokeWidth={1.75} />
			</span>
			<span class="refresh-label">{isLoading ? 'Loading' : 'Refresh'}</span>
		</button>
	</header>

	{#if lastError}
		<div class="alert alert-error" role="alert">
			<strong>Could not load profiles.</strong>
			<span>{lastError}</span>
			<button type="button" class="alert-action" onclick={handleRetry}>
				Try again
			</button>
		</div>
	{/if}

	{#if isLoading && profiles.length === 0}
		<div class="placeholder" aria-busy="true" aria-live="polite">
			Loading agent profiles…
		</div>
	{:else if !lastError && totalCount === 0}
		<div class="placeholder empty" aria-live="polite">
			<p>No agent profiles configured yet.</p>
			<p class="empty-hint">
				Profiles live in <code>~/.config/elefant/elefant.config.json</code>
				(global) or <code>.elefant/config.json</code> (project).
			</p>
		</div>
	{:else}
		<div class="groups">
			{#each groupedProfiles as group (group.id)}
				<section
					class="group-section"
					style="--group-accent: {group.accent};"
					aria-labelledby="group-{group.id}"
				>
					<div class="group-header">
						<div class="group-heading-row">
							<h3 id="group-{group.id}" class="group-heading">
								{group.label}
							</h3>
							<span class="group-count" aria-label="{group.items.length} agents">
								{group.items.length}
							</span>
						</div>
						<p class="group-rubric quire-sm">
							{group.rubric}
						</p>
					</div>
					<ul class="card-grid">
						{#each group.items as profile (profile.id)}
							<li>
								<AgentProfileCard
									{profile}
									initialExpanded={profile.id === initialExpandedId}
								/>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
</section>

<style>
	/* ─── Page shell ─────────────────────────────────────────────────── */

	.view {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		padding: var(--space-8) var(--space-6);
		max-width: 1200px;
		margin: 0 auto;
		width: 100%;
	}

	/* ─── Header ─────────────────────────────────────────────────────── */

	.view-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-6);
	}

	.view-heading {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		flex: 1 1 auto;
	}

	.view-title {
		font-family: var(--font-display);
		font-size: var(--font-size-3xl);
		font-weight: 700;
		letter-spacing: var(--tracking-tight);
		line-height: var(--leading-tight);
		color: var(--text-prose);
		margin: 0;
	}

	.view-subtitle {
		font-family: var(--font-body);
		font-size: var(--font-size-base);
		font-weight: 400;
		line-height: var(--leading-relaxed);
		color: var(--text-muted);
		margin: 0;
		max-width: 60ch;
	}

	/* Refresh button — small Quire chip with optional spinning icon. */
	.refresh-button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		font-weight: 600;
		letter-spacing: var(--tracking-widest);
		line-height: var(--leading-tight);
		text-transform: uppercase;
		color: var(--text-prose);
		cursor: pointer;
		flex: 0 0 auto;
		min-height: 32px;
		transition:
			background-color var(--transition-fast, 120ms ease),
			border-color var(--transition-fast, 120ms ease),
			color var(--transition-fast, 120ms ease);
	}

	.refresh-button:hover:not(:disabled) {
		border-color: var(--border-emphasis);
		color: var(--text-prose);
	}

	.refresh-button:focus-visible {
		outline: none;
		border-color: var(--border-focus);
		box-shadow: var(--glow-focus, 0 0 0 3px rgba(64, 73, 225, 0.35));
	}

	.refresh-button:disabled {
		cursor: progress;
		opacity: 0.65;
	}

	.refresh-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-meta);
	}

	.refresh-icon.is-spinning {
		animation: refresh-spin 900ms linear infinite;
	}

	@keyframes refresh-spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	@media (prefers-reduced-motion: reduce) {
		.refresh-icon.is-spinning {
			animation: none;
		}
	}

	/* ─── Alerts / placeholders ──────────────────────────────────────── */

	.alert {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-plate);
		border: 1px solid var(--border-hairline);
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
	}

	.alert-error {
		background-color: color-mix(in srgb, var(--color-error) 12%, transparent);
		border-color: color-mix(in srgb, var(--color-error) 50%, transparent);
		color: var(--text-prose);
	}

	.alert-action {
		margin-left: auto;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-leaf);
		background: transparent;
		color: var(--text-prose);
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
		cursor: pointer;
	}

	.alert-action:hover {
		background-color: var(--surface-hover);
	}

	.placeholder {
		padding: var(--space-8) var(--space-6);
		text-align: center;
		color: var(--text-muted);
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		background-color: var(--surface-plate);
		border: 1px dashed var(--border-hairline);
		border-radius: var(--radius-plate);
	}

	.placeholder.empty p {
		margin: 0;
	}

	.empty-hint {
		margin-top: var(--space-2) !important;
		font-size: var(--font-size-xs);
		color: var(--text-disabled);
	}

	.empty-hint code {
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		padding: 2px 6px;
		border-radius: var(--radius-leaf);
		background-color: var(--surface-leaf);
		border: 1px solid var(--border-hairline);
	}

	/* ─── Group stack ────────────────────────────────────────────────── */

	.groups {
		display: flex;
		flex-direction: column;
		gap: var(--space-10);
	}

	/* Each role group: 4px accent rail on the left, content offset by
	   padding-left. Rail is themed via the inline `--group-accent` prop. */
	.group-section {
		position: relative;
		padding-left: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.group-section::before {
		content: '';
		position: absolute;
		left: 0;
		top: 4px;
		bottom: 4px;
		width: 4px;
		border-radius: 2px;
		background-color: var(--group-accent);
		box-shadow: 0 0 12px color-mix(in srgb, var(--group-accent) 30%, transparent);
	}

	/* Group header: editorial heading row + monospace rubric chip. */
	.group-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.group-heading-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.group-heading {
		font-family: var(--font-display);
		font-size: var(--font-size-xl);
		font-weight: 600;
		letter-spacing: var(--tracking-tight);
		line-height: var(--leading-snug);
		color: var(--text-prose);
		margin: 0;
	}

	.group-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		height: 22px;
		padding: 0 var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		font-weight: 500;
		letter-spacing: var(--tracking-normal);
		color: var(--text-muted);
		background-color: var(--surface-leaf);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-leaf);
	}

	/* Rubric chip styled per DESIGN_SPEC §4 (mono 10px, semibold,
	   tracking-widest, muted). Quire-sm gives it the chip surface. */
	.group-rubric {
		display: inline-block;
		align-self: flex-start;
		padding: var(--space-1) var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs);
		font-weight: 500;
		letter-spacing: var(--tracking-widest);
		line-height: var(--leading-tight);
		text-transform: uppercase;
		color: var(--text-muted);
		margin: 0;
		max-width: 60ch;
	}

	/* ─── Card grid ──────────────────────────────────────────────────── */

	.card-grid {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
		gap: var(--space-4);
	}

	.card-grid > li {
		min-width: 0; /* allow grid children to shrink — prevents overflow */
	}

	/* ─── Responsive ─────────────────────────────────────────────────── */

	/* Collapsed (641–900px): two columns, smaller min-track. */
	@media (max-width: 900px) {
		.card-grid {
			grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		}
	}

	/* Mobile (≤640px): single column, stacked header. */
	@media (max-width: 640px) {
		.view {
			padding: var(--space-6) var(--space-4);
			gap: var(--space-6);
		}

		.view-header {
			flex-direction: column;
			align-items: stretch;
			gap: var(--space-3);
		}

		.view-title {
			font-size: var(--font-size-2xl, 24px);
		}

		.refresh-button {
			align-self: flex-start;
		}

		.groups {
			gap: var(--space-8);
		}

		.group-section {
			padding-left: var(--space-4);
		}

		.card-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
