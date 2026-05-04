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
		fontFamily: options.fontFamily ?? 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
		fontSize: options.fontSize ?? 13,
		lineHeight: options.lineHeight ?? 1.35,
		allowTransparency: options.allowTransparency ?? true,
		theme,
		cursorBlink: true,
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
