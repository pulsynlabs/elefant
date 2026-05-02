<script lang="ts">
	import type {
		McpServerConfig,
		McpTransport,
	} from '$lib/daemon/types.js';
	import { mcpService } from '$lib/services/mcp-service.js';

	type Props = {
		/** When provided, the form is in edit mode and pre-fills from this config. */
		editing?: McpServerConfig;
		/** Pre-fill from a registry entry (Add mode). */
		template?: Partial<McpServerConfig>;
		onSaved: (server: McpServerConfig) => void;
		onCancel: () => void;
	};

	let { editing, template, onSaved, onCancel }: Props = $props();

	const isEditing = $derived(!!editing);

	// ─── Form state ──────────────────────────────────────────────────────────
	let name = $state(editing?.name ?? template?.name ?? '');
	let transport = $state<McpTransport>(
		editing?.transport ?? template?.transport ?? 'stdio',
	);
	let commandText = $state(
		(editing?.command ?? template?.command ?? []).join(' '),
	);
	let url = $state(editing?.url ?? template?.url ?? '');
	let enabled = $state(editing?.enabled ?? true);
	let timeoutMs = $state(editing?.timeout ?? 30_000);

	// Env / headers as parallel arrays for stable keying in {#each}.
	type Pair = { key: string; value: string };
	const toPairs = (obj?: Record<string, string>): Pair[] =>
		obj ? Object.entries(obj).map(([key, value]) => ({ key, value })) : [];

	let envPairs = $state<Pair[]>(
		toPairs(editing?.env ?? template?.env),
	);
	let headerPairs = $state<Pair[]>(
		toPairs(editing?.headers ?? template?.headers),
	);

	let errors = $state<Record<string, string>>({});
	let status = $state<{ type: 'success' | 'error'; message: string } | null>(
		null,
	);
	let saving = $state(false);

	// ─── Validation ──────────────────────────────────────────────────────────
	const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

	function validate(): boolean {
		const next: Record<string, string> = {};
		if (!name.trim()) {
			next.name = 'Name is required';
		} else if (!NAME_PATTERN.test(name.trim())) {
			next.name = 'Name may only contain letters, numbers, underscore, hyphen';
		}

		if (transport === 'stdio') {
			if (!commandText.trim()) {
				next.command = 'Command is required for stdio transport';
			}
		} else {
			if (!url.trim()) {
				next.url = 'URL is required for remote transports';
			} else {
				try {
					const parsed = new URL(url.trim());
					if (!['http:', 'https:'].includes(parsed.protocol)) {
						next.url = 'URL must use http or https';
					}
				} catch {
					next.url = 'Must be a valid URL';
				}
			}
		}

		if (
			Number.isNaN(timeoutMs)
			|| timeoutMs < 1_000
			|| timeoutMs > 600_000
		) {
			next.timeout = 'Timeout must be between 1000 and 600000 ms';
		}

		errors = next;
		return Object.keys(next).length === 0;
	}

	// ─── Mutators ────────────────────────────────────────────────────────────
	function addEnvPair(): void {
		envPairs = [...envPairs, { key: '', value: '' }];
	}
	function removeEnvPair(index: number): void {
		envPairs = envPairs.filter((_, i) => i !== index);
	}
	function addHeaderPair(): void {
		headerPairs = [...headerPairs, { key: '', value: '' }];
	}
	function removeHeaderPair(index: number): void {
		headerPairs = headerPairs.filter((_, i) => i !== index);
	}

	function pairsToRecord(pairs: Pair[]): Record<string, string> | undefined {
		const out: Record<string, string> = {};
		for (const { key, value } of pairs) {
			const k = key.trim();
			if (k) out[k] = value;
		}
		return Object.keys(out).length > 0 ? out : undefined;
	}

	function parseCommand(text: string): string[] {
		// Naive split on whitespace — good enough for the common
		// `npx -y @scope/pkg arg` shape. Quoted args with spaces are an
		// edge case that the daemon will validate on save.
		return text.trim().split(/\s+/).filter(Boolean);
	}

	function buildConfig(): McpServerConfig {
		const base: McpServerConfig = {
			id: editing?.id ?? '',
			name: name.trim(),
			transport,
			enabled,
			timeout: Math.round(timeoutMs),
			pinnedTools: editing?.pinnedTools ?? [],
		};

		if (transport === 'stdio') {
			base.command = parseCommand(commandText);
			base.env = pairsToRecord(envPairs);
		} else {
			base.url = url.trim();
			base.headers = pairsToRecord(headerPairs);
		}

		return base;
	}

	async function handleSave(): Promise<void> {
		if (!validate()) return;
		saving = true;
		status = null;
		try {
			const config = buildConfig();
			let saved: McpServerConfig;
			if (isEditing && editing) {
				saved = await mcpService.updateServer(editing.id, config);
				status = { type: 'success', message: 'Server updated' };
			} else {
				saved = await mcpService.addServer(config);
				status = { type: 'success', message: 'Server added' };
			}
			onSaved(saved);
		} catch (err) {
			status = {
				type: 'error',
				message: err instanceof Error ? err.message : 'Failed to save server',
			};
		} finally {
			saving = false;
		}
	}
