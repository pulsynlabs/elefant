<script lang="ts">
	import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
	import { HugeiconsIcon, MinimizeIcon, MaximizeIcon, RestoreIcon, WindowCloseIcon } from "$lib/icons/index.js";

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
		<HugeiconsIcon icon={MinimizeIcon} size={12} strokeWidth={1.5} />
	</button>

	{#if isMaximized}
		<button class="win-btn restore" aria-label="Restore" onclick={handleRestore}>
			<HugeiconsIcon icon={RestoreIcon} size={12} strokeWidth={1.5} />
		</button>
	{:else}
		<button class="win-btn maximize" aria-label="Maximize" onclick={handleMaximize}>
			<HugeiconsIcon icon={MaximizeIcon} size={12} strokeWidth={1.5} />
		</button>
	{/if}

	<button class="win-btn close" aria-label="Close" onclick={handleClose}>
		<HugeiconsIcon icon={WindowCloseIcon} size={12} strokeWidth={1.5} />
	</button>
</div>

<style>
	.window-controls {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		/* Match the topbar height exactly */
		height: var(--topbar-height, 48px);
	}

	.win-btn {
		width: 40px;
		height: 100%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 0;
		margin: 0;
		/* Make icons crisp vs glass backgrounds */
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		transition:
			background-color 0.2s var(--ease-out-expo),
			color 0.2s var(--ease-out-expo);
	}

	/* Default state: nearly invisible — reads as part of the titlebar */

	.win-btn:hover {
		color: var(--color-text-primary);
		background-color: rgba(255, 255, 255, 0.06);
	}

	.win-btn.close:hover {
		/* Soft desaturated red tint — premium feel, not a harsh error block */
		color: #ff9aa2;
		background-color: rgba(232, 17, 35, 0.15);
	}
</style>
