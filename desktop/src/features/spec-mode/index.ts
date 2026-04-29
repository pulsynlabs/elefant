// Spec Mode feature barrel.
//
// Re-exports the panel surface and its sub-components so consumers (App.svelte,
// the sidebar nav entry, and tests) import from one place.

export { default as SpecModeView } from './SpecModeView.svelte';
export { default as WorkflowSwitcher } from './WorkflowSwitcher.svelte';
export { default as PhaseRail } from './PhaseRail.svelte';
export { default as SpecViewer } from './SpecViewer.svelte';
export { default as WaveTaskBoard } from './WaveTaskBoard.svelte';
export { default as MissionApprovalCard } from './MissionApprovalCard.svelte';
