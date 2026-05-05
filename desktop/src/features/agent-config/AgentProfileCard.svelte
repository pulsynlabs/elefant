<script lang="ts">
	// AgentProfileCard — premium 5-part card for a single agent profile.
	//
	// Per DESIGN_SPEC §5, every card is a Quire mid-tier surface (.quire-md)
	// composed of:
	//
	//   1. Header row    — avatar tile (.quire-sm + kind tint) + label+id
	//                       stack + kind chip (.quire-sm) + enabled toggle.
	//   2. Description   — full description, no truncation, max-width 56ch.
	//   3. Model picker  — "MODEL" eyebrow + AgentModelPicker (full-width).
	//   4. Advanced      — closed-by-default <details> with surviving knobs:
	//                       temperature, topP, allowed/denied tools (read-only
	//                       in this wave), context mode, prompt-file link.
	//   5. (no footer.)
	//
	// All legacy quota and tool-mode UI from the previous revision has
	// been removed — those fields no longer exist on `AgentProfile`.

	import { agentConfigStore } from '$lib/stores/agent-config.svelte.js';
	import type { AgentProfile, AgentKind } from '$lib/types/agent-config.js';
	import AgentModelPicker from './AgentModelPicker.svelte';
	import {
		HugeiconsIcon,
		UserGroupIcon,
		CheckListIcon,
		Search01Icon,
		Compass01Icon,
		Book02Icon,
		ToolsIcon,
		Wrench01Icon,
		AiBrain01Icon,
		PaintBrush02Icon,
		ValidationIcon,
		TestTube01Icon,
		Bug01Icon,
		Edit02Icon,
		BotIcon,
		ExternalLinkIcon,
	} from '$lib/icons/index.js';
	import type { IconSvgElement } from '$lib/icons/index.js';

	type Props = {
		profile: AgentProfile;
		// Kept for API compatibility with AgentProfilesView's prop pass-through;
		// the new card has no expand/collapse state, so this is unused.
		initialExpanded?: boolean;
		onToggleEnabled?: (profile: AgentProfile, next: boolean) => void;
	};

	let { profile, onToggleEnabled }: Props = $props();

	let isTogglingEnabled = $state(false);

	// ── Per-profile icon ────────────────────────────────────────────────
	// Map by profile id first (for tier-routed executors); fall back to
	// kind. Returns Hugeicons icon data ready for <HugeiconsIcon>.

	function pickIcon(p: AgentProfile): IconSvgElement {
		switch (p.id) {
			case 'executor-low':
				return ToolsIcon;
			case 'executor-medium':
				return Wrench01Icon;
			case 'executor-high':
				return AiBrain01Icon;
			case 'executor-frontend':
				return PaintBrush02Icon;
		}
		switch (p.kind) {
			case 'orchestrator':
				return UserGroupIcon;
			case 'planner':
				return CheckListIcon;
			case 'researcher':
				return Search01Icon;
			case 'explorer':
				return Compass01Icon;
			case 'librarian':
				return Book02Icon;
			case 'verifier':
				return ValidationIcon;
			case 'tester':
				return TestTube01Icon;
			case 'debugger':
				return Bug01Icon;
			case 'writer':
				return Edit02Icon;
			case 'executor':
				// Untiered executor (forward-compat only — should not occur
				// in user-facing groups since the alias was removed).
				return Wrench01Icon;
			default:
				return BotIcon;
		}
	}

	// ── Kind-aware accent color ────────────────────────────────────────
	// Drives the avatar tile background tint and the kind chip border.
	// References existing tokens — no new colors introduced.

	function pickAccent(p: AgentProfile): string {
		// Tiered executors share the canonical execution accent except
		// `executor-frontend`, which gets the warm "designer's hand" hue
		// per DESIGN_SPEC §3.
		if (p.id === 'executor-frontend') return 'var(--color-warning)';
		switch (p.kind) {
			case 'orchestrator':
			case 'writer':
				return 'var(--color-primary)';
			case 'planner':
			case 'explorer':
			case 'librarian':
				return 'var(--color-info)';
			case 'researcher':
				return 'var(--color-primary-muted, var(--color-primary))';
			case 'executor':
				return 'var(--color-success)';
			case 'verifier':
			case 'tester':
				return 'var(--color-warning)';
			case 'debugger':
				return 'var(--color-error)';
			default:
				return 'var(--text-muted)';
		}
	}

	const icon = $derived(pickIcon(profile));
	const accent = $derived(pickAccent(profile));

	// ── Toggles & handlers ─────────────────────────────────────────────

	async function handleToggle(event: Event): Promise<void> {
		const next = (event.currentTarget as HTMLInputElement).checked;
		if (isTogglingEnabled) return;
		isTogglingEnabled = true;
		try {
			await agentConfigStore.update(profile.id, { enabled: next });
			onToggleEnabled?.(profile, next);
		} finally {
			isTogglingEnabled = false;
		}
	}

	async function handleModelChange(
		value: { provider: string; model: string } | null,
	): Promise<void> {
		// Selecting "Inherit from default" (null) clears both fields so the
		// resolved-config cascade can take over. Selecting a model writes
		// both `provider` and `model` together — they must travel as a
		// pair to keep registry lookups honest.
		const nextBehavior: Partial<AgentProfile['behavior']> = value
			? { provider: value.provider, model: value.model }
			: { provider: undefined, model: undefined };
		await agentConfigStore.update(profile.id, {
			behavior: { ...profile.behavior, ...nextBehavior },
		});
	}

	const pickerValue = $derived(
		profile.behavior.provider && profile.behavior.model
			? {
					provider: profile.behavior.provider,
					model: profile.behavior.model,
				}
			: null,
	);

	// ── Numeric formatting ────────────────────────────────────────────

	function formatTemp(t: number | undefined): string {
		return t !== undefined ? t.toFixed(2) : 'inherit';
	}

	function formatTopP(p: number | undefined): string {
		return p !== undefined ? p.toFixed(2) : 'inherit';
	}

	// ── Allowed/denied tool counts (read-only display) ─────────────────

	const allowedTools = $derived(profile.tools.allowedTools ?? []);
	const deniedTools = $derived(profile.tools.deniedTools ?? []);
	const perToolApprovalCount = $derived(
		Object.keys(profile.tools.perToolApproval ?? {}).length,
	);

	function summarizeList(list: string[]): string {
		if (list.length === 0) return 'none';
		if (list.length <= 3) return list.join(', ');
		return `${list.slice(0, 3).join(', ')} +${list.length - 3} more`;
	}

	// ── Prompt file link ────────────────────────────────────────────────
	// Open the prompt file with the OS shell (Tauri shell.open) when
	// running inside the desktop shell; fall back to copying the path
	// to the clipboard so the user can paste it into their editor.
	// Mirrors the pattern used by FieldNotesTab.svelte.

	let copiedPromptPath = $state(false);
	let promptCopyTimer: ReturnType<typeof setTimeout> | null = null;

	// Some daemon profiles surface the prompt file under non-standard
	// keys; read it loosely so we don't hard-couple to a single field.
	const promptFile = $derived<string | null>(
		(profile as unknown as { promptFile?: string | null }).promptFile ?? null,
	);

	async function openPromptFile(): Promise<void> {
		if (!promptFile) return;
		const tauri = (window as unknown as {
			__TAURI__?: { shell?: { open: (target: string) => Promise<void> } };
		}).__TAURI__;
		if (tauri?.shell?.open) {
			try {
				await tauri.shell.open(promptFile);
				return;
			} catch {
				// fall through to clipboard fallback
			}
		}
		try {
			await navigator.clipboard.writeText(promptFile);
			copiedPromptPath = true;
			if (promptCopyTimer) clearTimeout(promptCopyTimer);
			promptCopyTimer = setTimeout(() => {
				copiedPromptPath = false;
			}, 1800);
		} catch {
			// best-effort; the path is still visible inline
		}
	}

	// Stable kind label for the chip — collapses tiered executor ids back
	// to the bare kind so chips read consistently across the roster.
	function kindLabel(k: AgentKind): string {
		return k;
	}
