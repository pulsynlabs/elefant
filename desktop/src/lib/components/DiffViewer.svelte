<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { MergeView } from '@codemirror/merge';
	import { EditorView } from '@codemirror/view';
	import { EditorState, type Extension } from '@codemirror/state';
	import { elefantDarkTheme, elefantLightTheme } from '$lib/codemirror/theme.js';
	import { themeStore } from '$lib/stores/theme.svelte.js';
	import type { DiagnosticInput } from '$lib/types/diagnostics.js';

	type Props = {
		original: string;
		modified: string;
		mode?: 'unified' | 'split';
		language?: string;
		class?: string;
		diagnostics?: DiagnosticInput[];
	};

	let {
		original,
		modified,
		mode = 'unified',
		language = 'text',
		class: className = '',
		diagnostics,
	}: Props = $props();

	let containerEl: HTMLDivElement;
	let mergeView: MergeView | null = null;

	function getLanguageExtension(lang: string) {
		switch (lang.toLowerCase()) {
			case 'typescript':
			case 'ts':
			case 'javascript':
			case 'js':
				// Lazy import to avoid bundling all languages
				return null; // Will be handled below
			default:
				return null;
		}
	}

	async function initMergeView(): Promise<void> {
		if (!containerEl) return;

		const theme = themeStore.isDark ? elefantDarkTheme : elefantLightTheme;

		// Destroy any existing view
		if (mergeView) {
			mergeView.destroy();
			mergeView = null;
		}

		// Clear container
		containerEl.innerHTML = '';

		const hasDiagnostics = !!(diagnostics && diagnostics.length > 0);

		// Lazy-load @codemirror/lint only when diagnostics are present.
		// We need lintGutter() in the .b extensions BEFORE MergeView is created,
		// so the import has to happen here (not after construction).
		let lintExtensions: Extension[] = [];
		let lintMod: typeof import('@codemirror/lint') | null = null;
		if (hasDiagnostics) {
			try {
				lintMod = await import('@codemirror/lint');
				lintExtensions = [lintMod.lintGutter()];
			} catch {
				// Lint module unavailable — fall through to a plain diff view.
				lintExtensions = [];
				lintMod = null;
			}
		}

		const extensions = [theme, EditorView.editable.of(false)];
		const bExtensions = [theme, EditorView.editable.of(false), ...lintExtensions];

		mergeView = new MergeView({
			a: {
				doc: original,
				extensions,
			},
			b: {
				doc: modified,
				extensions: bExtensions,
			},
			parent: containerEl,
			orientation: mode === 'split' ? 'a-b' : undefined,
			collapseUnchanged: mode === 'unified' ? { margin: 3, minSize: 4 } : undefined,
			highlightChanges: true,
			gutter: true,
		});

		if (hasDiagnostics && lintMod && diagnostics) {
			try {
				const bView = mergeView.b;
				const cmDiagnostics = toCmDiagnostics(diagnostics, bView);
				bView.dispatch(lintMod.setDiagnostics(bView.state, cmDiagnostics));
			} catch {
				// Diagnostics injection failed — diff still renders without markers.
			}
		}
	}

	type CmSeverity = 'error' | 'warning' | 'info' | 'hint';
	const SEVERITY_MAP: Record<DiagnosticInput['severity'], CmSeverity> = {
		error: 'error',
		warning: 'warning',
		info: 'info',
		hint: 'hint',
	};

	function toCmDiagnostics(
		inputs: DiagnosticInput[],
		view: EditorView,
	): import('@codemirror/lint').Diagnostic[] {
		const doc = view.state.doc;
		const totalLines = doc.lines;
		const result: import('@codemirror/lint').Diagnostic[] = [];

		for (const d of inputs) {
			const startLine = clamp(d.line, 1, totalLines);
			const startLineInfo = doc.line(startLine);
			const startCol = Math.max(0, d.column - 1);
			const from = Math.min(startLineInfo.from + startCol, startLineInfo.to);

			const endLineNum = d.endLine ? clamp(d.endLine, 1, totalLines) : startLine;
			const endLineInfo = doc.line(endLineNum);
			let to: number;
			if (d.endColumn !== undefined) {
				to = Math.min(endLineInfo.from + Math.max(0, d.endColumn - 1), endLineInfo.to);
			} else {
				// No end column — highlight at least one character on the start line.
				to = Math.min(startLineInfo.from + Math.max(d.column, startCol + 1), startLineInfo.to);
			}
			// Guarantee a non-empty range so the marker is visible.
			if (to <= from) {
				to = Math.min(from + 1, endLineInfo.to);
			}

			result.push({
				from,
				to,
				severity: SEVERITY_MAP[d.severity] ?? 'error',
				message: d.code ? `${d.message} [${d.code}]` : d.message,
			});
		}
		return result;
	}

	function clamp(n: number, min: number, max: number): number {
		return Math.max(min, Math.min(max, n));
	}

	onMount(() => {
		void initMergeView();
	});

	onDestroy(() => {
		if (mergeView) {
			mergeView.destroy();
			mergeView = null;
		}
	});

	// Re-init when theme changes
	$effect(() => {
		const isDark = themeStore.isDark;
		if (mergeView && containerEl) {
			void initMergeView();
		}
	});

	// Re-init when content or mode changes
	$effect(() => {
		const orig = original;
		const mod = modified;
		const m = mode;
		if (mergeView && containerEl) {
			void initMergeView();
		}
	});

	// Re-init when diagnostics change so lint markers stay in sync.
	// Tracks length + identity of each diagnostic to catch in-place edits.
	$effect(() => {
		const sig = diagnostics
			? diagnostics.map((d) => `${d.line}:${d.column}:${d.severity}:${d.code ?? ''}:${d.message}`).join('|')
			: '';
		void sig;
		if (mergeView && containerEl) {
			void initMergeView();
		}
	});
</script>

<div
	class="diff-viewer {className}"
	bind:this={containerEl}
	role="region"
	aria-label="File diff viewer"
></div>

<style>
	.diff-viewer {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		max-height: 400px;
		overflow-y: auto;
	}

	/* CodeMirror reset — ensure CM6 fills container */
	.diff-viewer :global(.cm-editor) {
		height: auto;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}

	.diff-viewer :global(.cm-mergeView) {
		width: 100%;
	}

	.diff-viewer :global(.cm-mergeViewEditor) {
		flex: 1;
		min-width: 0;
	}

	/* Lint marker tooltip surface — match elefant tokens for legibility. */
	.diff-viewer :global(.cm-tooltip.cm-tooltip-lint) {
		background: var(--color-surface, #1e1e1e);
		color: var(--color-text, #e6e6e6);
		border: 1px solid var(--color-border, #333);
		border-radius: var(--radius-sm, 4px);
		padding: 4px 8px;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs, 0.75rem);
		max-width: 480px;
	}
	.diff-viewer :global(.cm-diagnostic) {
		padding: 2px 0;
	}
	.diff-viewer :global(.cm-diagnostic-error) {
		border-left: 3px solid var(--color-error, #f87171);
		padding-left: 6px;
	}
	.diff-viewer :global(.cm-diagnostic-warning) {
		border-left: 3px solid var(--color-warning, #fbbf24);
		padding-left: 6px;
	}
	.diff-viewer :global(.cm-diagnostic-info),
	.diff-viewer :global(.cm-diagnostic-hint) {
		border-left: 3px solid var(--color-info, #60a5fa);
		padding-left: 6px;
	}
</style>
