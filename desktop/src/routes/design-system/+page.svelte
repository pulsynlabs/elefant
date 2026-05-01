<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Heading,
		Text,
		Button,
		Tooltip,
		Panel,
		EmptyState,
		QuireCard,
		Divider,
		Kbd,
		InlineCode,
		StatusDot,
		Avatar,
		Badge,
		Chip,
		Tag,
		Spinner,
		ProgressBar,
	} from '$lib/components/ui';

	type Theme = 'light' | 'dark';

	let theme = $state<Theme>('dark');
	let chipSelected = $state(true);
	let chipDismissed = $state(false);

	function applyTheme(next: Theme): void {
		theme = next;
		if (typeof document !== 'undefined') {
			document.documentElement.dataset.theme = next;
		}
	}

	function toggleTheme(): void {
		applyTheme(theme === 'dark' ? 'light' : 'dark');
	}

	onMount(() => {
		const current = document.documentElement.dataset.theme;
		if (current === 'light' || current === 'dark') {
			theme = current;
		} else {
			applyTheme('dark');
		}
	});

	// Token tables — declared once and rendered as small swatch grids.
	const colorTokens = {
		Primary: [
			'--color-primary',
			'--color-primary-hover',
			'--color-primary-pressed',
			'--color-primary-muted',
			'--color-primary-subtle',
		],
		Surfaces: [
			'--surface-substrate',
			'--surface-plate',
			'--surface-leaf',
			'--surface-overlay',
			'--surface-hover',
		],
		Borders: [
			'--border-hairline',
			'--border-edge',
			'--border-emphasis',
			'--border-focus',
		],
		Text: ['--text-prose', '--text-meta', '--text-muted', '--text-disabled'],
		Semantic: [
			'--color-success',
			'--color-warning',
			'--color-error',
			'--color-info',
		],
	} as const;

	const typeTiers = [
		{ name: 'hero', family: 'DM Serif Display', sample: 'The quick brown fox' },
		{ name: 'display', family: 'DM Serif Display', sample: 'The quick brown fox' },
		{ name: 'title', family: 'DM Serif Display', sample: 'The quick brown fox jumps' },
		{ name: 'prose', family: 'Geist Sans', sample: 'The quick brown fox jumps over the lazy dog.' },
		{ name: 'body', family: 'Geist Sans', sample: 'The quick brown fox jumps over the lazy dog.' },
		{ name: 'meta', family: 'Geist Mono', sample: 'the.quick.brown.fox' },
		{ name: 'caption', family: 'Geist Mono', sample: 'CAPTION TELEMETRY' },
	] as const;

	const buttonVariants = [
		'default',
		'secondary',
		'ghost',
		'outline',
		'destructive',
		'link',
	] as const;

	const buttonSizes = ['sm', 'default', 'lg', 'icon'] as const;

	const badgeTones = [
		'default',
		'primary',
		'success',
		'warning',
		'error',
		'info',
		'muted',
	] as const;

	const statusTones = [
		'neutral',
		'primary',
		'success',
		'warning',
		'error',
		'info',
	] as const;
</script>

<svelte:head>
	<title>Quire — The Elefant material language</title>
</svelte:head>

