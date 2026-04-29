<!--
@component
ProjectSettings — per-project settings panel.

Currently exposes the `legacyStateMode` toggle which opts a project out of
spec-mode features (writes resume to the legacy `.elefant/state.json` path
and the Spec Mode panel renders a "legacy mode" banner). Reads/writes via
PATCH /api/projects/:id/settings.

Accessibility:
  - Toggle is a real <input type="checkbox"> with a labelled wrapper.
  - Save status is announced via aria-live.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import { DAEMON_URL } from '$lib/daemon/client.js';

	let legacyStateMode = $state(false);
	let loading = $state(false);
	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveMessage = $state('');

	const projectId = $derived(projectsStore.activeProjectId);

	async function loadSettings(): Promise<void> {
		const id = projectId;
		if (!id) return;
		loading = true;
		try {
			const response = await fetch(`${DAEMON_URL}/api/projects/${encodeURIComponent(id)}/settings`);
			if (response.ok) {
				const json = (await response.json()) as { ok: true; data: { legacyStateMode: boolean } } | { ok: false };
				if ('data' in json) {
					legacyStateMode = json.data.legacyStateMode;
				}
			}
		} finally {
			loading = false;
		}
	}

	async function save(): Promise<void> {
		const id = projectId;
		if (!id) return;
		saveStatus = 'saving';
		try {
			const response = await fetch(`${DAEMON_URL}/api/projects/${encodeURIComponent(id)}/settings`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ legacyStateMode }),
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			saveStatus = 'saved';
			saveMessage = 'Saved';
			setTimeout(() => {
				saveStatus = 'idle';
			}, 1800);
		} catch (err) {
			saveStatus = 'error';
			saveMessage = err instanceof Error ? err.message : 'Save failed';
			setTimeout(() => {
				saveStatus = 'idle';
			}, 3500);
		}
	}

	onMount(() => {
		void loadSettings();
	});

	$effect(() => {
		// Reload when the active project changes
		if (projectId) void loadSettings();
	});
</script>

<div class="project-settings">
	<h3 class="section-heading">Project</h3>

	{#if !projectId}
		<p class="text-sm text-gray-500 dark:text-gray-400">Open a project to view its settings.</p>
	{:else}
		<div class="form-group">
			<label class="flex items-start gap-3">
				<input
					type="checkbox"
					bind:checked={legacyStateMode}
					onchange={save}
					disabled={loading}
					aria-label="Use legacy state.json"
					class="mt-1"
				/>
				<span>
					<span class="block text-sm font-medium text-gray-900 dark:text-gray-100">
						Use legacy state.json
					</span>
					<span class="mt-1 block text-xs text-gray-500 dark:text-gray-400">
						Disables Spec Mode features for this project. The daemon resumes
						writing workflow state to <code>.elefant/state.json</code> and the
						Spec Mode panel shows a legacy-mode banner.
					</span>
				</span>
			</label>
		</div>

		<p class="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
			{#if saveStatus === 'saving'}Saving…{/if}
			{#if saveStatus === 'saved'}{saveMessage}{/if}
			{#if saveStatus === 'error'}{saveMessage}{/if}
		</p>
	{/if}
</div>

<style>
	.section-heading {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
		margin-bottom: var(--space-4);
	}

	.form-group {
		margin-bottom: var(--space-4);
	}
</style>
