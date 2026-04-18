<script lang="ts">
	// ProjectAvatar — letter badge with deterministic color chosen from the
	// design-system palette. Stable per projectId so a given project always
	// renders with the same color.

	type Props = {
		projectId: string;
		name: string;
		size?: number;
	};

	let { projectId, name, size = 40 }: Props = $props();

	// Six palette slots, all pulled from design-system tokens. We store the
	// CSS custom-property *name* so the avatar responds to theme changes.
	const PALETTE: ReadonlyArray<string> = [
		'var(--color-primary)',
		'var(--color-info)',
		'var(--color-success)',
		'var(--color-warning)',
		'var(--color-error)',
		'var(--color-primary-hover)',
	];

	// Deterministic index from the first character of the project id.
	// Spec: `projectId.charCodeAt(0) % 6`.
	const paletteIndex = $derived(
		projectId.length > 0 ? projectId.charCodeAt(0) % PALETTE.length : 0,
	);

	const background = $derived(PALETTE[paletteIndex]);

	const letter = $derived(
		name.trim().length > 0 ? name.trim().charAt(0).toUpperCase() : '?',
	);

	// Font size scales with the avatar — ~40% of outer size, with a floor.
	const fontSize = $derived(Math.max(12, Math.round(size * 0.4)));
</script>

<span
	class="avatar"
	style="--avatar-size: {size}px; --avatar-font-size: {fontSize}px; --avatar-bg: {background};"
	role="img"
	aria-label="{name} project avatar"
>
	<span class="letter" aria-hidden="true">{letter}</span>
</span>

<style>
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--avatar-size);
		height: var(--avatar-size);
		min-width: var(--avatar-size);
		border-radius: var(--radius-lg);
		background-color: var(--avatar-bg);
		color: var(--color-primary-foreground);
		font-family: var(--font-mono);
		font-weight: var(--font-weight-bold);
		font-size: var(--avatar-font-size);
		line-height: 1;
		letter-spacing: 0;
		user-select: none;
		flex-shrink: 0;
		/* Subtle inner highlight uses the design-system glass token so it
		   adapts to light/dark mode automatically. */
		box-shadow:
			inset 0 1px 0 var(--glass-inner-glow),
			var(--shadow-sm);
	}

	.letter {
		/* Nudge slightly for optical centering across typefaces. */
		transform: translateY(-0.5px);
	}
</style>
