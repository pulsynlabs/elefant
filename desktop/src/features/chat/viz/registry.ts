// Viz renderer registry.
//
// Mirrors the existing `toolCardRegistry` pattern (see
// `desktop/src/features/chat/tools/registry.ts`): a single map from
// viz type → Svelte component, plus a resolver that returns null
// when the type is unregistered. `VizRenderer.svelte` falls back to
// `GenericVizCard.svelte` whenever this resolver returns null, so
// adding a new viz type only requires (a) creating the component
// and (b) calling `registerVizRenderer(type, Component)` from its
// module — no other call-site needs to change.

import type { Component } from 'svelte';
import type { VizType, VizRendererProps } from './types.js';
import LoadingViz from './LoadingViz.svelte';
import StatGridViz from './StatGridViz.svelte';

const vizRendererRegistry = new Map<VizType, Component<VizRendererProps>>();

/** Register a renderer component for the given viz type. Last write wins. */
export function registerVizRenderer(
	type: VizType,
	component: Component<VizRendererProps>,
): void {
	vizRendererRegistry.set(type, component);
}

/** Resolve a renderer component for the given viz type, or null when unregistered. */
export function resolveVizRenderer(
	type: VizType,
): Component<VizRendererProps> | null {
	return vizRendererRegistry.get(type) ?? null;
}

/**
 * Test-only helper. Removes a registered renderer so test suites can
 * isolate registry state between cases. Not exported from any barrel
 * meant for runtime use.
 */
export function unregisterVizRenderer(type: VizType): void {
	vizRendererRegistry.delete(type);
}

// Built-in registrations.
//
// Each concrete renderer registers itself here at module load so
// `VizRenderer.svelte` can resolve it on first paint without any
// runtime side-channel. Mirrors the eager-import pattern used by
// `chat/tools/registry.ts`.
registerVizRenderer(
	'loading',
	LoadingViz as unknown as Component<VizRendererProps>,
);
registerVizRenderer(
	'stat-grid',
	StatGridViz as unknown as Component<VizRendererProps>,
);
