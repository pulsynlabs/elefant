// Approval store (Svelte 5 runes)
//
// Manages the queue of pending tool-call approval requests coming from the
// daemon over WebSocket, plus a short decision history. The store owns the
// `ApprovalChannel` lifecycle so components only need to call `connect()` on
// mount and invoke the returned disposer on unmount.

import type { ApprovalRequest, ApprovalChannel } from '$lib/daemon/approvals.js';
import { connectApprovals } from '$lib/daemon/approvals.js';
import { DAEMON_URL } from '$lib/daemon/client.js';

export interface ApprovalDecision {
	requestId: string;
	tool: string;
	approved: boolean;
	reason?: string;
	timestamp: number;
}

const HISTORY_LIMIT = 50;

let pending = $state<ApprovalRequest[]>([]);
let history = $state<ApprovalDecision[]>([]);
let connectedConversationId = $state<string | null>(null);
let channel: ApprovalChannel | null = null;

function add(req: ApprovalRequest): void {
	// De-dupe by requestId in case the daemon replays.
	if (pending.some((r) => r.requestId === req.requestId)) return;
	pending = [...pending, req];
}

function respond(requestId: string, approved: boolean, reason?: string): void {
	const req = pending.find((r) => r.requestId === requestId);
	channel?.respond(requestId, approved, reason);
	pending = pending.filter((r) => r.requestId !== requestId);
	history = [
		{
			requestId,
			tool: req?.tool ?? 'unknown',
			approved,
			reason,
			timestamp: Date.now(),
		},
		...history,
	].slice(0, HISTORY_LIMIT);
}

function connect(conversationId: string): () => void {
	// Tear down any prior connection before joining a new conversation room.
	channel?.close();
	channel = connectApprovals(DAEMON_URL, conversationId, {
		onRequest: (req) => add(req),
		onError: (err) => {
			// Surface to console for now; a future toast layer can subscribe.
			console.error('[approvals] WebSocket error:', err.message);
		},
		onClose: () => {
			if (connectedConversationId === conversationId) {
				connectedConversationId = null;
			}
		},
	});
	connectedConversationId = conversationId;

	return () => {
		channel?.close();
		channel = null;
		connectedConversationId = null;
	};
}

function clear(): void {
	pending = [];
}

export const approvalsStore = {
	get pending() {
		return pending;
	},
	get history() {
		return history;
	},
	get connectedConversationId() {
		return connectedConversationId;
	},
	get isConnected() {
		return channel?.isOpen ?? false;
	},
	add,
	respond,
	connect,
	clear,
};
