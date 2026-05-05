import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Elysia } from 'elysia';

import type { Database } from '../db/database.ts';
import { getProjectById } from '../db/repo/projects.ts';
import { FIELD_NOTES_SECTIONS, fieldNotesDir } from '../project/paths.ts';
import { assertInsideFieldNotes } from '../fieldnotes/membership.ts';
import { parseFrontmatter, type Frontmatter } from '../fieldnotes/frontmatter.ts';
import { serializeFieldNotesLink } from '../fieldnotes/link.ts';
import { createDisabledProvider } from '../fieldnotes/embeddings/disabled.ts';
import { FieldNotesStore } from '../fieldnotes/store.ts';
import { getFieldNotesStatus, type FieldNotesStatus } from '../fieldnotes/status.ts';
import { IndexerService, type BulkIndexSummary } from '../fieldnotes/indexer.ts';
import { ProgressEmitter } from '../fieldnotes/progress.ts';
import { createFieldNotesSearchTool, type FieldNotesSearchOutput, type SearchResult } from '../tools/field_notes_search/index.ts';
import { launchEditor } from '../fieldnotes/editor-launch.ts';
import { routesLog } from '../fieldnotes/log.ts';

type ProjectContext = { projectId: string; projectPath: string };

export interface FieldNotesTreeFile {
  name: string;
  path: string;
  title: string;
  summary: string;
  tags: string[];
  confidence: string;
  updated: string;
  fieldnotes_link: string;
}

export interface FieldNotesTreeSection {
  name: string;
  label: string;
  files: FieldNotesTreeFile[];
}

export interface FieldNotesRoutesDeps {
  launchEditor?: typeof launchEditor;
  search?: (ctx: ProjectContext, input: FieldNotesSearchBody) => Promise<SearchResult[] | FieldNotesSearchOutput>;
  getStatus?: (ctx: ProjectContext) => Promise<FieldNotesStatus>;
  createIndexer?: (ctx: ProjectContext) => IndexerServiceLike;
  progressEmitter?: (projectId: string) => ProgressEmitter;
}

interface IndexerServiceLike {
  progress: ProgressEmitter;
  bulkIndex(): Promise<unknown>;
}

const projectIdQuerySchema = z.object({ projectId: z.string().min(1) }).passthrough();

const fileQuerySchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  meta: z.union([z.literal('true'), z.literal('false')]).optional(),
}).passthrough();

const searchBodySchema = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1),
  k: z.number().optional(),
  section: z.string().optional(),
  tags: z.array(z.string()).optional(),
  mode: z.enum(['semantic', 'keyword', 'hybrid']).optional(),
  minScore: z.number().optional(),
}).strict();

export type FieldNotesSearchBody = z.infer<typeof searchBodySchema>;

const projectBodySchema = z.object({ projectId: z.string().min(1) }).strict();
const openInEditorBodySchema = z.object({ projectId: z.string().min(1), path: z.string().min(1) }).strict();

const sharedProgressEmitters = new Map<string, ProgressEmitter>();

function getSharedProgressEmitter(projectId: string): ProgressEmitter {
  let emitter = sharedProgressEmitters.get(projectId);
  if (!emitter) {
    emitter = new ProgressEmitter();
    sharedProgressEmitters.set(projectId, emitter);
  }
  return emitter;
}

function errorBody(code: string, message: string, details?: unknown): { error: string; code: string; details?: unknown } {
  return { error: message, code, ...(details === undefined ? {} : { details }) };
}

function mapErrorStatus(code: string): number {
  if (code === 'VALIDATION_ERROR' || code === 'PERMISSION_DENIED') return 400;
  if (code === 'FILE_NOT_FOUND') return 404;
  return 500;
}

function projectContext(db: Database, projectId: string): { status: number; body?: unknown; ctx?: ProjectContext } {
  const project = getProjectById(db, projectId);
  if (!project.ok) {
    return { status: project.error.code === 'FILE_NOT_FOUND' ? 404 : 500, body: errorBody(project.error.code, project.error.message, project.error.details) };
  }
  return { status: 200, ctx: { projectId, projectPath: project.data.path } };
}

function fieldNotesRelativePath(projectPath: string, absolutePath: string): string {
  return relative(fieldNotesDir(projectPath), absolutePath).split(sep).join('/');
}

