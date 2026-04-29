import { describe, expect, test } from 'bun:test';

import { Database } from '../db/database.ts';
import { onDiscoveryComplete } from './spec-memory-hooks.ts';

function makeDatabase(): Database {
	return new Database(':memory:');
}

describe('onDiscoveryComplete', () => {
	test('inserts a memory entry tagged with spec-mode + workflowId concepts', async () => {
		const db = makeDatabase();
		const id = await onDiscoveryComplete(
			'feat-counter',
			{
				vision: 'Reusable counter component',
				mustHaves: [{ mhId: 'MH1', title: 'Increments by 1' }, 'Decrement supported'],
				outOfScope: ['Animations'],
				risks: [{ title: 'Concurrent updates' }],
			},
			db,
		);

		expect(id).not.toBeNull();
		const row = db.db
			.query('SELECT * FROM memory_entries WHERE id = ?')
			.get(id!) as { title: string; content: string; concepts: string; type: string };

		expect(row.title).toBe('Discovery: feat-counter');
		expect(row.type).toBe('note');
		expect(row.content).toContain('Vision:');
		expect(row.content).toContain('MH1 Increments by 1');
		expect(row.content).toContain('Decrement supported');
		expect(row.content).toContain('Out of scope: Animations');
		expect(row.content).toContain('Risks: Concurrent updates');
		expect(row.concepts).toContain('spec-mode');
		expect(row.concepts).toContain('feat-counter');
		expect(row.concepts).toContain('discovery');
		db.close();
	});

	test('returns null when requirements payload is empty', async () => {
		const db = makeDatabase();
		const id = await onDiscoveryComplete('empty-flow', {}, db);
		expect(id).toBeNull();
		db.close();
	});

	test('returns null without throwing when memory_entries table is absent', async () => {
		const db = makeDatabase();
		// Drop the table to simulate an unconfigured memory system.
		db.db.run('DROP TABLE memory_entries');
		const id = await onDiscoveryComplete(
			'no-mem',
			{ vision: 'best effort write' },
			db,
		);
		expect(id).toBeNull();
		db.close();
	});
});
