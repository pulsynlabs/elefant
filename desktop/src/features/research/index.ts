// Research feature barrel.
//
// Re-exports the Research Base reader surface so consumers (App.svelte,
// the sidebar nav entry, and tests) import from one place.
//
// W4.1 ships a placeholder ResearchView; W4.2 / W4.3 will replace it
// with the real two-pane reader (tree + markdown) and add additional
// sub-component exports here.

export { default as ResearchView } from './ResearchView.svelte';
