import path from 'node:path';
import type { ElefantError } from '../../types/errors.ts';
import { err, ok, type Result } from '../../types/result.ts';

export interface BrowserServerOptions {
  port: number;
  daemonPort: number;
  distPath?: string;
}

export interface BrowserServer {
  server: ReturnType<typeof Bun.serve>;
  url: string;
}

const proxyPrefixes = ['/api/', '/tools/'] as const;
const proxyExact = ['/health'] as const;

function notFoundError(): ElefantError {
  return {
    code: 'NOT_FOUND' as ElefantError['code'],
    message:
      `Desktop build not found. Build it first:\n` +
      `  cd desktop && bun run build\n\n` +
      `Then run: elefant serve\n\n` +
      `Or specify the path: elefant serve --dist /path/to/desktop/dist`,
  };
}

export async function resolveDistPath(
  opts: Pick<BrowserServerOptions, 'distPath'>,
): Promise<Result<string, ElefantError>> {
  const candidates = [
    opts.distPath,
    process.env.ELEFANT_DESKTOP_DIST,
    path.join(path.dirname(process.execPath), 'desktop', 'dist'),
    path.join(process.cwd(), 'desktop', 'dist'),
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);

  for (const candidate of candidates) {
    const indexFile = Bun.file(path.join(candidate, 'index.html'));
    if (await indexFile.exists()) {
      return ok(candidate);
    }
  }

  return err(notFoundError());
}

export function shouldProxy(pathname: string): boolean {
  return proxyExact.includes(pathname) || proxyPrefixes.some((prefix) => pathname.startsWith(prefix));
}

export function buildProxyResponse(daemonResponse: Response): Response {
  return new Response(daemonResponse.body, {
    status: daemonResponse.status,
    statusText: daemonResponse.statusText,
    headers: daemonResponse.headers,
  });
}

async function proxyToDaemon(req: Request, daemonBaseUrl: string): Promise<Response> {
  const url = new URL(req.url);
  const targetUrl = `${daemonBaseUrl}${url.pathname}${url.search}`;

  const headers = new Headers(req.headers);
  headers.set('host', new URL(daemonBaseUrl).host);

  const daemonResponse = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: req.body,
    redirect: 'manual',
    // @ts-expect-error Bun supports duplex for streaming request bodies.
    duplex: 'half',
  });

  /**
   * NFR1: SSE passthrough must not buffer daemon responses.
   * Agent event streams rely on token-by-token delivery, so the proxy returns
   * the daemon ReadableStream directly instead of calling text(), json(), or
   * arrayBuffer(), all of which would consume and buffer the full response.
   */
  return buildProxyResponse(daemonResponse);
}

function staticFilePath(distPath: string, pathname: string): string {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolvedPath = path.resolve(distPath, relativePath);
  const resolvedDistPath = path.resolve(distPath);

  if (resolvedPath === resolvedDistPath || resolvedPath.startsWith(`${resolvedDistPath}${path.sep}`)) {
    return resolvedPath;
  }

  return path.join(resolvedDistPath, 'index.html');
}

async function staticResponse(distPath: string, pathname: string): Promise<Response> {
  const filePath = staticFilePath(distPath, pathname);
  const file = Bun.file(filePath);

  if (pathname.includes('.') && (await file.exists())) {
    return new Response(file);
  }

  if (pathname === '/' && (await file.exists())) {
    return new Response(file);
  }

  return new Response(Bun.file(path.join(distPath, 'index.html')));
}

export async function createBrowserServer(
  opts: BrowserServerOptions,
): Promise<Result<BrowserServer, ElefantError>> {
  const distResult = await resolveDistPath(opts);
  if (!distResult.ok) {
    return distResult;
  }

  const distPath = distResult.data;
  const daemonBaseUrl = `http://localhost:${opts.daemonPort}`;

  try {
    const server = Bun.serve({
      port: opts.port,
      async fetch(req) {
        const url = new URL(req.url);

        if (shouldProxy(url.pathname)) {
          return proxyToDaemon(req, daemonBaseUrl);
        }

        return staticResponse(distPath, url.pathname);
      },
      error(error) {
        return new Response(`Internal error: ${error.message}`, { status: 500 });
      },
    });

    return ok({ server, url: `http://localhost:${server.port}` });
  } catch (error) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : 'Failed to start browser server',
      details: error,
    });
  }
}
