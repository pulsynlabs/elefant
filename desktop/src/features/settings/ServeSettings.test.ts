import { describe, it, expect } from 'bun:test';
import {
	deriveServeStatusLabel,
	deriveBindModeWarning,
	buildAuthHeader,
} from './serve-settings-state.js';

describe('deriveServeStatusLabel', () => {
	it('returns Loading when null', () => {
		expect(deriveServeStatusLabel(null)).toBe('Loading...');
	});

	it('returns Running URL when running', () => {
		expect(
			deriveServeStatusLabel({
				running: true,
				url: 'http://localhost:3000',
				bindMode: 'localhost',
				tailscaleIp: null,
			}),
		).toBe('Running — http://localhost:3000');
	});

	it('falls back to "unknown URL" when running but url is missing', () => {
		expect(
			deriveServeStatusLabel({
				running: true,
				url: null,
				bindMode: 'localhost',
				tailscaleIp: null,
			}),
		).toBe('Running — unknown URL');
	});

	it('returns Stopped when not running', () => {
		expect(
			deriveServeStatusLabel({
				running: false,
				url: null,
				bindMode: null,
				tailscaleIp: null,
			}),
		).toBe('Stopped');
	});
});

describe('deriveBindModeWarning', () => {
	it('returns null for localhost mode (always safe)', () => {
		expect(deriveBindModeWarning('localhost', false)).toBeNull();
		expect(deriveBindModeWarning('localhost', true)).toBeNull();
	});

	it('returns warning when network mode + no auth', () => {
		expect(deriveBindModeWarning('network', false)).toBe(
			'Warning: Set auth credentials before exposing the UI over the network.',
		);
	});

	it('returns null when network mode + auth configured', () => {
		expect(deriveBindModeWarning('network', true)).toBeNull();
	});

	it('returns warning when tailscale mode + no auth', () => {
		expect(deriveBindModeWarning('tailscale', false)).toBe(
			'Warning: Set auth credentials before exposing the UI over the network.',
		);
	});

	it('returns null when tailscale mode + auth configured', () => {
		expect(deriveBindModeWarning('tailscale', true)).toBeNull();
	});
});

describe('buildAuthHeader', () => {
	it('builds a base64-encoded Basic header', () => {
		// "user:pass" -> dXNlcjpwYXNz
		expect(buildAuthHeader('user', 'pass')).toBe('Basic dXNlcjpwYXNz');
	});

	it('handles empty values without throwing', () => {
		expect(buildAuthHeader('', '')).toBe('Basic Og==');
	});
});
