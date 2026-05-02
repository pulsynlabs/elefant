/**
 * Filesystem service — typed client wrapper for the daemon's
 * `GET /api/fs/list` endpoint used by the remote file browser.
 *
 * Mirrors the response envelope conventions established in
 * `src/server/routes-fs.ts`.
 */

import { registry } from '$lib/daemon/registry.js';
import { settingsStore } from '$lib/stores/settings.svelte.js';

// ---------------------------------------------------------------------------
// Types (mirror the daemon response shape)
// ---------------------------------------------------------------------------

export interface FsEntry {
	name: string;
	isDir: boolean;
}

export interface FsListResult {
	path: string;
	parent: string | null;
	entries: FsEntry[];
}

export type FsListResponse =
	| { ok: true; data: FsListResult }
	| { ok: false; error: string };

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** Timeout for directory listings — remote VPS may be slower than a local
 *  health check, so this is intentionally longer than the 3s health timeout. */
const FS_LIST_TIMEOUT_MS = 10_000;

/**
 * Lists a directory on the active daemon's filesystem.
 *
 * @param path - Absolute path to list. Omit to list the daemon's home directory.
 * @returns A typed result envelope — `{ ok: true, data }` on success or
 *          `{ ok: false, error }` on failure.
 */
export async function listRemoteDirectory(
	path?: string,
): Promise<FsListResponse> {
	const baseUrl = registry.getActive().getBaseUrl();
	let url = `${baseUrl}/api/fs/list`;
	if (path !== undefined) {
		url += `?path=${encodeURIComponent(path)}`;
	}

	const headers: Record<string, string> = {
		Accept: 'application/json',
	};

	const server = settingsStore.activeServer;
	if (server?.credentials) {
		const encoded = btoa(
			`${server.credentials.username}:${server.credentials.password}`,
		);
		headers['Authorization'] = `Basic ${encoded}`;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FS_LIST_TIMEOUT_MS);

	try {
		const res = await fetch(url, { headers, signal: controller.signal });

		let body: FsListResponse;
		try {
			body = (await res.json()) as FsListResponse;
		} catch {
			return {
				ok: false,
				error: `HTTP ${res.status}: ${res.statusText}`,
			};
		}

		// The daemon always returns the FsListResponse envelope, but if the
		// HTTP status indicates a server-level problem we still surface it.
		if (!res.ok) {
			return {
				ok: false,
				error: body.ok === false ? body.error : `HTTP ${res.status}`,
			};
		}

		return body;
	} catch (err: unknown) {
		if (
			typeof DOMException !== 'undefined' &&
			err instanceof DOMException &&
			err.name === 'AbortError'
		) {
			return { ok: false, error: 'Request timed out' };
		}
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	} finally {
		clearTimeout(timeoutId);
	}
}
