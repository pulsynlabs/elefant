/**
 * Svelte action that keeps a {@link TerminalRenderer} in sync with the
 * pixel size of its host element. Wraps a `ResizeObserver` so the parent
 * component does not have to manage one inline.
 *
 * Usage:
 * ```svelte
 * <div class="terminal-container" use:terminalResize={renderer}></div>
 * ```
 *
 * The action argument is the current renderer (or `null` while it is
 * still loading). When the argument changes — e.g. after async
 * `createRenderer` resolves — the action's `update` is called and
 * subsequent observer ticks dispatch to the new renderer.
 *
 * Why an action and not a `$effect`:
 *   - Keeps DOM-lifecycle concerns (observer attach/detach) co-located
 *     with the element they govern.
 *   - Survives Svelte 5 fine-grained re-renders without re-creating the
 *     observer on every reactive read.
 *   - Lets the host component stay declarative: bind the element ref,
 *     pass the renderer, done.
 */

import type { Action } from 'svelte/action';

import type { TerminalRenderer } from './renderer.js';

type TerminalResizeParam = TerminalRenderer | null;

export const terminalResize: Action<HTMLElement, TerminalResizeParam> = (node, initial) => {
	let current: TerminalResizeParam = initial ?? null;

	// rAF-throttle to coalesce bursts of ResizeObserver entries (e.g. when
	// the panel slides open and the layout reflows several times). One
	// fit per frame is plenty for a terminal grid.
	let rafId: number | null = null;
	const schedule = () => {
		if (rafId !== null) return;
		rafId = requestAnimationFrame(() => {
			rafId = null;
			current?.fit();
		});
	};

	const observer = new ResizeObserver(() => {
		schedule();
	});
	observer.observe(node);

	return {
		update(next: TerminalResizeParam) {
			current = next ?? null;
			// Fit immediately when a renderer arrives so the first frame
			// already reflects the host's actual size — otherwise users
			// would see the default 80×24 grid until the next resize.
			if (current) schedule();
		},
		destroy() {
			observer.disconnect();
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			current = null;
		},
	};
};
