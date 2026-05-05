// Frontend viz envelope types.
//
// These mirror the daemon-side `VizEnvelope` shape (see
// `src/tools/visualize/types.ts`) but are kept structurally
// independent so the desktop bundle never imports daemon code.
// Per-renderer narrowing of `data` happens inside each renderer
// component using the discriminated `type` field.

export type VizType =
	| 'mermaid'
	| 'table'
	| 'stat-grid'
	| 'code'
	| 'field-notes-card'
	| 'loading'
	| 'comparison';

export interface VizEnvelope {
	id: string;
	type: VizType;
	intent: string;
	title?: string;
	/** Per-type payload — narrowed by each renderer. */
	data: Record<string, unknown>;
}

export interface VizRendererProps {
	envelope: VizEnvelope;
}
