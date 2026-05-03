<script lang="ts">
	/**
	 * ResearchBaseTab — Settings → Research Base
	 *
	 * Six sections, top-to-bottom:
	 *   1. Vector Index toggle — gates the rest of the controls
	 *   2. Embedding Provider — 10 options + provider-specific config
	 *   3. Hardware — read-only profile + recommended-tier shortcut
	 *   4. Index Stats — totals + reindex action with progress
	 *   5. Editor Override — optional path to an editor binary
	 *   6. Open Folder — reveals the .elefant/markdown-db/ directory
	 *
	 * All persistence flows through `PUT /api/config` with the `research`
	 * block. Saves debounce 800 ms after any field change. The component is
	 * defensive when no project is selected, when the daemon is offline,
	 * and when the research config block has not yet been written.
	 */

	import { onMount, onDestroy } from 'svelte';
	import { configService } from '$lib/services/config-service.js';
	import { researchClient } from '$lib/daemon/research-client.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';
	import SelectInput from '$lib/components/ui/SelectInput.svelte';
	import { HugeiconsIcon, RefreshIcon, FolderIcon, WarningIcon } from '$lib/icons/index.js';
	import type {
		EmbeddingProviderName,
		ResearchConfig,
		ResearchProviderConfig,
		ResearchStatus,
	} from '$lib/daemon/types.js';

	// ─── Provider catalog ──────────────────────────────────────────────────

	type ProviderKind = 'bundled' | 'local-http' | 'remote' | 'disabled';

	interface ProviderMeta {
		value: EmbeddingProviderName;
		label: string;
		kind: ProviderKind;
	}

	const providerCatalog: ProviderMeta[] = [
		{ value: 'bundled-cpu', label: 'Built-in CPU', kind: 'bundled' },
		{ value: 'bundled-gpu', label: 'Built-in GPU', kind: 'bundled' },
		{ value: 'bundled-large', label: 'Built-in Large (needs GPU + 16 GB)', kind: 'bundled' },
		{ value: 'ollama', label: 'Ollama', kind: 'local-http' },
		{ value: 'lm-studio', label: 'LM Studio', kind: 'local-http' },
		{ value: 'vllm', label: 'vLLM', kind: 'local-http' },
		{ value: 'openai', label: 'OpenAI', kind: 'remote' },
		{ value: 'openai-compatible', label: 'OpenAI-compatible', kind: 'remote' },
		{ value: 'google', label: 'Google', kind: 'remote' },
		{ value: 'disabled', label: 'Disabled (keyword only)', kind: 'disabled' },
	];

	const providerOptions = providerCatalog.map((p) => ({ value: p.value, label: p.label }));
	const providerByName = new Map(providerCatalog.map((p) => [p.value, p]));

	function kindOf(name: EmbeddingProviderName): ProviderKind {
		return providerByName.get(name)?.kind ?? 'bundled';
	}

	// ─── Reactive state ────────────────────────────────────────────────────

	const DEFAULT_CONFIG: ResearchConfig = {
		enabled: true,
		provider: 'bundled-cpu',
		editorOverride: undefined,
		providerConfig: undefined,
	};

	let enabled = $state(DEFAULT_CONFIG.enabled);
	let provider = $state<EmbeddingProviderName>(DEFAULT_CONFIG.provider);
	let editorOverride = $state('');
	let providerBaseUrl = $state('');
	let providerApiKey = $state('');
	let providerModel = $state('');
	let bundledModelId = $state('');

	let status = $state<ResearchStatus | null>(null);
	let statusError = $state<string | null>(null);
	let isLoadingStatus = $state(false);

	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveMessage = $state('');

	let reindexState = $state<'idle' | 'starting' | 'started' | 'error'>('idle');
	let reindexMessage = $state('');

	let copiedPath = $state(false);

	// `dirty` only flips after the first user-triggered change so the initial
	// hydrate from the config file does not trigger a save.
	let dirty = $state(false);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	const activeProjectId = $derived(projectsStore.activeProjectId);
	const activeProject = $derived(projectsStore.activeProject);
	const providerKind = $derived(kindOf(provider));
	const isRemoteProvider = $derived(providerKind === 'remote');
	const showLocalHttpFields = $derived(providerKind === 'local-http' || providerKind === 'remote');
	const showApiKeyField = $derived(providerKind === 'remote');
	const showModelField = $derived(providerKind === 'remote');
	const showBundledModelOverride = $derived(providerKind === 'bundled');
	const isVectorActive = $derived(enabled && provider !== 'disabled');

	const researchBasePath = $derived(
		activeProject ? joinPath(activeProject.path, '.elefant', 'markdown-db') : null,
	);

	function joinPath(...parts: string[]): string {
		return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
	}

	// ─── Hydration ─────────────────────────────────────────────────────────

	onMount(async () => {
		await loadConfig();
		await refreshStatus();
	});

	onDestroy(() => {
		if (saveTimer !== null) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
	});

	async function loadConfig(): Promise<void> {
		const config = await configService.readConfig();
		const research = config?.research ?? DEFAULT_CONFIG;
		enabled = research.enabled ?? DEFAULT_CONFIG.enabled;
		provider = research.provider ?? DEFAULT_CONFIG.provider;
		editorOverride = research.editorOverride ?? '';
		const pc = research.providerConfig ?? {};
		providerBaseUrl = pc.baseUrl ?? '';
		providerApiKey = pc.apiKey ?? '';
		providerModel = pc.model ?? '';
		bundledModelId = pc.bundledModelId ?? '';
		// Reset dirty after hydrate so the load itself doesn't trigger a save.
		dirty = false;
	}

	async function refreshStatus(): Promise<void> {
		if (!activeProjectId) {
			status = null;
			statusError = null;
			return;
		}
		isLoadingStatus = true;
		statusError = null;
		try {
			status = await researchClient.fetchStatus(activeProjectId);
		} catch (error) {
			status = null;
			statusError = error instanceof Error ? error.message : 'Failed to load Research status';
		} finally {
			isLoadingStatus = false;
		}
	}

	// ─── Debounced auto-save ───────────────────────────────────────────────

	function buildProviderConfig(): ResearchProviderConfig | undefined {
		const config: ResearchProviderConfig = {};
		if (showLocalHttpFields && providerBaseUrl.trim() !== '') {
			config.baseUrl = providerBaseUrl.trim();
		}
		if (showApiKeyField && providerApiKey.trim() !== '') {
			config.apiKey = providerApiKey.trim();
		}
		if (showModelField && providerModel.trim() !== '') {
			config.model = providerModel.trim();
		}
		if (showBundledModelOverride && bundledModelId.trim() !== '') {
			config.bundledModelId = bundledModelId.trim();
		}
		return Object.keys(config).length > 0 ? config : undefined;
	}

	function markDirty(): void {
		dirty = true;
		queueSave();
	}

	function queueSave(): void {
		if (saveTimer !== null) {
			clearTimeout(saveTimer);
		}
		saveTimer = setTimeout(() => {
			saveTimer = null;
			void persist();
		}, 800);
	}

	async function persist(): Promise<void> {
		if (!dirty) return;
		saveStatus = 'saving';
		saveMessage = '';

		const research: ResearchConfig = {
			enabled,
			provider,
			editorOverride: editorOverride.trim() === '' ? undefined : editorOverride.trim(),
			providerConfig: buildProviderConfig(),
		};

		try {
			await configService.updateConfig({ research });
			dirty = false;
			saveStatus = 'saved';
			saveMessage = 'Saved';
			setTimeout(() => {
				if (saveStatus === 'saved') saveStatus = 'idle';
			}, 1800);
		} catch (error) {
			saveStatus = 'error';
			saveMessage = error instanceof Error ? error.message : 'Failed to save';
		}
	}

	// ─── Reindex ───────────────────────────────────────────────────────────

	async function handleReindex(): Promise<void> {
		if (!activeProjectId) return;
		reindexState = 'starting';
		reindexMessage = '';
		try {
			await researchClient.reindex(activeProjectId);
			reindexState = 'started';
			reindexMessage = 'Reindex started — refresh status in a moment.';
			// Give the daemon a beat and refresh stats.
			setTimeout(() => {
				void refreshStatus();
			}, 800);
		} catch (error) {
			reindexState = 'error';
			reindexMessage = error instanceof Error ? error.message : 'Reindex failed';
		}
	}

	// ─── Hardware "Use recommended" ───────────────────────────────────────

	function applyRecommendedProvider(): void {
		if (!status?.recommendedTier) return;
		provider = status.recommendedTier;
		markDirty();
	}

	// ─── Open Folder ───────────────────────────────────────────────────────

	async function openFolder(): Promise<void> {
		if (!researchBasePath) return;
		try {
			const tauri = (window as unknown as {
				__TAURI__?: { shell?: { open: (target: string) => Promise<void> } };
			}).__TAURI__;
			if (tauri?.shell?.open) {
				await tauri.shell.open(researchBasePath);
				return;
			}
		} catch {
			// fall through to copy fallback below
		}
		// Fallback: copy to clipboard so the user can paste it.
		try {
			await navigator.clipboard.writeText(researchBasePath);
			copiedPath = true;
			setTimeout(() => {
				copiedPath = false;
			}, 1800);
		} catch {
			// best-effort; user can still read the path inline
		}
	}

	// ─── Formatters ────────────────────────────────────────────────────────

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		const exponent = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
		const value = bytes / 10 ** (exponent * 3);
		return `${value.toFixed(value < 10 && exponent > 0 ? 1 : 0)} ${units[exponent]}`;
	}

	function formatRelative(timestamp: string | null): string {
		if (!timestamp) return 'Never';
		const then = new Date(timestamp).getTime();
		if (Number.isNaN(then)) return 'Unknown';
		const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
		if (seconds < 60) return 'Just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes} min ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
		const days = Math.floor(hours / 24);
		if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
		const months = Math.floor(days / 30);
		if (months < 12) return `${months} mo ago`;
		const years = Math.floor(months / 12);
		return `${years} yr${years === 1 ? '' : 's'} ago`;
	}

	function tierLabel(tier: string | null | undefined): string {
		if (!tier) return '—';
		return providerByName.get(tier as EmbeddingProviderName)?.label ?? tier;
	}
