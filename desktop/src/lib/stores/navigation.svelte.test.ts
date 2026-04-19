import { describe, it, expect, beforeEach } from 'bun:test';
import { navigationStore, initNavigation } from './navigation.svelte.js';
import { projectsStore, _setActiveProjectId, _setActiveSessionId, resetProjectsStore } from './projects.svelte.js';

// Test harness for navigation store
// Covers MH2: child-run stack navigation (openChildRun / backToParent)

describe('navigationStore', () => {
	beforeEach(() => {
		// Reset stores to known state
		resetProjectsStore();
		initNavigation({ getActiveProjectId: () => null });
	});

	describe('child-run stack navigation', () => {
		it('openChildRun sets currentView to child-run and currentChildRunId', () => {
			expect(navigationStore.current).toBe('projects');
			expect(navigationStore.currentChildRunId).toBeNull();

			navigationStore.openChildRun('r1');

			expect(navigationStore.current).toBe('child-run');
			expect(navigationStore.currentChildRunId).toBe('r1');
		});

		it('openChildRun nests: pushing r2 after r1 stacks both', () => {
			navigationStore.openChildRun('r1');
			navigationStore.openChildRun('r2');

			expect(navigationStore.current).toBe('child-run');
			expect(navigationStore.currentChildRunId).toBe('r2');
		});

		it('backToParent pops one from stack, returning to previous child', () => {
			navigationStore.openChildRun('r1');
			navigationStore.openChildRun('r2');

			navigationStore.backToParent();

			expect(navigationStore.current).toBe('child-run');
			expect(navigationStore.currentChildRunId).toBe('r1');
		});

		it('backToParent from stack length 1 returns to chat view and clears stack', () => {
			navigationStore.openChildRun('r1');
			expect(navigationStore.current).toBe('child-run');

			navigationStore.backToParent();

			expect(navigationStore.current).toBe('chat');
			expect(navigationStore.currentChildRunId).toBeNull();
		});

		it('switching session clears the child run stack', () => {
			// Set up a project and session
			_setActiveProjectId('p1');
			_setActiveSessionId('s1');

			// Open a child run
			navigationStore.openChildRun('r1');
			expect(navigationStore.currentChildRunId).toBe('r1');

			// Switch session
			_setActiveSessionId('s2');

			// Stack should be cleared
			expect(navigationStore.currentChildRunId).toBeNull();
		});

		it('multiple backToParent calls handle edge cases gracefully', () => {
			// Empty stack - backToParent should go to chat
			navigationStore.navigate('settings');
			navigationStore.backToParent();
			expect(navigationStore.current).toBe('chat');
			expect(navigationStore.currentChildRunId).toBeNull();
		});

		it('deep nesting: 3-level stack works correctly', () => {
			navigationStore.openChildRun('r1');
			navigationStore.openChildRun('r2');
			navigationStore.openChildRun('r3');

			expect(navigationStore.currentChildRunId).toBe('r3');

			navigationStore.backToParent();
			expect(navigationStore.currentChildRunId).toBe('r2');

			navigationStore.backToParent();
			expect(navigationStore.currentChildRunId).toBe('r1');

			navigationStore.backToParent();
			expect(navigationStore.current).toBe('chat');
			expect(navigationStore.currentChildRunId).toBeNull();
		});
	});

	describe('existing navigation methods', () => {
		it('navigate changes current view', () => {
			navigationStore.navigate('settings');
			expect(navigationStore.current).toBe('settings');
		});

		it('isActive returns true for current view', () => {
			navigationStore.navigate('chat');
			expect(navigationStore.isActive('chat')).toBe(true);
			expect(navigationStore.isActive('settings')).toBe(false);
		});

		it('goToProjectPicker sets view to projects', () => {
			navigationStore.navigate('chat');
			navigationStore.goToProjectPicker();
			expect(navigationStore.current).toBe('projects');
		});
	});
});