<main class="quire-showcase min-h-[100dvh]" data-theme-mirror={theme}>
	<!-- ─── HEADER ─────────────────────────────────────────────────── -->
	<header class="ds-header">
		<div class="ds-header-text">
			<span class="text-caption ds-eyebrow">Elefant · Design System</span>
			<Heading level={1} tier="display">Quire</Heading>
			<Text tag="p" tier="prose" tone="meta">
				The Elefant material language. Bound editorial sheets, hairline
				edges, restrained metal. Every token, surface, atom, and molecule
				rendered in both themes.
			</Text>
		</div>
		<div class="ds-header-controls">
			<Tooltip content="Switch between light and dark themes" position="bottom">
				<Button variant="secondary" size="sm" onclick={toggleTheme}>
					Theme · {theme}
				</Button>
			</Tooltip>
		</div>
	</header>

	<!-- ─── 1 · TYPE SCALE ─────────────────────────────────────────── -->
	<section class="ds-section">
		<div class="ds-section-head">
			<span class="text-caption ds-section-eyebrow">01 · Type</span>
			<Heading level={2} tier="title">Typography</Heading>
			<Text tag="p" tier="body" tone="meta">
				Three voices. DM Serif Display sets the masthead, Geist Sans carries the
				prose, Geist Mono keeps telemetry honest.
			</Text>
		</div>

		<ul class="ds-type-list">
			{#each typeTiers as tier (tier.name)}
				<li class="ds-type-row">
					<div class="ds-type-meta">
						<span class="text-caption">{tier.name}</span>
						<span class="text-caption ds-type-family">{tier.family}</span>
					</div>
					<div class="ds-type-sample">
						<span class="text-{tier.name}">{tier.sample}</span>
					</div>
				</li>
			{/each}
		</ul>
	</section>

	<Divider tone="hairline" />

	<!-- ─── 2 · COLOR TOKENS ───────────────────────────────────────── -->
	<section class="ds-section">
		<div class="ds-section-head">
			<span class="text-caption ds-section-eyebrow">02 · Color</span>
			<Heading level={2} tier="title">Color Tokens</Heading>
			<Text tag="p" tier="body" tone="meta">
				Primary <InlineCode>#4049e1</InlineCode> stays literal. Everything
				else is a derivation, designed in parallel for both themes.
			</Text>
		</div>

		<div class="ds-color-groups">
			{#each Object.entries(colorTokens) as [groupName, tokens] (groupName)}
				<div class="ds-color-group">
					<span class="text-caption ds-color-group-name">{groupName}</span>
					<div class="ds-swatch-row">
						{#each tokens as token (token)}
							<div class="ds-swatch-cell">
								<span class="ds-swatch" style="background: var({token});"></span>
								<span class="text-caption ds-swatch-name">{token.replace('--', '')}</span>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</section>

	<Divider tone="hairline" />

	<!-- ─── 3 · SURFACES (asymmetric bento) ────────────────────────── -->
	<section class="ds-section">
		<div class="ds-section-head">
			<span class="text-caption ds-section-eyebrow">03 · Surfaces</span>
			<Heading level={2} tier="title">Surfaces</Heading>
			<Text tag="p" tier="body" tone="meta">
				Three tiers of bound material. No blur — depth comes from color,
				border, and shadow.
			</Text>
		</div>

		<div class="ds-bento ds-bento-surfaces">
			<div class="ds-bento-cell ds-cell-sm">
				<div class="quire-sm ds-surface-demo ds-surface-sm">
					<span class="text-caption ds-surface-tier">sm</span>
					<Text tag="p" tier="body">Chips, pills, topbar.</Text>
				</div>
			</div>
			<div class="ds-bento-cell ds-cell-md">
				<div class="quire-md ds-surface-demo ds-surface-md">
					<span class="text-caption ds-surface-tier">md</span>
					<Heading level={3} tier="title">Sidebar &amp; panels</Heading>
					<Text tag="p" tier="body" tone="meta">
						Ambient surfaces achieve depth through tinted fills and
						hairline edges, never blur.
					</Text>
				</div>
			</div>
			<div class="ds-bento-cell ds-cell-lg">
				<div class="quire-lg ds-surface-demo ds-surface-lg">
					<span class="text-caption ds-surface-tier">lg</span>
					<Heading level={3} tier="title">Modals &amp; popovers</Heading>
					<Text tag="p" tier="body" tone="meta">
						Solid overlay with strong border and shadow — depth without
						blur.
					</Text>
				</div>
			</div>
		</div>
	</section>

	<Divider tone="hairline" />

	<!-- ─── 4 · NESTED BEZEL ───────────────────────────────────────── -->
	<section class="ds-section">
		<div class="ds-section-head">
			<span class="text-caption ds-section-eyebrow">04 · Bezel</span>
			<Heading level={2} tier="title">Nested Bezel</Heading>
			<Text tag="p" tier="body" tone="meta">
				Plate + leaf with mathematically concentric radii:
				<InlineCode>leaf = plate − 2px</InlineCode>.
			</Text>
		</div>

		<div class="ds-bezel-row">
			{#each [{ plate: 8, label: 'small' }, { plate: 12, label: 'medium' }, { plate: 18, label: 'large' }] as size (size.label)}
				<div class="ds-bezel-cell">
					<div
						class="quire-plate ds-bezel-plate"
						style="border-radius: {size.plate}px;"
					>
						<div
							class="quire-leaf ds-bezel-leaf"
							style="border-radius: calc({size.plate}px - 2px);"
						>
							<span class="text-caption">{size.label}</span>
						</div>
					</div>
					<span class="text-caption ds-bezel-math">
						plate {size.plate} · leaf {size.plate - 2}
					</span>
				</div>
			{/each}
		</div>
	</section>

	<Divider tone="hairline" />

	<!-- ─── 5 · BUTTONS ────────────────────────────────────────────── -->
	<section class="ds-section">
		<div class="ds-section-head">
			<span class="text-caption ds-section-eyebrow">05 · Buttons</span>
			<Heading level={2} tier="title">Buttons</Heading>
			<Text tag="p" tier="body" tone="meta">
				Six variants, four sizes. Press feedback is global; focus rings
				are token-driven.
			</Text>
		</div>

		<div class="ds-button-grid">
			{#each buttonVariants as variant (variant)}
				<div class="ds-button-row">
					<span class="text-caption ds-button-label">{variant}</span>
					<div class="ds-button-row-items">
						{#each buttonSizes as size (size)}
							<Button {variant} {size}>
								{size === 'icon' ? '↗' : variant}
							</Button>
						{/each}
					</div>
				</div>
			{/each}

			<div class="ds-button-row">
				<span class="text-caption ds-button-label">states</span>
				<div class="ds-button-row-items">
					<Button variant="default" loading>Loading</Button>
					<Button variant="default" disabled>Disabled</Button>
					<Button variant="secondary" disabled>Secondary off</Button>
					<Button variant="destructive">Delete</Button>
				</div>
			</div>
		</div>
	</section>

	<Divider tone="hairline" />

	<!-- ─── 6 · FORM ATOMS ─────────────────────────────────────────── -->
	<section class="ds-section">
		<div class="ds-section-head">
			<span class="text-caption ds-section-eyebrow">06 · Form Atoms</span>
			<Heading level={2} tier="title">Form Atoms</Heading>
		</div>

		<div class="ds-form-grid">
			<label class="ds-field">
				<span class="text-caption">Input</span>
				<input type="text" placeholder="Type something…" value="" />
			</label>

			<label class="ds-field">
				<span class="text-caption">Select</span>
				<select>
					<option>Quire material</option>
					<option>Editorial print</option>
					<option>Hairline binding</option>
				</select>
			</label>

			<label class="ds-field ds-field-wide">
				<span class="text-caption">Textarea</span>
				<textarea
					rows="3"
					placeholder="Body text uses Geist Sans at 14px."
				></textarea>
			</label>

			<div class="ds-field">
				<span class="text-caption">Keyboard</span>
				<div class="ds-kbd-row">
					<Kbd>⌘</Kbd>
					<Kbd>K</Kbd>
					<span class="text-meta">to open command palette</span>
				</div>
			</div>

			<div class="ds-field">
				<span class="text-caption">Inline Code</span>
				<Text tag="p" tier="body">
					Use <InlineCode>--text-prose</InlineCode> for body copy and
					<InlineCode>quire-md</InlineCode> for panels.
				</Text>
			</div>
		</div>
	</section>

	<Divider tone="hairline" />

	<!-- ─── 7 · PILLS ──────────────────────────────────────────────── -->
	<section class="ds-section">
		<div class="ds-section-head">
			<span class="text-caption ds-section-eyebrow">07 · Pills</span>
			<Heading level={2} tier="title">Badges, Chips, Tags</Heading>
		</div>

		<div class="ds-pill-block">
			<span class="text-caption ds-block-label">Badge — soft</span>
			<div class="ds-pill-row">
				{#each badgeTones as tone (tone)}
					<Badge {tone} variant="soft">{tone}</Badge>
				{/each}
			</div>
		</div>

		<div class="ds-pill-block">
			<span class="text-caption ds-block-label">Badge — solid</span>
			<div class="ds-pill-row">
				{#each badgeTones as tone (tone)}
					<Badge {tone} variant="solid">{tone}</Badge>
				{/each}
			</div>
		</div>

		<div class="ds-pill-block">
			<span class="text-caption ds-block-label">Badge — outline</span>
			<div class="ds-pill-row">
				{#each badgeTones as tone (tone)}
					<Badge {tone} variant="outline">{tone}</Badge>
				{/each}
			</div>
		</div>

		<div class="ds-pill-block">
			<span class="text-caption ds-block-label">Chip</span>
			<div class="ds-pill-row">
				<Chip selected={chipSelected} onclick={() => (chipSelected = !chipSelected)}>
					Selectable
				</Chip>
				<Chip onclick={() => {}}>Unselected</Chip>
				<Chip disabled onclick={() => {}}>Disabled</Chip>
				{#if !chipDismissed}
					<Chip dismissible onremove={() => (chipDismissed = true)}>
						Dismissible
					</Chip>
				{/if}
			</div>
		</div>

		<div class="ds-pill-block">
			<span class="text-caption ds-block-label">Tag</span>
			<div class="ds-pill-row">
				<Tag tone="neutral">draft</Tag>
				<Tag tone="primary">in review</Tag>
				<Tag tone="success">shipped</Tag>
				<Tag tone="warning">needs work</Tag>
				<Tag tone="error">blocked</Tag>
			</div>
		</div>
	</section>

	<Divider tone="hairline" />

	<!-- ─── 8 · STATUS & PROGRESS (asymmetric bento) ───────────────── -->
	<section class="ds-section">
		<div class="ds-section-head">
			<span class="text-caption ds-section-eyebrow">08 · Status</span>
			<Heading level={2} tier="title">Status &amp; Progress</Heading>
		</div>

		<div class="ds-bento ds-bento-status">
			<div class="ds-bento-cell ds-status-cell-dots">
				<span class="text-caption ds-block-label">Status Dot</span>
				<div class="ds-status-grid">
					{#each statusTones as tone (tone)}
						<div class="ds-status-cell">
							<StatusDot {tone} size="md" />
							<span class="text-meta">{tone}</span>
						</div>
					{/each}
				</div>
				<div class="ds-status-grid">
					{#each statusTones as tone (tone)}
						<div class="ds-status-cell">
							<StatusDot {tone} size="md" pulse />
							<span class="text-meta">{tone} · pulse</span>
						</div>
					{/each}
				</div>
			</div>

			<div class="ds-bento-cell ds-status-cell-spinners">
				<span class="text-caption ds-block-label">Spinner</span>
				<div class="ds-spinner-row">
					<div class="ds-spinner-cell">
						<Spinner size="sm" tone="primary" />
						<span class="text-caption">sm</span>
					</div>
					<div class="ds-spinner-cell">
						<Spinner size="md" tone="primary" />
						<span class="text-caption">md</span>
					</div>
					<div class="ds-spinner-cell">
						<Spinner size="lg" tone="primary" />
						<span class="text-caption">lg</span>
					</div>
					<div class="ds-spinner-cell">
						<Spinner size="md" tone="muted" />
						<span class="text-caption">muted</span>
					</div>
				</div>
			</div>

			<div class="ds-bento-cell ds-status-cell-progress">
				<span class="text-caption ds-block-label">Progress Bar</span>
				<div class="ds-progress-stack">
					<ProgressBar value={28} tone="primary" label="Primary" showLabel />
					<ProgressBar value={62} tone="success" label="Success" showLabel />
					<ProgressBar value={84} tone="warning" label="Warning" showLabel />
					<ProgressBar value={42} tone="error" label="Error" showLabel shimmer />
					<ProgressBar indeterminate tone="primary" label="Indeterminate" />
				</div>
			</div>
		</div>
	</section>

	<Divider tone="hairline" />

	<!-- ─── 9 · AVATAR ─────────────────────────────────────────────── -->
	<section class="ds-section">
		<div class="ds-section-head">
			<span class="text-caption ds-section-eyebrow">09 · Avatar</span>
			<Heading level={2} tier="title">Avatar</Heading>
			<Text tag="p" tier="body" tone="meta">
				Square <InlineCode>radius-fold</InlineCode> is the Quire-distinctive
				default; circle is available for traditional contexts. Monogram
				falls back to DM Serif Display italic.
			</Text>
		</div>

		<div class="ds-avatar-grid">
			<div class="ds-avatar-cell">
				<Avatar name="Elefant" size="sm" shape="square" />
				<span class="text-caption">sm · square</span>
			</div>
			<div class="ds-avatar-cell">
				<Avatar name="Quire" size="md" shape="square" />
				<span class="text-caption">md · square</span>
			</div>
			<div class="ds-avatar-cell">
				<Avatar name="Geist Sans" size="lg" shape="square" />
				<span class="text-caption">lg · square</span>
			</div>
			<div class="ds-avatar-cell">
				<Avatar name="DM Serif" size="md" shape="circle" />
				<span class="text-caption">md · circle</span>
			</div>
			<div class="ds-avatar-cell">
				<Avatar name="Geist" size="lg" shape="circle">
					{#snippet dot()}
						<StatusDot tone="success" size="sm" />
					{/snippet}
				</Avatar>
				<span class="text-caption">lg · circle · dot</span>
			</div>
			<div class="ds-avatar-cell">
				<Avatar name="" initials="QR" size="md" shape="square" />
				<span class="text-caption">explicit initials</span>
			</div>
		</div>
	</section>

	<Divider tone="hairline" />

	<!-- ─── 10 · PANEL ─────────────────────────────────────────────── -->
	<section class="ds-section">
		<div class="ds-section-head">
			<span class="text-caption ds-section-eyebrow">10 · Panel</span>
			<Heading level={2} tier="title">Panel</Heading>
		</div>

		<Panel padding="lg">
			{#snippet titleSnippet()}
				<h3 class="ds-panel-title">Editorial composition</h3>
			{/snippet}
			{#snippet subtitle()}
				A panel uses the <InlineCode>quire-md</InlineCode> surface with
				an optional header, toolbar, and footer.
			{/snippet}
			{#snippet toolbar()}
				<span>last edit · 4 min</span>
				<StatusDot tone="success" size="sm" />
			{/snippet}
			{#snippet footer()}
				<Button variant="ghost" size="sm">Cancel</Button>
				<Button variant="default" size="sm">Save changes</Button>
			{/snippet}

			<Text tag="p" tier="prose">
				The panel body carries the longer-form prose. Geist Sans at the
				prose tier (opsz 16, weight 400, leading 1.6, max-width 65ch)
				is the canonical body voice — you are reading it now.
			</Text>
			<Text tag="p" tier="body" tone="meta">
				Toolbars use the mono caption voice for telemetry. Footers reuse
				the button atom and inherit the same hairline as the header.
			</Text>
		</Panel>
	</section>

	<Divider tone="hairline" />

	<!-- ─── 11 · EMPTY STATE ───────────────────────────────────────── -->
	<section class="ds-section">
		<div class="ds-section-head">
			<span class="text-caption ds-section-eyebrow">11 · Empty State</span>
			<Heading level={2} tier="title">Empty State</Heading>
		</div>

		<div class="ds-empty-frame">
			<EmptyState
				title="No quires here yet"
				description="An empty state in Quire is pure typographic composition — DM Serif Display italic title, Geist Sans body, optional centred action. No card, no surface."
			>
				{#snippet icon()}
					<svg
						width="32"
						height="32"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						aria-hidden="true"
					>
						<path d="M4 6h16M4 12h12M4 18h8" />
					</svg>
				{/snippet}
				{#snippet action()}
					<Button variant="default">Compose first quire</Button>
				{/snippet}
			</EmptyState>
		</div>
	</section>

	<Divider tone="hairline" />

	<!-- ─── 12 · QUIRE CARD ────────────────────────────────────────── -->
	<section class="ds-section">
		<div class="ds-section-head">
			<span class="text-caption ds-section-eyebrow">12 · QuireCard</span>
			<Heading level={2} tier="title">QuireCard</Heading>
			<Text tag="p" tier="body" tone="meta">
				The signature surface of the material. Internally a
				<InlineCode>quire-plate</InlineCode> wrapping a
				<InlineCode>quire-leaf</InlineCode>.
			</Text>
		</div>

		<div class="ds-card-grid">
			<QuireCard>
				<div class="ds-card-body">
					<span class="text-caption">static</span>
					<Heading level={3} tier="title">Bound by hairlines</Heading>
					<Text tag="p" tier="body" tone="meta">
						The default card is non-interactive. Plate margin remains
						visible as the binding edge.
					</Text>
					<div class="ds-card-meta">
						<Tag tone="primary">case study</Tag>
						<Tag tone="neutral">2026</Tag>
					</div>
				</div>
			</QuireCard>

			<QuireCard hoverable onclick={() => {}}>
				<div class="ds-card-body">
					<span class="text-caption">interactive</span>
					<Heading level={3} tier="title">Hover to lift</Heading>
					<Text tag="p" tier="body" tone="meta">
						Hoverable cards translate one pixel up and surface an ambient
						indigo glow. Press settles back with a 0.995 scale.
					</Text>
					<div class="ds-card-footer">
						<Avatar name="Q" size="sm" shape="square" />
						<Text tag="span" tier="meta">Open detail →</Text>
					</div>
				</div>
			</QuireCard>
		</div>
	</section>

	<Divider tone="hairline" />

	<!-- ─── 13 · TOOLTIP ───────────────────────────────────────────── -->
	<section class="ds-section ds-section-final">
		<div class="ds-section-head">
			<span class="text-caption ds-section-eyebrow">13 · Tooltip</span>
			<Heading level={2} tier="title">Tooltip</Heading>
			<Text tag="p" tier="body" tone="meta">
				Hover or focus any of the controls below to surface a
				<InlineCode>quire-lg</InlineCode> tooltip.
			</Text>
		</div>

		<div class="ds-tooltip-row">
			<Tooltip content="Quire is bound editorial sheets." position="top">
				<Button variant="secondary">Hover (top)</Button>
			</Tooltip>
			<Tooltip content="Geist Sans at meta size, 6×10 padding." position="bottom">
				<Button variant="secondary">Hover (bottom)</Button>
			</Tooltip>
			<Tooltip content="Per-position 2px lift on mount." position="left">
				<Button variant="ghost">Hover (left)</Button>
			</Tooltip>
			<Tooltip content="Reduced-motion disables the entry transform." position="right">
				<Button variant="ghost">Hover (right)</Button>
			</Tooltip>
		</div>
	</section>

	<footer class="ds-footer">
		<Text tag="p" tier="caption" tone="muted">
			Quire · Elefant Design System · #4049e1
		</Text>
	</footer>
</main>

<style>
	/* ─── Page wrapper ─────────────────────────────────────────────────
	   The showcase is a self-contained page. We use min-h:100dvh (never
	   the full-viewport hard lock) per the design-taste-frontend rule,
	   a max-w container per gpt-taste editorial standards, and large
	   vertical rhythm between sections. */
	.quire-showcase {
		min-height: 100dvh;
		width: 100%;
		max-width: 1280px;
		margin: 0 auto;
		padding: var(--space-10) clamp(var(--space-4), 4vw, var(--space-9));
		display: flex;
		flex-direction: column;
		gap: var(--space-12);
		background: var(--surface-substrate);
		color: var(--text-prose);
		font-family: var(--font-body);
		font-variation-settings: 'opsz' 14, 'wght' 400;
	}

	/* ─── Header ───────────────────────────────────────────────────── */
	.ds-header {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--space-7);
		align-items: end;
		padding-bottom: var(--space-6);
		border-bottom: 1px solid var(--border-hairline);
	}

	.ds-header-text {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 56ch;
	}

	.ds-eyebrow {
		display: inline-block;
	}

	.ds-header-controls {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	@media (max-width: 768px) {
		.ds-header {
			grid-template-columns: 1fr;
			align-items: start;
		}

		.ds-header-controls {
			justify-content: flex-start;
		}
	}

	/* ─── Section primitives ───────────────────────────────────────── */
	.ds-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
		padding: var(--space-9) 0;
	}

	.ds-section-final {
		padding-bottom: var(--space-7);
	}

	.ds-section-head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-width: 60ch;
	}

	.ds-section-eyebrow {
		display: inline-block;
	}

	/* ─── 01 · Type list ───────────────────────────────────────────── */
	.ds-type-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.ds-type-row {
		display: grid;
		grid-template-columns: 200px 1fr;
		gap: var(--space-6);
		align-items: baseline;
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--border-hairline);
	}

	.ds-type-row:last-child {
		border-bottom: none;
	}

	.ds-type-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.ds-type-family {
		color: var(--text-muted);
	}

	.ds-type-sample {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	@media (max-width: 768px) {
		.ds-type-row {
			grid-template-columns: 1fr;
			gap: var(--space-2);
		}
	}

	/* ─── 02 · Color tokens ────────────────────────────────────────── */
	.ds-color-groups {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}

	.ds-color-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.ds-color-group-name {
		color: var(--text-muted);
	}

	.ds-swatch-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-5);
	}

	.ds-swatch-cell {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: flex-start;
		min-width: 96px;
	}

	.ds-swatch {
		display: block;
		width: 40px;
		height: 40px;
		border-radius: var(--radius-leaf);
		border: 1px solid var(--border-hairline);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.04),
			inset 0 -1px 0 rgba(0, 0, 0, 0.16);
	}

	.ds-swatch-name {
		color: var(--text-muted);
	}

	/* ─── 03 · Surfaces (asymmetric bento) ─────────────────────────── */
	.ds-bento {
		display: grid;
		grid-auto-flow: dense;
		gap: var(--space-4);
	}

	.ds-bento-surfaces {
		grid-template-columns: repeat(6, 1fr);
		grid-auto-rows: minmax(140px, auto);
	}

	.ds-bento-cell {
		min-width: 0;
	}

	/* sm — narrow, short. md — wide, medium. lg — full-width, tall. */
	.ds-cell-sm {
		grid-column: span 2;
		grid-row: span 1;
	}

	.ds-cell-md {
		grid-column: span 4;
		grid-row: span 1;
	}

	.ds-cell-lg {
		grid-column: span 6;
		grid-row: span 1;
	}

	.ds-surface-demo {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		justify-content: flex-start;
	}

	.ds-surface-sm {
		padding: var(--space-4);
	}

	.ds-surface-md {
		padding: var(--space-6);
	}

	.ds-surface-lg {
		padding: var(--space-7);
	}

	.ds-surface-tier {
		color: var(--text-muted);
	}

	@media (max-width: 768px) {
		.ds-bento-surfaces {
			grid-template-columns: 1fr;
		}

		.ds-cell-sm,
		.ds-cell-md,
		.ds-cell-lg {
			grid-column: span 1;
		}
	}

	/* ─── 04 · Bezel ───────────────────────────────────────────────── */
	.ds-bezel-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-7);
		align-items: flex-end;
	}

	.ds-bezel-cell {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: flex-start;
	}

	.ds-bezel-plate {
		padding: 2px;
		display: inline-block;
	}

	.ds-bezel-leaf {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 120px;
		padding: var(--space-5) var(--space-6);
	}

	.ds-bezel-cell:nth-child(2) .ds-bezel-leaf {
		min-width: 160px;
		padding: var(--space-6) var(--space-7);
	}

	.ds-bezel-cell:nth-child(3) .ds-bezel-leaf {
		min-width: 220px;
		padding: var(--space-7) var(--space-8);
	}

	.ds-bezel-math {
		color: var(--text-muted);
	}

	/* ─── 05 · Buttons ─────────────────────────────────────────────── */
	.ds-button-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-4);
	}

	.ds-button-row {
		display: grid;
		grid-template-columns: 120px 1fr;
		gap: var(--space-5);
		align-items: center;
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--border-hairline);
	}

	.ds-button-row:last-child {
		border-bottom: none;
	}

	.ds-button-label {
		color: var(--text-muted);
	}

	.ds-button-row-items {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
	}

	@media (max-width: 768px) {
		.ds-button-row {
			grid-template-columns: 1fr;
			gap: var(--space-2);
		}
	}

	/* ─── 06 · Form atoms ──────────────────────────────────────────── */
	.ds-form-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		grid-auto-flow: dense;
		gap: var(--space-5);
	}

	.ds-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.ds-field-wide {
		grid-column: span 2;
	}

	.ds-field input,
	.ds-field select,
	.ds-field textarea {
		font: inherit;
		font-family: var(--font-body);
		font-variation-settings: 'opsz' 14, 'wght' 400;
		color: var(--text-prose);
		background: var(--surface-leaf);
		border: 1px solid var(--border-edge);
		border-radius: var(--radius-leaf);
		padding: var(--space-3) var(--space-4);
		width: 100%;
		transition: border-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.ds-field textarea {
		resize: vertical;
		font-size: var(--font-size-base);
		line-height: var(--leading-base);
	}

	.ds-field input:focus-visible,
	.ds-field select:focus-visible,
	.ds-field textarea:focus-visible {
		outline: 1px solid var(--border-focus);
		outline-offset: 2px;
		border-color: var(--border-emphasis);
		box-shadow: var(--glow-focus);
	}

	.ds-kbd-row {
		display: inline-flex;
		gap: var(--space-2);
		align-items: center;
	}

	@media (max-width: 768px) {
		.ds-form-grid {
			grid-template-columns: 1fr;
		}

		.ds-field-wide {
			grid-column: span 1;
		}
	}

	/* ─── 07 · Pills ───────────────────────────────────────────────── */
	.ds-pill-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-bottom: var(--space-4);
		border-bottom: 1px solid var(--border-hairline);
	}

	.ds-pill-block:last-child {
		border-bottom: none;
	}

	.ds-pill-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
	}

	.ds-block-label {
		color: var(--text-muted);
	}

	/* ─── 08 · Status & progress (asymmetric bento) ────────────────── */
	.ds-bento-status {
		grid-template-columns: repeat(6, 1fr);
		grid-auto-rows: minmax(120px, auto);
	}

	.ds-status-cell-dots {
		grid-column: span 4;
		grid-row: span 2;
		padding: var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		background: var(--surface-plate);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-plate);
	}

	.ds-status-cell-spinners {
		grid-column: span 2;
		grid-row: span 1;
		padding: var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		background: var(--surface-plate);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-plate);
	}

	.ds-status-cell-progress {
		grid-column: span 2;
		grid-row: span 1;
		padding: var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		background: var(--surface-plate);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-plate);
	}

	.ds-status-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: var(--space-3) var(--space-5);
	}

	.ds-status-cell {
		display: inline-flex;
		gap: var(--space-3);
		align-items: center;
	}

	.ds-spinner-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-5);
		align-items: center;
	}

	.ds-spinner-cell {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: center;
		min-width: 48px;
	}

	.ds-progress-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	@media (max-width: 1024px) {
		.ds-bento-status {
			grid-template-columns: repeat(2, 1fr);
		}

		.ds-status-cell-dots {
			grid-column: span 2;
		}

		.ds-status-cell-spinners,
		.ds-status-cell-progress {
			grid-column: span 1;
		}
	}

	@media (max-width: 768px) {
		.ds-bento-status {
			grid-template-columns: 1fr;
		}

		.ds-status-cell-dots,
		.ds-status-cell-spinners,
		.ds-status-cell-progress {
			grid-column: span 1;
		}
	}

	/* ─── 09 · Avatar ──────────────────────────────────────────────── */
	.ds-avatar-grid {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-7);
		align-items: flex-end;
	}

	.ds-avatar-cell {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: center;
	}

	/* ─── 10 · Panel ───────────────────────────────────────────────── */
	.ds-panel-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--font-size-xl);
		font-variation-settings: 'opsz' 24, 'wght' 420;
		letter-spacing: var(--tracking-snug);
		line-height: var(--leading-tight);
		color: var(--text-prose);
	}

	/* ─── 11 · Empty state ─────────────────────────────────────────── */
	.ds-empty-frame {
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-plate);
		background: var(--surface-plate);
	}

	/* ─── 12 · QuireCard grid (asymmetric) ─────────────────────────── */
	.ds-card-grid {
		display: grid;
		grid-template-columns: 5fr 7fr;
		grid-auto-flow: dense;
		gap: var(--space-5);
	}

	.ds-card-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.ds-card-meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.ds-card-footer {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		margin-top: var(--space-3);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border-hairline);
	}

	@media (max-width: 768px) {
		.ds-card-grid {
			grid-template-columns: 1fr;
		}
	}

	/* ─── 13 · Tooltip ─────────────────────────────────────────────── */
	.ds-tooltip-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		align-items: center;
	}

	/* ─── Footer ───────────────────────────────────────────────────── */
	.ds-footer {
		padding: var(--space-7) 0 var(--space-4);
		border-top: 1px solid var(--border-hairline);
		text-align: center;
	}
</style>