</script>

<div class="research-tab">
	<div class="header-row">
		<h3 class="section-heading">Research Base</h3>
		{#if saveStatus !== 'idle'}
			<span class="save-feedback" class:error={saveStatus === 'error'}>
				{saveMessage || (saveStatus === 'saving' ? 'Saving…' : '')}
			</span>
		{/if}
	</div>

	<p class="lede">
		Per-project markdown knowledge garden at
		<code>.elefant/markdown-db/</code>. Configure how research is indexed
		and embedded.
	</p>

	<!-- ── 1. Vector Index toggle ─────────────────────────────────────── -->
	<section class="card">
		<header class="card-header">
			<h4 class="card-title">Vector Index</h4>
			<label class="toggle">
				<input
					type="checkbox"
					bind:checked={enabled}
					onchange={markDirty}
					aria-label="Enable vector index"
				/>
				<span class="toggle-track" aria-hidden="true">
					<span class="toggle-thumb" />
				</span>
				<span class="toggle-label">{enabled ? 'On' : 'Off'}</span>
			</label>
		</header>
		<p class="card-hint">
			{#if enabled}
				Research files are embedded into a local vector index for semantic search.
			{:else}
				Search uses keyword matching only.
			{/if}
		</p>
	</section>

	{#if enabled}
		<!-- ── 2. Embedding Provider ─────────────────────────────────────── -->
		<section class="card">
			<header class="card-header">
				<h4 class="card-title">Embedding Provider</h4>
			</header>

			<div class="form-group">
				<label class="field-label" for="embedding-provider">Provider</label>
				<SelectInput
					id="embedding-provider"
					bind:value={provider}
					options={providerOptions}
					aria-label="Embedding provider"
				/>
			</div>

			{#if isRemoteProvider}
				<div class="banner banner-warn" role="alert">
					<span class="banner-icon" aria-hidden="true">
						<HugeiconsIcon icon={WarningIcon} size={16} strokeWidth={1.8} />
					</span>
					<span class="banner-text">
						<strong>Privacy notice.</strong>
						Embedding text is sent to an external service. Review your data
						handling policy before enabling.
					</span>
				</div>
			{/if}

			{#if showLocalHttpFields}
				<div class="form-group">
					<label class="field-label" for="provider-base-url">
						Base URL
						{#if providerKind === 'local-http'}
							<span class="field-hint-inline">(e.g. http://localhost:11434)</span>
						{/if}
					</label>
					<input
						id="provider-base-url"
						type="url"
						class="field-input"
						bind:value={providerBaseUrl}
						oninput={markDirty}
						placeholder={providerKind === 'remote'
							? 'https://api.example.com'
							: 'http://localhost:11434'}
					/>
				</div>
			{/if}

			{#if showApiKeyField}
				<div class="form-group">
					<label class="field-label" for="provider-api-key">API Key</label>
					<input
						id="provider-api-key"
						type="password"
						class="field-input"
						bind:value={providerApiKey}
						oninput={markDirty}
						autocomplete="off"
						spellcheck="false"
						placeholder="•••••••"
					/>
				</div>
			{/if}

			{#if showModelField}
				<div class="form-group">
					<label class="field-label" for="provider-model">Model</label>
					<input
						id="provider-model"
						type="text"
						class="field-input"
						bind:value={providerModel}
						oninput={markDirty}
						placeholder="text-embedding-3-small"
					/>
				</div>
			{/if}

			{#if showBundledModelOverride}
				<div class="form-group">
					<label class="field-label" for="bundled-model-id">
						Model override
						<span class="field-hint-inline">(optional)</span>
					</label>
					<input
						id="bundled-model-id"
						type="text"
						class="field-input"
						bind:value={bundledModelId}
						oninput={markDirty}
						placeholder="Xenova/all-MiniLM-L6-v2"
					/>
					<span class="field-hint">
						Leave blank to use the default bundled model for this tier.
					</span>
				</div>
			{/if}
		</section>

		<!-- ── 3. Hardware ────────────────────────────────────────────────── -->
		<section class="card">
			<header class="card-header">
				<h4 class="card-title">Hardware</h4>
				{#if status?.recommendedTier && status.recommendedTier !== provider}
					<button
						type="button"
						class="link-btn"
						onclick={applyRecommendedProvider}
					>
						Use recommended
					</button>
				{/if}
			</header>

			{#if isLoadingStatus && !status}
				<p class="card-hint">Reading hardware profile…</p>
			{:else if status?.hardware}
				<dl class="stat-grid">
					<div class="stat">
						<dt>CPU cores</dt>
						<dd>{status.hardware.cpuCores}</dd>
					</div>
					<div class="stat">
						<dt>RAM</dt>
						<dd>{status.hardware.ramGB} GB</dd>
					</div>
					<div class="stat">
						<dt>GPU</dt>
						<dd>
							{#if status.hardware.hasGPU}
								Yes{#if status.hardware.gpuName}
									<span class="stat-sub">{status.hardware.gpuName}</span>
								{/if}
							{:else}
								No
							{/if}
						</dd>
					</div>
					<div class="stat">
						<dt>Recommended tier</dt>
						<dd>{tierLabel(status.recommendedTier)}</dd>
					</div>
				</dl>
			{:else if statusError}
				<p class="card-hint error-text">{statusError}</p>
			{:else}
				<p class="card-hint">
					Select a project to see hardware details.
				</p>
			{/if}
		</section>

		<!-- ── 4. Index Stats ─────────────────────────────────────────────── -->
		<section class="card">
			<header class="card-header">
				<h4 class="card-title">Index Stats</h4>
				<button
					type="button"
					class="ghost-btn"
					onclick={handleReindex}
					disabled={!activeProjectId || reindexState === 'starting' || !isVectorActive}
					aria-busy={reindexState === 'starting'}
				>
					<span class="btn-icon" aria-hidden="true">
						<HugeiconsIcon icon={RefreshIcon} size={14} strokeWidth={1.8} />
					</span>
					{reindexState === 'starting' ? 'Starting…' : 'Reindex now'}
				</button>
			</header>

			{#if !activeProjectId}
				<p class="card-hint">Select a project to view index stats.</p>
			{:else if isLoadingStatus && !status}
				<p class="card-hint">Loading…</p>
			{:else if status}
				<dl class="stat-grid">
					<div class="stat">
						<dt>Documents</dt>
						<dd>{status.totalDocs.toLocaleString()}</dd>
					</div>
					<div class="stat">
						<dt>Chunks</dt>
						<dd>{status.totalChunks.toLocaleString()}</dd>
					</div>
					<div class="stat">
						<dt>Disk size</dt>
						<dd>{formatBytes(status.diskSizeBytes)}</dd>
					</div>
					<div class="stat">
						<dt>Last indexed</dt>
						<dd>{formatRelative(status.lastIndexedAt)}</dd>
					</div>
				</dl>
			{:else if statusError}
				<p class="card-hint error-text">{statusError}</p>
			{/if}

			{#if reindexMessage}
				<p
					class="card-hint"
					class:error-text={reindexState === 'error'}
				>
					{reindexMessage}
				</p>
			{/if}
		</section>

		<!-- ── 5. Editor Override ─────────────────────────────────────────── -->
		<section class="card">
			<header class="card-header">
				<h4 class="card-title">Editor Override</h4>
			</header>
			<div class="form-group">
				<input
					id="editor-override"
					type="text"
					class="field-input"
					bind:value={editorOverride}
					oninput={markDirty}
					placeholder="Leave blank to auto-detect (checks EDITOR env var, VS Code, system default)"
					aria-label="Editor binary override"
				/>
				<span class="field-hint">
					Path to an editor binary. Used by the "Open in editor" button in the
					reader. Auto-detected when blank.
				</span>
			</div>
		</section>

		<!-- ── 6. Open Folder ─────────────────────────────────────────────── -->
		<section class="card">
			<header class="card-header">
				<h4 class="card-title">Research Folder</h4>
			</header>

			{#if researchBasePath}
				<div class="folder-row">
					<button type="button" class="ghost-btn" onclick={openFolder}>
						<span class="btn-icon" aria-hidden="true">
							<HugeiconsIcon icon={FolderIcon} size={14} strokeWidth={1.8} />
						</span>
						Browse research files in file manager
					</button>
					{#if copiedPath}
						<span class="save-feedback">Path copied</span>
					{/if}
				</div>
				<code class="path-code" title={researchBasePath}>{researchBasePath}</code>
			{:else}
				<p class="card-hint">Select a project to locate its research folder.</p>
			{/if}
		</section>
	{/if}
</div>

<style>
	.research-tab {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		max-width: 640px;
	}

	.header-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.section-heading {
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		margin: 0;
	}

	.lede {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		line-height: 1.5;
	}

	.lede code {
		font-family: var(--font-mono);
		font-size: 0.92em;
		padding: 2px 6px;
		background-color: var(--surface-leaf);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-sm);
		color: var(--text-prose);
	}

	/* ── Card ──────────────────────────────────────────────────────────── */

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.card-title {
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		margin: 0;
	}

	.card-hint {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		line-height: 1.5;
	}

	.error-text {
		color: var(--color-error);
	}

	/* ── Form bits ─────────────────────────────────────────────────────── */

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.field-label {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-secondary);
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
	}

	.field-hint-inline {
		font-weight: var(--font-weight-regular);
		font-size: var(--font-size-xs);
		color: var(--color-text-disabled);
	}

	.field-input {
		background-color: var(--surface-leaf);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-md);
		color: var(--text-prose);
		font-family: var(--font-body);
		font-size: var(--font-size-md);
		padding: var(--space-2) var(--space-3);
		width: 100%;
		outline: none;
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.field-input:hover {
		border-color: var(--border-emphasis);
	}

	.field-input:focus {
		border-color: var(--color-primary);
		box-shadow: var(--glow-focus);
	}

	.field-hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-disabled);
	}

	/* ── Toggle ────────────────────────────────────────────────────────── */

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
		user-select: none;
	}

	.toggle input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
		pointer-events: none;
	}

	.toggle-track {
		position: relative;
		width: 36px;
		height: 20px;
		background-color: var(--surface-leaf);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-full);
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.toggle-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		background-color: var(--text-meta);
		border-radius: var(--radius-full);
		transition:
			transform var(--transition-fast),
			background-color var(--transition-fast);
	}

	.toggle input:checked + .toggle-track {
		background-color: var(--color-primary);
		border-color: var(--color-primary);
	}

	.toggle input:checked + .toggle-track .toggle-thumb {
		transform: translateX(16px);
		background-color: var(--color-primary-foreground);
	}

	.toggle input:focus-visible + .toggle-track {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.toggle-label {
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		font-variant-numeric: tabular-nums;
		min-width: 24px;
	}

	/* ── Banner ────────────────────────────────────────────────────────── */

	.banner {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}

	.banner-warn {
		background-color: color-mix(in oklch, var(--color-warning) 8%, transparent);
		border: 1px solid color-mix(in oklch, var(--color-warning) 38%, transparent);
		color: var(--color-text-primary);
	}

	.banner-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--color-warning);
		margin-top: 1px;
	}

	.banner-text strong {
		font-weight: var(--font-weight-semibold);
	}

	/* ── Stats grid ────────────────────────────────────────────────────── */

	.stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: var(--space-4);
		margin: 0;
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.stat dt {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-disabled);
		font-weight: var(--font-weight-medium);
	}

	.stat dd {
		margin: 0;
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		font-variant-numeric: tabular-nums;
	}

	.stat-sub {
		display: block;
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-regular);
		color: var(--color-text-secondary);
		margin-top: 2px;
	}

	/* ── Buttons ───────────────────────────────────────────────────────── */

	.ghost-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		background-color: transparent;
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		font-family: var(--font-sans);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition:
			background-color var(--transition-fast),
			border-color var(--transition-fast),
			color var(--transition-fast);
	}

	.ghost-btn:hover:not(:disabled) {
		background-color: var(--color-surface-hover);
		border-color: var(--color-border-strong);
		color: var(--color-text-primary);
	}

	.ghost-btn:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
	}

	.ghost-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.link-btn {
		background: transparent;
		border: none;
		color: var(--color-primary);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		padding: 0;
	}

	.link-btn:hover {
		text-decoration: underline;
	}

	.link-btn:focus-visible {
		outline: none;
		box-shadow: var(--glow-focus);
		border-radius: var(--radius-sm);
	}

	.btn-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
	}

	/* ── Folder ────────────────────────────────────────────────────────── */

	.folder-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.path-code {
		display: block;
		padding: var(--space-2) var(--space-3);
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		overflow-x: auto;
		white-space: nowrap;
	}

	/* ── Save feedback ─────────────────────────────────────────────────── */

	.save-feedback {
		font-size: var(--font-size-sm);
		color: var(--color-success);
	}

	.save-feedback.error {
		color: var(--color-error);
	}

	/* ── Mobile ────────────────────────────────────────────────────────── */

	@media (max-width: 640px) {
		.card {
			padding: var(--space-3) var(--space-4);
		}

		.card-header {
			flex-wrap: wrap;
		}

		.ghost-btn,
		.toggle {
			min-height: 44px;
		}

		.stat-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
