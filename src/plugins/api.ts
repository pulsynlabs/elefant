import type { Database } from '../db/database.ts';
import type { HookEventName, HookHandler } from '../hooks/types.ts';
import type { ElefantState } from '../state/schema.ts';
import type { ToolDefinition } from '../types/tools.ts';
import type {
	CommandHandler,
	Disposer,
	HookOptions,
	Logger,
	PluginProviderConfig,
} from './types.ts';

export interface ElefantPluginAPI {
	/**
	 * Subscribe to a hook event.
	 * Handlers run in priority order (lower fires first, default 100).
	 * Return { cancel: true } to stop the chain.
	 * Return Partial<context> to merge updates into the context.
	 */
	on<E extends HookEventName>(event: E, handler: HookHandler<E>, opts?: HookOptions): Disposer;

	/**
	 * Register a tool accessible to the LLM.
	 */
	registerTool(def: ToolDefinition): Disposer;

	/**
	 * Register a slash command.
	 */
	registerCommand(name: string, handler: CommandHandler): Disposer;

	/**
	 * Register an LLM provider.
	 */
	registerProvider(name: string, config: PluginProviderConfig): Disposer;

	/**
	 * Get a read-only snapshot of the current workflow state.
	 */
	getState(): Readonly<ElefantState>;

	/**
	 * Access the project's SQLite database directly.
	 */
	getDb(): Database;

	/**
	 * Scoped logger for this plugin.
	 */
	log: Logger;
}
