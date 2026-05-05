// Chat history persistence via Tauri Store.
//
// The /api/chat endpoint is stateless — messages are never written to
// the daemon DB. We persist them ourselves in a local Tauri Store file,
// keyed by sessionId. This gives us session restore without any daemon
// changes.
//
// Storage format:
//   chat-history.json → { [sessionId]: SerializedMessage[] }
//
// We serialize only the fields we need to reconstruct the display —
// full ContentBlock trees are stored so tool cards re-render correctly.

// @tauri-apps/plugin-store is loaded dynamically to avoid Vite pre-bundling
// Tauri-specific modules, which causes 504 errors in dev mode.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type TauriStore = Awaited<ReturnType<typeof import('@tauri-apps/plugin-store').Store.load>>;
import type { ChatMessage, ContentBlock } from '../../features/chat/types.js';

const STORE_FILE = 'chat-history.json';
// Cap per session so the store doesn't grow unbounded.
const MAX_MESSAGES_PER_SESSION = 200;

// A serializable snapshot of a single message.
interface SerializedMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	blocks?: ContentBlock[];
	timestamp: string; // ISO string
}

let store: TauriStore | null = null;

async function getStore(): Promise<TauriStore | null> {
	if (!store) {
		try {
			const { Store } = await import('@tauri-apps/plugin-store');
			store = await Store.load(STORE_FILE);
		} catch {
			return null;
		}
	}
	return store;
}

function serialize(msg: ChatMessage): SerializedMessage | null {
	if (msg.role !== 'user' && msg.role !== 'assistant') return null;
	if (msg.isStreaming) return null; // never persist incomplete messages
	return {
		id: msg.id,
		role: msg.role,
		content: msg.content,
		blocks: msg.blocks,
		timestamp: msg.timestamp instanceof Date
			? msg.timestamp.toISOString()
			: String(msg.timestamp),
	};
}

function deserialize(s: SerializedMessage): ChatMessage {
	return {
		id: s.id,
		role: s.role,
		content: s.content,
		blocks: s.blocks,
		timestamp: new Date(s.timestamp),
	};
}

/**
 * Persist the current message list for a session.
 * Silently swallows errors — history is best-effort.
 */
export async function saveSessionHistory(
	sessionId: string,
	messages: ChatMessage[],
): Promise<void> {
	try {
		const s = await getStore();
		if (!s) return;
		const serialized = messages
			.map(serialize)
			.filter((m): m is SerializedMessage => m !== null)
			.slice(-MAX_MESSAGES_PER_SESSION);
		await s.set(sessionId, serialized);
		await s.save();
	} catch {
		// Best-effort — never crash the app over history persistence
	}
}

/**
 * Load the persisted message list for a session.
 * Returns [] if nothing is stored or on any error.
 */
export async function loadSessionHistory(sessionId: string): Promise<ChatMessage[]> {
	try {
		const s = await getStore();
		if (!s) return [];
		const raw = await s.get<SerializedMessage[]>(sessionId);
		if (!Array.isArray(raw)) return [];
		return raw.map(deserialize);
	} catch {
		return [];
	}
}
