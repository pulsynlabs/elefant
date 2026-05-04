/**
 * Type declarations for @capacitor/preferences.
 *
 * This package lives in mobile/node_modules/, not desktop/node_modules/.
 * These declarations satisfy the TypeScript compiler while the actual module
 * is only loaded at runtime via dynamic import when isCapacitorRuntime is true.
 */
declare module '@capacitor/preferences' {
	interface GetResult {
		value: string | null;
	}

	interface PreferencesPlugin {
		get(options: { key: string }): Promise<GetResult>;
		set(options: { key: string; value: string }): Promise<void>;
		remove(options: { key: string }): Promise<void>;
		clear(): Promise<void>;
		keys(): Promise<{ keys: string[] }>;
	}

	export const Preferences: PreferencesPlugin;
}
