/**
 * StatusBar theme-sync wrapper.
 *
 * On Capacitor builds, synchronises the Android/iOS status bar style
 * (icon tint) and background colour with the current app theme. The
 * `syncStatusBar()` call is designed to be invoked from the theme store
 * after every theme change — on desktop / browser builds it is a no-op.
 *
 * Spec: MH10
 */
import { isCapacitorRuntime } from '$lib/runtime.js';

/**
 * Sync Android/iOS status bar style and background with current app theme.
 * No-op on desktop and browser.
 * @param isDark - true for dark theme, false for light
 */
export async function syncStatusBar(isDark: boolean): Promise<void> {
	if (!isCapacitorRuntime) return;
	try {
		const moduleName = '@capacitor/status-bar';
		const { StatusBar, Style } = await import(/* @vite-ignore */ moduleName);

		// Style: Dark = white icons on dark bar, Light = dark icons on light bar
		await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });

		// Background colour: match the app's substrate surface.
		// dark: #0a0a0e  (--surface-substrate at data-theme="dark")
		// light: #ffffff (safe fallback; could be refined by reading the
		//         CSS variable at runtime, but that requires a DOM round-trip
		//         and the practical difference is invisible on most devices)
		const bgColor = isDark ? '#0a0a0e' : '#ffffff';
		try {
			await StatusBar.setBackgroundColor({ color: bgColor });
		} catch {
			// setBackgroundColor not supported on iOS — ignore silently
		}
	} catch {
		/* silent — plugin unavailable in dev/web preview */
	}
}
