/**
 * Mobile setup wizard state machine.
 *
 * Single source of truth for the 5-step Capacitor first-launch flow:
 *   1. Welcome
 *   2. Connection Type (remote vs. this-device)
 *   3. URL Input + Live Test (pings `/health`)
 *   4. Auth (optional bearer token)
 *   5. Success
 *
 * Spec: MH4 (mobile setup wizard, persistence via @capacitor/preferences).
 *
 * State is held in module-level $state runes so all step components and the
 * wizard shell read/write through one canonical store. `reset()` lets the
 * caller wipe state when remounting (e.g. dev hot reload).
 *
 * Persistence: `saveConfig()` writes a `ServerConfig`-compatible record to
 * Capacitor Preferences under the same keys (`servers`, `activeServerId`)
 * that `settingsStore.initCapacitorMode()` reads on app startup, so
 * configuration survives a force-close + reopen without a separate
 * migration path. The store is a no-op outside Capacitor — desktop and
 * browser builds never trigger this code path because the wizard itself
 * is gated by `isCapacitorRuntime` in App.svelte.
 *
 * The connection test uses a plain `fetch` to `<url>/health` with an 8s
 * AbortSignal timeout. The token, when present, is sent as
 * `Authorization: Bearer <token>` so the test exercises the same auth
 * path the daemon client will use post-wizard.
 */
import { isCapacitorRuntime } from '$lib/runtime.js';

export type WizardStep = 1 | 2 | 3 | 4 | 5;
export type ConnectionType = 'remote' | 'local';
export type TestStatus = 'idle' | 'testing' | 'success' | 'error';

// All wizard state in one rune-based module. Reading via getter keeps the
// reactive surface narrow and prevents external mutation.
let currentStep = $state<WizardStep>(1);
let connectionType = $state<ConnectionType>('remote');
let daemonUrl = $state('');
let authToken = $state('');
let testStatus = $state<TestStatus>('idle');
let testError = $state('');

/**
 * Strip a single trailing slash from a URL. Keeps `https://host:1337` as-is
 * but normalises `https://host:1337/` → `https://host:1337` so the `/health`
 * suffix never produces a double-slash.
 */
function stripTrailingSlash(url: string): string {
	return url.replace(/\/$/, '');
}

/**
 * Best-effort hostname extraction. Returns the URL itself when parsing
 * fails so we never crash the success step on a malformed URL — the caller
 * has already gated saveConfig() on a successful test, so a parse failure
 * here is an edge case worth degrading gracefully.
 */
function safeHostname(url: string): string {
	try {
		return new URL(url).hostname || url;
	} catch {
		return url;
	}
}

export const wizardState = {
	get currentStep(): WizardStep {
		return currentStep;
	},
	get connectionType(): ConnectionType {
		return connectionType;
	},
	get daemonUrl(): string {
		return daemonUrl;
	},
	get authToken(): string {
		return authToken;
	},
	get testStatus(): TestStatus {
		return testStatus;
	},
	get testError(): string {
		return testError;
	},

	nextStep(): void {
		if (currentStep < 5) {
			currentStep = (currentStep + 1) as WizardStep;
		}
	},

	prevStep(): void {
		if (currentStep > 1) {
			currentStep = (currentStep - 1) as WizardStep;
		}
	},

	setConnectionType(t: ConnectionType): void {
		connectionType = t;
	},

	setDaemonUrl(u: string): void {
		daemonUrl = u;
		// Reset test status whenever the URL changes so the user re-tests
		// before being allowed to proceed past Step 3.
		if (testStatus !== 'idle') {
			testStatus = 'idle';
			testError = '';
		}
	},

	setAuthToken(t: string): void {
		authToken = t;
	},

	/**
	 * Ping the configured daemon's `/health` endpoint with an 8s timeout.
	 * Sets `testStatus` to 'testing' → 'success' or 'error' and returns
	 * a boolean for callers that want to chain (e.g. auto-advance).
	 *
	 * Auth: when `authToken` is set, sends `Authorization: Bearer <token>`
	 * so the test exercises the post-wizard auth path. The daemon's
	 * `/health` route should accept either authed or unauthed requests
	 * (it's the connectivity check, not a permission gate).
	 */
	async testConnection(): Promise<boolean> {
		if (!daemonUrl.trim()) {
			testStatus = 'error';
			testError = 'Enter a daemon URL first';
			return false;
		}

		testStatus = 'testing';
		testError = '';

		try {
			const url = stripTrailingSlash(daemonUrl.trim());
			const headers: Record<string, string> = {};
			if (authToken.trim()) {
				headers['Authorization'] = `Bearer ${authToken.trim()}`;
			}

			const res = await fetch(`${url}/health`, {
				signal: AbortSignal.timeout(8000),
				headers,
			});

			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}

			testStatus = 'success';
			return true;
		} catch (err) {
			testStatus = 'error';
			testError =
				err instanceof Error ? err.message : 'Connection failed';
			return false;
		}
	},

	/**
	 * Persist the gathered configuration to Capacitor Preferences using
	 * the same key shape that `settingsStore.initCapacitorMode()` reads.
	 * This means the wizard's output is indistinguishable from a server
	 * added later via Settings — the next launch hydrates straight into
	 * the main app without a migration step.
	 *
	 * Silently no-ops outside Capacitor (the wizard never mounts there
	 * anyway, but we belt-and-brace the runtime check).
	 */
	async saveConfig(): Promise<void> {
		if (!isCapacitorRuntime) return;

		const url = stripTrailingSlash(daemonUrl.trim());
		const trimmedToken = authToken.trim();
		const serverConfig = {
			id: crypto.randomUUID(),
			url,
			displayName: safeHostname(url),
			isLocal: false,
			isDefault: true,
			...(trimmedToken
				? {
						credentials: {
							username: 'bearer',
							password: trimmedToken,
						},
					}
				: {}),
		};

		try {
			const { Preferences } = await import('@capacitor/preferences');
			await Preferences.set({
				key: 'servers',
				value: JSON.stringify([serverConfig]),
			});
			await Preferences.set({
				key: 'activeServerId',
				value: JSON.stringify(serverConfig.id),
			});
		} catch {
			/* silent — best-effort persistence; wizard already verified
			   reachability in Step 3, and the next launch will re-prompt
			   if persistence somehow failed. */
		}
	},

	/**
	 * Reset the entire wizard back to step 1. Used when the consumer
	 * unmounts the wizard mid-flow (e.g. user backgrounds the app then
	 * returns days later) or when restarting from Step 5 in dev.
	 */
	reset(): void {
		currentStep = 1;
		connectionType = 'remote';
		daemonUrl = '';
		authToken = '';
		testStatus = 'idle';
		testError = '';
	},
};
