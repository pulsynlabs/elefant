/**
 * Tiny async key-value store abstraction.
 *
 * Routes to `@tauri-apps/plugin-store` when running inside a Tauri webview,
 * falling back to `localStorage` in plain browser/serve mode. The two backends
 * share the same JSON-shaped key space so values written under one runtime are
 * readable by the other (within the limits of each backend).
 *
 * All operations are best-effort: storage failures resolve silently rather
 * than throwing, since persistence is non-critical UI state.
 */

const TAURI_STORE_FILE = 'elefant-ui-state.json';

/** Detected once at module load — true inside a Tauri webview. */
const isTauriRuntime: boolean =
	typeof window !== 'undefined' && '__TAURI__' in window;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface KVStore {
	/**
	 * Retrieves the value associated with `key`, or `null` when missing or
	 * unreadable. Values are typed as `T` but the cast is unchecked — callers
	 * must validate the shape before use.
	 */
	get<T>(key: string): Promise<T | null>;

	/**
	 * Persists `value` under `key`. Resolves once the write is durably stored
	 * (Tauri Store flushed to disk, or `localStorage` synchronously written).
	 */
	set(key: string, value: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// localStorage backend (browser / serve mode / Tauri fallback)
// ---------------------------------------------------------------------------

function localStorageGet<T>(key: string): T | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(key);
		if (raw === null) return null;
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

function localStorageSet(key: string, value: unknown): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Quota exceeded, private browsing, etc. — silent.
	}
}

function createLocalStorageKVStore(): KVStore {
	return {
		async get<T>(key: string): Promise<T | null> {
			return localStorageGet<T>(key);
		},
		async set(key: string, value: unknown): Promise<void> {
			localStorageSet(key, value);
		},
	};
}

// ---------------------------------------------------------------------------
// Tauri plugin-store backend (desktop)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type TauriStore = Awaited<
	ReturnType<typeof import('@tauri-apps/plugin-store').Store.load>
>;

function createTauriKVStore(): KVStore {
	let storePromise: Promise<TauriStore | null> | null = null;

	async function getStore(): Promise<TauriStore | null> {
		if (!storePromise) {
			storePromise = (async () => {
				try {
					const { Store } = await import('@tauri-apps/plugin-store');
					return await Store.load(TAURI_STORE_FILE);
				} catch {
					return null;
				}
			})();
		}
		return storePromise;
	}

	return {
		async get<T>(key: string): Promise<T | null> {
			// Read-through: Tauri Store first, then localStorage as a mirror
			// fallback so values written before plugin-store loaded are still
			// available.
			try {
				const store = await getStore();
				if (store) {
					const value = await store.get<T>(key);
					if (value !== null && value !== undefined) {
						return value;
					}
				}
			} catch {
				// Fall through to localStorage.
			}
			return localStorageGet<T>(key);
		},

		async set(key: string, value: unknown): Promise<void> {
			// Write-through: keep both backends in sync so the synchronous
			// localStorage read can hydrate state without waiting for the
			// async Tauri Store import on next launch.
			localStorageSet(key, value);
			try {
				const store = await getStore();
				if (store) {
					await store.set(key, value);
					await store.save();
				}
			} catch {
				// Silent — localStorage already holds the value.
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Returns a `KVStore` backed by the appropriate runtime: Tauri's plugin-store
 * when available, otherwise plain `localStorage`. Safe to call from any
 * environment, including SSR (returns a no-op shape that resolves to `null`).
 */
export function createKVStore(): KVStore {
	if (isTauriRuntime) {
		return createTauriKVStore();
	}
	return createLocalStorageKVStore();
}

/**
 * Synchronously reads a value from `localStorage`. Use this to seed initial
 * runes state without flash-of-wrong-state when a synchronous read is
 * acceptable (i.e. the value was previously written via `createKVStore()`,
 * which write-throughs to localStorage in both runtimes).
 */
export function readLocalStorageSync<T>(key: string): T | null {
	return localStorageGet<T>(key);
}
