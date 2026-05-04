import { Store } from "@tauri-apps/plugin-store";
import { syncStatusBar } from '$lib/native/status-bar.js';

type Theme = "dark" | "light";

const STORE_KEY = "elefant-preferences";
const THEME_KEY = "theme";
const LOCAL_STORAGE_KEY = "elefant-theme";
const DEFAULT_THEME: Theme = "dark";

// Reactive theme state using Svelte 5 runes
let theme = $state<Theme>(DEFAULT_THEME);

let store: Store | null = null;

async function getStore(): Promise<Store> {
	if (!store) {
		store = await Store.load(STORE_KEY + ".json");
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
	let resolved = false;

	// 1. Try Tauri Store (desktop)
	try {
		const s = await getStore();
		const savedTheme = await s.get<Theme>(THEME_KEY);
		if (savedTheme === "dark" || savedTheme === "light") {
			theme = savedTheme;
			resolved = true;
		}
	} catch {
		// Tauri Store unavailable (Capacitor, browser) — fall through
	}

	// 2. If Tauri Store didn't resolve a theme, try localStorage
	if (!resolved) {
		try {
			const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
			if (saved === "dark" || saved === "light") {
				theme = saved;
				resolved = true;
			}
		} catch {
			// localStorage blocked — fall through
		}
	}

	// 3. No saved preference — default to system preference
	if (!resolved) {
		if (
			window.matchMedia?.('(prefers-color-scheme: dark)').matches
		) {
			theme = 'dark';
		} else if (
			window.matchMedia?.('(prefers-color-scheme: light)').matches
		) {
			theme = 'light';
		} else {
			theme = DEFAULT_THEME;
		}
	}

	applyTheme(theme);

	// 4. Subscribe to system theme changes (MH10).
	//    Only auto-follow the system when the user hasn't set a manual
	//    preference — the presence of a value in localStorage (or Tauri
	//    Store) means the user explicitly chose a theme, and we respect
	//    that override. The listener fires on Capacitor, browser, and
	//    desktop equally.
	try {
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		mq.addEventListener('change', (e: MediaQueryListEvent) => {
			// Be defensive: check the live state of the preference store,
			// not a stale snapshot from init time.
			let hasManualPref = false;
			try {
				hasManualPref = localStorage.getItem(LOCAL_STORAGE_KEY) !== null;
			} catch {
				// localStorage unavailable — treat as no override
			}
			if (hasManualPref) return;

			theme = e.matches ? 'dark' : 'light';
			applyTheme(theme);
		});
	} catch {
		// matchMedia not supported — silent
	}
}

export async function toggleTheme(): Promise<void> {
	theme = theme === "dark" ? "light" : "dark";
	applyTheme(theme);
	try {
		const s = await getStore();
		await s.set(THEME_KEY, theme);
		await s.save();
	} catch {
		// Store not available (e.g., in browser dev), silently ignore
	}
	try {
		localStorage.setItem(LOCAL_STORAGE_KEY, theme);
	} catch {
		// localStorage blocked (incognito / storage full) — silent
	}
}

export async function setTheme(newTheme: Theme): Promise<void> {
	theme = newTheme;
	applyTheme(theme);
	try {
		const s = await getStore();
		await s.set(THEME_KEY, theme);
		await s.save();
	} catch {
		// Silent
	}
	try {
		localStorage.setItem(LOCAL_STORAGE_KEY, theme);
	} catch {
		// localStorage blocked — silent
	}
}

function applyTheme(t: Theme): void {
	document.documentElement.setAttribute("data-theme", t);
	// Sync Capacitor status bar style + background with current theme (MH10).
	// No-op on desktop — the wrapper gates on isCapacitorRuntime internally.
	void syncStatusBar(t === 'dark');
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