</script>

<div class="mcp-form">
	<h4 class="form-title">{isEditing ? 'Edit MCP Server' : 'Add MCP Server'}</h4>

	{#if status}
		<div class="status-message" class:error={status.type === 'error'} role="status">
			{status.message}
		</div>
	{/if}

	<div class="form-fields">
		<div class="form-group">
			<label class="field-label" for="mcp-name">Name</label>
			<input
				id="mcp-name"
				type="text"
				class="field-input"
				class:field-error={!!errors.name}
				bind:value={name}
				placeholder="filesystem"
				disabled={isEditing}
				aria-invalid={!!errors.name}
			/>
			{#if errors.name}<span class="error-text">{errors.name}</span>{/if}
		</div>

		<div class="form-group">
			<label class="field-label" for="mcp-transport">Transport</label>
			<select
				id="mcp-transport"
				class="field-select"
				bind:value={transport}
				disabled={isEditing}
			>
				<option value="stdio">stdio (local process)</option>
				<option value="streamable-http">streamable-http (remote)</option>
				<option value="sse">sse (remote, legacy)</option>
			</select>
		</div>

		{#if transport === 'stdio'}
			<div class="form-group">
				<label class="field-label" for="mcp-command">Command</label>
				<input
					id="mcp-command"
					type="text"
					class="field-input"
					class:field-error={!!errors.command}
					bind:value={commandText}
					placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp"
					aria-invalid={!!errors.command}
					spellcheck="false"
					autocapitalize="off"
				/>
				<span class="hint">
					Argv-style. The first token is the executable; remaining tokens are arguments.
				</span>
				{#if errors.command}<span class="error-text">{errors.command}</span>{/if}
			</div>

			<div class="form-group">
				<div class="pairs-header">
					<span class="field-label">Environment Variables</span>
					<button class="btn-link" type="button" onclick={addEnvPair}>
						+ Add
					</button>
				</div>
				{#if envPairs.length === 0}
					<p class="hint">No environment variables.</p>
				{:else}
					<div class="pairs-list">
						{#each envPairs as pair, i (i)}
							<div class="pair-row">
								<input
									type="text"
									class="field-input pair-key"
									placeholder="KEY"
									bind:value={pair.key}
									spellcheck="false"
									autocapitalize="off"
								/>
								<input
									type="text"
									class="field-input pair-value"
									placeholder="value"
									bind:value={pair.value}
									spellcheck="false"
									autocapitalize="off"
								/>
								<button
									class="btn-remove"
									type="button"
									onclick={() => removeEnvPair(i)}
									aria-label="Remove environment variable"
								>
									×
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			<div class="form-group">
				<label class="field-label" for="mcp-url">URL</label>
				<input
					id="mcp-url"
					type="url"
					class="field-input"
					class:field-error={!!errors.url}
					bind:value={url}
					placeholder="https://mcp.example.com/v1"
					aria-invalid={!!errors.url}
					spellcheck="false"
					autocapitalize="off"
				/>
				{#if errors.url}<span class="error-text">{errors.url}</span>{/if}
			</div>

			<div class="form-group">
				<div class="pairs-header">
					<span class="field-label">HTTP Headers</span>
					<button class="btn-link" type="button" onclick={addHeaderPair}>
						+ Add
					</button>
				</div>
				{#if headerPairs.length === 0}
					<p class="hint">No headers.</p>
				{:else}
					<div class="pairs-list">
						{#each headerPairs as pair, i (i)}
							<div class="pair-row">
								<input
									type="text"
									class="field-input pair-key"
									placeholder="Authorization"
									bind:value={pair.key}
									spellcheck="false"
									autocapitalize="off"
								/>
								<input
									type="text"
									class="field-input pair-value"
									placeholder="Bearer …"
									bind:value={pair.value}
									spellcheck="false"
									autocapitalize="off"
								/>
								<button
									class="btn-remove"
									type="button"
									onclick={() => removeHeaderPair(i)}
									aria-label="Remove header"
								>
									×
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<div class="form-row">
			<div class="form-group">
				<label class="field-label" for="mcp-timeout">Timeout (ms)</label>
				<input
					id="mcp-timeout"
					type="number"
					class="field-input"
					class:field-error={!!errors.timeout}
					bind:value={timeoutMs}
					min="1000"
					max="600000"
					step="1000"
					aria-invalid={!!errors.timeout}
				/>
				{#if errors.timeout}<span class="error-text">{errors.timeout}</span>{/if}
			</div>

			<div class="form-group toggle-group">
				<label class="toggle-label">
					<input type="checkbox" bind:checked={enabled} />
					<span>Enabled</span>
				</label>
			</div>
		</div>
	</div>

	<div class="form-actions">
		<button class="btn-primary" type="button" onclick={handleSave} disabled={saving}>
			{saving ? 'Saving…' : isEditing ? 'Update Server' : 'Add Server'}
		</button>
		<button class="btn-secondary" type="button" onclick={onCancel} disabled={saving}>
			Cancel
		</button>
	</div>
</div>

<style>
	.mcp-form {
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.form-title {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
	}

	.form-fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--space-4);
		align-items: start;
	}

	.field-label {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-secondary);
	}

	.field-input {
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		padding: var(--space-2) var(--space-3);
		width: 100%;
		outline: none;
		transition: border-color var(--transition-fast);
	}

	.field-input:focus {
		border-color: var(--color-primary);
	}

	.field-select {
		width: 100%;
	}

	.field-input.field-error {
		border-color: var(--color-error);
	}

	.error-text {
		font-size: var(--font-size-xs);
		color: var(--color-error);
	}

	.hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: 0;
	}

	.status-message {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		background-color: color-mix(in oklch, var(--color-success) 10%, transparent);
		color: var(--color-success);
		border: 1px solid var(--color-success);
	}

	.status-message.error {
		background-color: color-mix(in oklch, var(--color-error) 10%, transparent);
		color: var(--color-error);
		border-color: var(--color-error);
	}

	.pairs-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.btn-link {
		background: none;
		border: none;
		color: var(--color-primary);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		cursor: pointer;
		padding: 0;
	}

	.btn-link:hover {
		text-decoration: underline;
	}

	.pairs-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.pair-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) auto;
		gap: var(--space-2);
		align-items: center;
	}

	.pair-key,
	.pair-value {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}

	.btn-remove {
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: var(--font-size-md);
		padding: var(--space-1) var(--space-2);
		line-height: 1;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.btn-remove:hover {
		color: var(--color-error);
		border-color: var(--color-error);
	}

	.toggle-group {
		justify-self: end;
		align-self: end;
		padding-bottom: var(--space-2);
	}

	.toggle-label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
		cursor: pointer;
	}

	.form-actions {
		display: flex;
		gap: var(--space-3);
	}

	.btn-primary {
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border: none;
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition: background-color var(--transition-fast);
	}

	.btn-primary:hover:not(:disabled) {
		background-color: var(--color-primary-hover);
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-secondary {
		background-color: transparent;
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--font-size-md);
		cursor: pointer;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.btn-secondary:hover:not(:disabled) {
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
	}

	.btn-secondary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* ── Mobile touch targets (≥44px) ─────────────────────────────── */
	@media (max-width: 640px) {
		.btn-primary,
		.btn-secondary {
			min-height: 44px;
		}
	}
</style>
