<script lang="ts">
	// ToolPolicyEditor — tool mode + allow / deny lists for a profile.
	//
	// - `mode`: auto | manual | deny_all (radio group)
	// - Allowed / denied tools: chip input with Enter/comma add + click-to-remove
	// - Client-side validation on tool names; invalid tokens never enter the list
	//
	// Saves the whole `tools` block via `agentConfigStore.update`.

	import type {
		AgentProfile,
		ToolMode,
		ToolPolicy,
	} from '$lib/types/agent-config.js';
	import { TOOL_MODES } from '$lib/types/agent-config.js';
	import { agentConfigStore } from '$lib/stores/agent-config.svelte.js';
	import {
		isValidToolName,
		validateToolPolicy,
		parseToolList,
	} from './validation.js';
	import { HugeiconsIcon, CloseIcon } from '$lib/icons/index.js';

	type Props = {
		profile: AgentProfile;
		onSaved?: (profile: AgentProfile) => void;
		onCancel?: () => void;
	};

	let { profile, onSaved, onCancel }: Props = $props();

	let mode = $state<ToolMode>(profile.tools.mode);
	let allowedTools = $state<string[]>([...(profile.tools.allowedTools ?? [])]);
	let deniedTools = $state<string[]>([...(profile.tools.deniedTools ?? [])]);

	// Raw input buffers for the chip inputs.
	let allowedDraft = $state('');
	let deniedDraft = $state('');

	let allowedInvalid = $state<string[]>([]);
	let deniedInvalid = $state<string[]>([]);

	let isSaving = $state(false);
	let serverError = $state<string | null>(null);

	const currentPolicy = $derived<ToolPolicy>({
		mode,
		allowedTools,
		deniedTools,
		perToolApproval: profile.tools.perToolApproval,
	});

	const errors = $derived(validateToolPolicy(currentPolicy));

	const MODE_DESCRIPTIONS: Record<ToolMode, string> = {
		auto: 'Agent can call any registered tool unless denied below.',
		manual: 'Every tool call requires explicit approval.',
		deny_all: 'Block every tool call. Use for plan-only agents.',
	};

	function addFromInput(target: 'allow' | 'deny', source: string): void {
		const { tools, invalid } = parseToolList(source);
		if (target === 'allow') {
			const next = [...allowedTools];
			for (const name of tools) {
				if (!next.includes(name)) next.push(name);
			}
			allowedTools = next;
			allowedInvalid = invalid;
			allowedDraft = '';
		} else {
			const next = [...deniedTools];
			for (const name of tools) {
				if (!next.includes(name)) next.push(name);
			}
			deniedTools = next;
			deniedInvalid = invalid;
			deniedDraft = '';
		}
	}

	function handleChipKeydown(
		event: KeyboardEvent,
		target: 'allow' | 'deny',
	): void {
		// Commit on Enter, comma, or Tab (when there's content).
		const input = event.currentTarget as HTMLInputElement;
		const value = input.value.trim();
		if (event.key === 'Enter' || event.key === ',') {
			if (value.length === 0) return;
			event.preventDefault();
			addFromInput(target, value);
		} else if (event.key === 'Backspace' && value.length === 0) {
			// Backspace on an empty input removes the trailing chip, matching
			// the standard chip-input UX users already expect.
			if (target === 'allow' && allowedTools.length > 0) {
				allowedTools = allowedTools.slice(0, -1);
			} else if (target === 'deny' && deniedTools.length > 0) {
				deniedTools = deniedTools.slice(0, -1);
			}
		}
	}

	function handleChipBlur(target: 'allow' | 'deny'): void {
		const raw = target === 'allow' ? allowedDraft : deniedDraft;
		if (raw.trim().length > 0) {
			addFromInput(target, raw);
		}
	}

	function removeChip(target: 'allow' | 'deny', name: string): void {
		if (target === 'allow') {
			allowedTools = allowedTools.filter((t) => t !== name);
		} else {
			deniedTools = deniedTools.filter((t) => t !== name);
		}
	}

	async function handleSave(event: Event): Promise<void> {
		event.preventDefault();
		if (Object.keys(errors).length > 0) return;

		isSaving = true;
		serverError = null;
		try {
			const updated = await agentConfigStore.update(profile.id, {
				tools: {
					mode,
					allowedTools,
					deniedTools,
					perToolApproval: profile.tools.perToolApproval,
				},
			});
			if (!updated) {
				serverError = agentConfigStore.lastError ?? 'Failed to save';
				return;
			}
			onSaved?.(updated);
		} finally {
			isSaving = false;
		}
	}

	function handleReset(): void {
		mode = profile.tools.mode;
		allowedTools = [...(profile.tools.allowedTools ?? [])];
		deniedTools = [...(profile.tools.deniedTools ?? [])];
		allowedDraft = '';
		deniedDraft = '';
		allowedInvalid = [];
		deniedInvalid = [];
		serverError = null;
	}
