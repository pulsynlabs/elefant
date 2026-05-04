/**
 * App lifecycle handler — WebSocket pause/resume on background/foreground.
 *
 * When the user backgrounds the Capacitor app, we stop the WebSocket
 * connection-polling loop to save battery and prevent unnecessary reconnect
 * attempts while the app is inactive. On foreground, we restart the polling
 * loop so the daemon connection is re-established promptly.
 *
 * Spec: MH7, MH10
 */
import { isCapacitorRuntime } from '$lib/runtime.js';
import { connectionStore } from '$lib/stores/connection.svelte.js';

let _lifecycleHandle: { remove: () => void } | null = null;

/**
 * Wire Capacitor app lifecycle events to WebSocket pause/resume.
 * Call once during app init (guarded by isCapacitorRuntime).
 * Idempotent — subsequent calls are a no-op if already wired.
 */
export async function initLifecycle(): Promise<void> {
	if (!isCapacitorRuntime) return;
	if (_lifecycleHandle) return; // already wired

	try {
		const moduleName = '@capacitor/app';
		const { App } = await import(/* @vite-ignore */ moduleName);

		_lifecycleHandle = await App.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
			if (isActive) {
				// App foregrounded — restart connection polling
				connectionStore.start();
			} else {
				// App backgrounded — stop connection to save battery
				connectionStore.stop();
			}
		});
	} catch {
		/* silent — plugin unavailable in dev/web preview */
	}
}

export function cleanupLifecycle(): void {
	_lifecycleHandle?.remove();
	_lifecycleHandle = null;
}
