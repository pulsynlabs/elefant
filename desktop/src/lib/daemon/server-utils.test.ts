import { describe, it, expect } from 'bun:test';
import {
	normalizeServerUrl,
	generateServerId,
	isLocalUrl,
	serverDisplayNameFallback,
} from './server-utils.js';

describe('normalizeServerUrl', () => {
	it('adds http:// when scheme is missing', () => {
		expect(normalizeServerUrl('localhost:1337')).toBe('http://localhost:1337');
		expect(normalizeServerUrl('example.com')).toBe('http://example.com');
		expect(normalizeServerUrl('192.168.1.5')).toBe('http://192.168.1.5');
	});

	it('preserves https:// when present', () => {
		expect(normalizeServerUrl('https://example.com')).toBe('https://example.com');
		expect(normalizeServerUrl('https://vps.example.com:8080')).toBe('https://vps.example.com:8080');
	});

	it('strips trailing slash', () => {
		expect(normalizeServerUrl('http://example.com/')).toBe('http://example.com');
		expect(normalizeServerUrl('https://example.com:8080/')).toBe('https://example.com:8080');
		expect(normalizeServerUrl('localhost:1337/')).toBe('http://localhost:1337');
	});

	it('lowercases the host', () => {
		expect(normalizeServerUrl('http://EXAMPLE.COM')).toBe('http://example.com');
		expect(normalizeServerUrl('https://VPS.EXAMPLE.COM:8080')).toBe('https://vps.example.com:8080');
		expect(normalizeServerUrl('LOCALHOST:1337')).toBe('http://localhost:1337');
	});

	it('trims whitespace', () => {
		expect(normalizeServerUrl('  http://example.com  ')).toBe('http://example.com');
		expect(normalizeServerUrl('  https://VPS.EXAMPLE.COM:8080/  ')).toBe('https://vps.example.com:8080');
		expect(normalizeServerUrl('\tlocalhost:1337\n')).toBe('http://localhost:1337');
	});

	it('handles IPv4 addresses', () => {
		expect(normalizeServerUrl('http://192.168.1.5')).toBe('http://192.168.1.5');
		expect(normalizeServerUrl('192.168.1.5:8080')).toBe('http://192.168.1.5:8080');
		expect(normalizeServerUrl('http://10.0.0.1:3000/')).toBe('http://10.0.0.1:3000');
	});

	it('handles IPv6 addresses', () => {
		expect(normalizeServerUrl('http://[::1]')).toBe('http://[::1]');
		expect(normalizeServerUrl('http://[::1]:1337')).toBe('http://[::1]:1337');
		expect(normalizeServerUrl('http://[2001:db8::1]')).toBe('http://[2001:db8::1]');
	});

	it('handles paths and query strings', () => {
		expect(normalizeServerUrl('http://example.com/path')).toBe('http://example.com');
		expect(normalizeServerUrl('http://example.com?query=value')).toBe('http://example.com');
		expect(normalizeServerUrl('http://example.com/path?query=value')).toBe('http://example.com');
	});

	it('handles edge cases without throwing', () => {
		expect(normalizeServerUrl('')).toBe('');
		expect(normalizeServerUrl('   ')).toBe('');
		// Invalid URLs should return best-effort result
		expect(normalizeServerUrl('not-a-url')).toBe('http://not-a-url');
	});

	it('handles uppercase schemes', () => {
		expect(normalizeServerUrl('HTTP://example.com')).toBe('http://example.com');
		expect(normalizeServerUrl('HTTPS://example.com')).toBe('https://example.com');
	});
});

describe('generateServerId', () => {
	it('returns a valid UUID v4 string', () => {
		const id = generateServerId();
		expect(typeof id).toBe('string');
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
	});

	it('returns unique IDs on each call', () => {
		const ids = new Set<string>();
		for (let i = 0; i < 100; i++) {
			ids.add(generateServerId());
		}
		expect(ids.size).toBe(100);
	});
});

describe('isLocalUrl', () => {
	it('returns true for localhost', () => {
		expect(isLocalUrl('http://localhost')).toBe(true);
		expect(isLocalUrl('http://localhost:1337')).toBe(true);
		expect(isLocalUrl('https://localhost:3000')).toBe(true);
		expect(isLocalUrl('http://LOCALHOST')).toBe(true); // case insensitive
	});

	it('returns true for 127.0.0.1', () => {
		expect(isLocalUrl('http://127.0.0.1')).toBe(true);
		expect(isLocalUrl('http://127.0.0.1:1337')).toBe(true);
		expect(isLocalUrl('https://127.0.0.1:3000')).toBe(true);
	});

	it('returns true for ::1', () => {
		// Note: bare IPv6 in URLs without brackets is technically invalid,
		// but we handle it gracefully
		expect(isLocalUrl('http://::1')).toBe(true);
		// Valid IPv6 URL formats (with brackets)
		expect(isLocalUrl('http://[::1]')).toBe(true);
		expect(isLocalUrl('http://[::1]:1337')).toBe(true);
	});

	it('returns true for [::1]', () => {
		expect(isLocalUrl('http://[::1]')).toBe(true);
		expect(isLocalUrl('http://[::1]:8080')).toBe(true);
	});

	it('returns false for remote addresses', () => {
		expect(isLocalUrl('http://example.com')).toBe(false);
		expect(isLocalUrl('https://vps.example.com:8080')).toBe(false);
		expect(isLocalUrl('http://192.168.1.5')).toBe(false);
		expect(isLocalUrl('http://10.0.0.1')).toBe(false);
		expect(isLocalUrl('http://[2001:db8::1]')).toBe(false);
	});

	it('handles edge cases', () => {
		expect(isLocalUrl('')).toBe(false);
		expect(isLocalUrl('not-a-url')).toBe(false);
		expect(isLocalUrl('localhost')).toBe(true); // no scheme, but contains localhost
	});
});

describe('serverDisplayNameFallback', () => {
	it('returns hostname for simple URLs', () => {
		expect(serverDisplayNameFallback('http://example.com')).toBe('example.com');
		expect(serverDisplayNameFallback('https://my-vps.example.com')).toBe('my-vps.example.com');
	});

	it('returns hostname with port when present', () => {
		expect(serverDisplayNameFallback('http://localhost:1337')).toBe('localhost:1337');
		expect(serverDisplayNameFallback('https://example.com:8080')).toBe('example.com:8080');
		expect(serverDisplayNameFallback('http://192.168.1.5:3000')).toBe('192.168.1.5:3000');
	});

	it('handles IPv6 addresses', () => {
		expect(serverDisplayNameFallback('http://[::1]')).toBe('[::1]');
		expect(serverDisplayNameFallback('http://[::1]:1337')).toBe('[::1]:1337');
		expect(serverDisplayNameFallback('http://[2001:db8::1]')).toBe('[2001:db8::1]');
	});

	it('strips paths and query strings', () => {
		expect(serverDisplayNameFallback('http://example.com/path')).toBe('example.com');
		expect(serverDisplayNameFallback('http://example.com?query=value')).toBe('example.com');
		expect(serverDisplayNameFallback('http://example.com:8080/path/to/resource')).toBe('example.com:8080');
	});

	it('handles edge cases', () => {
		expect(serverDisplayNameFallback('')).toBe('');
		expect(serverDisplayNameFallback('not-a-url')).toBe('not-a-url');
		expect(serverDisplayNameFallback('localhost:1337')).toBe('localhost:1337');
	});
});
