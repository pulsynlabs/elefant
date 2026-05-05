// Field Notes feature barrel.
//
// Re-exports the Field Notes View surface and its sub-components so consumers
// (App.svelte, the sidebar nav entry, tests) can import from one place.

export { default as FieldNotesView } from './FieldNotesView.svelte';
export { default as TreePane } from './TreePane.svelte';
export { default as ReaderPane } from './ReaderPane.svelte';
export { default as FrontmatterPillBar } from './FrontmatterPillBar.svelte';
export { default as TableOfContents } from './TableOfContents.svelte';
export { default as Breadcrumbs } from './Breadcrumbs.svelte';

export { fieldNotesStore } from './fieldnotes-store.svelte.js';
