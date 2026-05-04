import { describe, expect, it } from 'bun:test'
import { FileChangeTracker, normalizePath, type FileChange } from './file-changes.ts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeChange(overrides: Partial<FileChange> = {}): FileChange {
	return {
		path: 'src/foo.ts',
		changeType: 'created',
		absolutePath: '/home/project/src/foo.ts',
		lastTouchedAt: Date.now(),
		...overrides,
	}
}

// ─── normalizePath ────────────────────────────────────────────────────────────

describe('normalizePath', () => {
	it('resolves a file inside the project root to a relative path', () => {
		expect(normalizePath('/home/project/src/foo.ts', '/home/project')).toBe(
			'src/foo.ts',
		)
	})

	it('handles deeply nested paths', () => {
		expect(
			normalizePath('/home/project/a/b/c/d.ts', '/home/project'),
		).toBe('a/b/c/d.ts')
	})

	it('produces a path with ../ when absolute path is outside the project root', () => {
		expect(
			normalizePath('/tmp/elsewhere.ts', '/home/project'),
		).toBe('../../tmp/elsewhere.ts')
	})

	it('returns empty string when paths are identical', () => {
		expect(normalizePath('/home/project', '/home/project')).toBe('')
	})
})

// ─── FileChangeTracker ────────────────────────────────────────────────────────

describe('FileChangeTracker', () => {
	describe('recordChange / getChanges', () => {
		it('records a single change and returns it sorted', () => {
			const tracker = new FileChangeTracker()
			const change = makeChange({ path: 'src/a.ts', lastTouchedAt: 100 })
			tracker.recordChange('s1', change)

			const changes = tracker.getChanges('s1')
			expect(changes).toHaveLength(1)
			expect(changes[0]).toEqual(change)
		})

		it('returns changes sorted by lastTouchedAt descending', () => {
			const tracker = new FileChangeTracker()
			const a = makeChange({ path: 'a.ts', lastTouchedAt: 100 })
			const b = makeChange({ path: 'b.ts', lastTouchedAt: 300 })
			const c = makeChange({ path: 'c.ts', lastTouchedAt: 200 })

			tracker.recordChange('s1', a)
			tracker.recordChange('s1', b)
			tracker.recordChange('s1', c)

			const changes = tracker.getChanges('s1')
			expect(changes.map((ch) => ch.path)).toEqual(['b.ts', 'c.ts', 'a.ts'])
		})

		it('separates changes by sessionId', () => {
			const tracker = new FileChangeTracker()
			tracker.recordChange('s1', makeChange({ path: 'a.ts' }))
			tracker.recordChange('s2', makeChange({ path: 'b.ts' }))

			expect(tracker.getChanges('s1')).toHaveLength(1)
			expect(tracker.getChanges('s2')).toHaveLength(1)
		})

		it('returns an empty array for an unknown session', () => {
			const tracker = new FileChangeTracker()
			expect(tracker.getChanges('nonexistent')).toEqual([])
		})

		it('updates an existing entry for the same path', () => {
			const tracker = new FileChangeTracker()
			const first = makeChange({
				path: 'src/x.ts',
				changeType: 'modified',
				lastTouchedAt: 100,
			})
			const second = makeChange({
				path: 'src/x.ts',
				changeType: 'modified',
				lastTouchedAt: 200,
			})

			tracker.recordChange('s1', first)
			tracker.recordChange('s1', second)

			const changes = tracker.getChanges('s1')
			expect(changes).toHaveLength(1)
			expect(changes[0].lastTouchedAt).toBe(200)
		})
	})

	describe('changeType semantics', () => {
		it('does not downgrade a created entry to modified', () => {
			const tracker = new FileChangeTracker()
			tracker.recordChange(
				's1',
				makeChange({ path: 'x.ts', changeType: 'created', lastTouchedAt: 100 }),
			)
			tracker.recordChange(
				's1',
				makeChange({ path: 'x.ts', changeType: 'modified', lastTouchedAt: 200 }),
			)

			const changes = tracker.getChanges('s1')
			expect(changes[0].changeType).toBe('created')
			// Still updates lastTouchedAt
			expect(changes[0].lastTouchedAt).toBe(200)
		})

		it('allows created to overwrite any prior state', () => {
			const tracker = new FileChangeTracker()
			tracker.recordChange(
				's1',
				makeChange({ path: 'x.ts', changeType: 'modified', lastTouchedAt: 100 }),
			)
			tracker.recordChange(
				's1',
				makeChange({ path: 'x.ts', changeType: 'created', lastTouchedAt: 200 }),
			)

			expect(tracker.getChanges('s1')[0].changeType).toBe('created')
		})
	})

	describe('clearSession', () => {
		it('removes all changes for a session', () => {
			const tracker = new FileChangeTracker()
			tracker.recordChange('s1', makeChange({ path: 'a.ts' }))
			tracker.recordChange('s1', makeChange({ path: 'b.ts' }))

			tracker.clearSession('s1')
			expect(tracker.getChanges('s1')).toEqual([])
		})

		it('is a no-op for an unknown session', () => {
			const tracker = new FileChangeTracker()
			expect(() => tracker.clearSession('ghost')).not.toThrow()
		})

		it('does not affect other sessions', () => {
			const tracker = new FileChangeTracker()
			tracker.recordChange('s1', makeChange({ path: 'a.ts' }))
			tracker.recordChange('s2', makeChange({ path: 'b.ts' }))

			tracker.clearSession('s1')
			expect(tracker.getChanges('s1')).toEqual([])
			expect(tracker.getChanges('s2')).toHaveLength(1)
		})
	})

	describe('eviction cap', () => {
		it('evicts the oldest entry when session exceeds 1000', () => {
			const tracker = new FileChangeTracker()

			// Insert exactly 1000 entries
			for (let i = 0; i < 1000; i++) {
				tracker.recordChange(
					's1',
					makeChange({ path: `src/${i}.ts`, lastTouchedAt: i }),
				)
			}

			expect(tracker.getChanges('s1')).toHaveLength(1000)

			// Insert one more — should evict the oldest (lastTouchedAt: 0)
			tracker.recordChange(
				's1',
				makeChange({ path: 'src/new.ts', lastTouchedAt: 1000 }),
			)

			const changes = tracker.getChanges('s1')
			expect(changes).toHaveLength(1000)

			// The oldest entry (src/0.ts with lastTouchedAt: 0) should be gone
			const paths = new Set(changes.map((c) => c.path))
			expect(paths.has('src/0.ts')).toBe(false)
			expect(paths.has('src/new.ts')).toBe(true)
		})

		it('does not evict when exactly at the cap', () => {
			const tracker = new FileChangeTracker()
			for (let i = 0; i < 1000; i++) {
				tracker.recordChange(
					's1',
					makeChange({ path: `src/${i}.ts`, lastTouchedAt: i }),
				)
			}
			expect(tracker.getChanges('s1')).toHaveLength(1000)
		})
	})

	describe('snapshot field', () => {
		it('stores snapshot when provided', () => {
			const tracker = new FileChangeTracker()
			tracker.recordChange(
				's1',
				makeChange({
					path: 'src/x.ts',
					changeType: 'modified',
					snapshot: 'before edit',
				}),
			)

			expect(tracker.getChanges('s1')[0].snapshot).toBe('before edit')
		})

		it('stores undefined snapshot by default', () => {
			const tracker = new FileChangeTracker()
			tracker.recordChange('s1', makeChange({ snapshot: undefined }))
			expect(tracker.getChanges('s1')[0].snapshot).toBeUndefined()
		})
	})
})
