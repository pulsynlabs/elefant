import { describe, expect, it } from 'bun:test';

import { classify } from './classifier.ts';

describe('classify', () => {
	it('classifies bash rm -rf as high risk', () => {
		expect(classify('bash', { command: 'rm -rf /tmp/unsafe' })).toBe('high');
	});

	it('classifies bash git push as high risk', () => {
		expect(classify('bash', { command: 'git push origin main' })).toBe('high');
	});

	it('classifies write to .env as high risk', () => {
		expect(classify('write', { path: '/workspace/.env' })).toBe('high');
	});

	it('classifies write to normal path as medium risk', () => {
		expect(classify('write', { path: '/workspace/src/file.ts' })).toBe('medium');
	});

	it('classifies read as low risk', () => {
		expect(classify('read', { path: '/workspace/src/file.ts' })).toBe('low');
	});

	it('classifies glob as low risk', () => {
		expect(classify('glob', { pattern: '**/*.ts' })).toBe('low');
	});

	it('defaults unknown tools to high risk', () => {
		expect(classify('unknown-tool', {})).toBe('high');
	});

	it('classifies edit to .pem as high risk', () => {
		expect(classify('edit', { path: '/workspace/certs/server.pem' })).toBe('high');
	});
});
