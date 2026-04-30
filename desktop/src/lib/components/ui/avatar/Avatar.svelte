<script lang="ts">
	import type { Snippet } from 'svelte';

	type Size = 'sm' | 'md' | 'lg';
	type Shape = 'square' | 'circle';

	type Props = {
		/** User's display name — first letter is used for the monogram fallback. */
		name?: string;
		/** Image source. Falls back to monogram on error. */
		src?: string;
		alt?: string;
		/** Legacy: explicit initials override (preserves existing API). */
		initials?: string;
		size?: Size;
		/** Default 'square' is the Quire-distinctive variant; 'circle' is traditional. */
		shape?: Shape;
		/** Optional snippet rendered as a status dot at the bottom-right corner. */
		dot?: Snippet;
		class?: string;
	};

	let {
		name,
		src,
		alt,
		initials,
		size = 'md',
		shape = 'square',
		dot,
		class: className = '',
	}: Props = $props();

	const sizes: Record<Size, string> = { sm: '24px', md: '32px', lg: '48px' };
	const fontSizes: Record<Size, string> = {
		sm: '11px',
		md: '14px',
		lg: '20px',
	};

	let imgError = $state(false);

	const showImage = $derived(!!src && !imgError);

	const monogram = $derived(
		(initials ??
			(name ? name.trim().charAt(0).toUpperCase() : '') ??
			'')
			.slice(0, 2)
			.toUpperCase()
	);

	const ariaLabel = $derived(alt ?? name ?? 'Avatar');
</script>

<span
	class="avatar quire-sm shape-{shape} size-{size} {className}"
	style="--avatar-size: {sizes[size]}; --avatar-font: {fontSizes[size]};"
	aria-label={ariaLabel}
	role="img"
>
	{#if showImage}
		<img
			class="avatar-img"
			{src}
			alt={alt ?? ''}
			loading="lazy"
			onerror={() => (imgError = true)}
		/>
	{:else}
		<span class="avatar-monogram" aria-hidden="true">{monogram || '·'}</span>
	{/if}

	{#if dot}
		<span class="avatar-dot">{@render dot()}</span>
	{/if}
</span>

<style>
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--avatar-size);
		height: var(--avatar-size);
		flex-shrink: 0;
		overflow: hidden;
		position: relative;
		isolation: isolate;
	}

	.shape-square {
		border-radius: var(--radius-fold);
	}

	.shape-circle {
		border-radius: 50%;
	}

	.avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.avatar-monogram {
		font-family: var(--font-display);
		font-style: italic;
		font-weight: var(--font-weight-regular);
		font-size: var(--avatar-font);
		color: var(--text-muted);
		font-variation-settings: "opsz" 24, "wght" 400;
		line-height: 1;
		user-select: none;
	}

	.avatar-dot {
		position: absolute;
		right: 0;
		bottom: 0;
		display: inline-flex;
		/* Keep the dot fully visible on rounded corners. */
		transform: translate(15%, 15%);
		z-index: 2;
		pointer-events: none;
	}
</style>
