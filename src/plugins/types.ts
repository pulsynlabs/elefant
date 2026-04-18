import type { Database } from '../db/database.ts';
import type { ElefantState } from '../state/schema.ts';
import type { ElefantError } from '../types/errors.ts';
import type { Result } from '../types/result.ts';
import type { ElefantPluginAPI } from './api.ts';

// A disposer returned by every register*() call
export type Disposer = () => void;

// Handler priority options
export interface HookOptions {
	priority?: number;
}

// Command handler receives parsed args string
export type CommandHandler = (args: string) => Promise<void> | void;

// Provider config for registerProvider()
// Minimal — expands in future sprints
export interface PluginProviderConfig {
	baseURL: string;
	apiKey: string;
	model: string;
	format: 'openai' | 'anthropic';
}

// Logger facade
export interface Logger {
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
}

/**
 * Utility alias for plugin-facing read-only state snapshots.
 */
export type PluginStateSnapshot = Readonly<ElefantState>;

/**
 * Utility alias for plugin-facing database operation results.
 */
export type PluginResult<T> = Result<T, ElefantError>;

/**
 * Utility alias for plugin-facing database access.
 */
export type PluginDatabase = Database;

// Plugin factory function type
export type ElefantPluginFactory = (api: ElefantPluginAPI) => void | Promise<void>;
