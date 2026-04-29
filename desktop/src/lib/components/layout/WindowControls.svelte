<script lang="ts">
	import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

	let isMaximized = $state(false);

	const appWindow = getCurrentWebviewWindow();

	async function handleMinimize(): Promise<void> {
		await appWindow?.minimize();
	}

	async function handleMaximize(): Promise<void> {
		await appWindow?.maximize();
		isMaximized = true;
	}

	async function handleRestore(): Promise<void> {
		await appWindow?.unmaximize();
		isMaximized = false;
	}

	async function handleClose(): Promise<void> {
		await appWindow?.close();
	}

	async function syncState(): Promise<void> {
		isMaximized = (await appWindow?.isMaximized()) ?? false;
	}

	appWindow?.onResized(() => {
		void syncState();
	});

	// Sync once on mount
	void syncState();
</script>

<div class="window-controls">
	<button class="win-btn minimize" aria-label="Minimize" onclick={handleMinimize}>
		<svg width="10" height="2" viewBox="0 0 10 2" fill="none">
			<rect width="10" height="2" rx="0.5" fill="currentColor" />
		</svg>
	</button>

	{#if isMaximized}
		<button class="win-btn restore" aria-label="Restore" onclick={handleRestore}>
			<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
				<rect x="1" y="1" width="6" height="6" rx="0.5" stroke="currentColor" stroke-width="0.75" />
				<rect x="3" y="3" width="6" height="6" rx="0.5" stroke="currentColor" stroke-width="0.75" />
			</svg>
		</button>
	{:else}
		<button class="win-btn maximize" aria-label="Maximize" onclick={handleMaximize}>
			<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
				<rect x="0.5" y="0.5" width="9" height="9" rx="0.5" stroke="currentColor" stroke-width="0.75" />
			</svg>
		</button>
	{/if}

	<button class="win-btn close" aria-label="Close" onclick={handleClose}>
		<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
			<line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="0.75" stroke-linecap="round" />
			<line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="0.75" stroke-linecap="round" />
		</svg>
	</button>
</div>

<style>
	.window-controls {
		display: flex;
		align-items: center;
		gap: 0;
		flex-shrink: 0;
	}

	.win-btn {
		width: 38px;
		height: 100%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--color-text-secondary);
		cursor: pointer;
		padding: 0;
		margin: 0;
		transition:
			background-color var(--duration-fast) var(--ease-out-expo),
			color var(--duration-fast) var(--ease-out-expo);
	}

	.win-btn:hover {
		color: var(--color-text-primary);
		background-color: var(--color-surface-hover);
	}

	.win-btn.close:hover {
		color: #ffffff;
		background-color: var(--color-error, #ef4444);
	}
</style>
