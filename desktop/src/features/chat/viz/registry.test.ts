// Viz renderer registry tests.
//
// Mirrors the lightweight unit-test approach used by the rest of the
// chat feature: no @testing-library/svelte (it isn't installed), so
// we exercise the pure resolution logic with a stub component object.
// Component identity is preserved through Map storage, which is all
// `VizRenderer.svelte` needs to dispatch the correct renderer.

import { describe, expect, it, beforeEach } from 'bun:test';
import type { Component } from 'svelte';
import type { VizRendererProps, VizType } from './types.js';
import {
	registerVizRenderer,
	resolveVizRenderer,
	unregisterVizRenderer,
} from './registry.js';

// A minimal stand-in for a Svelte component. Identity is what the
// resolver guarantees — its callable shape is irrelevant here.
function makeStubComponent(): Component<VizRendererProps> {
	return {} as unknown as Component<VizRendererProps>;
}

const ALL_TYPES: VizType[] = [
	'mermaid',
	'table',
	'stat-grid',
	'code',
	'research-card',
	'loading',
	'comparison',
];

describe('viz registry', () => {
	beforeEach(() => {
		// Defensive: clear every known type so tests don't bleed state
		// from one another or from prior module imports.
		for (const t of ALL_TYPES) unregisterVizRenderer(t);
	});

	it('returns null for an unregistered type', () => {
		expect(resolveVizRenderer('mermaid')).toBeNull();
		expect(resolveVizRenderer('loading')).toBeNull();
	});

	it('resolves a registered component by type', () => {
		const stub = makeStubComponent();
		registerVizRenderer('loading', stub);

		expect(resolveVizRenderer('loading')).toBe(stub);
	});

	it('keeps types isolated from one another', () => {
		const loadingStub = makeStubComponent();
		const tableStub = makeStubComponent();

		registerVizRenderer('loading', loadingStub);
		registerVizRenderer('table', tableStub);

		expect(resolveVizRenderer('loading')).toBe(loadingStub);
		expect(resolveVizRenderer('table')).toBe(tableStub);
		expect(resolveVizRenderer('mermaid')).toBeNull();
	});

	it('overwrites a prior registration for the same type (last write wins)', () => {
		const first = makeStubComponent();
		const second = makeStubComponent();

		registerVizRenderer('stat-grid', first);
		registerVizRenderer('stat-grid', second);

		expect(resolveVizRenderer('stat-grid')).toBe(second);
	});

	it('unregisterVizRenderer removes the entry', () => {
		const stub = makeStubComponent();
		registerVizRenderer('comparison', stub);
		expect(resolveVizRenderer('comparison')).toBe(stub);

		unregisterVizRenderer('comparison');
		expect(resolveVizRenderer('comparison')).toBeNull();
	});
});
