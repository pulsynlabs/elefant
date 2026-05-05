import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { IndexerService } from '../../fieldnotes/indexer.ts';
import { ensureFieldNotes } from '../../fieldnotes/init.ts';
import { assertInsideFieldNotes } from '../../fieldnotes/membership.ts';
import {
  autoFillFrontmatter,
  FrontmatterSchema,
  parseFrontmatter,
  serializeFrontmatter,
  type Frontmatter,
} from '../../fieldnotes/frontmatter.ts';
import { serializeFieldNotesLink } from '../../fieldnotes/link.ts';
import { FIELD_NOTES_SECTIONS, fieldNotesDir } from '../../project/paths.ts';
import type { RunContext } from '../../runs/types.ts';
import type { ElefantError } from '../../types/errors.ts';
import { err, ok, type Result } from '../../types/result.ts';
import type { ToolDefinition } from '../../types/tools.ts';

type Confidence = Frontmatter['confidence'];
type AuthorAgent = Frontmatter['author_agent'];

export interface FieldNotesWriteParams {
  path: string;
  title?: string;
  summary?: string;
  section?: string;
  body: string;
  tags?: string[];
  sources?: string[];
  confidence?: Confidence;
  workflow?: string;
  id?: string;
}

export interface FieldNotesWriteResult {
  path: string;
  id: string;
  created: boolean;
  fieldnotes_link: string;
}

export interface FieldNotesWriteContext {
  agentName?: string;
  agentType?: string;
}

export interface FieldNotesWriteDeps {
  projectPath?: string;
  currentRun?: RunContext;
  indexerService?: Pick<IndexerService, 'indexFile'>;
  ctx?: FieldNotesWriteContext;
}

const WRITE_ALLOWED_AGENTS = new Set(['researcher', 'writer', 'librarian']);
const AUTHOR_AGENTS = new Set<string>(FrontmatterSchema.shape.author_agent.options);

function validationError(message: string, details?: unknown): ElefantError {
  return { code: 'VALIDATION_ERROR', message, details };
}

function executionError(message: string, details?: unknown): ElefantError {
  return { code: 'TOOL_EXECUTION_FAILED', message, details };
}

function normalizeAgentName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('goop-') ? trimmed.slice('goop-'.length) : trimmed;
}

function callingAgent(deps: FieldNotesWriteDeps): string | undefined {
  return normalizeAgentName(
    deps.ctx?.agentName ?? deps.ctx?.agentType ?? deps.currentRun?.agentType,
  );
}

function authorAgent(agent: string | undefined): AuthorAgent {
  if (agent && AUTHOR_AGENTS.has(agent)) return agent as AuthorAgent;
  return 'user';
}

function validatePermission(agent: string | undefined): Result<void, ElefantError> {
  if (agent === undefined) return ok(undefined);
  if (WRITE_ALLOWED_AGENTS.has(agent)) return ok(undefined);
  return err({
    code: 'PERMISSION_DENIED',
      message: `field_notes_write is restricted to researcher, writer, and librarian agents (called by ${agent}).`,
  });
}

function validateStringField(name: string, value: string | undefined): Result<string, ElefantError> {
  if (typeof value !== 'string' || value.trim() === '') {
    return err(validationError(`${name} must be a non-empty string`));
  }
  return ok(value);
}

function validateStringArray(name: string, value: string[] | undefined): Result<string[], ElefantError> {
  if (value === undefined) return ok([]);
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return err(validationError(`${name} must be an array of strings`));
  }
  return ok(value);
}

function validateConfidence(value: string | undefined): Result<Confidence, ElefantError> {
  if (value === undefined) return ok('medium');
  if (value === 'high' || value === 'medium' || value === 'low') return ok(value);
  return err(validationError(`confidence must be one of high, medium, low; got ${value}`));
}

function isKnownSection(section: string): section is Frontmatter['section'] {
  return (FIELD_NOTES_SECTIONS as readonly string[]).includes(section);
}

function pathSection(relativePath: string): string {
  return relativePath.split('/')[0] ?? '';
}

function isScratchPath(relativePath: string): boolean {
  return relativePath === '99-scratch' || relativePath.startsWith('99-scratch/');
}

function validateSection(params: FieldNotesWriteParams, scratch: boolean): Result<Frontmatter['section'], ElefantError> {
  const section = params.section ?? (scratch ? '99-scratch' : undefined);
  if (!section) return err(validationError('section is required outside 99-scratch/'));
  if (!isKnownSection(section)) return err(validationError(`section must be one of ${FIELD_NOTES_SECTIONS.join(', ')}; got ${section}`));
  return ok(section);
}

function validatePathMatchesSection(relativePath: string, section: Frontmatter['section']): Result<void, ElefantError> {
  const firstSegment = pathSection(relativePath);
  if (!isKnownSection(firstSegment)) {
    return err(validationError(`path must start with one of ${FIELD_NOTES_SECTIONS.join(', ')}; got ${firstSegment}`));
  }
  if (firstSegment !== section) {
    return err(validationError(`path section (${firstSegment}) must match frontmatter section (${section})`));
  }
  return ok(undefined);
}

function researchRelativePath(projectPath: string, absolutePath: string): string {
  return relative(fieldNotesDir(projectPath), absolutePath).split(sep).join('/');
}

async function existingFrontmatter(absolutePath: string): Promise<Frontmatter | null> {
  if (!existsSync(absolutePath)) return null;
  const raw = await readFile(absolutePath, 'utf8');
  const parsed = parseFrontmatter(raw);
  return parsed.ok ? parsed.data.frontmatter : null;
}

