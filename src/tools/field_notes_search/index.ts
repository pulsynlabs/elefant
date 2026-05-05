import type { Database } from '../../db/database.ts';
import type { EmbeddingProvider } from '../../fieldnotes/embeddings/provider.ts';
import type { Frontmatter } from '../../fieldnotes/frontmatter.ts';
import { serializeFieldNotesLink } from '../../fieldnotes/link.ts';
import { FieldNotesStore } from '../../fieldnotes/store.ts';
import type { RunContext } from '../../runs/types.ts';
import type { ElefantError } from '../../types/errors.ts';
import { err, ok, type Result } from '../../types/result.ts';
import type { ToolDefinition } from '../../types/tools.ts';

export type FieldNotesSearchMode = 'semantic' | 'keyword' | 'hybrid';

export interface FieldNotesSearchParams {
  query: string;
  k?: number;
  section?: string;
  tags?: string[];
  mode?: FieldNotesSearchMode;
  minScore?: number;
}

export interface SearchResult {
  path: string;
  section: string;
  title: string;
  summary: string;
  score: number;
  snippet: string;
  frontmatter: Frontmatter;
  fieldnotes_link: string;
}

export interface FieldNotesSearchOutput {
  results: SearchResult[];
  mode_used: FieldNotesSearchMode;
  total: number;
}

interface StoreSearchRow {
  id: number;
  documentId: string;
  chunkIndex: number;
  text: string;
  tags: string[];
  score: number;
  documentTitle: string;
  documentPath: string;
}

interface StoreDocumentRow {
  id: string;
  filePath: string;
  section: Frontmatter['section'];
  title: string;
  summary: string;
  frontmatter: Frontmatter;
}

export interface FieldNotesSearchStore {
  searchKeyword(query: string, opts: { k: number; section?: string }): Result<StoreSearchRow[], ElefantError>;
  searchVector(queryEmbedding: Float32Array, opts: { k: number; section?: string }): Result<StoreSearchRow[], ElefantError>;
  getDocumentById(id: string): Result<StoreDocumentRow | null, ElefantError>;
  close?(): void;
}

export interface FieldNotesSearchDeps {
  store?: FieldNotesSearchStore;
  embeddingProvider: EmbeddingProvider;
  projectPath?: string;
  database?: Database;
  currentRun?: RunContext;
}

const DEFAULT_K = 8;
const MAX_K = 25;
const RRF_K = 60;

function validationError(message: string): ElefantError {
  return { code: 'VALIDATION_ERROR', message };
}

function executionError(message: string, details?: unknown): ElefantError {
  return { code: 'TOOL_EXECUTION_FAILED', message, details };
}

function clampK(value: number | undefined): number {
  const requested = value ?? DEFAULT_K;
  if (!Number.isFinite(requested)) return DEFAULT_K;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_K);
}

function validateParams(params: FieldNotesSearchParams): Result<{
  query: string;
  k: number;
  section?: string;
  tags?: string[];
  mode: FieldNotesSearchMode;
  minScore?: number;
}, ElefantError> {
  const query = params.query.trim();
  if (query === '') return err(validationError('query must not be empty'));

  const mode = params.mode ?? 'hybrid';
  if (mode !== 'semantic' && mode !== 'keyword' && mode !== 'hybrid') {
    return err(validationError(`mode must be one of semantic, keyword, hybrid; got ${String(params.mode)}`));
  }

  if (params.tags !== undefined && !params.tags.every((tag) => typeof tag === 'string')) {
    return err(validationError('tags must be an array of strings'));
  }

  if (params.minScore !== undefined && (!Number.isFinite(params.minScore) || params.minScore < 0 || params.minScore > 1)) {
    return err(validationError('minScore must be a number between 0 and 1'));
  }

  return ok({
    query,
    k: clampK(params.k),
    section: params.section,
    tags: params.tags,
    mode,
    minScore: params.minScore,
  });
}

function resolveProjectPath(deps: FieldNotesSearchDeps): Result<string, ElefantError> {
  if (deps.projectPath) return ok(deps.projectPath);
  if (!deps.database || !deps.currentRun) {
    return err(executionError('field_notes_search requires either a store, a projectPath, or database/currentRun dependencies'));
  }

  const row = deps.database.db
    .query('SELECT path FROM projects WHERE id = ?')
    .get(deps.currentRun.projectId) as { path: string } | null;

  if (!row) {
    return err({ code: 'FILE_NOT_FOUND', message: `Project not found: ${deps.currentRun.projectId}` });
  }

  return ok(row.path);
}

