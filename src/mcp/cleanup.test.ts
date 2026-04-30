import { describe, expect, it } from 'bun:test';

import { killDescendants } from './cleanup.ts';

describe('killDescendants', () => {
	it('handles a pid with no children without throwing', async () => {
		await expect(killDescendants(99_999_999)).resolves.toBeUndefined();
	});
});
