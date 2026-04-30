#!/usr/bin/env bun
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BASE_URL_SUPPLEMENT, POPULAR_PROVIDERS } from "./provider-registry-supplement.ts";

const PROVIDERS_ROOT = resolve(".references/models.dev-dev/providers");
const OUTPUT_PATH = resolve("src/providers/registry/generated.ts");

type ProviderFormat = "openai" | "anthropic-compatible";

interface ProviderToml {
  name: string;
  env: string[];
  npm: string;
  api?: string;
  doc: string;
}

interface ModelToml {
  name: string;
}

interface RegistryModelDraft {
  id: string;
  name: string;
}

interface RegistryProviderDraft {
  id: string;
  name: string;
  baseURL: string;
  format: ProviderFormat;
  envVar: string[];
  iconSvg: string;
  docUrl: string;
  models: RegistryModelDraft[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length === value.length ? strings : undefined;
}

async function importToml(path: string): Promise<unknown> {
  const module = (await import(pathToFileURL(path).href, { with: { type: "toml" } })) as unknown;
  return isRecord(module) && "default" in module ? module.default : module;
}

function parseProviderToml(value: unknown): ProviderToml | undefined {
  if (!isRecord(value)) return undefined;

  const name = asString(value.name);
  const env = asStringArray(value.env);
  const npm = asString(value.npm);
  const api = asString(value.api);
  const doc = asString(value.doc);

  if (name === undefined || env === undefined || npm === undefined || doc === undefined) {
    return undefined;
  }

  return api === undefined ? { name, env, npm, doc } : { name, env, npm, api, doc };
}

function parseModelToml(value: unknown): ModelToml | undefined {
  if (!isRecord(value)) return undefined;

  const name = asString(value.name);
  return name === undefined ? undefined : { name };
}

function inferFormat(id: string, npmPackage: string, api: string | undefined): ProviderFormat | undefined {
  if (npmPackage === "@ai-sdk/anthropic") return "anthropic-compatible";
  if (npmPackage === "@ai-sdk/openai") return "openai";

  if (npmPackage === "@ai-sdk/openai-compatible") {
    return api === undefined ? undefined : "openai";
  }

  if (npmPackage === "@openrouter/ai-sdk-provider") {
    return api === undefined ? undefined : "openai";
  }

  if (BASE_URL_SUPPLEMENT[id] !== undefined) return "openai";

  return undefined;
}

function resolveBaseURL(id: string, api: string | undefined): string | undefined {
  return api ?? BASE_URL_SUPPLEMENT[id];
}

function modelIdFromPath(modelPath: string): string {
  return modelPath.slice(modelPath.lastIndexOf("/") + 1, -".toml".length);
}

async function readModels(providerDir: string, providerId: string): Promise<RegistryModelDraft[]> {
  const models: RegistryModelDraft[] = [];
  const modelGlob = new Bun.Glob("models/*.toml");

  for await (const modelPath of modelGlob.scan({ cwd: providerDir, absolute: true })) {
    try {
      const modelToml = parseModelToml(await importToml(modelPath));
      if (modelToml === undefined) {
        console.warn(`Skipping malformed model ${relative(process.cwd(), modelPath)} for provider ${providerId}`);
        continue;
      }

      models.push({ id: modelIdFromPath(modelPath), name: modelToml.name });
    } catch (error: unknown) {
      console.warn(`Skipping unreadable model ${relative(process.cwd(), modelPath)} for provider ${providerId}: ${errorMessage(error)}`);
    }
  }

  return models.sort((left, right) => left.id.localeCompare(right.id));
}

async function readIconSvg(providerDir: string, providerId: string): Promise<string> {
  if (!POPULAR_PROVIDERS.includes(providerId)) return "";

  const logoPath = join(providerDir, "logo.svg");
  const logoFile = Bun.file(logoPath);
  if (!(await logoFile.exists())) return "";

  return await logoFile.text();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readProvider(providerTomlPath: string): Promise<RegistryProviderDraft | undefined> {
  const providerDir = dirname(providerTomlPath);
  const id = providerDir.slice(providerDir.lastIndexOf("/") + 1);

  try {
    const providerToml = parseProviderToml(await importToml(providerTomlPath));
    if (providerToml === undefined) {
      console.warn(`Skipping malformed provider ${id}: provider.toml is missing required fields`);
      return undefined;
    }

    const format = inferFormat(id, providerToml.npm, providerToml.api);
    if (format === undefined) {
      console.warn(`Skipping provider ${id}: unsupported npm package ${providerToml.npm} without usable API metadata`);
      return undefined;
    }

    const baseURL = resolveBaseURL(id, providerToml.api);
    if (baseURL === undefined) {
      console.warn(`Skipping provider ${id}: missing api field and no base URL supplement`);
      return undefined;
    }

    return {
      id,
      name: providerToml.name,
      baseURL,
      format,
      envVar: providerToml.env,
      iconSvg: await readIconSvg(providerDir, id),
      docUrl: providerToml.doc,
      models: await readModels(providerDir, id),
    };
  } catch (error: unknown) {
    console.warn(`Skipping provider ${id}: ${errorMessage(error)}`);
    return undefined;
  }
}

function toTypeScriptString(value: string): string {
  return JSON.stringify(value);
}

function emitRegistry(providers: readonly RegistryProviderDraft[]): string {
  const lines: string[] = [
    "// GENERATED FILE — do not edit by hand",
    "// Regenerate with: bun scripts/generate-provider-registry.ts",
    "",
    "import type { RegistryProvider } from './types.ts';",
    "",
    "export const PROVIDER_REGISTRY: readonly RegistryProvider[] = [",
  ];

  for (const provider of providers) {
    lines.push("  {");
    lines.push(`    id: ${toTypeScriptString(provider.id)},`);
    lines.push(`    name: ${toTypeScriptString(provider.name)},`);
    lines.push(`    baseURL: ${toTypeScriptString(provider.baseURL)},`);
    lines.push(`    format: ${toTypeScriptString(provider.format)},`);
    lines.push(`    envVar: [${provider.envVar.map(toTypeScriptString).join(", ")}],`);
    lines.push(`    iconSvg: ${toTypeScriptString(provider.iconSvg)},`);
    lines.push(`    docUrl: ${toTypeScriptString(provider.docUrl)},`);
    lines.push("    models: [");

    for (const model of provider.models) {
      lines.push(`      { id: ${toTypeScriptString(model.id)}, name: ${toTypeScriptString(model.name)} },`);
    }

    lines.push("    ],");
    lines.push("  },");
  }

  lines.push("] as const;", "");
  return lines.join("\n");
}

export async function generateProviderRegistry(): Promise<readonly RegistryProviderDraft[]> {
  const providers: RegistryProviderDraft[] = [];
  const providerGlob = new Bun.Glob("*/provider.toml");

  for await (const providerTomlPath of providerGlob.scan({ cwd: PROVIDERS_ROOT, absolute: true })) {
    const provider = await readProvider(providerTomlPath);
    if (provider !== undefined) providers.push(provider);
  }

  return providers.sort((left, right) => left.id.localeCompare(right.id));
}

if (import.meta.main) {
  const providers = await generateProviderRegistry();
  await Bun.write(OUTPUT_PATH, emitRegistry(providers));
  console.log(`Wrote ${providers.length} providers to ${relative(process.cwd(), OUTPUT_PATH)}`);
}
