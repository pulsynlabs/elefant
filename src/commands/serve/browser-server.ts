import path from 'node:path';
import type { ElefantError } from '../../types/errors.ts';
import { err, ok, type Result } from '../../types/result.ts';
import { getServeAuthPath, loadServeAuth, type ServeAuth } from './serve-auth.ts';
import { detectTailscaleIp } from './tailscale.ts';

export type BindMode = 'localhost' | 'network' | 'tailscale';

export interface BrowserServerOptions {
  port: number;
  daemonPort: number;
  distPath?: string;
  bindMode?: BindMode;
  tailscaleDetectOnly?: boolean;
  auth?: ServeAuth;
}

export interface BrowserServer {
  server: ReturnType<typeof Bun.serve>;
  url: string;
  bindMode: BindMode;
  hostname: string;
  tailscaleDetectOnly: boolean;
  tailscaleIp?: string; // populated when tailscale mode detected an IP
}

const proxyPrefixes = ['/api/', '/tools/'] as const;
const proxyExact = ['/health'] as const;

function notFoundError(): ElefantError {
  return {
    code: 'NOT_FOUND',
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

export function buildUnauthorizedResponse(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Elefant"' },
  });
}

/**
 * NFR6: Use Bun.password.verify — NEVER string === comparison for secrets.
 * This prevents timing attacks on the password comparison.
 */
export async function verifyBasicAuth(req: Request, auth: ServeAuth): Promise<boolean> {
  const header = req.headers.get('authorization');
  if (!header || !header.startsWith('Basic ')) {
    return false;
  }

  const b64 = header.slice('Basic '.length);
  let decoded: string;
  try {
    decoded = atob(b64);
  } catch {
    return false;
  }

  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) {
    return false;
  }

  const username = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);

  if (username !== auth.username) {
    return false;
  }

  return Bun.password.verify(password, auth.passwordHash);
}

async function proxyToDaemon(req: Request, daemonBaseUrl: string): Promise<Response> {
  const url = new URL(req.url);
  const targetUrl = `${daemonBaseUrl}${url.pathname}${url.search}`;

  const headers = new Headers(req.headers);
  headers.set('host', new URL(daemonBaseUrl).host);

  // Strip browser-origin headers — the proxy is the trusted local intermediary.
  // The daemon's localhost-only CORS guard should not see the browser's remote origin.
  headers.delete('origin');
  headers.delete('referer');

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

/**
 * Pre-flight check: if the server is bound to anything other than localhost,
 * auth credentials must exist.  This is a pure function that takes the auth
 * file path so it can be tested without touching the real filesystem.
 */
export async function authPreflightCheck(
  bindMode: BindMode,
  authFilePath?: string,
): Promise<Result<void, ElefantError>> {
  if (bindMode === 'localhost') {
    return ok(undefined);
  }

  const filePath = authFilePath ?? getServeAuthPath();
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return err({
      code: 'VALIDATION_ERROR',
      message:
        'Auth credentials required for network/Tailscale mode. ' +
        'Run: elefant auth set <user> <pass>',
    });
  }

  return ok(undefined);
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
  const bindMode = opts.bindMode ?? 'localhost';
  const tailscaleDetectOnly = opts.tailscaleDetectOnly ?? false;

  let loadedAuth: ServeAuth | undefined = opts.auth;
  if (bindMode !== 'localhost') {
    if (!loadedAuth) {
      const authResult = await authPreflightCheck(bindMode);
      if (!authResult.ok) {
        return authResult;
      }

      const loadedAuthResult = await loadServeAuth();
      if (!loadedAuthResult.ok) {
        return loadedAuthResult;
      }
      loadedAuth = loadedAuthResult.data;
    }
  }

  // Resolve hostname from bind mode
  let hostname: string;
  let tailscaleIp: string | undefined;
  switch (bindMode) {
    case 'network':
      hostname = '0.0.0.0';
      break;
    case 'tailscale': {
      const tsResult = await detectTailscaleIp();
      if (!tsResult.ok) {
        return tsResult;
      }
      tailscaleIp = tsResult.data;
      if (tailscaleDetectOnly) {
        hostname = '0.0.0.0';
      } else {
        hostname = tailscaleIp;
      }
      break;
    }
    case 'localhost':
    default:
      hostname = '127.0.0.1';
      break;
  }

  try {
    const server = Bun.serve({
      port: opts.port,
      hostname,
      async fetch(req) {
        const url = new URL(req.url);

        if (bindMode !== 'localhost' && loadedAuth && !(await verifyBasicAuth(req, loadedAuth))) {
          return buildUnauthorizedResponse();
        }

        if (shouldProxy(url.pathname)) {
          return proxyToDaemon(req, daemonBaseUrl);
        }

        return staticResponse(distPath, url.pathname);
      },
      error(error) {
        return new Response(`Internal error: ${error.message}`, { status: 500 });
      },
    });

    return ok({
      server,
      url: tailscaleIp ? `http://${tailscaleIp}:${server.port}` : `http://${hostname}:${server.port}`,
      bindMode,
      hostname,
      tailscaleDetectOnly,
      tailscaleIp,
    });
  } catch (error) {
    return err({
      code: 'TOOL_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : 'Failed to start browser server',
      details: error,
    });
  }
}
