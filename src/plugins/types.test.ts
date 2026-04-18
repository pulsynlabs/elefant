import { describe, expect, it } from 'bun:test';

import type { ElefantPluginAPI } from './api.ts';
import type { ElefantPluginFactory } from './types.ts';

type Assert<T extends true> = T;

type PluginFactoryReturnIsValid = Assert<
	ReturnType<ElefantPluginFactory> extends void | Promise<void> ? true : false
>;

// Runtime smoke test — just verify the module loads
describe('plugin types', () => {
	it('ElefantPluginFactory type is usable', () => {
		const _typeCheck: PluginFactoryReturnIsValid = true;
		expect(_typeCheck).toBe(true);
	});

	it('plugin factory type accepts a sync function', () => {
		const _factory: ElefantPluginFactory = (_api) => {
			// valid factory
		};
		expect(typeof _factory).toBe('function');
	});

	it('plugin factory type accepts an async function', () => {
		const _factory: ElefantPluginFactory = async (_api) => {
			// valid async factory
		};
		expect(typeof _factory).toBe('function');
	});

	it('ElefantPluginAPI type is importable', () => {
		const _acceptsApi = (_api: ElefantPluginAPI): void => {
			// compile-time shape check via annotation
		};
		expect(typeof _acceptsApi).toBe('function');
	});
});