function resolveFieldNotesPath(projectPath: string, relativePath: string): { status: number; body?: unknown; absolutePath?: string; relativePath?: string } {
  const absoluteCandidate = resolve(fieldNotesDir(projectPath), relativePath);
  const membership = assertInsideFieldNotes(projectPath, absoluteCandidate, { requireMarkdown: true });
  if (!membership.ok) {
    const status = mapErrorStatus(membership.error.code);
    return { status, body: errorBody(membership.error.code, membership.error.message, membership.error.details) };
  }

  return {
    status: 200,
    absolutePath: membership.data,
    relativePath: fieldNotesRelativePath(projectPath, membership.data),
  };
}

function fallbackTitle(fileName: string): string {
  return basename(fileName, extname(fileName)).replace(/[-_]+/g, ' ');
}

function fieldNotesLink(workflow: string | null | undefined, path: string): string {
  return serializeFieldNotesLink({ kind: 'fieldnotes-uri', workflow: workflow ?? '_', path, anchor: null });
}

function parseFrontmatterBestEffort(raw: string, path: string): { frontmatter: Partial<Frontmatter>; body: string } {
  const parsed = parseFrontmatter(raw);
  if (parsed.ok) return parsed.data;

  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/u);
  const yaml = match?.[1] ?? '';
  const body = match ? raw.slice(match[0].length) : raw;
  const frontmatter: Partial<Frontmatter> = {};

  for (const line of yaml.split('\n')) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim() as keyof Frontmatter;
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key === 'tags' || key === 'sources') {
      frontmatter[key] = value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
    } else {
      (frontmatter as Record<string, unknown>)[key] = value === 'null' ? null : value;
    }
  }

  frontmatter.title ??= fallbackTitle(path);
  frontmatter.summary ??= '';
  frontmatter.tags ??= [];
  frontmatter.confidence ??= 'medium';
  frontmatter.updated ??= '';
  return { frontmatter, body };
}

