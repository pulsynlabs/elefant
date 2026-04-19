// URL sanitizer — XSS hardening tests.
//
// These tests lock in the protocol allowlist (`http`, `https`, `mailto`)
// and verify every evasion pattern we protect against: casing, encoding,
// leading whitespace, and non-URL inputs. If a future markdown
// regression silently loosens the policy, these tests fail loudly.

import { describe, expect, it } from 'bun:test';
import { BLOCKED_URL, sanitizeUrl } from './url-sanitizer.js';

describe('sanitizeUrl — allowed protocols', () => {
	it('allows https URLs unchanged', () => {
		expect(sanitizeUrl('https://example.com/path?q=1#frag')).toBe(
			'https://example.com/path?q=1#frag',
		);
	});

	it('allows http URLs unchanged', () => {
		expect(sanitizeUrl('http://example.com')).toBe('http://example.com');
	});

	it('allows mailto URLs unchanged', () => {
		expect(sanitizeUrl('mailto:foo@bar.com')).toBe('mailto:foo@bar.com');
	});

	it('allows mailto with subject/body params', () => {
		const href = 'mailto:foo@bar.com?subject=hi&body=test';
		expect(sanitizeUrl(href)).toBe(href);
	});

	it('is case-insensitive for allowed protocols', () => {
		expect(sanitizeUrl('HTTPS://example.com')).toBe('HTTPS://example.com');
		expect(sanitizeUrl('MailTo:foo@bar.com')).toBe('MailTo:foo@bar.com');
	});

	it('allows relative URLs', () => {
		expect(sanitizeUrl('/docs/index')).toBe('/docs/index');
		expect(sanitizeUrl('./sibling.md')).toBe('./sibling.md');
		expect(sanitizeUrl('../parent.md')).toBe('../parent.md');
		expect(sanitizeUrl('#anchor')).toBe('#anchor');
		expect(sanitizeUrl('?query=1')).toBe('?query=1');
	});

	it('treats scheme-less bare text as relative (non-exploitable)', () => {
		// No colon → no scheme → cannot navigate to a dangerous URL.
		expect(sanitizeUrl('plain-text')).toBe('plain-text');
	});
});

describe('sanitizeUrl — blocked protocols', () => {
	it('blocks javascript:', () => {
		expect(sanitizeUrl('javascript:alert(1)')).toBe(BLOCKED_URL);
	});

	it('blocks uppercase JAVASCRIPT:', () => {
		expect(sanitizeUrl('JAVASCRIPT:alert(1)')).toBe(BLOCKED_URL);
	});

	it('blocks mixed-case JaVaScRiPt:', () => {
		expect(sanitizeUrl('JaVaScRiPt:alert(1)')).toBe(BLOCKED_URL);
	});

	it('blocks data: URIs', () => {
		expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe(BLOCKED_URL);
		expect(sanitizeUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe(BLOCKED_URL);
	});

	it('blocks tauri: protocol', () => {
		expect(sanitizeUrl('tauri://localhost/index.html')).toBe(BLOCKED_URL);
	});

	it('blocks file: protocol', () => {
		expect(sanitizeUrl('file:///etc/passwd')).toBe(BLOCKED_URL);
	});

	it('blocks vbscript:', () => {
		expect(sanitizeUrl('vbscript:msgbox("xss")')).toBe(BLOCKED_URL);
	});

	it('blocks ftp: (not on the allowlist)', () => {
		expect(sanitizeUrl('ftp://example.com/')).toBe(BLOCKED_URL);
	});

	it('blocks custom schemes', () => {
		expect(sanitizeUrl('elefant://command/run')).toBe(BLOCKED_URL);
	});
});

describe('sanitizeUrl — encoding and whitespace evasion', () => {
	it('blocks percent-encoded javascript scheme separator', () => {
		expect(sanitizeUrl('javascript%3Aalert(1)')).toBe(BLOCKED_URL);
	});

	it('blocks mixed-case percent-encoded javascript', () => {
		expect(sanitizeUrl('JaVaScRiPt%3Aalert(1)')).toBe(BLOCKED_URL);
	});

	it('blocks leading-tab javascript URL', () => {
		expect(sanitizeUrl('\tjavascript:alert(1)')).toBe(BLOCKED_URL);
	});

	it('blocks leading-newline javascript URL', () => {
		expect(sanitizeUrl('\njavascript:alert(1)')).toBe(BLOCKED_URL);
	});

	it('blocks leading-space javascript URL', () => {
		expect(sanitizeUrl('   javascript:alert(1)')).toBe(BLOCKED_URL);
	});

	it('blocks leading-CR javascript URL', () => {
		expect(sanitizeUrl('\rjavascript:alert(1)')).toBe(BLOCKED_URL);
	});

	it('blocks null-byte prefixed javascript URL', () => {
		expect(sanitizeUrl('\u0000javascript:alert(1)')).toBe(BLOCKED_URL);
	});

	it('blocks percent-encoded with leading whitespace', () => {
		expect(sanitizeUrl(' \tjavascript%3Aalert(1)')).toBe(BLOCKED_URL);
	});

	it('rejects malformed percent-encoding defensively', () => {
		// Bad percent-encoding (`%ZZ`) throws in `decodeURIComponent`.
		// We treat it as hostile rather than trusting the raw string.
		expect(sanitizeUrl('javascript:alert%ZZ')).toBe(BLOCKED_URL);
	});
});

describe('sanitizeUrl — edge cases', () => {
	it('blocks empty strings', () => {
		expect(sanitizeUrl('')).toBe(BLOCKED_URL);
	});

	it('blocks whitespace-only strings', () => {
		expect(sanitizeUrl('   ')).toBe(BLOCKED_URL);
		expect(sanitizeUrl('\t\n\r')).toBe(BLOCKED_URL);
	});

	it('blocks non-string input defensively', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(sanitizeUrl(null as unknown as string)).toBe(BLOCKED_URL);
		expect(sanitizeUrl(undefined as unknown as string)).toBe(BLOCKED_URL);
	});

	it('treats colon inside a path (no valid scheme prefix) as relative', () => {
		// Not a scheme because the characters before `:` violate RFC 3986.
		expect(sanitizeUrl('foo bar:baz')).toBe('foo bar:baz');
	});

	it('allows an mailto with plus-addressing', () => {
		expect(sanitizeUrl('mailto:user+tag@example.com')).toBe('mailto:user+tag@example.com');
	});
});