</script>

<article
	class="card quire-md"
	class:card-disabled={!profile.enabled}
	style="--kind-accent: {accent};"
	aria-labelledby="profile-title-{profile.id}"
>
	<!-- ─── 1. Header row ────────────────────────────────────────────── -->
	<header class="card-header">
		<div class="avatar-tile quire-sm" aria-hidden="true">
			<HugeiconsIcon {icon} size={22} strokeWidth={1.75} />
		</div>

		<div class="identity">
			<h3 id="profile-title-{profile.id}" class="identity-label">
				{profile.label}
			</h3>
			<p class="identity-id" title={profile.id}>{profile.id}</p>
		</div>

		<span class="kind-chip quire-sm" aria-label="Agent kind">
			{kindLabel(profile.kind)}
		</span>

		<label
			class="enabled-switch"
			aria-label="Enable profile {profile.label}"
		>
			<input
				type="checkbox"
				checked={profile.enabled}
				disabled={isTogglingEnabled}
				onchange={handleToggle}
			/>
			<span class="switch-track" aria-hidden="true">
				<span class="switch-thumb"></span>
			</span>
			<span class="sr-only">
				{profile.enabled ? 'Enabled' : 'Disabled'}
			</span>
		</label>
	</header>

	<!-- ─── 2. Description block (full, no truncation) ──────────────── -->
	{#if profile.description}
		<p class="card-description">{profile.description}</p>
	{/if}

	<!-- ─── 3. Model picker row ─────────────────────────────────────── -->
	<div class="model-row">
		<span id="model-label-{profile.id}" class="row-eyebrow">Model</span>
		<div
			class="model-picker-wrap"
			role="group"
			aria-labelledby="model-label-{profile.id}"
		>
			<AgentModelPicker
				value={pickerValue}
				onChange={handleModelChange}
				disabled={!profile.enabled}
			/>
		</div>
	</div>

	<!-- ─── 4. Advanced disclosure (closed by default) ─────────────── -->
	<details class="advanced">
		<summary class="advanced-summary">
			<span class="advanced-summary-label">Advanced</span>
			<span class="advanced-summary-chevron" aria-hidden="true"></span>
		</summary>

		<dl class="advanced-grid">
			<div class="advanced-row">
				<dt>Temperature</dt>
				<dd>{formatTemp(profile.behavior.temperature)}</dd>
			</div>
			<div class="advanced-row">
				<dt>Top P</dt>
				<dd>{formatTopP(profile.behavior.topP)}</dd>
			</div>
			<div class="advanced-row">
				<dt>Permission mode</dt>
				<dd>{profile.behavior.permissionMode ?? 'inherit'}</dd>
			</div>
			<div class="advanced-row">
				<dt>Workflow mode</dt>
				<dd>{profile.behavior.workflowMode ?? 'inherit'}</dd>
			</div>
			<div class="advanced-row">
				<dt>Workflow depth</dt>
				<dd>{profile.behavior.workflowDepth ?? 'inherit'}</dd>
			</div>
			<div class="advanced-row">
				<dt>Autopilot</dt>
				<dd>
					{profile.behavior.autopilot === undefined
						? 'inherit'
						: profile.behavior.autopilot
							? 'on'
							: 'off'}
				</dd>
			</div>
			<div class="advanced-row">
				<dt>Allowed tools</dt>
				<dd class="advanced-list" title={allowedTools.join(', ') || 'none'}>
					{summarizeList(allowedTools)}
				</dd>
			</div>
			<div class="advanced-row">
				<dt>Denied tools</dt>
				<dd class="advanced-list" title={deniedTools.join(', ') || 'none'}>
					{summarizeList(deniedTools)}
				</dd>
			</div>
			{#if perToolApprovalCount > 0}
				<div class="advanced-row">
					<dt>Per-tool approval</dt>
					<dd>
						{perToolApprovalCount} rule{perToolApprovalCount === 1 ? '' : 's'}
					</dd>
				</div>
			{/if}
			{#if promptFile}
				<div class="advanced-row advanced-row-action">
					<dt>Prompt file</dt>
					<dd>
						<button
							type="button"
							class="prompt-link"
							onclick={openPromptFile}
							aria-label="Open prompt file in editor"
						>
							<span class="prompt-link-label">
								{copiedPromptPath ? 'Path copied' : 'Open in editor'}
							</span>
							<HugeiconsIcon
								icon={ExternalLinkIcon}
								size={12}
								strokeWidth={2}
							/>
						</button>
					</dd>
				</div>
			{/if}
		</dl>
	</details>
</article>

<style>
	/* ─── Card surface ──────────────────────────────────────────────── */

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius-plate);
		transition:
			border-color var(--transition-fast, 120ms ease),
			box-shadow var(--transition-fast, 120ms ease);
	}

	.card:hover {
		border-color: var(--border-emphasis, var(--border-edge));
	}

	.card-disabled {
		opacity: 0.72;
	}

	/* ─── 1. Header row ─────────────────────────────────────────────── */

	.card-header {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		align-items: center;
		gap: var(--space-3);
	}

	.avatar-tile {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		flex: 0 0 auto;
		color: var(--kind-accent);
		background-color: color-mix(
			in srgb,
			var(--kind-accent) 15%,
			transparent
		);
		border-color: color-mix(
			in srgb,
			var(--kind-accent) 30%,
			transparent
		);
	}

	.identity {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.identity-label {
		font-family: var(--font-body);
		font-size: var(--font-size-md, 16px);
		font-weight: 600;
		letter-spacing: var(--tracking-snug, normal);
		line-height: var(--leading-snug, 1.3);
		color: var(--text-prose, var(--color-text-primary));
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.identity-id {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--text-muted, var(--color-text-muted));
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.kind-chip {
		display: inline-flex;
		align-items: center;
		padding: 2px var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs, 10px);
		font-weight: 600;
		letter-spacing: var(--tracking-widest);
		line-height: var(--leading-tight, 1);
		text-transform: uppercase;
		color: var(--kind-accent);
		border-color: color-mix(
			in srgb,
			var(--kind-accent) 40%,
			transparent
		);
		flex: 0 0 auto;
	}

	.enabled-switch {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
		user-select: none;
		flex: 0 0 auto;
	}

	.enabled-switch input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.switch-track {
		position: relative;
		display: inline-block;
		width: 32px;
		height: 18px;
		border-radius: 9999px;
		background-color: var(--border-edge, var(--color-border-strong));
		transition: background-color var(--transition-fast, 120ms ease);
	}

	.enabled-switch input:checked + .switch-track {
		background-color: var(--color-primary);
	}

	.enabled-switch input:focus-visible + .switch-track {
		box-shadow: var(--glow-focus, 0 0 0 3px rgba(64, 73, 225, 0.35));
	}

	.switch-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 9999px;
		background-color: var(--color-primary-foreground, #fff);
		transition: transform var(--transition-fast, 120ms ease);
	}

	.enabled-switch input:checked + .switch-track .switch-thumb {
		transform: translateX(14px);
	}

	.enabled-switch input:disabled + .switch-track {
		opacity: 0.6;
		cursor: progress;
	}

	/* ─── 2. Description block ──────────────────────────────────────── */

	.card-description {
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		font-weight: 400;
		line-height: var(--line-height-relaxed, var(--leading-relaxed, 1.65));
		color: var(--text-meta, var(--color-text-muted));
		max-width: 56ch;
		margin: 0;
		/* Explicitly NOT truncating — full description is the spec. */
		white-space: normal;
		overflow: visible;
	}

	/* ─── 3. Model picker row ───────────────────────────────────────── */

	.model-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--border-hairline, var(--color-border));
	}

	.row-eyebrow {
		font-family: var(--font-mono);
		font-size: var(--font-size-2xs, 10px);
		font-weight: 600;
		letter-spacing: var(--tracking-widest);
		line-height: var(--leading-tight, 1);
		text-transform: uppercase;
		color: var(--text-muted, var(--color-text-muted));
	}

	.model-picker-wrap {
		display: block;
		width: 100%;
	}

	/* The picker constrains itself to 320px by default; in the card it
	   should fill the row. Override its inner max-width so the trigger
	   button stretches end-to-end. */
	.model-picker-wrap :global(.picker) {
		display: block;
		max-width: none;
	}

	/* ─── 4. Advanced disclosure ────────────────────────────────────── */

	.advanced {
		margin: 0;
	}

	.advanced[open] .advanced-summary-chevron {
		transform: rotate(45deg);
	}

	/* Reset the default <summary> marker; we render our own chevron. */
	.advanced-summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2) 0;
		border-top: 1px solid var(--border-hairline, var(--color-border));
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--text-prose, var(--color-text-primary));
		cursor: pointer;
		list-style: none;
		user-select: none;
	}

	.advanced-summary::-webkit-details-marker {
		display: none;
	}

	.advanced-summary:focus-visible {
		outline: 1px solid var(--border-focus, var(--color-primary));
		outline-offset: 2px;
		border-radius: var(--radius-leaf, var(--radius-sm));
	}

	.advanced-summary-label {
		flex: 1 1 auto;
	}

	/* Hand-drawn chevron: a small rotated square corner that flips on
	   open. Keeps us off any specific icon. */
	.advanced-summary-chevron {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-right: 1.5px solid currentColor;
		border-bottom: 1.5px solid currentColor;
		transform: rotate(-45deg);
		transition: transform var(--transition-fast, 120ms ease);
		opacity: 0.7;
	}

	.advanced-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0;
		margin: 0;
		padding-top: var(--space-2);
	}

	.advanced-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		border-bottom: 1px dashed var(--border-hairline, var(--color-border));
	}

	.advanced-row:last-child {
		border-bottom: none;
	}

	.advanced-row dt {
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--text-meta, var(--color-text-secondary));
		margin: 0;
	}

	.advanced-row dd {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--text-prose, var(--color-text-primary));
		text-align: right;
		margin: 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.advanced-list {
		max-width: 30ch;
	}

	.prompt-link {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px var(--space-2);
		background: transparent;
		border: 1px solid var(--border-edge, var(--color-border));
		border-radius: var(--radius-leaf, var(--radius-sm));
		color: var(--text-prose, var(--color-text-primary));
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		cursor: pointer;
		transition:
			border-color var(--transition-fast, 120ms ease),
			color var(--transition-fast, 120ms ease);
	}

	.prompt-link:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.prompt-link:focus-visible {
		outline: 1px solid var(--border-focus, var(--color-primary));
		outline-offset: 2px;
	}

	.prompt-link-label {
		line-height: 1;
	}

	/* ─── Screen-reader-only ────────────────────────────────────────── */

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* ─── Responsive ────────────────────────────────────────────────── */

	@media (max-width: 640px) {
		.card {
			padding: var(--space-4);
		}

		.card-header {
			grid-template-columns: auto 1fr auto;
			row-gap: var(--space-2);
		}

		/* Toggle wraps to a second row on its own, kind chip stays
		   inline next to the identity stack. */
		.enabled-switch {
			grid-column: 1 / -1;
			justify-self: end;
		}

		.advanced-row {
			grid-template-columns: 1fr;
			gap: var(--space-1);
		}

		.advanced-row dd {
			text-align: left;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.card,
		.switch-track,
		.switch-thumb,
		.prompt-link,
		.advanced-summary-chevron {
			transition: none;
		}
	}
</style>
