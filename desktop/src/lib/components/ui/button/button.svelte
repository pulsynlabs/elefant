<script lang="ts">
	import { Button as ButtonPrimitive } from "bits-ui";
	import { buttonVariants, type Props } from "./index.js";
	import { cn } from "$lib/utils.js";
	import { Spinner } from "../spinner/index.js";

	let {
		class: className = "",
		variant = "default",
		size = "default",
		loading = false,
		disabled,
		children,
		...restProps
	}: Props & { children?: import("svelte").Snippet } = $props();

	// Loading implies disabled to prevent duplicate clicks.
	const isDisabled = $derived(loading || disabled);

	// Spinner tone follows variant — primary buttons use white-ish (foreground),
	// everything else falls back to the spinner's own primary tone.
	const spinnerTone = $derived(variant === "default" || variant === "destructive" ? "muted" : "primary");
</script>

<!-- Trailing-icon nested pill ("button-in-button" pattern, high-end-visual-design §4B):
     deferred to design-system showcase pass to keep the consumer API stable. -->

<ButtonPrimitive.Root
	class={cn(buttonVariants({ variant, size }), "btn-quire", className)}
	disabled={isDisabled}
	aria-busy={loading || undefined}
	{...restProps}
>
	{#if loading}
		<span class="btn-spinner" aria-hidden="true">
			<Spinner size={size === "lg" ? "md" : "sm"} tone={spinnerTone} />
		</span>
	{/if}
	<span class="btn-content" class:btn-content-hidden={loading}>
		{@render children?.()}
	</span>
</ButtonPrimitive.Root>

<style>
	/* Width-stable loading: the content keeps its dimensions but is
	   visually hidden, while the spinner is layered on top. This avoids
	   the layout shift that a content-replacement loading state causes. */
	.btn-quire {
		position: relative;
		font-variation-settings: "opsz" 14, "wght" 500;
		letter-spacing: var(--tracking-snug);
	}

	.btn-content {
		display: inline-flex;
		align-items: center;
		gap: inherit;
	}

	.btn-content-hidden {
		visibility: hidden;
	}

	.btn-spinner {
		position: absolute;
		inset: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
	}
</style>
