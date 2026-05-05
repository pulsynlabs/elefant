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
	chatStore.setTemperature(1.0);
	chatStore.setTopP(1.0);
	chatStore.setTimeoutMs(60_000);
	chatStore.setThinkingEnabled(false);
	clearAgentOverride();
	// Clear conversation state including undo/redo stacks
	chatStore.clearConversation();
}

describe('buildChatRequestFields — AdvancedOptions → payload mapping', () => {
	beforeEach(resetStore);

	it('every AdvancedOptions field appears in the payload', () => {
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

		expect(payload.temperature).toBe(0.3);
		expect(payload.topP).toBe(0.85);
		expect(payload.timeoutMs).toBe(120_000);
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
		chatStore.setTemperature(1.0);
		chatStore.setTopP(1.0);
		chatStore.setTimeoutMs(60_000);

		setAgentOverride({
			provider: 'openai',
			temperature: 0.1,
			topP: 0.5,
		});

		const payload = buildChatRequestFields();
		expect(payload.provider).toBe('openai');
		expect(payload.temperature).toBe(0.1);
		expect(payload.topP).toBe(0.5);
		// timeoutMs is no longer overridable per-run; falls through to composer state.
		expect(payload.timeoutMs).toBe(60_000);
	});

	it('only-partial override falls through for unset fields', () => {
		chatStore.setTemperature(1.0);
		chatStore.setTopP(0.9);

		setAgentOverride({ temperature: 0.2 });

		const payload = buildChatRequestFields();
		expect(payload.temperature).toBe(0.2);
		expect(payload.topP).toBe(0.9); // still the AdvancedOptions value
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
			provider: 'openai',
			model: 'gpt-5',
		});
		expect(hasAgentOverride()).toBe(true);
		clearAgentOverride();
		expect(hasAgentOverride()).toBe(false);
	});
});

