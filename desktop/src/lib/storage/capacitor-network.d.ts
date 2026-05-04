/**
 * Type declarations for @capacitor/network.
 *
 * This package lives in mobile/node_modules/, not desktop/node_modules/.
 * These declarations satisfy the TypeScript compiler while the actual module
 * is only loaded at runtime via dynamic import when isCapacitorRuntime is true.
 *
 * Only the surface area used by the connection store's reconnect pipeline
 * is declared here — networkStatusChange listener and the listener handle.
 */
declare module '@capacitor/network' {
	type ConnectionType = 'wifi' | 'cellular' | 'none' | 'unknown';

	interface ConnectionStatus {
		connected: boolean;
		connectionType: ConnectionType;
	}

	interface PluginListenerHandle {
		remove(): Promise<void>;
	}

	interface NetworkPlugin {
		getStatus(): Promise<ConnectionStatus>;
		addListener(
			eventName: 'networkStatusChange',
			listenerFunc: (status: ConnectionStatus) => void,
		): Promise<PluginListenerHandle>;
		removeAllListeners(): Promise<void>;
	}

	export const Network: NetworkPlugin;
}
