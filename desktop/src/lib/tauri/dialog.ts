import { settingsStore } from '$lib/stores/settings.svelte.js';

/**
 * True when the app is running inside a Tauri webview, false in the plain
 * browser / `bun run serve` mode where `@tauri-apps/plugin-dialog` is not
 * available.
 */
export const isTauriRuntime: boolean =
	typeof window !== 'undefined' && '__TAURI__' in window;

/**
 * Callback registered by the component tree to display the in-app
 * RemoteFileBrowser modal. The promise resolves to the chosen path, or
 * `null` if the user cancelled.
 *
 * The callback indirection exists because the modal is a Svelte component
 * that has to live in the DOM — it can't be invoked imperatively from a
 * plain module function. The component registers its show fn on mount.
 */
let showRemotePicker: (() => Promise<string | null>) | null = null;

/**
 * Registers the function used to display the RemoteFileBrowser modal.
 * Called by the component that owns the modal (typically a top-level
 * view) on mount, and may be passed `null` to clear the registration on
 * destroy.
 */
export function registerRemotePicker(
	fn: (() => Promise<string | null>) | null,
): void {
	showRemotePicker = fn;
}

/**
 * Opens a folder picker.
 *
 * Routing rules:
 *   - Tauri runtime + local active server  → native Tauri folder dialog
 *   - Tauri runtime + remote active server → in-app RemoteFileBrowser
 *   - Plain browser (no Tauri runtime)     → in-app RemoteFileBrowser
 *
 * The browser-only case exists because `bun run serve` exposes the UI to
 * a plain browser tab where the Tauri plugin is unavailable; even when
 * the active server is local the browser has no direct filesystem access
 * and must go through the daemon's `/api/fs/list` endpoint.
 *
 * @returns The selected directory path, or null if cancelled / unavailable.
 */
export async function pickDirectory(): Promise<string | null> {
	const activeServer = settingsStore.activeServer;
	const isLocal = activeServer?.isLocal ?? true;

	// Case 1: Tauri + local server → native picker
	if (isTauriRuntime && isLocal) {
		try {
			const { open } = await import('@tauri-apps/plugin-dialog');
			const result = await open({ directory: true, multiple: false });
			return typeof result === 'string' ? result : null;
		} catch {
			// Fall through to the in-app picker if the native dialog
			// surfaces an error (rare, but keeps the user from getting
			// stuck if the plugin misbehaves).
		}
	}

	// Case 2: Tauri + remote server, OR Case 3: Browser/serve mode
	if (showRemotePicker) {
		return showRemotePicker();
	}

	// Fallback: the modal hasn't registered yet. This shouldn't happen in
	// the normal flow because the picker view registers on mount before
	// the user can click "Open New Folder", but we return null cleanly
	// rather than throwing so the caller's catch path is well-defined.
	return null;
}
