// Daemon API type definitions

export interface HealthResponse {
	ok: boolean;
	status: 'running';
	uptime: number;
	timestamp: string;
}

export interface ErrorResponse {
	ok: false;
	error: string;
	code?: string;
	details?: unknown;
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ProviderFormat = 'openai' | 'anthropic';

export interface ProviderEntry {
	name: string;
	baseURL: string;
	apiKey: string;
	model: string;
	format: ProviderFormat;
}

export interface ElefantConfig {
	port: number;
	providers: ProviderEntry[];
	defaultProvider: string;
	logLevel: LogLevel;
}
