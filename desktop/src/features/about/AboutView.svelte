<script lang="ts">
	import Tag from '$lib/components/ui/tag/Tag.svelte';

	const version = '0.1.0';
	const repoUrl = 'https://github.com/hffmnnj/elefant';

	const stack = [
		{ name: 'Tauri v2', desc: 'Desktop framework' },
		{ name: 'Svelte 5', desc: 'UI framework (runes)' },
		{ name: 'Bun + Elysia', desc: 'Agent daemon' },
		{ name: 'CodeMirror 6', desc: 'Diff viewer' },
		{ name: 'Shiki', desc: 'Syntax highlighting' },
		{ name: 'shadcn-svelte', desc: 'Components' },
		{ name: 'TailwindCSS v4', desc: 'Styling' },
	];
</script>

<div class="about-view">
	<div class="about-header">
		<h2 class="about-title industrial-caps">About</h2>
	</div>

	<div class="about-content">
		<div class="brand-section">
			<div class="brand-mark" aria-hidden="true">E</div>
			<div class="brand-info">
				<h1 class="brand-name">Elefant</h1>
				<p class="brand-tagline">Code with memory.</p>
			</div>
		</div>

		<div class="info-grid">
			<div class="info-item">
				<span class="info-label mono-label">Version</span>
				<span class="info-value">{version}</span>
			</div>
			<div class="info-item">
				<span class="info-label mono-label">License</span>
				<span class="info-value">MIT</span>
			</div>
		</div>

		<div class="links-section">
			<a
				class="link-item"
				href={repoUrl}
				target="_blank"
				rel="noopener noreferrer"
				aria-label="View source code on GitHub (opens in browser)"
			>
				<span aria-hidden="true">⌘</span>
				Source Code — GitHub
			</a>
		</div>

		<div class="stack-section">
			<h3 class="stack-title industrial-caps">Built with</h3>
			<div class="stack-tags" role="list">
				{#each stack as item}
					<div class="stack-tag-item" role="listitem">
						<Tag variant="primary">{item.name}</Tag>
						<span class="stack-desc">{item.desc}</span>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.about-view {
		display: flex;
		flex-direction: column;
		height: 100%;
		background-color: var(--color-bg);
	}

	.about-header {
		padding: var(--space-5) var(--space-6);
		border-bottom: 1px solid var(--color-border);
		background-color: var(--color-surface);
		flex-shrink: 0;
	}

	.about-title {
		font-size: var(--font-size-sm);
		color: var(--color-text-primary);
	}

	.about-content {
		padding: var(--space-7) var(--space-8);
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		max-width: 480px;
		overflow-y: auto;
	}

	.brand-section {
		display: flex;
		align-items: center;
		gap: var(--space-5);
	}

	.brand-mark {
		width: 64px;
		height: 64px;
		border-radius: var(--radius-xl);
		background-color: var(--color-primary);
		color: var(--color-primary-foreground);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 28px;
		font-weight: var(--font-weight-normal);
		font-family: var(--font-serif);
		font-style: italic;
		flex-shrink: 0;
		box-shadow: var(--glow-primary), var(--shadow-md);
	}

	.brand-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.brand-name {
		font-size: var(--font-size-3xl);
		font-weight: var(--font-weight-normal);
		font-family: var(--font-serif);
		font-style: italic;
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-tight);
		line-height: var(--line-height-tight);
	}

	.brand-tagline {
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
		font-style: italic;
	}

	.info-grid {
		display: flex;
		gap: var(--space-6);
	}

	.info-item {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.info-label {
		color: var(--color-text-muted);
	}

	.info-value {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--color-text-primary);
	}

	.links-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.link-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-primary);
		text-decoration: none;
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		transition: color var(--transition-fast);
	}

	.link-item:hover {
		color: var(--color-primary-hover);
		text-decoration: underline;
	}

	.stack-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.stack-title {
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
	}

	.stack-tags {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.stack-tag-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.stack-desc {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
</style>
