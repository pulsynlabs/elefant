<script lang="ts">
	// ResearchView — placeholder shell for the Research Base reader.
	//
	// This stub satisfies the sidebar/route wiring in W4.1. The full
	// two-pane reader (tree + markdown reader) lands in W4.2 / W4.3
	// per the BLUEPRINT, at which point this file will be replaced by
	// the real implementation.
	//
	// Kept intentionally minimal so the routing surface is testable now
	// without dragging in the daemon / SSE / markdown plumbing.
</script>

<div class="research-view-placeholder" role="status" aria-live="polite">
	<p class="placeholder-text">Research View (loading…)</p>
</div>

<style>
	.research-view-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: var(--space-6);
		color: var(--color-text-muted);
	}

	.placeholder-text {
		margin: 0;
		font-size: var(--font-size-sm);
		font-family: var(--font-sans);
	}
</style>
