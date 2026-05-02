import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';

import { mountFsRoutes, type FsListResponse } from './routes-fs.ts';

async function readFsResponse(response: Response): Promise<FsListResponse> {
	return (await response.json()) as FsListResponse;
}

function createApp(homePath = homedir()): Elysia {
	const app = new Elysia();
	mountFsRoutes(app, { lstat, readdir, realpath, stat, homedir: () => homePath });
	return app;
}

describe('mountFsRoutes', () => {
	let tempRoot: string;

	beforeEach(async () => {
		tempRoot = await mkdtemp(join(tmpdir(), 'elefant-fs-route-'));
	});

	afterEach(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});

	it('returns a sorted directory listing for a valid directory', async () => {
		await mkdir(join(tempRoot, 'z-dir'));
		await mkdir(join(tempRoot, 'a-dir'));
		await writeFile(join(tempRoot, 'z-file.txt'), 'z');
		await writeFile(join(tempRoot, 'a-file.txt'), 'a');

		const app = createApp();
		const response = await app.handle(
			new Request(`http://localhost/api/fs/list?path=${encodeURIComponent(tempRoot)}`),
		);
		const body = await readFsResponse(response);

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		if (body.ok) {
			expect(body.data.path).toBe(tempRoot);
			expect(body.data.parent).not.toBeNull();
			expect(body.data.entries).toEqual([
				{ name: 'a-dir', isDir: true },
				{ name: 'z-dir', isDir: true },
				{ name: 'a-file.txt', isDir: false },
				{ name: 'z-file.txt', isDir: false },
			]);
		}
	});

	it('uses the home directory when path query is missing', async () => {
		await mkdir(join(tempRoot, 'home-child'));

		const app = createApp(tempRoot);
		const response = await app.handle(new Request('http://localhost/api/fs/list'));
		const body = await readFsResponse(response);

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		if (body.ok) {
			expect(body.data.path).toBe(tempRoot);
			expect(body.data.entries).toContainEqual({ name: 'home-child', isDir: true });
		}
	});

	it('rejects traversal attempts before resolving the path', async () => {
		const app = createApp();
		const traversalPath = `${tempRoot}/../${tempRoot.split('/').at(-1) ?? ''}`;
		const response = await app.handle(
			new Request(`http://localhost/api/fs/list?path=${encodeURIComponent(traversalPath)}`),
		);
		const body = await readFsResponse(response);

		expect(response.status).toBe(400);
		expect(body).toEqual({ ok: false, error: 'Path traversal is not allowed' });
	});

	it('rejects deny-listed system paths', async () => {
		const app = createApp();
		const response = await app.handle(
			new Request(`http://localhost/api/fs/list?path=${encodeURIComponent('/etc')}`),
		);
		const body = await readFsResponse(response);

		expect(response.status).toBe(400);
		expect(body).toEqual({ ok: false, error: 'Path is not allowed' });
	});

	it('rejects deny-listed home subdirectories', async () => {
		const fakeHome = join(tempRoot, 'home');
		const sshPath = join(fakeHome, '.ssh');
		await mkdir(sshPath, { recursive: true });

		const app = createApp(fakeHome);
		const response = await app.handle(
			new Request(`http://localhost/api/fs/list?path=${encodeURIComponent(sshPath)}`),
		);
		const body = await readFsResponse(response);

		expect(response.status).toBe(400);
		expect(body).toEqual({ ok: false, error: 'Path is not allowed' });
	});

	it('returns 404 for non-existent paths', async () => {
		const app = createApp();
		const response = await app.handle(
			new Request(`http://localhost/api/fs/list?path=${encodeURIComponent(join(tempRoot, 'missing'))}`),
		);
		const body = await readFsResponse(response);

		expect(response.status).toBe(404);
		expect(body).toEqual({ ok: false, error: 'Path not found' });
	});

	it('returns 500 when reading the directory fails', async () => {
		const app = new Elysia();
		mountFsRoutes(app, {
			lstat,
			readdir: async () => {
				const error = new Error('permission denied');
				throw error;
			},
			realpath,
			stat,
			homedir: () => tempRoot,
		});

		const response = await app.handle(
			new Request(`http://localhost/api/fs/list?path=${encodeURIComponent(tempRoot)}`),
		);
		const body = await readFsResponse(response);

		expect(response.status).toBe(500);
		expect(body).toEqual({ ok: false, error: 'permission denied' });
	});

	it('skips symlinks that resolve outside the listed directory', async () => {
		const outsideRoot = await mkdtemp(join(tmpdir(), 'elefant-fs-outside-'));
		try {
			await mkdir(join(tempRoot, 'inside'));
			await mkdir(join(outsideRoot, 'outside'));
			await symlink(join(outsideRoot, 'outside'), join(tempRoot, 'escape'));
			await symlink(join(tempRoot, 'inside'), join(tempRoot, 'inside-link'));

			const app = createApp();
			const response = await app.handle(
				new Request(`http://localhost/api/fs/list?path=${encodeURIComponent(tempRoot)}`),
			);
			const body = await readFsResponse(response);

			expect(response.status).toBe(200);
			expect(body.ok).toBe(true);
			if (body.ok) {
				expect(body.data.entries).toContainEqual({ name: 'inside', isDir: true });
				expect(body.data.entries).toContainEqual({ name: 'inside-link', isDir: true });
				expect(body.data.entries.some((entry) => entry.name === 'escape')).toBe(false);
			}
		} finally {
			await rm(outsideRoot, { recursive: true, force: true });
		}
	});
});
