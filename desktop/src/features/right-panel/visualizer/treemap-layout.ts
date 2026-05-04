import {
	hierarchy,
	treemap,
	treemapSquarify,
	type HierarchyRectangularNode,
} from 'd3-hierarchy';
import type { TokenSegment } from '$lib/stores/token-counter.svelte.js';

export interface TreemapRect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	label: string;
	tokens: number;
	percent: number;
	category: TokenSegment['category'];
}

interface TreemapNodeData {
	label: string;
	tokens: number;
	percent: number;
	category: TokenSegment['category'];
	children?: TreemapNodeData[];
}

function aggregateSmall(segments: TokenSegment[]): TokenSegment[] {
	const large = segments.filter((s) => s.percent >= 1);
	const small = segments.filter((s) => s.percent < 1);

	if (small.length === 0) return large;

	const otherTokens = small.reduce((sum, s) => sum + s.tokens, 0);
	const total = segments.reduce((sum, s) => sum + s.tokens, 0);

	return [
		...large,
		{
			category: 'other',
			label: `Other (${small.length})`,
			tokens: otherTokens,
			percent: total > 0 ? (otherTokens / total) * 100 : 0,
		},
	];
}

function sanitizeSegments(segments: TokenSegment[]): TokenSegment[] {
	return segments
		.filter((s) => Number.isFinite(s.tokens) && s.tokens > 0)
		.map((s) => ({
			...s,
			percent: Number.isFinite(s.percent) ? Math.max(0, s.percent) : 0,
		}));
}

export function computeTreemap(
	segments: TokenSegment[],
	width: number,
	height: number,
): TreemapRect[] {
	if (!Array.isArray(segments) || segments.length === 0 || width <= 0 || height <= 0) {
		return [];
	}

	const normalized = sanitizeSegments(segments);
	if (normalized.length === 0) return [];

	const aggregated = aggregateSmall(normalized);
	if (aggregated.length === 0) return [];

	const rootData: TreemapNodeData = {
		label: 'root',
		tokens: aggregated.reduce((sum, segment) => sum + segment.tokens, 0),
		percent: 100,
		category: 'other',
		children: aggregated.map((segment) => ({
			label: segment.label,
			tokens: segment.tokens,
			percent: segment.percent,
			category: segment.category,
		})),
	};

	const root = hierarchy<TreemapNodeData>(rootData)
		.sum((d) => d.tokens)
		.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

	const layout = treemap<TreemapNodeData>()
		.size([width, height])
		.paddingInner(1)
		.paddingOuter(0)
		.round(true)
		.tile(treemapSquarify.ratio(1));

	const treemapRoot = layout(root);

	return (treemapRoot as HierarchyRectangularNode<TreemapNodeData>)
		.leaves()
		.map((leaf): TreemapRect => ({
			x0: leaf.x0,
			y0: leaf.y0,
			x1: leaf.x1,
			y1: leaf.y1,
			label: leaf.data.label,
			tokens: leaf.data.tokens,
			percent: leaf.data.percent,
			category: leaf.data.category,
		}))
		.filter((rect) => rect.x1 > rect.x0 && rect.y1 > rect.y0);
}
