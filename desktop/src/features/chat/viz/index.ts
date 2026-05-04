// Viz feature barrel exports.
//
// TypeScript utilities and types are exported here for clean imports.
// Svelte components are NOT re-exported from this barrel (they have
// complex default export semantics); import them directly from their
// source files when needed.

// Types
export type { VizType, VizEnvelope, VizRendererProps } from './types.js';

// Registry
export { resolveVizRenderer, registerVizRenderer } from './registry.js';

// Parsing utilities
export { parseVizEnvelope, isVizToolCall } from './parse-envelope.js';
