// @tauri-apps/plugin-store is loaded dynamically to avoid Vite pre-bundling
// Tauri-specific modules, which causes 504 errors in dev mode.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type TauriStore = Awaited<ReturnType<typeof import('@tauri-apps/plugin-store').Store.load>>;

type Theme = "dark" | "light";

const STORE_KEY = "elefant-preferences";
const THEME_KEY = "theme";
const DEFAULT_THEME: Theme = "dark";

// Reactive theme state using Svelte 5 runes
let theme = $state<Theme>(DEFAULT_THEME);

let store: TauriStore | null = null;

async function getStore(): Promise<TauriStore | null> {
	if (!store) {
		try {
			const { Store } = await import("@tauri-apps/plugin-store");
			store = await Store.load(STORE_KEY + ".json");
		} catch {
			return null;
		}
	}
	return store;
}

export function currentTheme(): Theme {
	return theme;
}

export function isDark(): boolean {
	return theme === "dark";
}

export async function initTheme(): Promise<void> {
	try {
		const s = await getStore();
		const savedTheme = s ? await s.get<Theme>(THEME_KEY) : null;
		if (savedTheme === "dark" || savedTheme === "light") {
			theme = savedTheme;
		} else {
			// Check system preference
			if (
				window.matchMedia &&
				window.matchMedia("(prefers-color-scheme: light)").matches
			) {
				theme = "light";
			} else {
				theme = DEFAULT_THEME;
			}
		}
	} catch {
		theme = DEFAULT_THEME;
	}
	applyTheme(theme);
}

export async function toggleTheme(): Promise<void> {
	theme = theme === "dark" ? "light" : "dark";
	applyTheme(theme);
	try {
		const s = await getStore();
		if (s) {
			await s.set(THEME_KEY, theme);
			await s.save();
		}
	} catch {
		// Store not available (e.g., in browser dev), silently ignore
	}
}

export async function setTheme(newTheme: Theme): Promise<void> {
	theme = newTheme;
	applyTheme(theme);
	try {
		const s = await getStore();
		if (s) {
			await s.set(THEME_KEY, theme);
			await s.save();
		}
	} catch {
		// Silent
	}
}

function applyTheme(t: Theme): void {
	document.documentElement.setAttribute("data-theme", t);
}

// Export as a readable object for components
export const themeStore = {
	get current() {
		return theme;
	},
	get isDark() {
		return theme === "dark";
	},
	init: initTheme,
	toggle: toggleTheme,
	set: setTheme,
};
