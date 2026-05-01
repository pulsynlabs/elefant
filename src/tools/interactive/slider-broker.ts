/**
 * SliderBroker — singleton for managing pending slider requests.
 * Mirrors the QuestionBroker pattern: register a slider Id, await a promise,
 * resolve when the frontend answers via HTTP route. Times out at 60s.
 */

import type { SliderBrokerPayload } from './types.js';

interface PendingSlider {
	resolve: (payload: SliderBrokerPayload) => void;
	reject: (reason: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class SliderBroker {
	private pending = new Map<string, PendingSlider>();

	/**
	 * Register a new slider request and return a promise that resolves when
	 * answered or rejects on timeout.
	 */
	register(sliderId: string, timeoutMs = 60_000): Promise<SliderBrokerPayload> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(sliderId);
				reject(new Error(`Slider timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(sliderId, { resolve, reject, timer });
		});
	}

	/**
	 * Answer a pending slider by its Id.
	 * Returns true if the slider was found and resolved, false otherwise.
	 */
	answer(sliderId: string, payload: SliderBrokerPayload): boolean {
		const pending = this.pending.get(sliderId);
		if (!pending) return false;
		clearTimeout(pending.timer);
		this.pending.delete(sliderId);
		pending.resolve(payload);
		return true;
	}

	/** Number of pending slider requests (useful for debugging/monitoring). */
	getPendingCount(): number {
		return this.pending.size;
	}

	/** Clear all pending sliders (useful for testing cleanup). */
	clearAll(): void {
		for (const [, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(new Error('Slider broker cleared'));
		}
		this.pending.clear();
	}
}

export const sliderBroker = new SliderBroker();
