import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { mountServeRoutes } from './routes-serve.ts';
import { clearServeAuth, writeServeAuth } from '../commands/serve/serve-auth.ts';

describe('routes-serve', () => {
	let app: Elysia;

	beforeEach(async () => {
		await clearServeAuth();
		app = new Elysia();
		mountServeRoutes(app);
	});

	afterEach(async () => {
		await clearServeAuth();
	});

	describe('GET /api/serve/auth/status', () => {
		it('returns no credentials when none configured', async () => {
			const res = await app.handle(
				new Request('http://localhost/api/serve/auth/status'),
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ configured: false, username: null });
		});
	});

	describe('POST /api/serve/auth', () => {
		it('sets credentials and returns ok', async () => {
			const res = await app.handle(
				new Request('http://localhost/api/serve/auth', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ username: 'testuser', password: 'testpass' }),
				}),
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ ok: true });
		});

		it('returns validation error when password is missing', async () => {
			const res = await app.handle(
				new Request('http://localhost/api/serve/auth', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ username: 'testuser' }),
				}),
			);
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);
		});

		it('returns validation error when body is empty', async () => {
			const res = await app.handle(
				new Request('http://localhost/api/serve/auth', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
				}),
			);
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);
		});
	});

	describe('GET /api/serve/auth/status after POST', () => {
		it('shows credentials after setting them', async () => {
			// Set credentials first
			const writeResult = await writeServeAuth('testuser', 's3cret');
			expect(writeResult.ok).toBe(true);

			const res = await app.handle(
				new Request('http://localhost/api/serve/auth/status'),
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ configured: true, username: 'testuser' });
		});
	});

	describe('DELETE /api/serve/auth', () => {
		it('clears credentials and returns ok', async () => {
			// Set up credentials first
			await writeServeAuth('testuser', 's3cret');

			const res = await app.handle(
				new Request('http://localhost/api/serve/auth', {
					method: 'DELETE',
				}),
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ ok: true });
		});

		it('returns ok even when no credentials exist', async () => {
			const res = await app.handle(
				new Request('http://localhost/api/serve/auth', {
					method: 'DELETE',
				}),
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ ok: true });
		});
	});

	describe('GET /api/serve/auth/status after DELETE', () => {
		it('shows no credentials after clearing', async () => {
			// Set then clear credentials
			await writeServeAuth('testuser', 's3cret');
			await clearServeAuth();

			const res = await app.handle(
				new Request('http://localhost/api/serve/auth/status'),
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ configured: false, username: null });
		});
	});

	describe('GET /api/serve/tailscale', () => {
		it('returns detected boolean and ip field', async () => {
			const res = await app.handle(
				new Request('http://localhost/api/serve/tailscale'),
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { detected: boolean; ip: string | null };
			expect(body).toHaveProperty('detected');
			expect(body).toHaveProperty('ip');
			expect(typeof body.detected).toBe('boolean');
			expect(body.ip === null || typeof body.ip === 'string').toBe(true);
		});
	});

	describe('GET /api/serve/status', () => {
		it('returns status shape with running, url, bindMode, tailscaleIp', async () => {
			const res = await app.handle(
				new Request('http://localhost/api/serve/status'),
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				running: boolean;
				url: string | null;
				bindMode: string | null;
				tailscaleIp: string | null;
			};
			expect(body).toHaveProperty('running');
			expect(body).toHaveProperty('url');
			expect(body).toHaveProperty('bindMode');
			expect(body).toHaveProperty('tailscaleIp');
			expect(body.running).toBe(false);
			expect(body.url).toBe(null);
			expect(body.bindMode).toBe(null);
			// tailscaleIp is either null or string — depends on machine
			expect(body.tailscaleIp === null || typeof body.tailscaleIp === 'string').toBe(true);
		});
	});
});
