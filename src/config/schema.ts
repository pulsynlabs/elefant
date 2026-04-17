import { z } from "zod";

const providerSchema = z.object({
	name: z.string().min(1),
	baseURL: z.string().url(),
	apiKey: z.string().min(1),
	model: z.string().min(1),
	format: z.enum(["openai", "anthropic"]),
});

const configSchema = z.object({
	port: z.number().int().min(1).max(65535).default(1337),
	providers: z.array(providerSchema).min(1),
	defaultProvider: z.string().min(1),
	logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export { configSchema, providerSchema };
export type ElefantConfig = z.infer<typeof configSchema>;
export type ProviderEntry = z.infer<typeof providerSchema>;
