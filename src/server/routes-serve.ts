import { Elysia, t } from 'elysia';
import { writeServeAuth, clearServeAuth, loadServeAuth } from '../commands/serve/serve-auth.ts';
import { detectTailscaleIp } from '../commands/serve/tailscale.ts';

export function mountServeRoutes(app: Elysia): void {
	app.get('/api/serve/status', async () => {
		const tailscaleResult = await detectTailscaleIp();
		const tailscaleIp = tailscaleResult.ok ? tailscaleResult.data : null;

		return {
			running: false,
			url: null,
			bindMode: null,
			tailscaleIp,
		};
	});

	app.post(
		'/api/serve/auth',
		async ({ body, set }) => {
			const result = await writeServeAuth(body.username, body.password);
			if (!result.ok) {
				set.status = 500;
				return { ok: false, error: result.error.message };
			}
			return { ok: true };
		},
		{
			body: t.Object({
				username: t.String({ minLength: 1 }),
				password: t.String({ minLength: 1 }),
			}),
		},
	);

	app.delete('/api/serve/auth', async () => {
		await clearServeAuth();
		return { ok: true };
	});

	app.get('/api/serve/auth/status', async () => {
		const result = await loadServeAuth();
		if (!result.ok) {
			return { configured: false, username: null };
		}
		return { configured: true, username: result.data.username };
	});

	app.get('/api/serve/tailscale', async () => {
		const result = await detectTailscaleIp();
		if (!result.ok) {
			return { detected: false, ip: null };
		}
		return { detected: true, ip: result.data };
	});
}