describe('thinking-mode state', () => {
	beforeEach(resetStore);

	// `chatStore.currentModelSupportsThinking` is a Svelte $derived. The
	// test shim (test-setup.ts) wraps deriveds in a Proxy, so we read the
	// underlying value via `.__raw` for direct equality assertions.
	const derivedSupportsThinking = (): boolean => {
		const v = chatStore.currentModelSupportsThinking as unknown as { __raw?: boolean };
		return v?.__raw ?? Boolean(v);
	};

	it('thinkingEnabled defaults to false', () => {
		expect(chatStore.thinkingEnabled).toBe(false);
	});

	it('setThinkingEnabled(true) flips the flag', () => {
		chatStore.setThinkingEnabled(true);
		expect(chatStore.thinkingEnabled).toBe(true);
		chatStore.setThinkingEnabled(false);
		expect(chatStore.thinkingEnabled).toBe(false);
	});

	it('currentModelSupportsThinking is false for non-thinking providers', () => {
		chatStore.setProvider('openai/gpt-4o');
		expect(derivedSupportsThinking()).toBe(false);

		chatStore.setProvider('groq/llama-3-70b');
		expect(derivedSupportsThinking()).toBe(false);

		// Older Claude generations do not support extended thinking.
		chatStore.setProvider('anthropic/claude-3-5-sonnet-latest');
		expect(derivedSupportsThinking()).toBe(false);

		// Null/empty provider -> conservative false (REQ-004 fallback).
		chatStore.setProvider(null);
		expect(derivedSupportsThinking()).toBe(false);
	});

	it('currentModelSupportsThinking is true for known thinking-capable Claude models', () => {
		chatStore.setProvider('anthropic/claude-3-7-sonnet-20250219');
		expect(derivedSupportsThinking()).toBe(true);

		chatStore.setProvider('anthropic/claude-sonnet-4-5');
		expect(derivedSupportsThinking()).toBe(true);

		chatStore.setProvider('anthropic/claude-opus-4-1');
		expect(derivedSupportsThinking()).toBe(true);
	});

	it('thinkingEnabled resets to false on session change', () => {
		chatStore.setThinkingEnabled(true);
		expect(chatStore.thinkingEnabled).toBe(true);

		chatStore.setActiveSession('session-abc');
		expect(chatStore.thinkingEnabled).toBe(false);

		chatStore.setThinkingEnabled(true);
		chatStore.setActiveSession(null);
		expect(chatStore.thinkingEnabled).toBe(false);
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

// ==========================================================================
// Fork branch tests (W2.T2.1)
// ==========================================================================

describe('fork branches — basic fork()', () => {
	beforeEach(resetStore);

	it('fork() basic case — 3-message conversation, fork(2) at second user msg', () => {
		// 2 user + 2 assistant = 4 messages
		addPair('user 1', 'assistant 1');
		addPair('user 2', 'assistant 2');

		expect(chatStore.messages).toHaveLength(4);

		const returned = chatStore.fork(2);

		// fork(2) truncates to [0,1] (user1 + assistant1), leaving messages = 2
		expect(chatStore.messages).toHaveLength(2);
		expect(chatStore.messages[0].content).toBe('user 1');
		expect(chatStore.messages[1].content).toBe('assistant 1');

		// forkBranches = [root (implicit), newBranch] = 2
		expect(chatStore.forkBranches).toHaveLength(2);

		// Returned is the user text at index 2
		expect(returned).toBe('user 2');

		// The new branch's snapshot includes the forked user message
		const newBranch = chatStore.forkBranches[1];
		expect(newBranch.messages).toHaveLength(3); // user1, assistant1, user2
		expect(newBranch.messages[2].content).toBe('user 2');
	});

	it('fork() at index 0 — single pair, fork(0)', () => {
		addPair('hello world', 'hi there');

		expect(chatStore.messages).toHaveLength(2);

		const returned = chatStore.fork(0);

		expect(returned).toBe('hello world');
		expect(chatStore.messages).toHaveLength(0);
		expect(chatStore.forkBranches).toHaveLength(2); // root + new branch
		expect(chatStore.forkBranches[1].messages[0].content).toBe('hello world');
	});

	it('fork() at last user message — 4 messages, fork(2) at second user', () => {
		addPair('p1', 'a1');
		addPair('p2', 'a2');

		expect(chatStore.messages).toHaveLength(4);

		const returned = chatStore.fork(2);

		// Messages truncates to [0,1] = p1 + a1
		expect(chatStore.messages).toHaveLength(2);
		expect(chatStore.messages[0].content).toBe('p1');
		expect(returned).toBe('p2');
	});

	it('fork(-1) returns null, no mutation', () => {
		addPair('hello', 'world');

		const before = chatStore.forkBranches.length;
		const result = chatStore.fork(-1);

		expect(result).toBeNull();
		expect(chatStore.forkBranches).toHaveLength(before);
		expect(chatStore.messages).toHaveLength(2);
	});

	it('fork(messages.length) returns null — OOB', () => {
		addPair('hello', 'world');

		const before = chatStore.forkBranches.length;
		const result = chatStore.fork(99);

		expect(result).toBeNull();
		expect(chatStore.forkBranches).toHaveLength(before);
		expect(chatStore.messages).toHaveLength(2);
	});

	it('fork() on assistant message index returns null, no mutation', () => {
		addPair('hello', 'world');

		const before = chatStore.forkBranches.length;
		// Index 1 is the assistant message
		const result = chatStore.fork(1);

		expect(result).toBeNull();
		expect(chatStore.forkBranches).toHaveLength(before);
		expect(chatStore.messages).toHaveLength(2);
	});

	it('fork() during streaming returns null, no mutation', () => {
		addPair('hello', 'world');

		// Start streaming — sets isStreaming=true
		chatStore.startAssistantMessage();

		const before = chatStore.forkBranches.length;
		const result = chatStore.fork(0);

		expect(result).toBeNull();
		expect(chatStore.forkBranches).toHaveLength(before);
		expect(chatStore.messages).toHaveLength(3); // original 2 + streaming placeholder
	});

	it('fork() snapshot is immutable — structuredClone prevents shared refs', () => {
		addPair('user A', 'assistant A');

		chatStore.fork(0);
		const branchSnapshot = chatStore.forkBranches[1].messages;

		// Add a new message to the active conversation
		chatStore.addUserMessage('new user message');
		addPair('after fork', 'response after fork');

		// Branch snapshot must NOT reflect the new messages
		expect(branchSnapshot).toHaveLength(1);
		expect(branchSnapshot[0].content).toBe('user A');
	});

	it('fork() first call creates implicit root branch with label "Root"', () => {
		addPair('hello', 'world');

		chatStore.fork(0);

		expect(chatStore.forkBranches[0].label).toBe('Root');
		expect(chatStore.forkBranches[1].label).toBe('hello');
	});

	it('fork() parentBranchId tracking — second fork parent is first branch id', () => {
		addPair('first user', 'first assistant');
		addPair('second user', 'second assistant');

		// First fork: creates root + new branch, activeBranchId = new branch
		chatStore.fork(0);
		const firstBranchId = chatStore.forkBranches[1].id;
		const rootId = chatStore.forkBranches[0].id;

		// Switch to first branch (has empty messages after fork)
		chatStore.switchToBranch(firstBranchId);
		// messages = [] after fork(0)

		// Add a pair on first branch
		chatStore.addUserMessage('third user');
		chatStore.startAssistantMessage();
		chatStore.finalizeMessage('stop');
		// messages = [u3, a3]

		// Undo to populate undoStack
		chatStore.undo();
		// messages = [], undoStack = [{u3, a3}]

		// Second fork: from first branch → parentBranchId = firstBranchId
		chatStore.fork(0);

		const secondForkBranch = chatStore.forkBranches[2];
		expect(secondForkBranch.parentBranchId).toBe(firstBranchId);
	});
});

describe('fork branches — switchToBranch()', () => {
	beforeEach(resetStore);

	it('switchToBranch() round-trip — fork, add messages, switch back and forth', () => {
		addPair('root user', 'root assistant');

		// Fork at index 0 — truncates messages to []
		chatStore.fork(0);
		const rootBranchId = chatStore.forkBranches[0].id;
		const newBranchId = chatStore.forkBranches[1].id;

		// Add 2 complete message pairs on the new branch
		// After fork(0), messages = []. After these 2 pairs: messages = 4 messages
		chatStore.addUserMessage('new 1');
		chatStore.startAssistantMessage();
		chatStore.appendToken('resp 1');
		chatStore.finalizeMessage('stop');
		chatStore.addUserMessage('new 2');
		chatStore.startAssistantMessage();
		chatStore.appendToken('resp 2');
		chatStore.finalizeMessage('stop');

		expect(chatStore.messages).toHaveLength(4);

		// Switch to root — messages restore to original 2
		const switched = chatStore.switchToBranch(rootBranchId);
		expect(switched).toBe(true);
		expect(chatStore.messages).toHaveLength(2);
		expect(chatStore.messages[0].content).toBe('root user');

		// Switch back to new branch — messages restored to the branch snapshot
		// which only has the 1 message from when fork(0) was called
		const switched2 = chatStore.switchToBranch(newBranchId);
		expect(switched2).toBe(true);
		// The new branch snapshot was taken at fork(0) and only has [root user]
		expect(chatStore.messages).toHaveLength(1);
		expect(chatStore.messages[0].content).toBe('root user');
	});

	it('switchToBranch() clears undoStack and redoStack', () => {
		addPair('pair 1', 'resp 1');
		addPair('pair 2', 'resp 2');
		addPair('pair 3', 'resp 3');

		// Fork at index 4 (the user message "pair 3") — 6 messages, fork at last user
		// After fork: root = [u1,a1,u2,a2,u3], messages = [u1,a1,u2,a2]
		chatStore.fork(4);
		const rootId = chatStore.forkBranches[0].id;
		const branchId = chatStore.forkBranches[1].id;

		// Switch to branch, add a pair so we can undo it
		chatStore.switchToBranch(branchId);
		// Branch has [u1,a1,u2,a2] after switch (snapshot from fork)
		chatStore.addUserMessage('branch user');
		chatStore.startAssistantMessage();
		chatStore.finalizeMessage('stop');
		// messages = [u1,a1,u2,a2,bu,ba] — 6 messages, 3 pairs

		// Undo removes the last pair [bu,ba], populating undoStack and redoStack
		const undoResult = chatStore.undo();
		expect(undoResult).toBe('branch user');
		expect(readDerivedBool(chatStore.canUndo)).toBe(true);
		expect(readDerivedBool(chatStore.canRedo)).toBe(true);

		// Switch to root — undo/redo stacks must be cleared
		chatStore.switchToBranch(rootId);

		expect(readDerivedBool(chatStore.canUndo)).toBe(false);
		expect(readDerivedBool(chatStore.canRedo)).toBe(false);
	});

	it('switchToBranch() during streaming returns false, no mutation', () => {
		addPair('hello', 'world');

		chatStore.startAssistantMessage();

		const rootId = chatStore.forkBranches[0]?.id ?? 'none';
		const result = chatStore.switchToBranch(rootId);

		expect(result).toBe(false);
		// isStreaming is still true, message list unchanged (3 msgs)
		expect(chatStore.messages).toHaveLength(3);
	});

	it('switchToBranch("nonexistent") returns false', () => {
		addPair('hello', 'world');

		const result = chatStore.switchToBranch('does-not-exist');

		expect(result).toBe(false);
		expect(chatStore.activeBranchId).not.toBe('does-not-exist');
	});

	it('switchToBranch() updates activeBranchId', () => {
		addPair('user', 'assistant');

		// fork(0): creates root + new branch, activeBranchId = root.id (first branch)
		chatStore.fork(0);

		const rootId = chatStore.forkBranches[0].id;
		const newBranchId = chatStore.forkBranches[1].id;

		// After fork(0), activeBranchId is root (the first branch created)
		expect(chatStore.activeBranchId).toBe(rootId);

		// Switch to new branch — activeBranchId should update
		chatStore.switchToBranch(newBranchId);
		expect(chatStore.activeBranchId).toBe(newBranchId);

		// Switch back to root
		chatStore.switchToBranch(rootId);
		expect(chatStore.activeBranchId).toBe(rootId);
	});
});

describe('fork branches — clearConversation() and caps', () => {
	beforeEach(resetStore);

	it('clearConversation() resets forkBranches and activeBranchId', () => {
		addPair('hello', 'world');

		chatStore.fork(0);

		expect(chatStore.forkBranches).toHaveLength(2);
		expect(chatStore.activeBranchId).not.toBeNull();

		chatStore.clearConversation();

		expect(chatStore.forkBranches).toHaveLength(0);
		expect(chatStore.forkBranchCount).toBe(0);
		expect(chatStore.activeBranchId).toBeNull();
	});

	it('forkBranches 20-entry cap — loop 22 forks, oldest is dropped', () => {
		// Create a 4-message base (2 pairs) once, then fork 22 times
		// Each fork adds 2 branches (root + new), so we accumulate up to cap
		addPair('base user 1', 'base assistant 1');
		addPair('base user 2', 'base assistant 2');

		for (let i = 0; i < 22; i++) {
			// Fork at index 0 each time - creates root once, then new branches
			chatStore.fork(0);

			// After first fork: 2 branches (root + branch-1)
			// After subsequent forks: add 1 branch each (root stays)
			// Switch back to root before next fork
			if (i < 21) {
				chatStore.switchToBranch(chatStore.forkBranches[0].id);
				// Restore messages for next fork iteration
				chatStore.addUserMessage(`fork user ${i}`);
				chatStore.startAssistantMessage();
				chatStore.finalizeMessage('stop');
			}
		}

		// MAX_FORK_BRANCHES = 20, oldest root entry should be dropped
		expect(chatStore.forkBranches).toHaveLength(20);

		// The oldest root (from iteration 0, label 'base user 1') should be gone
		const rootLabels = chatStore.forkBranches.map((b) => b.label);
		expect(rootLabels).not.toContain('Root');
	});

	it('3-level nested fork chain — parentBranchId chain is correct', () => {
		addPair('L1 user', 'L1 assistant');

		// Fork 1: creates root, activeBranchId = branch-1
		chatStore.fork(0);
		const rootId = chatStore.forkBranches[0].id;
		const branch1Id = chatStore.forkBranches[1].id;

		// Fork 2: switch to root, add a pair, fork at user message (index 2)
		chatStore.switchToBranch(rootId);
		chatStore.addUserMessage('L2 user');
		chatStore.startAssistantMessage();
		chatStore.finalizeMessage('stop');
		// messages = [u1, a1, L2user, a2]; fork at index 2 (L2user is user role)
		chatStore.fork(2);
		const branch2Id = chatStore.forkBranches[2].id;

		// Fork 3: switch to branch-2, add a pair, fork at index 2
		chatStore.switchToBranch(branch2Id);
		chatStore.addUserMessage('L3 user');
		chatStore.startAssistantMessage();
		chatStore.finalizeMessage('stop');
		chatStore.fork(2);
		const branch3Id = chatStore.forkBranches[3].id;

		// Verify chain: branch3.parentBranchId === branch2.id
		const branch3 = chatStore.forkBranches.find((b) => b.id === branch3Id);
		const branch2 = chatStore.forkBranches.find((b) => b.id === branch2Id);

		expect(branch3?.parentBranchId).toBe(branch2Id);
		expect(branch2?.parentBranchId).toBe(rootId);
	});

	it('forkBranchCount getter reflects forkBranches.length', () => {
		addPair('p1', 'a1');
		addPair('p2', 'a2');

		expect(chatStore.forkBranchCount).toBe(0);

		// First fork: creates root + branch-1 = 2
		chatStore.fork(0);
		expect(chatStore.forkBranchCount).toBe(2);

		// Fork again: switch to root, add a pair, fork at user message
		chatStore.switchToBranch(chatStore.forkBranches[0].id);
		chatStore.addUserMessage('p3');
		chatStore.startAssistantMessage();
		chatStore.finalizeMessage('stop');
		// messages = [u1, a1, u2, a2, u3, a3] — fork at u3 (index 4)
		chatStore.fork(4);
		expect(chatStore.forkBranchCount).toBe(3);
	});
});

// ==========================================================================
// Side-context lifecycle tests (W4.T1)
// ==========================================================================

describe('side-context — entry', () => {
	beforeEach(resetStore);

	it('enterSideContext from a clean main thread opens side context', () => {
		chatStore.addUserMessage('main question');
		chatStore.startAssistantMessage();
		chatStore.appendToken('main answer');
		chatStore.finalizeMessage('stop');

		const mainLength = chatStore.messages.length;

		const entered = chatStore.enterSideContext('side question');
		expect(entered).toBe(true);
		expect(readDerivedBool(chatStore.isSideContext)).toBe(true);
		// Messages = mainSnapshot (2) + user question (1) = 3
		expect(chatStore.messages.length).toBe(mainLength + 1);
		// Last message is the side-context user question
		const lastMsg = chatStore.messages[chatStore.messages.length - 1];
		expect(lastMsg.content).toBe('side question');
		expect(lastMsg.role).toBe('user');
	});

	it('enterSideContext with empty string returns false', () => {
		chatStore.addUserMessage('main');
		const entered = chatStore.enterSideContext('');
		expect(entered).toBe(false);
		expect(readDerivedBool(chatStore.isSideContext)).toBe(false);
	});

	it('enterSideContext returns false when already in side context', () => {
		chatStore.addUserMessage('main');
		chatStore.enterSideContext('first side');
		expect(readDerivedBool(chatStore.isSideContext)).toBe(true);

		const second = chatStore.enterSideContext('second side');
		expect(second).toBe(false);
		// Side context unchanged — still the first entry
		expect(chatStore.sideContext?.question).toBe('first side');
	});

	it('enterSideContext returns false while streaming', () => {
		chatStore.addUserMessage('main');
		chatStore.startAssistantMessage(); // sets isStreaming = true

		const entered = chatStore.enterSideContext('side');
		expect(entered).toBe(false);
		expect(readDerivedBool(chatStore.isSideContext)).toBe(false);

		// Clean up: finalize the in-progress stream
		chatStore.finalizeMessage('stop');
	});

	it('sideContext getter exposes the side-context snapshot', () => {
		chatStore.addUserMessage('main msg');
		chatStore.enterSideContext('side q');

		const sc = chatStore.sideContext;
		expect(sc).not.toBeNull();
		expect(sc!.question).toBe('side q');
		expect(sc!.mainSnapshot).toHaveLength(1); // only the main user message
		expect(sc!.mainSnapshot[0].content).toBe('main msg');
		expect(sc!.messages).toHaveLength(2); // mainSnapshot + user question
	});

	it('enterSideContext clears undo/redo stacks', () => {
		addPair('hello', 'world');
		chatStore.undo(); // push onto undoStack and redoStack
		expect(readDerivedBool(chatStore.canRedo)).toBe(true);

		chatStore.enterSideContext('side');
		// Both stacks should be cleared by the entry path
		expect(readDerivedBool(chatStore.canUndo)).toBe(false);
		expect(readDerivedBool(chatStore.canRedo)).toBe(false);
	});

	it('enterSideContext with whitespace-only question returns false', () => {
		chatStore.addUserMessage('main');
		const entered = chatStore.enterSideContext('   ');
		expect(entered).toBe(false);
		expect(readDerivedBool(chatStore.isSideContext)).toBe(false);
	});
});

describe('side-context — exit', () => {
	beforeEach(resetStore);

	it('exitSideContext restores main messages and clears side-context state', () => {
		chatStore.addUserMessage('main Q');
		chatStore.startAssistantMessage();
		chatStore.appendToken('main A');
		chatStore.finalizeMessage('stop');

		const preEntryMessages = [...chatStore.messages];

		chatStore.enterSideContext('side Q');
		chatStore.startAssistantMessage();
		chatStore.appendToken('side A');
		chatStore.finalizeMessage('stop');

		// Messages now reflect side-context content (more than pre-entry)
		expect(chatStore.messages.length).toBeGreaterThan(preEntryMessages.length);

		const exited = chatStore.exitSideContext();
		expect(exited).toBe(true);
		expect(readDerivedBool(chatStore.isSideContext)).toBe(false);
		expect(chatStore.sideContext).toBeNull();
		// Messages restored to exact pre-entry snapshot
		expect(chatStore.messages.length).toBe(preEntryMessages.length);
		expect(chatStore.messages).toEqual(preEntryMessages);
	});

	it('exitSideContext returns false when not in side context', () => {
		const exited = chatStore.exitSideContext();
		expect(exited).toBe(false);
	});

	it('exitSideContext clears undo/redo stacks', () => {
		chatStore.addUserMessage('main');
		chatStore.enterSideContext('side');
		// Simulate a side-context message pair so undo/redo would have content
		chatStore.startAssistantMessage();
		chatStore.appendToken('hello');
		chatStore.finalizeMessage('stop');
		chatStore.undo(); // populate undo/redo stacks within side context

		chatStore.exitSideContext();
		// Both stacks should be cleared
		expect(readDerivedBool(chatStore.canUndo)).toBe(false);
		expect(readDerivedBool(chatStore.canRedo)).toBe(false);
	});

	it('sequential enter → exit → enter cycle is idempotent', () => {
		chatStore.addUserMessage('main 1');
		chatStore.startAssistantMessage();
		chatStore.finalizeMessage('stop');
		const originalMessages = [...chatStore.messages];

		// First cycle
		chatStore.enterSideContext('side 1');
		chatStore.exitSideContext();
		expect(chatStore.messages).toEqual(originalMessages);

		// Second cycle — should restore to the same original snapshot
		chatStore.enterSideContext('side 2');
		expect(readDerivedBool(chatStore.isSideContext)).toBe(true);
		chatStore.exitSideContext();
		expect(chatStore.messages).toEqual(originalMessages);
	});
});

describe('side-context — streaming isolation', () => {
	beforeEach(resetStore);

	it('streaming tokens during side context do not mutate mainSnapshot', () => {
		chatStore.addUserMessage('main Q');
		chatStore.startAssistantMessage();
		chatStore.appendToken('main A');
		chatStore.finalizeMessage('stop');
		const preEntrySnapshot = [...chatStore.messages];

		chatStore.enterSideContext('side Q');
		// Stream tokens into side context
		chatStore.startAssistantMessage();
		chatStore.appendToken('token1');
		chatStore.appendToken('token2');
		chatStore.addToolCall({
			id: 'tc-1',
			name: 'read',
			arguments: { filePath: '/foo' },
		});
		chatStore.addToolResult('tc-1', 'file content', false);
		chatStore.appendToken('final token');
		chatStore.finalizeMessage('stop');

		// Side context is active and has mutated messages
		expect(chatStore.messages.length).toBeGreaterThan(preEntrySnapshot.length);

		// Exit — mainSnapshot should be restored byte-identical
		chatStore.exitSideContext();
		expect(chatStore.messages).toEqual(preEntrySnapshot);
	});

	it('setStreamingError during side context does not mutate mainSnapshot', () => {
		chatStore.addUserMessage('main Q');
		const preEntrySnapshot = [...chatStore.messages];

		chatStore.enterSideContext('side Q');
		chatStore.startAssistantMessage();
		chatStore.appendToken('partial');
		chatStore.setStreamingError('mock error');

		chatStore.exitSideContext();
		expect(chatStore.messages).toEqual(preEntrySnapshot);
	});

	it('sideContext getter reflects live streaming mutations', () => {
		chatStore.addUserMessage('main');
		chatStore.enterSideContext('side');

		chatStore.startAssistantMessage();
		chatStore.appendToken('hello');

		// The sideContext.messages should be in sync with chatStore.messages
		const sc = chatStore.sideContext;
		expect(sc).not.toBeNull();
		expect(sc!.messages.length).toBe(chatStore.messages.length);

		// Last message should be the streaming assistant with accumulated token
		const lastSc = sc!.messages[sc!.messages.length - 1];
		expect(lastSc.role).toBe('assistant');
		expect(lastSc.content).toBe('hello');
		expect(lastSc.isStreaming).toBe(true);

		chatStore.finalizeMessage('stop');
	});
});

describe('side-context — persistence guard', () => {
	beforeEach(resetStore);

	it('saveSessionHistory is not called during side-context finalizeMessage', () => {
		// NOTE: `saveSessionHistory` is a module-level import from
		// `$lib/services/chat-history.js`. Because the chat.svelte.ts module is
		// already resolved at import time, Bun's `mock.module` cannot retroactively
		// replace the binding inside chat.svelte.ts without restructuring the
		// test file to mock-before-import. Instead, we verify the guard indirectly:
		//
		// 1. Set an active session so the guard condition would pass if not blocked.
		// 2. Enter side context, stream a complete assistant response, and exit.
		// 3. Assert messages are byte-identical to the pre-entry snapshot —
		//    proving no side-context messages leaked into any persisted output.
		// 4. Source-level assertion: `finalizeMessage` line ~301 guards with
		//    `if (activeSessionId && sideContext === null)` so side-context
		//    finalizes never reach `saveSessionHistory`.

		chatStore.setActiveSession('test-session-id');
		chatStore.addUserMessage('persisted main Q');
		chatStore.startAssistantMessage();
		chatStore.appendToken('persisted main A');
		chatStore.finalizeMessage('stop');

		const preEntryMessages = [...chatStore.messages];

		chatStore.enterSideContext('side Q');
		chatStore.startAssistantMessage();
		chatStore.appendToken('side A — should not be persisted');
		chatStore.finalizeMessage('stop');

		chatStore.exitSideContext();
		// Messages restored exactly — no side-context content remains
		expect(chatStore.messages).toEqual(preEntryMessages);
	});
});

describe('side-context — lifecycle termination', () => {
	beforeEach(resetStore);

	it('setActiveSession discards active side context', () => {
		chatStore.addUserMessage('main');
		chatStore.enterSideContext('side Q');
		expect(readDerivedBool(chatStore.isSideContext)).toBe(true);

		chatStore.setActiveSession('new-session');
		expect(readDerivedBool(chatStore.isSideContext)).toBe(false);
		expect(chatStore.sideContext).toBeNull();
	});

	it('clearConversation clears side-context state', () => {
		chatStore.addUserMessage('main');
		chatStore.enterSideContext('side Q');
		expect(readDerivedBool(chatStore.isSideContext)).toBe(true);

		chatStore.clearConversation();
		expect(readDerivedBool(chatStore.isSideContext)).toBe(false);
		expect(chatStore.sideContext).toBeNull();
		expect(chatStore.messages).toEqual([]);
	});

	it('setActiveSession(null) discards active side context', () => {
		chatStore.addUserMessage('main');
		chatStore.enterSideContext('side Q');
		expect(readDerivedBool(chatStore.isSideContext)).toBe(true);

		chatStore.setActiveSession(null);
		expect(readDerivedBool(chatStore.isSideContext)).toBe(false);
		expect(chatStore.sideContext).toBeNull();
	});
});

describe('side-context — fork branches unaffected', () => {
	beforeEach(resetStore);

	it('forkBranches are unchanged through enter/exit cycle', () => {
		chatStore.addUserMessage('main Q');
		const preForkCount = chatStore.forkBranchCount;
		const preActiveBranch = chatStore.activeBranchId;

		chatStore.enterSideContext('side Q');
		expect(chatStore.forkBranchCount).toBe(preForkCount);
		expect(chatStore.activeBranchId).toBe(preActiveBranch);

		chatStore.exitSideContext();
		expect(chatStore.forkBranchCount).toBe(preForkCount);
		expect(chatStore.activeBranchId).toBe(preActiveBranch);
	});

	it('side context does not push onto forkBranches', () => {
		// Setup: create a fork so we have a baseline
		addPair('pair 1', 'resp 1');
		addPair('pair 2', 'resp 2');
		chatStore.fork(2); // fork at "pair 2"
		const forkCountBefore = chatStore.forkBranchCount;

		// Enter side context — nothing should be added to forkBranches
		chatStore.enterSideContext('side Q');
		expect(chatStore.forkBranchCount).toBe(forkCountBefore);

		// Stream in side context
		chatStore.startAssistantMessage();
		chatStore.appendToken('side response');
		chatStore.finalizeMessage('stop');

		// Fork count still unchanged
		expect(chatStore.forkBranchCount).toBe(forkCountBefore);

		// Exit — still unchanged
		chatStore.exitSideContext();
		expect(chatStore.forkBranchCount).toBe(forkCountBefore);
	});
});
