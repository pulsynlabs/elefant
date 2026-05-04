/**
 * Type declarations for @capacitor/keyboard.
 *
 * This package lives in mobile/node_modules/, not desktop/node_modules/.
 * These declarations satisfy the TypeScript compiler while the actual module
 * is only loaded at runtime via dynamic import when isCapacitorRuntime is true.
 *
 * Only the surface area used by ChatView's keyboard-avoidance pipeline is
 * declared here — keyboardWillShow/keyboardWillHide and the listener handle.
 */
declare module '@capacitor/keyboard' {
	interface KeyboardInfo {
		/** Keyboard height in logical (CSS) pixels. */
		keyboardHeight: number;
	}

	interface PluginListenerHandle {
		remove(): Promise<void>;
	}

	type KeyboardEventName =
		| 'keyboardWillShow'
		| 'keyboardDidShow'
		| 'keyboardWillHide'
		| 'keyboardDidHide';

	interface KeyboardPlugin {
		addListener(
			eventName: 'keyboardWillShow' | 'keyboardDidShow',
			listenerFunc: (info: KeyboardInfo) => void,
		): Promise<PluginListenerHandle>;
		addListener(
			eventName: 'keyboardWillHide' | 'keyboardDidHide',
			listenerFunc: () => void,
		): Promise<PluginListenerHandle>;
		addListener(
			eventName: KeyboardEventName,
			listenerFunc: (info?: KeyboardInfo) => void,
		): Promise<PluginListenerHandle>;
		removeAllListeners(): Promise<void>;
	}

	export const Keyboard: KeyboardPlugin;
}
