import { Store } from '@tauri-apps/plugin-store';
import { getDaemonClient } from '$lib/daemon/client.js';

const STORE_FILE = 'elefant-preferences.json';

interface AppSettings {
	daemonUrl: string;
	autoStartDaemon: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
	daemonUrl: 'http://localhost:1337',
	autoStartDaemon: false,
};

let daemonUrl = $state<string>(DEFAULT_SETTINGS.daemonUrl);
let autoStartDaemon = $state<boolean>(DEFAULT_SETTINGS.autoStartDaemon);

let store: Store | null = null;

async function getStore(): Promise<Store> {
	if (!store) {
		store = await Store.load(STORE_FILE);
	}
	return store;
}

export async function initSettings(): Promise<void> {
	try {
		const s = await getStore();
		const savedUrl = await s.get<string>('daemonUrl');
		const savedAutoStart = await s.get<boolean>('autoStartDaemon');

		if (savedUrl && typeof savedUrl === 'string') {
			daemonUrl = savedUrl;
		}
		if (typeof savedAutoStart === 'boolean') {
			autoStartDaemon = savedAutoStart;
		}

		getDaemonClient(daemonUrl);
	} catch {
		// Use defaults on error
	}
}

export async function setDaemonUrl(url: string): Promise<void> {
	daemonUrl = url;
	getDaemonClient(url);

	try {
		const s = await getStore();
		await s.set('daemonUrl', url);
		await s.save();
	} catch {
		// Silent
	}
}

export async function setAutoStartDaemon(value: boolean): Promise<void> {
	autoStartDaemon = value;

	try {
		const s = await getStore();
		await s.set('autoStartDaemon', value);
		await s.save();
	} catch {
		// Silent
	}
}

export const settingsStore = {
	get daemonUrl() { return daemonUrl; },
	get autoStartDaemon() { return autoStartDaemon; },
	init: initSettings,
	setDaemonUrl,
	setAutoStartDaemon,
};