function buildFrontmatter(args: {
  params: FieldNotesWriteParams;
  section: Frontmatter['section'];
  agent: string | undefined;
  existing: Frontmatter | null;
}): Result<Frontmatter, ElefantError> {
  const title = validateStringField('title', args.params.title);
  if (!title.ok) return err(title.error);

  const summary = validateStringField('summary', args.params.summary);
  if (!summary.ok) return err(summary.error);

  const tags = validateStringArray('tags', args.params.tags);
  if (!tags.ok) return err(tags.error);

  const sources = validateStringArray('sources', args.params.sources);
  if (!sources.ok) return err(sources.error);

  const confidence = validateConfidence(args.params.confidence);
  if (!confidence.ok) return err(confidence.error);

  try {
    const requestedId = args.params.id ?? args.existing?.id;
    return ok(autoFillFrontmatter({
      id: args.params.id ?? args.existing?.id,
      title: title.data,
      section: args.section,
      summary: summary.data,
      author_agent: authorAgent(args.agent),
      workflow: args.params.workflow ?? args.existing?.workflow ?? null,
      tags: tags.data,
      sources: sources.data,
      confidence: confidence.data,
      created: args.existing && args.existing.id === requestedId ? args.existing.created : undefined,
      updated: new Date().toISOString(),
    }));
  } catch (error) {
    return err(validationError('Frontmatter validation failed', error));
  }
}

function triggerReindex(indexerService: FieldNotesWriteDeps['indexerService'], absolutePath: string): void {
  if (!indexerService) return;
  void indexerService.indexFile(absolutePath).catch(() => undefined);
}

export async function executeFieldNotesWrite(
  params: FieldNotesWriteParams,
  deps: FieldNotesWriteDeps = {},
): Promise<Result<FieldNotesWriteResult, ElefantError>> {
  try {
    const agent = callingAgent(deps);
    const permission = validatePermission(agent);
    if (!permission.ok) return err(permission.error);

    const relativePath = validateStringField('path', params.path);
    if (!relativePath.ok) return err(relativePath.error);

    const body = validateStringField('body', params.body);
    if (!body.ok) return err(body.error);

    const projectPath = deps.projectPath ?? process.cwd();
    const ensure = ensureFieldNotes(projectPath);
    if (!ensure.ok) return err(ensure.error);

    const absoluteCandidate = join(fieldNotesDir(projectPath), relativePath.data);
    const membership = assertInsideFieldNotes(projectPath, absoluteCandidate, { requireMarkdown: true });
    if (!membership.ok) return err(membership.error);

    const absolutePath = membership.data;
    const canonicalRelativePath = researchRelativePath(projectPath, absolutePath);
    const scratch = isScratchPath(canonicalRelativePath);
    const section = validateSection(params, scratch);
    if (!section.ok) return err(section.error);

    const pathSectionValidation = validatePathMatchesSection(canonicalRelativePath, section.data);
    if (!pathSectionValidation.ok) return err(pathSectionValidation.error);

    const existing = await existingFrontmatter(absolutePath);
    const fm = buildFrontmatter({ params, section: section.data, agent, existing });
    if (!fm.ok) return err(fm.error);

    if (!scratch) {
      const strict = FrontmatterSchema.safeParse(fm.data);
      if (!strict.success) return err(validationError(strict.error.message, strict.error));
    }

    await mkdir(dirname(absolutePath), { recursive: true });
    await Bun.write(absolutePath, serializeFrontmatter(fm.data, body.data));
    triggerReindex(deps.indexerService, absolutePath);

    return ok({
      path: canonicalRelativePath,
      id: fm.data.id,
      created: existing === null,
      fieldnotes_link: serializeFieldNotesLink({
        kind: 'fieldnotes-uri',
        workflow: fm.data.workflow ?? '_',
        path: canonicalRelativePath,
        anchor: null,
      }),
    });
  } catch (error) {
    return err(executionError(`Failed to write field notes file: ${error instanceof Error ? error.message : String(error)}`, error));
  }
}

export function createFieldNotesWriteTool(deps: FieldNotesWriteDeps = {}): ToolDefinition<FieldNotesWriteParams, FieldNotesWriteResult> {
  return {
    name: 'field_notes_write',
    description: 'Write or update a Field Notes markdown file with validated frontmatter and single-file reindexing.',
    allowedAgents: ['researcher', 'writer', 'librarian'],
    parameters: {
      path: { type: 'string', required: true, description: 'Relative path from .elefant/field-notes/, e.g. 02-tech/my-notes.md.' },
      title: { type: 'string', required: true, description: 'Field Notes document title.' },
      summary: { type: 'string', required: true, description: 'Concise summary for indexes and search results.' },
      section: { type: 'string', required: false, description: 'One of the 8 known sections; optional only for 99-scratch/ paths.' },
      body: { type: 'string', required: true, description: 'Full markdown body without frontmatter.' },
      tags: { type: 'array', required: false, default: [], description: 'String tags for filtering and browsing.' },
      sources: { type: 'array', required: false, default: [], description: 'Source URLs or citations.' },
      confidence: { type: 'string', required: false, default: 'medium', description: 'Confidence: high, medium, or low.' },
      workflow: { type: 'string', required: false, description: 'Workflow slug for fieldnotes:// links.' },
      id: { type: 'string', required: false, description: 'Existing UUID to preserve on update; omit to create new.' },
    },
    inputJSONSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'title', 'summary', 'body'],
      properties: {
        path: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string' },
        section: { type: 'string', enum: FIELD_NOTES_SECTIONS },
        body: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, default: [] },
        sources: { type: 'array', items: { type: 'string' }, default: [] },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'], default: 'medium' },
        workflow: { type: 'string' },
        id: { type: 'string' },
      },
    },
    execute: (params) => executeFieldNotesWrite(params, deps),
  };
}

export const fieldNotesWriteTool = createFieldNotesWriteTool();
