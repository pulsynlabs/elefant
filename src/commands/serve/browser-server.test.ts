import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  authPreflightCheck,
  buildProxyResponse,
  buildUnauthorizedResponse,
  resolveDistPath,
  shouldProxy,
  verifyBasicAuth,
} from './browser-server.ts';
import type { ServeAuth } from './serve-auth.ts';

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalDesktopDist = process.env.ELEFANT_DESKTOP_DIST;

function createTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'elefant-browser-server-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  process.chdir(originalCwd);

  if (originalDesktopDist === undefined) {
    delete process.env.ELEFANT_DESKTOP_DIST;
  } else {
    process.env.ELEFANT_DESKTOP_DIST = originalDesktopDist;
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveDistPath', () => {
  it('returns NOT_FOUND when no dist candidate contains index.html', async () => {
    const cwd = createTempDir();
    process.chdir(cwd);
    delete process.env.ELEFANT_DESKTOP_DIST;

    const result = await resolveDistPath({ distPath: '/nonexistent' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('cd desktop && bun run build');
      expect(result.error.message).toContain('elefant serve --dist');
    }
  });

  it('returns ok when opts.distPath points to a dist directory with index.html', async () => {
    const distPath = createTempDir();
    writeFileSync(path.join(distPath, 'index.html'), '<main>Elefant</main>');

    const result = await resolveDistPath({ distPath });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(distPath);
    }
  });

  it('returns ok when ELEFANT_DESKTOP_DIST env var points to valid dist', async () => {
    const distPath = createTempDir();
    writeFileSync(path.join(distPath, 'index.html'), '<main>Elefant</main>');
    process.env.ELEFANT_DESKTOP_DIST = distPath;

    // No opts.distPath — env var is the second candidate in the fallback chain
    const result = await resolveDistPath({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(distPath);
    }
  });

  it('resolves via cwd/desktop/dist when distPath and env var are absent', async () => {
    const cwd = createTempDir();
    const distDir = path.join(cwd, 'desktop', 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, 'index.html'), '<main>CWD Elefant</main>');
    process.chdir(cwd);
    delete process.env.ELEFANT_DESKTOP_DIST;

    // Neither distPath nor env var — falls back to cwd/desktop/dist (4th candidate)
    const result = await resolveDistPath({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(distDir);
    }
  });

  it('opts.distPath takes precedence over ELEFANT_DESKTOP_DIST env var', async () => {
    const flagPath = createTempDir();
    const envPath = createTempDir();
    writeFileSync(path.join(flagPath, 'index.html'), '<main>Flag</main>');
    writeFileSync(path.join(envPath, 'index.html'), '<main>Env</main>');
    process.env.ELEFANT_DESKTOP_DIST = envPath;

    // opts.distPath is the first candidate and should win
    const result = await resolveDistPath({ distPath: flagPath });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(flagPath);
    }
  });
});

describe('buildProxyResponse', () => {
  it('passes the daemon ReadableStream body through without buffering', () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: token\\n\\n'));
        controller.close();
      },
    });
    const daemonResponse = new Response(stream, {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/event-stream' },
    });

    const response = buildProxyResponse(daemonResponse);

    expect(response.body).toBe(stream);
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
  });
});

