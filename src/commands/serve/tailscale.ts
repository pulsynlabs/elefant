import type { ElefantError } from '../../types/errors.ts';
import { err, ok, type Result } from '../../types/result.ts';

/**
 * Detect the local Tailscale IP address (100.x.x.x) via two strategies:
 * 1. Tailscale local API (http://100.100.100.100/localapi/v0/status)
 * 2. Fallback: parse `ip -4 addr show tailscale0` (Linux) or `ifconfig tailscale0` (macOS)
 */
export async function detectTailscaleIp(): Promise<Result<string, ElefantError>> {
  // Strategy 1: Tailscale local API
  try {
    const response = await fetch('http://100.100.100.100/localapi/v0/status', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = await response.json() as { TailscaleIPs?: string[] };
      const ip = parseTailscaleIpFromApiResponse(data);
      if (ip) return ok(ip);
    }
  } catch {
    // Fall through to strategy 2
  }

  // Strategy 2: Parse network interface
  const ip = await detectTailscaleIpFromInterface();
  if (ip) return ok(ip);

  return err({
    code: 'NOT_FOUND',
    message:
      'Tailscale not detected. Is it running?\n' +
      '  Start Tailscale and try again, or use --tailscale=detect to bind on all interfaces.',
  });
}

async function detectTailscaleIpFromInterface(): Promise<string | null> {
  const isLinux = process.platform === 'linux';
  const cmd = isLinux
    ? ['ip', '-4', 'addr', 'show', 'tailscale0']
    : ['ifconfig', 'tailscale0'];

  try {
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return parseTailscaleIpFromIfaceOutput(output);
  } catch {
    return null;
  }
}

/** Parse a Tailscale IP from raw `ip addr` or `ifconfig` output. Exported for testing. */
export function parseTailscaleIpFromIfaceOutput(output: string): string | null {
  const match = output.match(/inet\s+(100\.\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

/** Parse TailscaleIPs from local API JSON. Exported for testing. */
export function parseTailscaleIpFromApiResponse(data: { TailscaleIPs?: string[] }): string | null {
  return data.TailscaleIPs?.find((ip) => ip.startsWith('100.')) ?? null;
}
