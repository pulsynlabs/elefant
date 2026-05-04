export type TerminalTheme = {
	background: string;
	foreground: string;
	cursor: string;
	cursorAccent: string;
	selectionBackground: string;
	selectionForeground?: string;
	black: string;
	red: string;
	green: string;
	yellow: string;
	blue: string;
	magenta: string;
	cyan: string;
	white: string;
	brightBlack: string;
	brightRed: string;
	brightGreen: string;
	brightYellow: string;
	brightBlue: string;
	brightMagenta: string;
	brightCyan: string;
	brightWhite: string;
};

export type TerminalDataHandler = (data: string) => void;

export interface TerminalRenderer {
	readonly kind: 'ghostty-web' | 'xterm';
	mount(container: HTMLElement): void;
	write(data: string): void;
	onData(handler: TerminalDataHandler): () => void;
	resize(cols: number, rows: number): void;
	/**
	 * Recompute the terminal grid against its container's current pixel size.
	 * Called by the ResizeObserver-backed Svelte action whenever the host
	 * element changes size (panel resize, window resize, layout reflow).
	 * Implementations should be cheap to call repeatedly and a no-op when
	 * the renderer is not yet mounted.
	 */
	fit(): void;
	focus(): void;
	clear(): void;
	dispose(): void;
}

export type CreateRendererOptions = {
	rootEl: HTMLElement;
	fontFamily?: string;
	fontSize?: number;
	lineHeight?: number;
	allowTransparency?: boolean;
};

const FALLBACK_THEME: TerminalTheme = {
	background: '#0a0d16',
	foreground: '#c8d0e4',
	cursor: '#4049e1',
	cursorAccent: '#0a0d16',
	selectionBackground: 'rgba(64, 73, 225, 0.28)',
	selectionForeground: '#ffffff',
	black: '#0b0f1a',
	red: '#ff6b8a',
	green: '#67dcb1',
	yellow: '#ffd580',
	blue: '#7f8cff',
	magenta: '#c694ff',
	cyan: '#6fd6ff',
	white: '#d7def2',
	brightBlack: '#4f5a73',
	brightRed: '#ff8aa3',
	brightGreen: '#95ebca',
	brightYellow: '#ffe2a8',
	brightBlue: '#a5afff',
	brightMagenta: '#dbb7ff',
	brightCyan: '#9de7ff',
	brightWhite: '#f4f7ff',
};

function readCssVar(styles: CSSStyleDeclaration, key: string): string | undefined {
	const value = styles.getPropertyValue(key).trim();
	return value.length > 0 ? value : undefined;
}

export function resolveTheme(rootEl: HTMLElement): TerminalTheme {
	const styles = getComputedStyle(rootEl);

	// The terminal canvas paints its own background — we drive it from the
	// substrate so the renderer surface blends with the page beneath the
	// panel chrome. `--surface-substrate` is the real Quire token; the
	// older `--surface-canvas` / `--surface-shell` lookups (kept as a fall-
	// through for compatibility) never resolved against tokens.css and
	// always dropped through to FALLBACK_THEME, leaving terminals visibly
	// off-tone in dark mode.
	return {
		background:
			readCssVar(styles, '--surface-substrate') ??
			readCssVar(styles, '--surface-canvas') ??
			readCssVar(styles, '--surface-shell') ??
			FALLBACK_THEME.background,
		foreground: readCssVar(styles, '--text-prose') ?? FALLBACK_THEME.foreground,
		cursor: readCssVar(styles, '--color-primary') ?? FALLBACK_THEME.cursor,
		cursorAccent:
			readCssVar(styles, '--text-inverse') ??
			readCssVar(styles, '--text-primary-inverse') ??
			FALLBACK_THEME.cursorAccent,
		selectionBackground:
			readCssVar(styles, '--color-primary-subtle') ??
			readCssVar(styles, '--color-primary-soft') ??
			FALLBACK_THEME.selectionBackground,
		selectionForeground:
			readCssVar(styles, '--text-prose') ?? FALLBACK_THEME.selectionForeground,
		black: readCssVar(styles, '--terminal-black') ?? FALLBACK_THEME.black,
		red: readCssVar(styles, '--terminal-red') ?? FALLBACK_THEME.red,
		green: readCssVar(styles, '--terminal-green') ?? FALLBACK_THEME.green,
		yellow: readCssVar(styles, '--terminal-yellow') ?? FALLBACK_THEME.yellow,
		blue: readCssVar(styles, '--terminal-blue') ?? FALLBACK_THEME.blue,
		magenta: readCssVar(styles, '--terminal-magenta') ?? FALLBACK_THEME.magenta,
		cyan: readCssVar(styles, '--terminal-cyan') ?? FALLBACK_THEME.cyan,
		white: readCssVar(styles, '--terminal-white') ?? FALLBACK_THEME.white,
		brightBlack:
			readCssVar(styles, '--terminal-bright-black') ?? FALLBACK_THEME.brightBlack,
		brightRed:
			readCssVar(styles, '--terminal-bright-red') ?? FALLBACK_THEME.brightRed,
		brightGreen:
			readCssVar(styles, '--terminal-bright-green') ?? FALLBACK_THEME.brightGreen,
		brightYellow:
			readCssVar(styles, '--terminal-bright-yellow') ?? FALLBACK_THEME.brightYellow,
		brightBlue:
			readCssVar(styles, '--terminal-bright-blue') ?? FALLBACK_THEME.brightBlue,
		brightMagenta:
			readCssVar(styles, '--terminal-bright-magenta') ?? FALLBACK_THEME.brightMagenta,
		brightCyan:
			readCssVar(styles, '--terminal-bright-cyan') ?? FALLBACK_THEME.brightCyan,
		brightWhite:
			readCssVar(styles, '--terminal-bright-white') ?? FALLBACK_THEME.brightWhite,
	};
}

export async function createRenderer(options: CreateRendererOptions): Promise<TerminalRenderer> {
	const { createGhosttyRenderer } = await import('./ghostty-renderer.js');

	try {
		return await createGhosttyRenderer(options);
	} catch (error) {
		if (import.meta.env.DEV) {
			console.debug('[terminal] ghostty-web unavailable, using xterm fallback', error);
		}

		const { createXtermRenderer } = await import('./xterm-renderer.js');
		return createXtermRenderer(options);
	}
}
