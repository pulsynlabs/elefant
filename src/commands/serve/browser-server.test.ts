import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildProxyResponse, resolveDistPath, shouldProxy } from './browser-server.ts';

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
});