function openStore(deps: FieldNotesSearchDeps): Result<{ store: FieldNotesSearchStore; shouldClose: boolean }, ElefantError> {
  if (deps.store) return ok({ store: deps.store, shouldClose: false });

  const projectPath = resolveProjectPath(deps);
  if (!projectPath.ok) return err(projectPath.error);

  const store = FieldNotesStore.open(projectPath.data);
  if (!store.ok) return err(store.error);
  return ok({ store: store.data, shouldClose: true });
}

function normaliseScores(rows: StoreSearchRow[]): StoreSearchRow[] {
  if (rows.length === 0) return [];
  const scores = rows.map((row) => row.score);
  const max = Math.max(...scores);
  const min = Math.min(...scores);

  if (max === min) {
    return rows.map((row) => ({ ...row, score: max > 0 ? 1 : 0 }));
  }

  if (min < 0) {
    return rows.map((row) => ({ ...row, score: (row.score - min) / (max - min) }));
  }

  if (max <= 0) {
    return rows.map((row) => ({ ...row, score: 0 }));
  }

  return rows.map((row) => ({ ...row, score: row.score / max }));
}

function dedupeKey(row: StoreSearchRow): string {
  return `${row.documentId}:${row.chunkIndex}`;
}

function fuseRrf(keywordRows: StoreSearchRow[], vectorRows: StoreSearchRow[]): StoreSearchRow[] {
  const merged = new Map<string, { row: StoreSearchRow; score: number }>();

  for (const list of [keywordRows, vectorRows]) {
    list.forEach((row, index) => {
      const key = dedupeKey(row);
      const existing = merged.get(key);
      const contribution = 1 / (RRF_K + index + 1);
      if (existing) {
        existing.score += contribution;
      } else {
        merged.set(key, { row, score: contribution });
      }
    });
  }

  const ranked = Array.from(merged.values())
    .map(({ row, score }) => ({ ...row, score }))
    .sort((a, b) => b.score - a.score);

  const max = ranked[0]?.score ?? 0;
  if (max <= 0) return ranked.map((row) => ({ ...row, score: 0 }));
  return ranked.map((row) => ({ ...row, score: row.score / max }));
}

function includesAnyTag(row: StoreSearchRow, tags: string[] | undefined): boolean {
  if (!tags || tags.length === 0) return true;
  const wanted = new Set(tags);
  return row.tags.some((tag) => wanted.has(tag));
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [];
}

function firstQueryTerm(query: string): string | null {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .find((part) => part.length > 0) ?? null;
}

export function extractSnippet(text: string, query: string): string {
  const normalisedText = text.replace(/\s+/g, ' ').trim();
  const term = firstQueryTerm(query);
  if (!term) return normalisedText.slice(0, 280);

  const sentences = splitSentences(normalisedText);
  const matchIndex = sentences.findIndex((sentence) => sentence.toLowerCase().includes(term));
  if (matchIndex === -1) return normalisedText.slice(0, 280);

  const start = Math.max(0, matchIndex - 2);
  const end = Math.min(sentences.length, matchIndex + 3);
  return sentences.slice(start, end).join(' ').slice(0, 600);
}

async function embedQuery(provider: EmbeddingProvider, query: string): Promise<Result<Float32Array, ElefantError>> {
  const init = await provider.init();
  if (!init.ok) return err(init.error);

  const embedded = await provider.embed([query]);
  if (!embedded.ok) return err(embedded.error);

  const vector = embedded.data.vectors[0];
  if (!vector) {
    return err({ code: 'PROVIDER_ERROR', message: 'Embedding provider returned no query vector' });
  }

  return ok(vector);
}

