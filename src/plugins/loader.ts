import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { DaemonContext } from '../daemon/context.ts';
import type { HookEventName, HookHandler } from '../hooks/types.ts';
import type { ToolDefinition } from '../types/tools.ts';
import type { ElefantPluginAPI } from './api.ts';
import type {
	CommandHandler,
	Disposer,
	ElefantPluginFactory,
	Logger,
	PluginProviderConfig,
} from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPluginFactory(value: unknown): value is ElefantPluginFactory {
	return typeof value === 'function';
}

function pluginNameFromPath(pluginPath: string): string {
	const normalized = pluginPath.replace(/\\/g, '/');
	const segments = normalized.split('/').filter((segment) => segment.length > 0);
	if (segments.length >= 2) {
		return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
	}

	return normalized;
}

export class PluginLoader {
	private readonly projectPluginsDir: string;
	private readonly globalPluginsDir: string;
	private readonly disposers: Disposer[] = [];
	private readonly commands = new Map<string, CommandHandler>();

	public constructor(private readonly ctx: DaemonContext) {
		this.projectPluginsDir = join(ctx.project.elefantDir, 'plugins');
		this.globalPluginsDir = join(homedir(), '.elefant', 'plugins');
	}

	public discover(): string[] {
		const entrypoints: string[] = [];
		const seen = new Set<string>();

		for (const dir of [this.projectPluginsDir, this.globalPluginsDir]) {
			if (!existsSync(dir)) {
				continue;
			}

			for (const entry of readdirSync(dir)) {
				const fullPath = join(dir, entry);
				const stat = statSync(fullPath);

				if (stat.isDirectory()) {
					const entrypoint = this.resolveDirectoryEntrypoint(fullPath);
					if (!entrypoint) {
						continue;
					}

					if (!seen.has(entrypoint)) {
						seen.add(entrypoint);
						entrypoints.push(entrypoint);
					}

					continue;
				}

				if (!entry.endsWith('.ts') && !entry.endsWith('.js')) {
					continue;
				}

				const abs = resolve(fullPath);
				if (!seen.has(abs)) {
					seen.add(abs);
					entrypoints.push(abs);
				}
			}
		}

		return entrypoints;
	}

	public async loadAll(): Promise<void> {
		const entrypoints = this.discover();
		for (const entrypoint of entrypoints) {
			await this.loadOne(entrypoint);
		}
	}

	public async unloadAll(): Promise<void> {
		for (let index = this.disposers.length - 1; index >= 0; index -= 1) {
			const dispose = this.disposers[index];
			try {
				dispose();
			} catch {
				// ignore disposer errors while unloading
			}
		}

		this.disposers.length = 0;
		this.commands.clear();
	}

	private resolveDirectoryEntrypoint(directoryPath: string): string | null {
		const pkgPath = join(directoryPath, 'package.json');
		if (existsSync(pkgPath)) {
			try {
				const pkgRaw = readFileSync(pkgPath, 'utf-8');
				const parsed = JSON.parse(pkgRaw) as unknown;
				if (isRecord(parsed) && typeof parsed.main === 'string') {
					const fromMain = resolve(directoryPath, parsed.main);
					if (existsSync(fromMain)) {
						return fromMain;
					}
				}
			} catch {
				// ignore invalid package.json and fall back to index.ts/index.js
			}
		}

		for (const candidate of ['index.ts', 'index.js']) {
			const candidatePath = join(directoryPath, candidate);
			if (existsSync(candidatePath)) {
				return candidatePath;
			}
		}

		return null;
	}

	private async loadOne(entrypoint: string): Promise<void> {
		try {
			const moduleUrl = pathToFileURL(entrypoint).href;
			const mod = (await import(moduleUrl)) as unknown;

			const factory = this.pickFactory(mod);
			if (!factory) {
				console.warn(`[elefant] Plugin at ${entrypoint} does not export a factory function`);
				return;
			}

			const api = this.buildApi(entrypoint);
			await factory(api);
		} catch (error) {
			console.error(`[elefant] Failed to load plugin at ${entrypoint}:`, error);
		}
	}

	private pickFactory(mod: unknown): ElefantPluginFactory | null {
		if (isPluginFactory(mod)) {
			return mod;
		}

		if (isRecord(mod) && isPluginFactory(mod.default)) {
			return mod.default;
		}

		return null;
	}

	private buildApi(pluginPath: string): ElefantPluginAPI {
		const { ctx } = this;
		const pluginName = pluginNameFromPath(pluginPath);

		const logger: Logger = {
			info: (message, ...args) => {
				console.log(`[plugin:${pluginName}] INFO:`, message, ...args);
			},
			warn: (message, ...args) => {
				console.warn(`[plugin:${pluginName}] WARN:`, message, ...args);
			},
			error: (message, ...args) => {
				console.error(`[plugin:${pluginName}] ERROR:`, message, ...args);
			},
			debug: (message, ...args) => {
				if (process.env.ELEFANT_DEBUG) {
					console.log(`[plugin:${pluginName}] DEBUG:`, message, ...args);
				}
			},
		};

		return {
			on: <E extends HookEventName>(
				event: E,
				handler: HookHandler<E>,
				opts?: { priority?: number },
			): Disposer => {
				const wrappedHandler: HookHandler<E> = async (hookContext) => {
					try {
						return await handler(hookContext);
					} catch (error) {
						console.error(`[plugin:${pluginName}] Hook handler error (${event}):`, error);
						return undefined;
					}
				};

				const disposer = ctx.hooks.register(event, wrappedHandler, opts);
				this.disposers.push(disposer);
				return disposer;
			},

			registerTool: (def: ToolDefinition): Disposer => {
				try {
					ctx.tools.register(def);
				} catch (error) {
					console.error(`[plugin:${pluginName}] registerTool error:`, error);
				}

				return () => {
					// Dynamic tool unregistering is not supported yet.
				};
			},

			registerCommand: (name: string, handler: CommandHandler): Disposer => {
				this.commands.set(name, handler);
				logger.info(`Registered command: ${name}`);

				const disposer: Disposer = () => {
					this.commands.delete(name);
				};
				this.disposers.push(disposer);
				return disposer;
			},

			registerProvider: (name: string, config: PluginProviderConfig): Disposer => {
				const maybeRouter = ctx.providers as unknown as {
					register?: (providerName: string, providerConfig: unknown) => void;
				};

				try {
					if (typeof maybeRouter.register === 'function') {
						maybeRouter.register(name, config);
					}
				} catch (error) {
					console.error(`[plugin:${pluginName}] registerProvider error:`, error);
				}

				return () => {
					// Dynamic provider unregistering is not supported yet.
				};
			},

			getState: () => ctx.state.getState(),
			getDb: () => ctx.db,
			log: logger,
		};
	}
}