function sectionLabel(section: string): string {
  return section.replace(/^\d+-/u, '').replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function isTreeMarkdownFile(name: string): boolean {
  return name.endsWith('.md') && name !== 'README.md' && name !== 'INDEX.md';
}

function buildFieldNotesTree(projectPath: string): { sections: FieldNotesTreeSection[]; lastRefreshed: string } {
  const base = fieldNotesDir(projectPath);
  const sectionSet = new Set(FIELD_NOTES_SECTIONS);
  const presentSections = existsSync(base)
    ? readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];

  const sections = presentSections
    .filter((section) => sectionSet.has(section))
    .sort((left, right) => FIELD_NOTES_SECTIONS.indexOf(left) - FIELD_NOTES_SECTIONS.indexOf(right))
    .map((section): FieldNotesTreeSection => {
      const sectionDir = join(base, section);
      const files = readdirSync(sectionDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isTreeMarkdownFile(entry.name))
        .map((entry): FieldNotesTreeFile => {
          const relativePath = `${section}/${entry.name}`;
          const raw = readFileSync(join(sectionDir, entry.name), 'utf8');
          const parsed = parseFrontmatterBestEffort(raw, relativePath);
          return {
            name: entry.name,
            path: relativePath,
            title: parsed.frontmatter.title ?? fallbackTitle(entry.name),
            summary: parsed.frontmatter.summary ?? '',
            tags: parsed.frontmatter.tags ?? [],
            confidence: parsed.frontmatter.confidence ?? '',
            updated: parsed.frontmatter.updated ?? '',
            fieldnotes_link: fieldNotesLink(parsed.frontmatter.workflow, relativePath),
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name));

      return { name: section, label: sectionLabel(section), files };
    });

  return { sections, lastRefreshed: new Date().toISOString() };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function renderList(lines: string[], ordered: boolean): string {
  const tag = ordered ? 'ol' : 'ul';
  const items = lines.map((line) => `<li>${renderInline(line.replace(/^\s*(?:[-*]|\d+\.)\s+/u, ''))}</li>`).join('');
  return `<${tag}>${items}</${tag}>`;
}

function renderTable(lines: string[]): string {
  const rows = lines.filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line));
  const [header, ...bodyRows] = rows;
  const cells = (line: string) => line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  const head = `<thead><tr>${cells(header ?? '').map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${bodyRows.map((line) => `<tr>${cells(line).map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let fence: { language: string; lines: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (fence) {
      if (line.startsWith('```')) {
        const className = fence.language ? ` class="language-${escapeHtml(fence.language)}"` : '';
        blocks.push(`<pre><code${className}>${escapeHtml(fence.lines.join('\n'))}</code></pre>`);
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }

    if (line.startsWith('```')) {
      flushParagraph();
      fence = { language: line.slice(3).trim(), lines: [] };
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) {
      flushParagraph();
      blocks.push(`<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    if (/^\s*\|.+\|\s*$/u.test(line)) {
      flushParagraph();
      const tableLines = [line];
      while (index + 1 < lines.length && /^\s*\|.+\|\s*$/u.test(lines[index + 1])) {
        index += 1;
        tableLines.push(lines[index]);
      }
      blocks.push(renderTable(tableLines));
      continue;
    }

    if (/^\s*[-*]\s+/u.test(line) || /^\s*\d+\.\s+/u.test(line)) {
      flushParagraph();
      const ordered = /^\s*\d+\.\s+/u.test(line);
      const listLines = [line];
      while (index + 1 < lines.length && (ordered ? /^\s*\d+\.\s+/u : /^\s*[-*]\s+/u).test(lines[index + 1])) {
        index += 1;
        listLines.push(lines[index]);
      }
      blocks.push(renderList(listLines, ordered));
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  if (fence) blocks.push(`<pre><code>${escapeHtml(fence.lines.join('\n'))}</code></pre>`);
  return sanitizeHtml(blocks.join('\n'));
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/giu, '');
}

function defaultIndexer(ctx: ProjectContext): IndexerService {
  return new IndexerService({ projectId: ctx.projectId, projectPath: ctx.projectPath, provider: createDisabledProvider() });
}

async function defaultSearch(ctx: ProjectContext, input: FieldNotesSearchBody): Promise<FieldNotesSearchOutput> {
  const tool = createFieldNotesSearchTool({ projectPath: ctx.projectPath, embeddingProvider: createDisabledProvider() });
  const result = await tool.execute(input);
  if (!result.ok) throw result.error;
  return result.data;
}

async function defaultStatus(ctx: ProjectContext): Promise<FieldNotesStatus> {
  const storeResult = FieldNotesStore.open(ctx.projectPath);
  const store = storeResult.ok ? storeResult.data : null;
  try {
    const result = await getFieldNotesStatus({ projectId: ctx.projectId, projectPath: ctx.projectPath, store, provider: createDisabledProvider() });
    if (!result.ok) throw result.error;
    return result.data;
  } finally {
    store?.close();
  }
}

function pipeIndexerProgress(indexer: IndexerServiceLike, shared: ProgressEmitter): () => void {
  if (indexer.progress === shared) return () => {};
  return indexer.progress.subscribe((event) => {
    shared.emit(event);
  });
}

function sseResponse(projectId: string, emitter: ProgressEmitter, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: string) => controller.enqueue(encoder.encode(value));
      const unsubscribe = emitter.subscribe((event) => {
        if (event.projectId === projectId) send(emitter.toSSEData(event));
      });
      const keepalive = setInterval(() => send(': keepalive\n\n'), 15_000);
      const cleanup = () => {
        clearInterval(keepalive);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };
      signal.addEventListener('abort', cleanup, { once: true });
      send(`event: keepalive\ndata: ${JSON.stringify({ projectId })}\n\n`);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

export function mountFieldNotesRoutes(app: Elysia, db: Database, deps: FieldNotesRoutesDeps = {}): Elysia {
  const editorLauncher = deps.launchEditor ?? launchEditor;
  const search = deps.search ?? defaultSearch;
  const getStatus = deps.getStatus ?? defaultStatus;
  const createIndexer = deps.createIndexer ?? defaultIndexer;
  const progressEmitter = deps.progressEmitter ?? getSharedProgressEmitter;

  app.get('/v1/fieldnotes/tree', ({ query, set }) => {
    const parsed = projectIdQuerySchema.safeParse(query);
    if (!parsed.success) {
      set.status = 400;
      return errorBody('VALIDATION_ERROR', 'Invalid query', parsed.error.issues);
    }
    const project = projectContext(db, parsed.data.projectId);
    if (!project.ctx) {
      set.status = project.status;
      return project.body;
    }
    routesLog.info('GET /v1/fieldnotes/tree', { projectId: parsed.data.projectId });
    return buildFieldNotesTree(project.ctx.projectPath);
  });

  app.get('/v1/fieldnotes/file', ({ query, set }) => {
    const parsed = fileQuerySchema.safeParse(query);
    if (!parsed.success) {
      set.status = 400;
      return errorBody('VALIDATION_ERROR', 'Invalid query', parsed.error.issues);
    }
    const project = projectContext(db, parsed.data.projectId);
    if (!project.ctx) {
      set.status = project.status;
      return project.body;
    }
    const resolved = resolveFieldNotesPath(project.ctx.projectPath, parsed.data.path);
    if (!resolved.absolutePath || !resolved.relativePath) {
      set.status = resolved.status;
      return resolved.body;
    }
    if (!existsSync(resolved.absolutePath)) {
      set.status = 404;
      return errorBody('FILE_NOT_FOUND', `Field Notes file not found: ${parsed.data.path}`);
    }

    routesLog.info('GET /v1/fieldnotes/file', { projectId: parsed.data.projectId, path: parsed.data.path });
    const raw = readFileSync(resolved.absolutePath, 'utf8');
    const parsedFile = parseFrontmatter(raw);
    if (!parsedFile.ok) {
      set.status = 400;
      return errorBody(parsedFile.error.code, parsedFile.error.message, parsedFile.error.details);
    }

    const payload = {
      path: resolved.relativePath,
      frontmatter: parsedFile.data.frontmatter,
      html: parsed.data.meta === 'true' ? '' : renderMarkdown(parsedFile.data.body),
      rawBody: parsedFile.data.body,
      fieldnotes_link: fieldNotesLink(parsedFile.data.frontmatter.workflow, resolved.relativePath),
    };
    return payload;
  });

  app.post('/v1/fieldnotes/search', async ({ body, set }) => {
    const parsed = searchBodySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return errorBody('VALIDATION_ERROR', 'Invalid request body', parsed.error.issues);
    }
    const project = projectContext(db, parsed.data.projectId);
    if (!project.ctx) {
      set.status = project.status;
      return project.body;
    }
    routesLog.info('POST /v1/fieldnotes/search', { projectId: parsed.data.projectId, query: parsed.data.query, mode: parsed.data.mode ?? 'hybrid' });
    try {
      const result = await search(project.ctx, parsed.data);
      return Array.isArray(result) ? result : result.results;
    } catch (error) {
      set.status = 500;
      return errorBody('TOOL_EXECUTION_FAILED', error instanceof Error ? error.message : String(error));
    }
  });

  app.get('/v1/fieldnotes/status', async ({ query, set }) => {
    const parsed = projectIdQuerySchema.safeParse(query);
    if (!parsed.success) {
      set.status = 400;
      return errorBody('VALIDATION_ERROR', 'Invalid query', parsed.error.issues);
    }
    const project = projectContext(db, parsed.data.projectId);
    if (!project.ctx) {
      set.status = project.status;
      return project.body;
    }
    routesLog.info('GET /v1/fieldnotes/status', { projectId: parsed.data.projectId });
    const status = await getStatus(project.ctx);
    if (!status) {
      set.status = 500;
      return errorBody('TOOL_EXECUTION_FAILED', 'Failed to get research status');
    }
    return status;
  });

  app.post('/v1/fieldnotes/reindex', async ({ body, set }) => {
    const parsed = projectBodySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return errorBody('VALIDATION_ERROR', 'Invalid request body', parsed.error.issues);
    }
    const project = projectContext(db, parsed.data.projectId);
    if (!project.ctx) {
      set.status = project.status;
      return project.body;
    }
    routesLog.info('POST /v1/fieldnotes/reindex', { projectId: parsed.data.projectId });
    const indexer = createIndexer(project.ctx);
    const unsubscribe = pipeIndexerProgress(indexer, progressEmitter(project.ctx.projectId));
    void Promise.resolve(indexer.bulkIndex() as Promise<BulkIndexSummary>).finally(unsubscribe);
    return { started: true };
  });

  app.get('/v1/fieldnotes/index/progress', ({ query, request, set }) => {
    const parsed = projectIdQuerySchema.safeParse(query);
    if (!parsed.success) {
      set.status = 400;
      return errorBody('VALIDATION_ERROR', 'Invalid query', parsed.error.issues);
    }
    const project = projectContext(db, parsed.data.projectId);
    if (!project.ctx) {
      set.status = project.status;
      return project.body;
    }
    routesLog.info('GET /v1/fieldnotes/index/progress (SSE)', { projectId: parsed.data.projectId });
    return sseResponse(project.ctx.projectId, progressEmitter(project.ctx.projectId), request.signal);
  });

  app.post('/v1/fieldnotes/open-in-editor', async ({ body, set }) => {
    const parsed = openInEditorBodySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return errorBody('VALIDATION_ERROR', 'Invalid request body', parsed.error.issues);
    }
    const project = projectContext(db, parsed.data.projectId);
    if (!project.ctx) {
      set.status = project.status;
      return project.body;
    }
    const resolved = resolveFieldNotesPath(project.ctx.projectPath, parsed.data.path);
    if (!resolved.absolutePath) {
      set.status = resolved.status;
      return resolved.body;
    }
    routesLog.info('POST /v1/fieldnotes/open-in-editor', { projectId: parsed.data.projectId, path: parsed.data.path });
    const launched = await editorLauncher(resolved.absolutePath);
    return launched;
  });

  return app;
}
