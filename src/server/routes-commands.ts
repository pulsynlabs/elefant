import { Elysia } from 'elysia';
import { z } from 'zod';
import path from 'node:path';

import { loadCommandRegistry } from './slash-commands.ts';

const COMMANDS_DIR = path.join(import.meta.dir, '..', 'commands', 'spec-mode');

const QuerySchema = z.object({
	category: z.string().optional(),
});

/**
 * ## Command Discovery API
 *
 * `GET /api/commands` — Returns metadata for all registered spec-mode slash commands.
 *
 * **Optional filter:** `?category=spec-mode` filters to commands in that category.
 *
 * **Response shape:** `SlashCommandDefinition[]`
 * ```typescript
 * { name: string, trigger: string, description: string, category: string, args?: string }
 * ```
 *
 * **Frontend autocomplete:** The desktop chat input store fetches this endpoint on mount
 * and filters the list as the user types after `/`. The dropdown displays `trigger` and
 * `description`. Implementation deferred to Wave 7 (GUI).
 */
export function mountCommandsRoute<TApp extends Elysia>(app: TApp): TApp {
	app.get('/api/commands', async ({ query }) => {
		const parsed = QuerySchema.safeParse(query);
		const category = parsed.success ? parsed.data.category : undefined;

		const registry = await loadCommandRegistry(COMMANDS_DIR);

		const filtered = category
			? registry.filter((c) => c.category === category)
			: registry;

		return filtered;
	});

	return app;
}

export { COMMANDS_DIR };
