<script lang="ts">
	import { resolveVizRenderer } from './registry.js';
	import GenericVizCard from './GenericVizCard.svelte';
	import type { VizRendererProps } from './types.js';

	let { envelope }: VizRendererProps = $props();

	const Renderer = $derived(resolveVizRenderer(envelope.type) ?? GenericVizCard);
</script>

<Renderer {envelope} />