async function getRows(
  store: FieldNotesSearchStore,
  provider: EmbeddingProvider,
  query: string,
  mode: FieldNotesSearchMode,
  k: number,
  section?: string,
): Promise<Result<StoreSearchRow[], ElefantError>> {
  const searchK = mode === 'hybrid' ? k * 2 : k;

  if (mode === 'keyword') {
    const keyword = store.searchKeyword(query, { k: searchK, section });
    return keyword.ok ? ok(normaliseScores(keyword.data)) : keyword;
  }

  const queryVector = await embedQuery(provider, query);
  if (!queryVector.ok) return err(queryVector.error);

  if (mode === 'semantic') {
    const semantic = store.searchVector(queryVector.data, { k: searchK, section });
    return semantic.ok ? ok(normaliseScores(semantic.data)) : semantic;
  }

  const [keyword, semantic] = await Promise.all([
    Promise.resolve(store.searchKeyword(query, { k: searchK, section })),
    Promise.resolve(store.searchVector(queryVector.data, { k: searchK, section })),
  ]);

  if (!keyword.ok) return err(keyword.error);
  if (!semantic.ok) return err(semantic.error);
  return ok(fuseRrf(keyword.data, semantic.data));
}

function scorePasses(row: StoreSearchRow, minScore: number | undefined): boolean {
  return minScore === undefined || row.score >= minScore;
}

async function toSearchResult(
  store: FieldNotesSearchStore,
  row: StoreSearchRow,
  query: string,
): Promise<Result<SearchResult, ElefantError>> {
  const document = store.getDocumentById(row.documentId);
  if (!document.ok) return err(document.error);
  if (!document.data) {
    return err({ code: 'FILE_NOT_FOUND', message: `Field Notes document not found for chunk: ${row.documentId}` });
  }

  const workflow = document.data.frontmatter.workflow ?? '_';
  return ok({
    path: document.data.filePath,
    section: document.data.section,
    title: document.data.title,
    summary: document.data.summary,
    score: Math.max(0, Math.min(1, row.score)),
    snippet: extractSnippet(row.text, query),
    frontmatter: document.data.frontmatter,
    fieldnotes_link: serializeFieldNotesLink({ kind: 'fieldnotes-uri', workflow, path: document.data.filePath, anchor: null }),
  });
}

export function createFieldNotesSearchTool(deps: FieldNotesSearchDeps): ToolDefinition<FieldNotesSearchParams, FieldNotesSearchOutput> {
  return {
    name: 'field_notes_search',
    description: 'Search the per-project Field Notes with keyword, semantic, or hybrid retrieval. Falls back to keyword when vectors are disabled.',
    deferred: true,
    parameters: {
      query: { type: 'string', required: true, description: 'Search query text.' },
      k: { type: 'number', required: false, default: DEFAULT_K, description: 'Max results (1–25).' },
      section: { type: 'string', required: false, description: 'Filter by section, e.g. 02-tech.' },
      tags: { type: 'array', required: false, description: 'Filter by tags; any matching tag includes the result.' },
      mode: { type: 'string', required: false, default: 'hybrid', description: 'Search mode: semantic, keyword, or hybrid.' },
      minScore: { type: 'number', required: false, description: 'Minimum normalised score threshold (0–1).' },
    },
    inputJSONSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string' },
        k: { type: 'number', minimum: 1, maximum: MAX_K, default: DEFAULT_K },
        section: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ['semantic', 'keyword', 'hybrid'], default: 'hybrid' },
        minScore: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    execute: async (params): Promise<Result<FieldNotesSearchOutput, ElefantError>> => {
      const parsed = validateParams(params);
      if (!parsed.ok) return err(parsed.error);

      const modeUsed: FieldNotesSearchMode = deps.embeddingProvider.name === 'disabled' && parsed.data.mode !== 'keyword'
        ? 'keyword'
        : parsed.data.mode;

      const opened = openStore(deps);
      if (!opened.ok) return err(opened.error);

      const { store, shouldClose } = opened.data;
      try {
        const rows = await getRows(
          store,
          deps.embeddingProvider,
          parsed.data.query,
          modeUsed,
          parsed.data.k,
          parsed.data.section,
        );
        if (!rows.ok) return err(rows.error);

        const filteredRows = rows.data
          .filter((row) => includesAnyTag(row, parsed.data.tags))
          .filter((row) => scorePasses(row, parsed.data.minScore))
          .slice(0, parsed.data.k);

        const results: SearchResult[] = [];
        for (const row of filteredRows) {
          const result = await toSearchResult(store, row, parsed.data.query);
          if (!result.ok) return err(result.error);
          results.push(result.data);
        }

        return ok({ results, mode_used: modeUsed, total: results.length });
      } finally {
        if (shouldClose) store.close?.();
      }
    },
  };
}
