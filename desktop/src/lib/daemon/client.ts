import type {
	HealthResponse,
	ChatRequest,
	ChatStreamEvent,
	ProviderEntry,
} from './types.js';
import { parseSSEStream } from './sse-parser.js';

export class DaemonClient {
	private baseUrl: string;
	private timeout: number;

	constructor(baseUrl: string = 'http://localhost:1337', timeout: number = 5000) {
		this.baseUrl = baseUrl;
		this.timeout = timeout;
	}

	setBaseUrl(url: string): void {
		this.baseUrl = url;
	}

	getBaseUrl(): string {
		return this.baseUrl;
	}

	async checkHealth(): Promise<HealthResponse> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeout);

		try {
			const response = await fetch(`${this.baseUrl}/health`, {
				signal: controller.signal,
				headers: { 'Accept': 'application/json' },
			});

			if (!response.ok) {
				throw new Error(`Health check failed: HTTP ${response.status}`);
			}

			const data = await response.json() as HealthResponse;
			return data;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	async *streamChat(
		request: ChatRequest,
		signal?: AbortSignal
	): AsyncGenerator<ChatStreamEvent> {
		const response = await fetch(`${this.baseUrl}/api/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'text/event-stream',
			},
			body: JSON.stringify(request),
			signal,
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw new Error(`Chat request failed: HTTP ${response.status} — ${errorText}`);
		}

		if (!response.body) {
			throw new Error('No response body for SSE stream');
		}

		yield* parseSSEStream(response.body);
	}

	async getProviders(): Promise<ProviderEntry[]> {
		// In v1, providers come from the config file (not a daemon API endpoint)
		// This is a placeholder that returns empty — the config service reads them directly
		return [];
	}

	async answerQuestion(
		questionId: string,
		answers: string[]
	): Promise<{ ok: true } | { ok: false; error: string }> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeout);
		try {
			const response = await fetch(`${this.baseUrl}/tools/question/answer/${questionId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ answers }),
				signal: controller.signal,
			});
			if (!response.ok) {
				const text = await response.text().catch(() => `HTTP ${response.status}`);
				return { ok: false, error: text };
			}
			return await response.json() as { ok: true } | { ok: false; error: string };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
		} finally {
			clearTimeout(timeoutId);
		}
	}
}

// Singleton instance — initialized with default URL, updated from settings
let clientInstance: DaemonClient | null = null;

export function getDaemonClient(baseUrl?: string): DaemonClient {
	if (!clientInstance) {
		clientInstance = new DaemonClient(baseUrl);
	} else if (baseUrl && baseUrl !== clientInstance.getBaseUrl()) {
		clientInstance.setBaseUrl(baseUrl);
	}
	return clientInstance;
}
