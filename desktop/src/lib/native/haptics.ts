/**
 * Haptics wrapper — thin abstraction over @capacitor/haptics.
 *
 * Every call is gated through `isCapacitorRuntime` so desktop / browser
 * builds are a true no-op; the package itself lives in `mobile/node_modules`
 * and is never bundled into the desktop Vite output.
 *
 * The variable-specifier + /* @vite-ignore *​/ pattern defeats both
 * TypeScript module resolution (the package is not in desktop/tsconfig
 * resolve paths) and Vite static analysis (so the bundler doesn't scan
 * for it). On Capacitor the import resolves normally because the app
 * context provides the module.
 *
 * Spec: MH5
 */
import { isCapacitorRuntime } from '$lib/runtime.js';

type ImpactLevel = 'light' | 'medium' | 'heavy';
type NotificationType = 'success' | 'warning' | 'error';

async function impact(level: ImpactLevel): Promise<void> {
	if (!isCapacitorRuntime) return;
	try {
		const moduleName = '@capacitor/haptics';
		const { Haptics, ImpactStyle } = await import(/* @vite-ignore */ moduleName);
		const style =
			level === 'light'
				? ImpactStyle.Light
				: level === 'heavy'
					? ImpactStyle.Heavy
					: ImpactStyle.Medium;
		await Haptics.impact({ style });
	} catch {
		/* silent — Android may not support haptics on all devices */
	}
}

async function notification(type: NotificationType): Promise<void> {
	if (!isCapacitorRuntime) return;
	try {
		const moduleName = '@capacitor/haptics';
		const { Haptics, NotificationType: NT } = await import(/* @vite-ignore */ moduleName);
		const notifType =
			type === 'success'
				? NT.Success
				: type === 'warning'
					? NT.Warning
					: NT.Error;
		await Haptics.notification({ type: notifType });
	} catch {
		/* silent */
	}
}

export const haptics = {
	/** Light impact — tab taps, minor interactions. */
	light: () => impact('light'),
	/** Medium impact — send message, significant action. */
	medium: () => impact('medium'),
	/** Heavy impact — major transitions. */
	heavy: () => impact('heavy'),
	/** Success notification haptic. */
	success: () => notification('success'),
	/** Warning notification haptic. */
	warning: () => notification('warning'),
	/** Error notification haptic. */
	error: () => notification('error'),
};
