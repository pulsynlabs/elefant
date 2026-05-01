import { describe, expect, it } from 'bun:test';
import {
  parseTailscaleIpFromApiResponse,
  parseTailscaleIpFromIfaceOutput,
} from './tailscale.ts';

describe('parseTailscaleIpFromIfaceOutput', () => {
  it('extracts the inet 100.x.x.x address from Linux ip addr output', () => {
    const output = [
      '2: tailscale0: <POINTOPOINT,MULTICAST,NOARP,UP,LOWER_UP> mtu 1280 qdisc fq_codel state UNKNOWN group default qlen 500',
      '    link/none',
      '    inet 100.64.0.1/32 scope global tailscale0',
      '       valid_lft forever preferred_lft forever',
      '    inet6 fd7a:115c:a1e0::1/128 scope global',
      '       valid_lft forever preferred_lft forever',
    ].join('\n');

    const result = parseTailscaleIpFromIfaceOutput(output);
    expect(result).toBe('100.64.0.1');
  });

  it('extracts the inet 100.x.x.x address from macOS ifconfig output', () => {
    const output = [
      'tailscale0: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1280',
      '    inet6 fe80::1%tailscale0 prefixlen 64 scopeid 0x8',
      '    inet 100.110.50.3 netmask 0xffffffff broadcast 100.110.50.3',
      '    nd6 options=201<PERFORMNUD,DAD>',
    ].join('\n');

    const result = parseTailscaleIpFromIfaceOutput(output);
    expect(result).toBe('100.110.50.3');
  });

  it('returns null when no 100.x.x.x address is present in the output', () => {
    const output = [
      'eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500',
      '    inet 192.168.1.5  netmask 255.255.255.0  broadcast 192.168.1.255',
      '    inet6 fe80::1  prefixlen 64  scopeid 0x20<link>',
    ].join('\n');

    const result = parseTailscaleIpFromIfaceOutput(output);
    expect(result).toBeNull();
  });

  it('returns null for empty output', () => {
    const result = parseTailscaleIpFromIfaceOutput('');
    expect(result).toBeNull();
  });
});

describe('parseTailscaleIpFromApiResponse', () => {
  it('extracts the first 100.x.x.x IP from TailscaleIPs array', () => {
    const data = { TailscaleIPs: ['100.64.0.1', '::1'] } as { TailscaleIPs?: string[] };
    const result = parseTailscaleIpFromApiResponse(data);
    expect(result).toBe('100.64.0.1');
  });

  it('skips IPv6 addresses and returns the first 100.x.x.x IP', () => {
    const data = { TailscaleIPs: ['::1', 'fd7a::1', '100.80.25.7'] } as { TailscaleIPs?: string[] };
    const result = parseTailscaleIpFromApiResponse(data);
    expect(result).toBe('100.80.25.7');
  });

  it('returns null when TailscaleIPs is an empty array', () => {
    const data = { TailscaleIPs: [] } as { TailscaleIPs?: string[] };
    const result = parseTailscaleIpFromApiResponse(data);
    expect(result).toBeNull();
  });

  it('returns null when TailscaleIPs is undefined', () => {
    const data = {} as { TailscaleIPs?: string[] };
    const result = parseTailscaleIpFromApiResponse(data);
    expect(result).toBeNull();
  });

  it('returns null when TailscaleIPs contains only non-100.x addresses', () => {
    const data = { TailscaleIPs: ['192.168.1.5', '::1'] } as { TailscaleIPs?: string[] };
    const result = parseTailscaleIpFromApiResponse(data);
    expect(result).toBeNull();
  });
});
