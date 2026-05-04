import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import type {
	CreateRendererOptions,
	TerminalDataHandler,
	TerminalRenderer,
} from './renderer.js';
import { resolveTheme } from './renderer.js';

class XtermRenderer implements TerminalRenderer {
	public readonly kind = 'xterm' as const;

	private readonly terminal: Terminal;
	private readonly fitAddon: FitAddon;
	private readonly dataHandlers = new Set<TerminalDataHandler>();
	private mounted = false;

	constructor(terminal: Terminal, fitAddon: FitAddon) {
		this.terminal = terminal;
		this.fitAddon = fitAddon;
	}

	mount(container: HTMLElement): void {
		if (this.mounted) return;
		this.terminal.open(container);
		this.fitAddon.fit();
		this.mounted = true;
	}

	write(data: string): void {
		this.terminal.write(data);
	}

	onData(handler: TerminalDataHandler): () => void {
		this.dataHandlers.add(handler);
		return () => {
			this.dataHandlers.delete(handler);
		};
	}

	handleIncomingData(data: string): void {
		for (const handler of this.dataHandlers) {
			handler(data);
		}
	}

	resize(cols: number, rows: number): void {
		this.terminal.resize(cols, rows);
	}

	fit(): void {
		// FitAddon throws if the terminal is not yet attached to the DOM
		// (no parent element, zero dimensions). Guard so that ResizeObserver
		// callbacks fired before mount() — or after dispose() — are no-ops.
		if (!this.mounted) return;
		try {
			this.fitAddon.fit();
		} catch {
			// Container has zero size (display:none, detached). Will refit
			// the next time the observer fires with a real size.
		}
	}

	focus(): void {
		this.terminal.focus();
	}

	clear(): void {
		this.terminal.clear();
	}

	dispose(): void {
		this.dataHandlers.clear();
		this.terminal.dispose();
	}
}

export function createXtermRenderer(options: CreateRendererOptions): TerminalRenderer {
	const theme = resolveTheme(options.rootEl);

	const terminalOptions: ITerminalOptions = {
		// Mirror typography.css `--font-mono` literally — xterm draws to
		// canvas and cannot read CSS custom properties, so the font stack
		// must be expanded here.
		fontFamily:
			options.fontFamily ??
			'"Geist Mono Variable", "Geist Mono", "JetBrains Mono", "SF Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
		fontSize: options.fontSize ?? 14,
		lineHeight: options.lineHeight ?? 1.4,
		allowTransparency: options.allowTransparency ?? true,
		theme,
		cursorBlink: true,
		// UX niceties: double-click selects word, right-click extends a
		// word selection (rather than opening the browser context menu
		// over the canvas). Ctrl+C is left to xterm.js's default selection
		// handling, which forwards the keypress to the PTY when no text
		// is selected — that's the SIGINT path users expect.
		rightClickSelectsWord: true,
		scrollback: 5000,
	};

	const terminal = new Terminal(terminalOptions);
	const fitAddon = new FitAddon();
	terminal.loadAddon(fitAddon);

	const renderer = new XtermRenderer(terminal, fitAddon);
	terminal.onData((data) => {
		renderer.handleIncomingData(data);
	});

	return renderer;
}
