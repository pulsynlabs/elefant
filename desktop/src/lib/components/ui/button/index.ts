import { tv, type VariantProps } from "tailwind-variants";
import type { Button as ButtonPrimitive } from "bits-ui";
import Root from "./button.svelte";

/**
 * Quire Button Variants
 *
 * Six variants × four sizes. Every visual property is token-driven —
 * background, color, border, and radius all resolve through Quire
 * tokens defined in tokens.css and surface classes in quire.css.
 *
 * Press feedback (`scale(0.98)`) is global via shadcn-overrides.css —
 * not duplicated here. Focus-visible ring is global — not duplicated.
 *
 * The "button-in-button" trailing-icon pattern (high-end-visual-design §4B)
 * is intentionally deferred to a structural showcase pass to keep the
 * consumer-facing API stable in this iteration.
 */
const buttonVariants = tv({
	base: [
		// Layout
		"inline-flex items-center justify-center gap-2 whitespace-nowrap",
		// Type — Geist Sans body, medium weight, snug tracking
		"font-medium",
		// Motion — color/border transitions only; transforms are global
		"transition-[background-color,border-color,color,box-shadow] duration-150 ease-out",
		// Disabled
		"disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
		// Outline reset (focus-visible handled globally)
		"outline-none",
	].join(" "),
	variants: {
		variant: {
			// Default — primary indigo solid. The brand action.
			default: [
				"bg-[var(--color-primary)] text-[var(--color-primary-foreground)]",
				"hover:bg-[var(--color-primary-hover)]",
				"active:bg-[var(--color-primary-pressed)]",
			].join(" "),
			// Secondary — Quire-leaf surface, hairline edge
			secondary: [
				"bg-[var(--surface-leaf)] text-[var(--text-prose)]",
				"border border-[var(--border-edge)]",
				"hover:bg-[var(--surface-hover)] hover:border-[var(--border-emphasis)]",
			].join(" "),
			// Ghost — transparent, surface on hover
			ghost: [
				"bg-transparent text-[var(--text-prose)]",
				"hover:bg-[var(--surface-hover)]",
			].join(" "),
			// Destructive — semantic error
			destructive: [
				"bg-[var(--color-error)] text-white",
				"hover:opacity-90",
			].join(" "),
			// Outline — transparent fill, hairline edge
			outline: [
				"bg-transparent text-[var(--text-prose)]",
				"border border-[var(--border-edge)]",
				"hover:border-[var(--border-emphasis)] hover:bg-[var(--surface-hover)]",
			].join(" "),
			// Link — typographic accent only
			link: [
				"bg-transparent text-[var(--color-primary)]",
				"underline-offset-4 hover:underline",
				"px-0", // links don't get horizontal padding
			].join(" "),
		},
		size: {
			default: "h-9 px-4 text-sm rounded-[var(--radius-leaf)]",
			sm: "h-7 px-3 text-sm rounded-[var(--radius-leaf)]",
			lg: "h-11 px-6 text-base rounded-[var(--radius-plate)]",
			icon: "h-9 w-9 rounded-[var(--radius-leaf)]",
		},
	},
	defaultVariants: {
		variant: "default",
		size: "default",
	},
});

type Variant = VariantProps<typeof buttonVariants>["variant"];
type Size = VariantProps<typeof buttonVariants>["size"];

type Props = ButtonPrimitive.RootProps & {
	variant?: Variant;
	size?: Size;
	loading?: boolean;
};

export { Root, Root as Button, buttonVariants, type Variant, type Size, type Props };
