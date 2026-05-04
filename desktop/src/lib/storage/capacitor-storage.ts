import { isCapacitorRuntime } from '$lib/runtime.js';

/** Unified storage interface for all runtimes. */
export interface AppStorage {
	get<T>(key: string): Promise<T | null>;
	set(key: string, value: unknown): Promise<void>;
	remove(key: string): Promise<void>;
	save(): Promise<void>;
}

/**
 * Creates an AppStorage instance backed by @capacitor/preferences.
 * Must only be called when isCapacitorRuntime === true.
 * Uses dynamic import to avoid bundling @capacitor/preferences in desktop builds.
 */
async function createCapacitorStorage(): Promise<AppStorage> {
	// Dynamic import — @capacitor/preferences only available in Capacitor runtime
	const { Preferences } = await import('@capacitor/preferences');

	return {
		async get<T>(key: string): Promise<T | null> {
			const { value } = await Preferences.get({ key });
			if (value === null || value === undefined) return null;
			try {
				return JSON.parse(value) as T;
			} catch {
				return value as unknown as T;
			}
		},
		async set(key: string, value: unknown): Promise<void> {
			await Preferences.set({ key, value: JSON.stringify(value) });
		},
		async remove(key: string): Promise<void> {
			await Preferences.remove({ key });
		},
		async save(): Promise<void> {
			// Capacitor Preferences auto-saves; no-op here
		},
	};
}

/**
 * Creates a no-op AppStorage for plain browser mode.
 * Values are stored in a module-level Map (non-persistent, lives for page session only).
 */
function createBrowserStorage(): AppStorage {
	const map = new Map<string, string>();
	return {
		async get<T>(key: string): Promise<T | null> {
			const v = map.get(key);
			if (v === undefined) return null;
			try {
				return JSON.parse(v) as T;
			} catch {
				return v as unknown as T;
			}
		},
		async set(key: string, value: unknown): Promise<void> {
			map.set(key, JSON.stringify(value));
		},
		async remove(key: string): Promise<void> {
			map.delete(key);
		},
		async save(): Promise<void> {
			// no-op
		},
	};
}

let _storage: AppStorage | null = null;

/**
 * Returns the platform-appropriate storage instance.
 * Lazily initialized — safe to call multiple times.
 */
export async function getAppStorage(): Promise<AppStorage> {
	if (_storage) return _storage;
	if (isCapacitorRuntime) {
		_storage = await createCapacitorStorage();
	} else {
		_storage = createBrowserStorage();
	}
	return _storage;
}
