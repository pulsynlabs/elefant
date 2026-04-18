// WebSocket approval channel
//
// Opens a WebSocket to the daemon at /api/ws, joins the
// `approval:{conversationId}` room, and forwards approval requests to a
// callback. The caller can respond with approve/deny; responses are sent
// over the same socket.
//
// Protocol mirrors `src/transport/ws-protocol.ts` in the daemon.

export interface ApprovalRequest {
	type: 'approval:request';
	requestId: string;
	tool: string;
	args: Record<string, unknown>;
	risk: 'low' | 'medium' | 'high';
	conversationId: string;
	timeoutMs: number;
}

export interface ApprovalCallbacks {
	onRequest: (req: ApprovalRequest) => void;
	onError?: (err: Error) => void;
	onOpen?: () => void;
	onClose?: () => void;
}

export interface ApprovalChannel {
	respond: (requestId: string, approved: boolean, reason?: string) => void;
	close: () => void;
	readonly isOpen: boolean;
}

function toWsUrl(daemonUrl: string): string {
	// Preserves path-prefix daemons (e.g. https://host/elefant) while swapping
	// the scheme. Works for both http:// and https:// inputs.
	return daemonUrl.replace(/^http/, 'ws') + '/api/ws';
}

/**
 * Connect to the daemon's approval WebSocket for a given conversation.
 *
 * The returned channel is immediately usable; writes before OPEN are ignored.
 * Callers are responsible for invoking `close()` on unmount.
 */
export function connectApprovals(
	daemonUrl: string,
	conversationId: string,
	callbacks: ApprovalCallbacks,
): ApprovalChannel {
	const ws = new WebSocket(toWsUrl(daemonUrl));

	ws.onopen = () => {
		// Join the per-conversation approval room so only relevant requests
		// land on this socket.
		try {
			ws.send(JSON.stringify({ type: 'join', room: `approval:${conversationId}` }));
		} catch (err) {
			callbacks.onError?.(err instanceof Error ? err : new Error('send failed'));
		}
		callbacks.onOpen?.();
	};

	ws.onmessage = (e) => {
		try {
			const msg = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data)) as {
				type?: string;
			};
			if (msg.type === 'approval:request') {
				callbacks.onRequest(msg as ApprovalRequest);
			}
			// Ignore pong/event messages — not used by the approval flow.
		} catch {
			// Drop malformed payloads silently.
		}
	};

	ws.onerror = () => {
		callbacks.onError?.(new Error('WebSocket error'));
	};

	ws.onclose = () => {
		callbacks.onClose?.();
	};

	return {
		respond(requestId, approved, reason) {
			if (ws.readyState !== WebSocket.OPEN) return;
			try {
				ws.send(JSON.stringify({
					type: 'approval:response',
					requestId,
					approved,
					reason,
				}));
			} catch (err) {
				callbacks.onError?.(err instanceof Error ? err : new Error('send failed'));
			}
		},
		close() {
			if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
				ws.close();
			}
		},
		get isOpen() {
			return ws.readyState === WebSocket.OPEN;
		},
	};
}