</script>

<form class="form" onsubmit={handleSave} aria-labelledby="tool-policy-title">
	<header class="form-header">
		<h4 id="tool-policy-title" class="form-title">Tool Policy</h4>
		<p class="form-subtitle">
			Decide which tools
			<span class="agent-id">{profile.id}</span> can call. Combine with
			per-tool approval rules below.
		</p>
	</header>

	<fieldset class="mode-group">
		<legend class="mode-legend">Tool mode</legend>
		{#each TOOL_MODES as m (m)}
			<label class="mode-option" class:mode-option-selected={mode === m}>
				<input
					type="radio"
					name="tool-mode-{profile.id}"
					value={m}
					checked={mode === m}
					onchange={() => (mode = m)}
				/>
				<div class="mode-content">
					<span class="mode-name">{m}</span>
					<span class="mode-description">{MODE_DESCRIPTIONS[m]}</span>
				</div>
			</label>
		{/each}
	</fieldset>

	<div class="chip-field" class:chip-field-muted={mode === 'deny_all'}>
		<label class="chip-label" for="allowed-{profile.id}">
			Allowed tools
			<span class="chip-count">{allowedTools.length}</span>
		</label>
		<div class="chip-box" role="group" aria-label="Allowed tools">
			{#each allowedTools as tool (tool)}
				<span class="chip">
					{tool}
					<button
						type="button"
						class="chip-remove"
						aria-label="Remove {tool}"
						onclick={() => removeChip('allow', tool)}
					>
						<HugeiconsIcon icon={CloseIcon} size={10} strokeWidth={2} />
					</button>
				</span>
			{/each}
			<input
				id="allowed-{profile.id}"
				class="chip-input"
				type="text"
				placeholder={allowedTools.length === 0 ? 'e.g. read_file, bash' : ''}
				bind:value={allowedDraft}
				onkeydown={(e) => handleChipKeydown(e, 'allow')}
				onblur={() => handleChipBlur('allow')}
				aria-invalid={errors.allowedTools ? 'true' : undefined}
				aria-describedby="allowed-hint-{profile.id}"
				disabled={mode === 'deny_all'}
			/>
		</div>
		<p id="allowed-hint-{profile.id}" class="chip-hint">
			{#if errors.allowedTools}
				<span class="error">{errors.allowedTools}</span>
			{:else if allowedInvalid.length > 0}
				<span class="error"
					>Ignored invalid: {allowedInvalid.join(', ')}</span
				>
			{:else}
				Press Enter or comma to add. Names must start with a letter.
			{/if}
		</p>
	</div>

	<div class="chip-field">
		<label class="chip-label" for="denied-{profile.id}">
			Denied tools
			<span class="chip-count">{deniedTools.length}</span>
		</label>
		<div class="chip-box chip-box-danger" role="group" aria-label="Denied tools">
			{#each deniedTools as tool (tool)}
				<span class="chip chip-danger">
					{tool}
					<button
						type="button"
						class="chip-remove"
						aria-label="Remove {tool}"
						onclick={() => removeChip('deny', tool)}
					>
						<HugeiconsIcon icon={CloseIcon} size={10} strokeWidth={2} />
					</button>
				</span>
			{/each}
			<input
				id="denied-{profile.id}"
				class="chip-input"
				type="text"
				placeholder={deniedTools.length === 0
					? 'e.g. bash, delete_file'
					: ''}
				bind:value={deniedDraft}
				onkeydown={(e) => handleChipKeydown(e, 'deny')}
				onblur={() => handleChipBlur('deny')}
				aria-invalid={errors.deniedTools ? 'true' : undefined}
				aria-describedby="denied-hint-{profile.id}"
			/>
		</div>
		<p id="denied-hint-{profile.id}" class="chip-hint">
			{#if errors.deniedTools}
				<span class="error">{errors.deniedTools}</span>
			{:else if deniedInvalid.length > 0}
				<span class="error"
					>Ignored invalid: {deniedInvalid.join(', ')}</span
				>
			{:else}
				Denied tools always lose, regardless of mode.
			{/if}
		</p>
	</div>

	{#if serverError}
		<div class="server-error" role="alert">{serverError}</div>
	{/if}

	<footer class="form-actions">
		{#if onCancel}
			<button
				type="button"
				class="button button-secondary"
				onclick={onCancel}
				disabled={isSaving}
			>
				Cancel
			</button>
		{/if}
		<button
			type="button"
			class="button button-secondary"
			onclick={handleReset}
			disabled={isSaving}
		>
			Reset
		</button>
		<button
			type="submit"
			class="button button-primary"
			disabled={isSaving || Object.keys(errors).length > 0}
		>
			{isSaving ? 'Saving…' : 'Save tool policy'}
		</button>
	</footer>
</form>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	.form-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.form-title {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-snug);
		margin: 0;
	}

	.form-subtitle {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin: 0;
	}

	.agent-id {
		font-family: var(--font-mono);
		color: var(--color-text-secondary);
	}

	.mode-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: 0;
		margin: 0;
		border: none;
	}

	.mode-legend {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-secondary);
		padding: 0;
		margin-bottom: var(--space-1);
	}

	.mode-option {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background-color: var(--color-surface-elevated);
		cursor: pointer;
		transition:
			border-color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.mode-option:hover {
		border-color: var(--color-border-strong);
	}

	.mode-option input {
		margin-top: 2px;
		accent-color: var(--color-primary);
	}

	.mode-option input:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.mode-option-selected {
		border-color: var(--color-primary);
		background-color: color-mix(
			in srgb,
			var(--color-primary) 8%,
			var(--color-surface-elevated)
		);
	}

	.mode-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.mode-name {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-primary);
	}

	.mode-description {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.chip-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.chip-field-muted {
		opacity: 0.7;
	}

	.chip-label {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-secondary);
	}

	.chip-count {
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs, 10px);
		color: var(--color-text-disabled);
	}

	.chip-box {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2);
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		min-height: 44px;
		transition: border-color var(--transition-fast);
	}

	.chip-box:focus-within {
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-full);
		color: var(--color-text-primary);
	}

	.chip-danger {
		border-color: color-mix(
			in srgb,
			var(--color-error, #b23a3a) 40%,
			var(--color-border-strong)
		);
		color: var(--color-error, #b23a3a);
	}

	.chip-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0;
		border-radius: var(--radius-full);
		transition:
			color var(--transition-fast),
			background-color var(--transition-fast);
	}

	.chip-remove:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.chip-remove:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	.chip-input {
		flex: 1;
		min-width: 80px;
		border: none;
		background: transparent;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--color-text-primary);
		padding: var(--space-1);
		outline: none;
	}

	.chip-input:disabled {
		cursor: not-allowed;
	}

	.chip-hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-disabled);
		margin: 0;
	}

	.error {
		color: var(--color-error, #b23a3a);
	}

	.server-error {
		padding: var(--space-3);
		border: 1px solid color-mix(
			in srgb,
			var(--color-error, #b23a3a) 50%,
			transparent
		);
		border-radius: var(--radius-md);
		background-color: color-mix(
			in srgb,
			var(--color-error, #b23a3a) 12%,
			transparent
		);
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-3);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
	}

	.button {
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.button:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.button:disabled {
		cursor: progress;
		opacity: 0.65;
	}

	.button-secondary {
		border: 1px solid var(--color-border-strong);
		background: transparent;
		color: var(--color-text-primary);
	}

	.button-secondary:hover:not(:disabled) {
		background-color: var(--color-surface-hover);
	}

	.button-primary {
		border: 1px solid var(--color-primary);
		background-color: var(--color-primary);
		color: var(--color-primary-foreground, #fff);
	}

	.button-primary:hover:not(:disabled) {
		background-color: color-mix(in srgb, var(--color-primary) 90%, black);
	}
</style>
