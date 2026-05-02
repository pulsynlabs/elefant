// chat.svelte.ts — payload mapping + undo/redo tests.
//
// Task 4.7 audit requirement: every field visible in AdvancedOptions.svelte
// must land in the POST body sent to `/api/chat`. These tests assert the
// field → payload mapping and also verify that AgentOverrideDialog state
// wins over the AdvancedOptions defaults when both are set.
//
// The payload is built by `chatStore.buildChatRequestFields()`, which is
// the sole code path used by ChatView to construct a `ChatRequest`.
//
// Undo/redo tests (W1.T2) verify the chatStore undo/redo state machine:
// pair removal/restoration, stack caps, streaming guards, and redo-clear
// on new user messages. These tests lock the store contract so future
// refactors can't silently regress undo behavior.

import { describe, expect, it, beforeEach } from 'bun:test';
import type { ChatMessage } from './types.js';
import {
	chatStore,
	buildChatRequestFields,
	setAgentOverride,
	clearAgentOverride,
	hasAgentOverride,
} from './chat.svelte.js';

// The AdvancedOptions controls map to these store setters.
// Keep this list in sync with AdvancedOptions.svelte.
const ADVANCED_OPTIONS_FIELDS = [
	'maxIterations',
	'maxTokens',
	'temperature',
	'topP',
	'timeoutMs',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal factory: produce a ChatMessage-shaped user message. */
function makeUserMessage(content: string): ChatMessage {
	return {
		id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
		role: 'user',
		content,
		timestamp: new Date(),
	};
}

/** Minimal factory: produce a ChatMessage-shaped assistant message. */
function makeAssistantMessage(content: string): ChatMessage {
	return {
		id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
		role: 'assistant',
		content,
		blocks: [{ type: 'text', text: content }],
		timestamp: new Date(),
	};
}

/**
 * `canUndo` and `canRedo` are Svelte `$derived` values. The test shim
 * wraps deriveds in a Proxy, so we pull the underlying value via `.__raw`
 * for direct equality / boolean assertions.
 */
function readDerivedBool(proxy: unknown): boolean {
	const v = proxy as { __raw?: boolean };
	return v?.__raw ?? Boolean(v);
}

/** Add a complete user+assistant message pair via the store API. */
function addPair(userContent: string, assistantContent: string): { user: ChatMessage; assistant: ChatMessage } {
	const user = chatStore.addUserMessage(userContent);
	const assistantId = chatStore.startAssistantMessage();
	chatStore.appendToken(assistantContent);
	chatStore.finalizeMessage('stop');

	// After finalizeMessage, the assistant message is the last entry
	const messages = chatStore.messages;
	const assistant = messages[messages.length - 1];
	return { user, assistant };
}

function resetStore(): void {
	// Restore the default values set at module load.
	chatStore.setProvider(null);
	chatStore.setMaxIterations(50);
	chatStore.setMaxTokens(4096);
	chatStore.setTemperature(1.0);
	chatStore.setTopP(1.0);
	chatStore.setTimeoutMs(60_000);
	clearAgentOverride();
	// Clear conversation state including undo/redo stacks
	chatStore.clearConversation();
}

describe('buildChatRequestFields — AdvancedOptions → payload mapping', () => {
	beforeEach(resetStore);

	it('every AdvancedOptions field appears in the payload', () => {
		chatStore.setMaxIterations(75);
		chatStore.setMaxTokens(8192);
		chatStore.setTemperature(0.3);
		chatStore.setTopP(0.85);
		chatStore.setTimeoutMs(120_000);

		const payload = buildChatRequestFields();

		// The field list is exhaustive by construction: if AdvancedOptions
		// sprouts a new field in the future, adding it to the tuple above
		// automatically triggers an assertion here.
		for (const field of ADVANCED_OPTIONS_FIELDS) {
			expect(payload).toHaveProperty(field);
		}

		expect(payload.maxIterations).toBe(75);
		expect(payload.maxTokens).toBe(8192);
		expect(payload.temperature).toBe(0.3);
		expect(payload.topP).toBe(0.85);
		expect(payload.timeoutMs).toBe(120_000);
	});

	it('omits maxTokens when the user leaves it at 0 (provider default)', () => {
		chatStore.setMaxTokens(0);
		const payload = buildChatRequestFields();
		expect(payload.maxTokens).toBeUndefined();
	});

	it('forwards the selected provider, or undefined when none is chosen', () => {
		chatStore.setProvider(null);
		expect(buildChatRequestFields().provider).toBeUndefined();

		chatStore.setProvider('anthropic');
		expect(buildChatRequestFields().provider).toBe('anthropic');
	});

	it('preserves temperature=0 and topP=0 (falsy but valid values)', () => {
		chatStore.setTemperature(0);
		chatStore.setTopP(0);
		const payload = buildChatRequestFields();
		expect(payload.temperature).toBe(0);
		expect(payload.topP).toBe(0);
	});
});

describe('buildChatRequestFields — AgentOverride precedence', () => {
	beforeEach(resetStore);

	it('override fields win over AdvancedOptions fields', () => {
		chatStore.setProvider('anthropic');
		chatStore.setMaxIterations(50);
		chatStore.setMaxTokens(4096);
		chatStore.setTemperature(1.0);
		chatStore.setTopP(1.0);
		chatStore.setTimeoutMs(60_000);

		setAgentOverride({
			provider: 'openai',
			maxIterations: 10,
			maxTokens: 1024,
			temperature: 0.1,
			topP: 0.5,
			timeoutMs: 30_000,
		});

		const payload = buildChatRequestFields();
		expect(payload.provider).toBe('openai');
		expect(payload.maxIterations).toBe(10);
		expect(payload.maxTokens).toBe(1024);
		expect(payload.temperature).toBe(0.1);
		expect(payload.topP).toBe(0.5);
		expect(payload.timeoutMs).toBe(30_000);
	});

	it('only-partial override falls through for unset fields', () => {
		chatStore.setTemperature(1.0);
		chatStore.setTopP(0.9);

		setAgentOverride({ temperature: 0.2 });

		const payload = buildChatRequestFields();
		expect(payload.temperature).toBe(0.2);
		expect(payload.topP).toBe(0.9); // still the AdvancedOptions value
	});

	it('override maxTokens is respected even when AdvancedOptions maxTokens is 0', () => {
		chatStore.setMaxTokens(0);
		setAgentOverride({ maxTokens: 2048 });
		expect(buildChatRequestFields().maxTokens).toBe(2048);
	});

	it('hasAgentOverride is false for empty override, true otherwise', () => {
		clearAgentOverride();
		expect(hasAgentOverride()).toBe(false);
		setAgentOverride({ temperature: 0.5 });
		expect(hasAgentOverride()).toBe(true);
		clearAgentOverride();
		expect(hasAgentOverride()).toBe(false);
	});

	it('clearAgentOverride removes every override field', () => {
		setAgentOverride({
			temperature: 0.1,
			topP: 0.2,
			maxTokens: 100,
			maxIterations: 5,
			timeoutMs: 10_000,
			provider: 'openai',
			model: 'gpt-5',
		});
		expect(hasAgentOverride()).toBe(true);
		clearAgentOverride();
		expect(hasAgentOverride()).toBe(false);
	});
});

describe('AdvancedOptions audit — no dead fields', () => {
	beforeEach(resetStore);

	// This test guards against regressions where a control is added to
	// the AdvancedOptions.svelte form but never reaches the daemon. If
	// this test starts failing, ensure both AdvancedOptions AND
	// buildChatRequestFields were updated together.
	it('every expected AdvancedOptions field is wired through the store', () => {
		const payload = buildChatRequestFields();
		const payloadKeys = Object.keys(payload);
		for (const field of ADVANCED_OPTIONS_FIELDS) {
			expect(payloadKeys).toContain(field);
		}
	});
});

// ==========================================================================
// Undo/redo state machine tests (W1.T2)
// ==========================================================================

describe('undo/redo — empty state', () => {
	beforeEach(resetStore);

	it('undo() on empty messages returns null and is a no-op', () => {
		expect(chatStore.messages).toHaveLength(0);
		expect(readDerivedBool(chatStore.canUndo)).toBe(false);
		expect(readDerivedBool(chatStore.canRedo)).toBe(false);

		const result = chatStore.undo();

		expect(result).toBeNull();
		expect(chatStore.messages).toHaveLength(0);
	});

	it('redo() on empty messages is a no-op (returns false)', () => {
		expect(chatStore.messages).toHaveLength(0);

		const result = chatStore.redo();

		expect(result).toBe(false);
		expect(chatStore.messages).toHaveLength(0);
	});
});

describe('undo/redo — single pair', () => {
	beforeEach(resetStore);

	it('undo() after one pair removes both messages and returns the user text', () => {
		const { user: u } = addPair('hello', 'world');

		expect(chatStore.messages).toHaveLength(2);

		const result = chatStore.undo();

		expect(result).toBe('hello');
		expect(chatStore.messages).toHaveLength(0);
		// The undone pair is now on the redo stack
		expect(readDerivedBool(chatStore.canRedo)).toBe(true);
	});

	it('undo() then redo() restores messages to pre-undo state', () => {
		addPair('hello', 'world');

		const preMessages = chatStore.messages;
		const preLength = preMessages.length;
		const preIds = preMessages.map((m) => m.id);
		const preContents = preMessages.map((m) => m.content);

		// Undo removes the pair
		const undoResult = chatStore.undo();
		expect(undoResult).toBe('hello');
		expect(chatStore.messages).toHaveLength(0);

		// Redo restores it
		const redoResult = chatStore.redo();
		expect(redoResult).toBe(true);
		expect(chatStore.messages).toHaveLength(preLength);

		const postMessages = chatStore.messages;
		expect(postMessages.map((m) => m.id)).toEqual(preIds);
		expect(postMessages.map((m) => m.content)).toEqual(preContents);
	});

	it('redo() with empty redo stack returns false', () => {
		addPair('hello', 'world');

		expect(readDerivedBool(chatStore.canRedo)).toBe(false);
		expect(chatStore.redo()).toBe(false);
		expect(chatStore.messages).toHaveLength(2); // unchanged
	});
});

describe('undo/redo — multi-pair conversation', () => {
	beforeEach(resetStore);

	it('undo 3 times then redo 2 times on a 4-pair conversation', () => {
		addPair('p1', 'a1');
		addPair('p2', 'a2');
		addPair('p3', 'a3');
		addPair('p4', 'a4');

		expect(chatStore.messages).toHaveLength(8); // 4 pairs

		// Undo 3 times — removes pairs 4, 3, 2
		expect(chatStore.undo()).toBe('p4');
		expect(chatStore.undo()).toBe('p3');
		expect(chatStore.undo()).toBe('p2');

		// 1 pair (p1 + a1) remains = 2 messages
		expect(chatStore.messages).toHaveLength(2);
		expect(chatStore.messages[0].content).toBe('p1');
		expect(chatStore.messages[1].content).toBe('a1');

		// Redo 2 times — restores pairs 2, 3
		expect(chatStore.redo()).toBe(true);
		expect(chatStore.redo()).toBe(true);

		// 3 pairs = 6 messages
		expect(chatStore.messages).toHaveLength(6);
		expect(chatStore.messages[0].content).toBe('p1');
		expect(chatStore.messages[1].content).toBe('a1');
		expect(chatStore.messages[2].content).toBe('p2');
		expect(chatStore.messages[3].content).toBe('a2');
		expect(chatStore.messages[4].content).toBe('p3');
		expect(chatStore.messages[5].content).toBe('a3');

		// One more redo entry remains (pair 4)
		expect(readDerivedBool(chatStore.canRedo)).toBe(true);

		// Redo the last one
		expect(chatStore.redo()).toBe(true);
		expect(chatStore.messages).toHaveLength(8);

		// Now redo stack is empty
		expect(readDerivedBool(chatStore.canRedo)).toBe(false);
		expect(chatStore.redo()).toBe(false);
	});
});

describe('undo/redo — redo stack cleared on new message', () => {
	beforeEach(resetStore);

	it('addUserMessage after undo clears the redo stack', () => {
		addPair('hello', 'world');

		// Undo to populate the redo stack
		chatStore.undo();
		expect(readDerivedBool(chatStore.canRedo)).toBe(true);

		// Sending a new message clears the redo stack
		chatStore.addUserMessage('new prompt');
		expect(readDerivedBool(chatStore.canRedo)).toBe(false);
	});

	it('addUserMessage after undo → redo is a no-op', () => {
		addPair('old', 'old-response');

		chatStore.undo();
		chatStore.addUserMessage('new message');

		// Redo should be a no-op because stack was cleared
		expect(chatStore.redo()).toBe(false);
		expect(chatStore.messages).toHaveLength(1); // only the new user message
	});
});

describe('undo/redo — stack cap at 50', () => {
	beforeEach(resetStore);

	it('with 51 pairs, all 51 undos succeed but the 52nd returns null', () => {
		// Create 51 user+assistant pairs (102 messages total)
		for (let i = 1; i <= 51; i++) {
			addPair(`user ${i}`, `assistant ${i}`);
		}

		expect(chatStore.messages).toHaveLength(102);

		// All 51 undos should succeed — each removes the last pair
		for (let i = 0; i < 51; i++) {
			const result = chatStore.undo();
			expect(result).not.toBeNull();
			expect(result).toBe(`user ${51 - i}`);
		}

		// Messages are now empty
		expect(chatStore.messages).toHaveLength(0);

		// 52nd undo has nothing to undo
		expect(chatStore.undo()).toBeNull();
	});

	it('with 55 pairs, all 55 undos and all 55 redos work (only undoStack is capped)', () => {
		// Create 55 pairs (110 messages)
		for (let i = 1; i <= 55; i++) {
			addPair(`u${i}`, `a${i}`);
		}

		expect(chatStore.messages).toHaveLength(110);

		// Undo all 55 pairs — every one should succeed (undo walks messages,
		// not the capped stack)
		for (let i = 0; i < 55; i++) {
			const result = chatStore.undo();
			expect(result).not.toBeNull();
			expect(result).toBe(`u${55 - i}`);
		}

		expect(chatStore.messages).toHaveLength(0);
		expect(chatStore.undo()).toBeNull();

		// The undoStack is capped at 50 entries, but redoStack is NOT capped.
		// All 55 redos should succeed — restoring the full conversation.
		for (let i = 0; i < 55; i++) {
			expect(chatStore.redo()).toBe(true);
		}

		// Full conversation restored
		expect(chatStore.messages).toHaveLength(110);
		expect(readDerivedBool(chatStore.canRedo)).toBe(false);
		expect(chatStore.redo()).toBe(false);
	});
});

describe('undo/redo — streaming guards', () => {
	beforeEach(resetStore);

	it('undo() returns null while isStreaming is true', () => {
		addPair('hello', 'world');

		// Verify undo works normally
		expect(chatStore.undo()).toBe('hello');
		expect(chatStore.messages).toHaveLength(0);

		// Restore the pair
		chatStore.redo();

		// Now start streaming — sets isStreaming=true
		chatStore.startAssistantMessage();

		// undo should be blocked
		expect(chatStore.undo()).toBeNull();
		// Messages unchanged (had 2 from redo + 1 from startAssistant = 3)
		expect(chatStore.messages).toHaveLength(3);
	});

	it('redo() returns false while isStreaming is true', () => {
		addPair('hello', 'world');

		// Populate the redo stack
		chatStore.undo();
		expect(readDerivedBool(chatStore.canRedo)).toBe(true);

		// Start streaming
		chatStore.startAssistantMessage();

		// redo should be blocked
		expect(chatStore.redo()).toBe(false);
		// Messages unchanged (0 from undo + 1 from startAssistant = 1)
		expect(chatStore.messages).toHaveLength(1);
	});

	it('canUndo is false when isStreaming is true, even with undoStack entries', () => {
		addPair('hello', 'world');

		// Populate undoStack by doing an undo
		chatStore.undo();
		// After undo, messages is empty, but undoStack has 1 entry
		// isStreaming is false, so canUndo should be true
		expect(readDerivedBool(chatStore.canUndo)).toBe(true);

		// Start streaming
		chatStore.startAssistantMessage();

		// Now isStreaming is true, so canUndo should be false
		// even though undoStack still has an entry
		expect(readDerivedBool(chatStore.canUndo)).toBe(false);
	});

	it('canRedo is false when isStreaming is true, even with redoStack entries', () => {
		addPair('hello', 'world');

		// Populate redoStack by doing an undo
		chatStore.undo();
		expect(readDerivedBool(chatStore.canRedo)).toBe(true);

		// Start streaming
		chatStore.startAssistantMessage();

		// isStreaming is true → canRedo derived evaluates to false
		expect(readDerivedBool(chatStore.canRedo)).toBe(false);
	});
});
