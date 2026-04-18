import { describe, expect, it } from 'bun:test'

import { classify } from '../../src/permissions/classifier.ts'

describe('Permission gate approval flow', () => {
	it('read tool is low risk', () => {
		expect(classify('read', { path: '/tmp/foo.ts' })).toBe('low')
	})

	it('write tool is medium risk', () => {
		expect(classify('write', { path: '/tmp/foo.ts' })).toBe('medium')
	})

	it('rm -rf is high risk', () => {
		expect(classify('bash', { command: 'rm -rf /tmp/test' })).toBe('high')
	})

	it('git push is high risk', () => {
		expect(classify('bash', { command: 'git push origin main' })).toBe('high')
	})

	it('env file write is high risk', () => {
		expect(classify('write', { path: '/project/.env' })).toBe('high')
	})

	it('unknown tool defaults to high risk', () => {
		expect(classify('some-unknown-tool', {})).toBe('high')
	})
})
