<script lang="ts">
	import { themeStore } from '$lib/stores/theme.svelte.js';
</script>

<button
	class="theme-toggle"
	onclick={() => themeStore.toggle()}
	aria-label={themeStore.isDark ? 'Switch to light mode' : 'Switch to dark mode'}
	title={themeStore.isDark ? 'Light mode' : 'Dark mode'}
>
	{#if themeStore.isDark}
		<!-- Sun icon -->
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
			<circle cx="12" cy="12" r="4"/>
			<path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
		</svg>
	{:else}
		<!-- Moon icon -->
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
		</svg>
	{/if}
</button>

<style>
	.theme-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: color var(--transition-fast), border-color var(--transition-fast), background-color var(--transition-fast);
	}

	.theme-toggle:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border-strong);
		background-color: var(--color-surface-hover);
	}
</style>
