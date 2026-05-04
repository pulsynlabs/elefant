import {
	FitAddon,
	Terminal,
	init as initGhostty,
	type ITerminalOptions,
} from 'ghostty-web';

import type {
	CreateRendererOptions,
	TerminalDataHandler,
	TerminalRenderer,
} from './renderer.js';
import { resolveTheme } from './renderer.js';

class GhosttyRenderer implements TerminalRenderer {
	public readonly kind = 'ghostty-web' as const;

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
		// Mirror the xterm renderer: skip when not mounted, swallow zero-size
		// errors from the addon. The next ResizeObserver tick with a non-zero
		// box will succeed.
		if (!this.mounted) return;
		try {
			this.fitAddon.fit();
		} catch {
			// no-op
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

export async function createGhosttyRenderer(
	options: CreateRendererOptions,
): Promise<TerminalRenderer> {
	const theme = resolveTheme(options.rootEl);

	await initGhostty();

	// ghostty-web does not currently expose `lineHeight` on ITerminalOptions
	// (W4.T1 finding) — its renderer derives line metrics from the font.
	const terminalOptions: ITerminalOptions = {
		fontFamily:
			options.fontFamily ??
			'"Geist Mono Variable", "Geist Mono", "JetBrains Mono", "SF Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
		fontSize: options.fontSize ?? 14,
		allowTransparency: options.allowTransparency ?? true,
		theme,
		cursorBlink: true,
	};

	const terminal = new Terminal(terminalOptions);
	const fitAddon = new FitAddon();
	terminal.loadAddon(fitAddon);
	const renderer = new GhosttyRenderer(terminal, fitAddon);

	terminal.onData((data) => {
		renderer.handleIncomingData(data);
	});

	return renderer;
}