describe('shouldProxy', () => {
  it('matches daemon proxy routes and excludes static routes', () => {
    expect(shouldProxy('/api/projects')).toBe(true);
    expect(shouldProxy('/api/')).toBe(true);
    expect(shouldProxy('/tools/run')).toBe(true);
    expect(shouldProxy('/health')).toBe(true);
    expect(shouldProxy('/healthz')).toBe(false);
    expect(shouldProxy('/assets/app.js')).toBe(false);
    expect(shouldProxy('/settings')).toBe(false);
  });

  it('matches /api/ prefix (e.g. /api/foo)', () => {
    expect(shouldProxy('/api/foo')).toBe(true);
    expect(shouldProxy('/api/bar')).toBe(true);
    expect(shouldProxy('/api/projects/123')).toBe(true);
  });

  it('matches /tools/ prefix (e.g. /tools/bar)', () => {
    expect(shouldProxy('/tools/bar')).toBe(true);
    expect(shouldProxy('/tools/run')).toBe(true);
    expect(shouldProxy('/tools/agent/execute')).toBe(true);
  });

  it('matches /health exact route', () => {
    expect(shouldProxy('/health')).toBe(true);
  });

  it('does NOT match /static/app.js', () => {
    expect(shouldProxy('/static/app.js')).toBe(false);
    expect(shouldProxy('/assets/bundle.css')).toBe(false);
    expect(shouldProxy('/index.html')).toBe(false);
  });

  it('does NOT match paths that look like prefixes but are not (e.g. /healthz, /apiary)', () => {
    expect(shouldProxy('/healthz')).toBe(false);
    expect(shouldProxy('/apiary')).toBe(false);
    expect(shouldProxy('/tool')).toBe(false);
    expect(shouldProxy('/toolsies')).toBe(false);
  });
});

describe('authPreflightCheck', () => {
  it('returns ok for localhost mode regardless of file existence', async () => {
    const result = await authPreflightCheck('localhost', '/nonexistent/auth.json');
    expect(result.ok).toBe(true);
  });

  it('returns ok for network mode when auth file exists', async () => {
    const tmpDir = createTempDir();
    const authPath = path.join(tmpDir, 'serve-auth.json');
    writeFileSync(authPath, JSON.stringify({ username: 'alice', passwordHash: '...' }));

    const result = await authPreflightCheck('network', authPath);
    expect(result.ok).toBe(true);
  });

  it('returns err for network mode when auth file does NOT exist', async () => {
    const result = await authPreflightCheck('network', '/nonexistent/auth.json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('elefant auth set');
    }
  });

  it('returns err for tailscale mode when auth file does NOT exist', async () => {
    const result = await authPreflightCheck('tailscale', '/nonexistent/auth.json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns ok for tailscale mode when auth file exists', async () => {
    const tmpDir = createTempDir();
    const authPath = path.join(tmpDir, 'serve-auth.json');
    writeFileSync(authPath, JSON.stringify({ username: 'bob', passwordHash: '...' }));

    const result = await authPreflightCheck('tailscale', authPath);
    expect(result.ok).toBe(true);
  });
});

describe('verifyBasicAuth', () => {
  async function createAuth(): Promise<ServeAuth> {
    return {
      username: 'alice',
      passwordHash: await Bun.password.hash('secret'),
      createdAt: new Date().toISOString(),
    };
  }

  function requestWithBasicAuth(value?: string): Request {
    const headers = new Headers();
    if (value !== undefined) {
      headers.set('authorization', `Basic ${btoa(value)}`);
    }

    return new Request('http://localhost:3000/', { headers });
  }

  it('returns true with correct credentials', async () => {
    const auth = await createAuth();
    expect(await verifyBasicAuth(requestWithBasicAuth('alice:secret'), auth)).toBe(true);
  });

  it('returns false with wrong password', async () => {
    const auth = await createAuth();
    expect(await verifyBasicAuth(requestWithBasicAuth('alice:wrong'), auth)).toBe(false);
  });

  it('returns false with wrong username', async () => {
    const auth = await createAuth();
    expect(await verifyBasicAuth(requestWithBasicAuth('bob:secret'), auth)).toBe(false);
  });

  it('returns false with missing Authorization header', async () => {
    const auth = await createAuth();
    expect(await verifyBasicAuth(requestWithBasicAuth(), auth)).toBe(false);
  });
});

describe('buildUnauthorizedResponse', () => {
  it('returns a 401 with the Basic Auth challenge header', () => {
    const response = buildUnauthorizedResponse();

    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toBe('Basic realm="Elefant"');
  });
});
