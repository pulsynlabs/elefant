import { open } from '@tauri-apps/plugin-dialog';

/**
 * Opens a native OS folder picker dialog.
 * @returns The selected directory path, or null if cancelled/error.
 */
export async function pickDirectory(): Promise<string | null> {
	try {
		const result = await open({ directory: true, multiple: false });
		if (typeof result === 'string') return result;
		return null;
	} catch {
		// Fallback for web dev mode (no Tauri runtime)
		const fallback = prompt('Enter project directory path:');
		return fallback ?? null;
	}
}
