/**
 * Runtime detection utilities.
 *
 * Use these flags to branch between Tauri, Capacitor, and plain browser (serve mode).
 * All three environments run the same Svelte frontend — only the native APIs differ.
 */

/**
 * True when running inside a Tauri desktop webview.
 * The Tauri global object is injected by the Tauri runtime.
 */
export const isTauriRuntime: boolean =
	typeof window !== 'undefined' && '__TAURI__' in window;

/**
 * True when running inside a Capacitor native app (Android or iOS).
 * The Capacitor global object is injected by the Capacitor bridge.
 */
export const isCapacitorRuntime: boolean =
	typeof window !== 'undefined' && 'Capacitor' in window;

/**
 * True when running in plain browser / bun serve mode (no native wrapper).
 */
export const isBrowserMode: boolean = !isTauriRuntime && !isCapacitorRuntime;

/**
 * Returns the current platform identifier.
 * On Capacitor, reads Capacitor.getPlatform() for 'android' | 'ios'.
 * On Tauri, returns 'desktop'.
 * On plain browser, returns 'web'.
 */
export function getPlatform(): 'android' | 'ios' | 'desktop' | 'web' {
	if (isCapacitorRuntime) {
		try {
			// Capacitor.getPlatform() is synchronous and always available after bridge init
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return (window as any).Capacitor.getPlatform() as 'android' | 'ios';
		} catch {
			return 'web';
		}
	}
	if (isTauriRuntime) return 'desktop';
	return 'web';
}
