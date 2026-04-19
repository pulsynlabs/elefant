<script lang="ts">
  // LiquidGlassDefs — SVG filter definitions for the Liquid Glass material system.
  // Mount this once at the app root (App.svelte). It injects zero-size SVG that
  // provides #lg-refraction for use in backdrop-filter: url(#lg-refraction).
  // Chromium WebView (Tauri) fully supports SVG backdrop-filter references.
</script>

<svg
	aria-hidden="true"
	focusable="false"
	width="0"
	height="0"
	style="position:absolute;overflow:hidden;pointer-events:none"
>
	<defs>
		<!--
			Rim-masked refraction filter.
			Displacement is constrained to the edge rim (via feMorphology erode + feComposite out).
			The interior stays clean. scale=28 produces gentle lens bending; increase to 40 for
			more dramatic refraction. baseFrequency controls lens field size.
		-->
		<filter
			id="lg-refraction"
			x="-20%"
			y="-20%"
			width="140%"
			height="140%"
			color-interpolation-filters="sRGB"
		>
			<!-- 1. Procedural noise field (slow bends, not grain) -->
			<feTurbulence
				type="fractalNoise"
				baseFrequency="0.008 0.012"
				numOctaves="2"
				seed="2"
				result="noise"
			/>
			<!-- 2. Smooth the noise into a gentle lens field -->
			<feGaussianBlur in="noise" stdDeviation="2" result="noise_smooth" />
			<!-- 3. Displace backdrop pixels -->
			<feDisplacementMap
				in="SourceGraphic"
				in2="noise_smooth"
				scale="28"
				xChannelSelector="R"
				yChannelSelector="G"
				result="displaced"
			/>
			<!-- 4. Build rim mask: erode alpha inward, then subtract to get only the edge band -->
			<feMorphology in="SourceAlpha" operator="erode" radius="10" result="inner" />
			<feComposite in="SourceAlpha" in2="inner" operator="out" result="rim" />
			<feGaussianBlur in="rim" stdDeviation="2" result="rim_soft" />
			<!-- 5. Keep displacement only on rim; keep center clean -->
			<feComposite in="displaced" in2="rim_soft" operator="in" result="displaced_rim" />
			<feComposite in="SourceGraphic" in2="rim_soft" operator="out" result="center" />
			<feBlend in="displaced_rim" in2="center" mode="normal" />
		</filter>
	</defs>
</svg>
