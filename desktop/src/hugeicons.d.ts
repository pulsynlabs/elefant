// Type declarations for @hugeicons/core-free-icons subpath imports.
// The package exports icon data as default exports from individual modules,
// but only provides types for the barrel import. This declaration covers
// the subpath pattern used by the icon registry.

declare module '@hugeicons/core-free-icons/*' {
	import type { IconSvgElement } from '@hugeicons/svelte';
	const icon: IconSvgElement;
	export default icon;
}
