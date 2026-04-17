<script lang="ts">
	const version = '0.1.0';
	const repoUrl = 'https://github.com/hffmnnj/elefant';
</script>

<div class="about-view">
	<div class="about-header">
		<h2 class="about-title">About</h2>
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
				<span class="info-label">Version</span>
				<span class="info-value">{version}</span>
			</div>
			<div class="info-item">
				<span class="info-label">License</span>
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
			<h3 class="stack-title">Built with</h3>
			<ul class="stack-list" role="list">
				<li>Tauri v2 — Desktop framework</li>
				<li>Svelte 5 — UI framework (runes)</li>
				<li>Bun + Elysia — Agent daemon</li>
				<li>CodeMirror 6 — Diff viewer</li>
				<li>Shiki — Syntax highlighting</li>
				<li>shadcn-svelte + bits-ui — Components</li>
				<li>TailwindCSS v4 — Styling</li>
			</ul>
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
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-snug);
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
		font-size: 32px;
		font-weight: var(--font-weight-bold);
		font-family: var(--font-mono);
		flex-shrink: 0;
	}

	.brand-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.brand-name {
		font-size: var(--font-size-4xl);
		font-weight: var(--font-weight-bold);
		color: var(--color-text-primary);
		letter-spacing: var(--tracking-tight);
		line-height: 1;
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
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
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
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-secondary);
	}

	.stack-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: 0;
	}

	.stack-list li {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.stack-list li::before {
		content: '—';
		color: var(--color-primary);
		font-weight: var(--font-weight-bold);
	}
</style>
