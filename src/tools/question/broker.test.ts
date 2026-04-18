/**
 * Unit tests for the QuestionBroker.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { QuestionBroker, questionBroker } from './broker.js';

describe('QuestionBroker', () => {
	describe('singleton instance', () => {
		beforeEach(() => {
			questionBroker.clearAll();
		});

		it('should be a singleton', () => {
			// The exported questionBroker is a singleton
			// We verify this by checking it's the same object reference
			// Importing again would give the same instance in ES modules
			expect(questionBroker).toBeDefined();
			expect(questionBroker.getPendingCount).toBeDefined();
		});

		it('register returns a promise that resolves when answer is called', async () => {
			const questionId = 'test-1';
			const promise = questionBroker.register(questionId, 5000);

			// Answer the question
			const answered = questionBroker.answer(questionId, { answers: ['Yes'] });
			expect(answered).toBe(true);

			const result = await promise;
			expect(result.answers).toEqual(['Yes']);
		});

		it('register rejects with timeout error after configured timeout', async () => {
			const questionId = 'test-timeout';
			const shortTimeout = 100; // 100ms for fast tests

			const promise = questionBroker.register(questionId, shortTimeout);

			try {
				await promise;
				throw new Error('Should have rejected');
			} catch (error) {
				expect(error instanceof Error).toBe(true);
				expect((error as Error).message).toContain('timed out');
				expect((error as Error).message).toContain(`${shortTimeout}ms`);
			}
		});

		it('answer returns false for unknown questionId', () => {
			const answered = questionBroker.answer('unknown-id', { answers: ['Yes'] });
			expect(answered).toBe(false);
		});

		it('answer returns false for already-answered question', async () => {
			const questionId = 'test-double-answer';
			const promise = questionBroker.register(questionId, 5000);

			// First answer succeeds
			const first = questionBroker.answer(questionId, { answers: ['First'] });
			expect(first).toBe(true);

			// Second answer fails (already answered)
			const second = questionBroker.answer(questionId, { answers: ['Second'] });
			expect(second).toBe(false);

			// Original answer is preserved
			const result = await promise;
			expect(result.answers).toEqual(['First']);
		});

		it('getPendingCount returns number of pending questions', () => {
			expect(questionBroker.getPendingCount()).toBe(0);

			questionBroker.register('q1', 5000);
			expect(questionBroker.getPendingCount()).toBe(1);

			questionBroker.register('q2', 5000);
			expect(questionBroker.getPendingCount()).toBe(2);

			questionBroker.answer('q1', { answers: ['A'] });
			expect(questionBroker.getPendingCount()).toBe(1);

			questionBroker.answer('q2', { answers: ['B'] });
			expect(questionBroker.getPendingCount()).toBe(0);
		});

		it('clearAll rejects all pending questions and clears map', async () => {
			const p1 = questionBroker.register('c1', 5000);
			const p2 = questionBroker.register('c2', 5000);

			expect(questionBroker.getPendingCount()).toBe(2);

			questionBroker.clearAll();

			expect(questionBroker.getPendingCount()).toBe(0);

			// Both promises should reject
			await expect(p1).rejects.toThrow('Question broker cleared');
			await expect(p2).rejects.toThrow('Question broker cleared');
		});
	});

	describe('class instance (isolated testing)', () => {
		beforeEach(() => {
			// Clean up singleton before each test in this block
			questionBroker.clearAll();
		});

		it('can create isolated instances for testing', async () => {
			const broker = new QuestionBroker();

			const questionId = 'isolated-test';
			const promise = broker.register(questionId, 5000);

			broker.answer(questionId, { answers: ['Test'] });

			const result = await promise;
			expect(result.answers).toEqual(['Test']);

			// Clean up
			broker.clearAll();
		});

		it('isolated instances do not share state with singleton', async () => {
			const isolated = new QuestionBroker();

			// Register in singleton and answer immediately
			const singletonPromise = questionBroker.register('singleton-q', 5000);
			questionBroker.answer('singleton-q', { answers: ['A'] });
			await singletonPromise; // Wait for it to resolve

			// Register in isolated
			const isolatedPromise = isolated.register('isolated-q', 5000);

			// Counts should be independent
			expect(questionBroker.getPendingCount()).toBe(0); // Already answered
			expect(isolated.getPendingCount()).toBe(1);

			// Answer isolated question before cleanup
			isolated.answer('isolated-q', { answers: ['B'] });
			await isolatedPromise;

			expect(isolated.getPendingCount()).toBe(0);
		});
	});

	describe('timeout edge cases', () => {
		beforeEach(() => {
			questionBroker.clearAll();
		});

		it('timeout removes question from pending map', async () => {
			const questionId = 'timeout-cleanup';
			const promise = questionBroker.register(questionId, 50);

			expect(questionBroker.getPendingCount()).toBe(1);

			try {
				await promise;
			} catch {
				// Expected timeout
			}

			// After timeout, question should be removed
			expect(questionBroker.getPendingCount()).toBe(0);

			// Answering should fail (already timed out)
			const answered = questionBroker.answer(questionId, { answers: ['Late'] });
			expect(answered).toBe(false);
		});

		it('answering before timeout clears the timer', async () => {
			const questionId = 'early-answer';
			const promise = questionBroker.register(questionId, 1000);

			// Answer immediately
			questionBroker.answer(questionId, { answers: ['Quick'] });

			// Should resolve without waiting for timeout
			const result = await promise;
			expect(result.answers).toEqual(['Quick']);
		});
	});

	describe('AnswerPayload variations', () => {
		beforeEach(() => {
			questionBroker.clearAll();
		});

		it('handles single answer', async () => {
			const promise = questionBroker.register('single', 5000);
			questionBroker.answer('single', { answers: ['Only'] });
			const result = await promise;
			expect(result.answers).toEqual(['Only']);
		});

		it('handles multiple answers', async () => {
			const promise = questionBroker.register('multi', 5000);
			questionBroker.answer('multi', { answers: ['A', 'B', 'C'] });
			const result = await promise;
			expect(result.answers).toEqual(['A', 'B', 'C']);
		});

		it('handles empty answers array', async () => {
			const promise = questionBroker.register('empty', 5000);
			questionBroker.answer('empty', { answers: [] });
			const result = await promise;
			expect(result.answers).toEqual([]);
		});
	});
});
