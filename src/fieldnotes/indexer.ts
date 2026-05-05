import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { ElefantError } from '../types/errors.ts';
import { ok, type Result } from '../types/result.ts';
import { fieldNotesDir } from '../project/paths.ts';
import { assertInsideFieldNotes } from './membership.ts';
import { parseFrontmatter, type Frontmatter } from './frontmatter.ts';
import { chunkMarkdown, type Chunk } from './chunker.ts';
import { FieldNotesStore, type UpsertChunkInput } from './store.ts';
import type { EmbeddingProvider, EmbeddingProviderConfig } from './embeddings/provider.ts';
import { ProgressEmitter, type IndexProgressEvent } from './progress.ts';
import { indexerLog } from './log.ts';

const MAX_FILE_BYTES = 500 * 1024;

export interface BulkIndexSummary {
  indexed: number;
  skipped: number;
  errors: string[];
}

export interface IndexerOptions {
  projectPath: string;
  projectId: string;
  provider: EmbeddingProvider;
  maxConcurrentEmbeds?: number;
}

interface PreparedDocument {
  absolutePath: string;
  relativePath: string;
  bodyHash: string;
  frontmatter: Frontmatter;
  body: string;
  chunks: Chunk[];
}

export interface BulkIndexWorkerMessage {
  type: 'bulk';
  projectPath: string;
  projectId: string;
  documents: PreparedDocument[];
  maxConcurrentEmbeds: number;
}

export type WorkerProgressMessage =
  | { type: 'progress'; event: IndexProgressEvent }
  | { type: 'done'; summary: BulkIndexSummary }
  | { type: 'error'; message: string };

interface PreparedBulkIndexOptions {
  projectPath: string;
  projectId: string;
  provider: EmbeddingProvider;
  documents: PreparedDocument[];
  maxConcurrentEmbeds: number;
  emitProgress: (event: IndexProgressEvent) => void;
}

function elefantError(error: unknown): ElefantError {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    return error as ElefantError;
  }
  return { code: 'TOOL_EXECUTION_FAILED', message: String(error), details: error };
}

function hashBody(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

function toFieldNotesRelativePath(projectPath: string, filePath: string): string {
  return relative(fieldNotesDir(projectPath), filePath).split(sep).join('/');
}

function isSectionRootIndexFile(relativePath: string): boolean {
  const parts = relativePath.split('/');
  if (parts.length !== 2) return false;
  return parts[1] === 'README.md' || parts[1] === 'INDEX.md';
}

function shouldSkipRelative(relativePath: string): boolean {
  if (!relativePath.endsWith('.md')) return true;
  if (relativePath === 'README.md' || relativePath === 'INDEX.md') return true;
  if (relativePath.startsWith('99-scratch/')) return true;
  return isSectionRootIndexFile(relativePath);
}

function walkMarkdownFiles(projectPath: string): string[] {
  const base = fieldNotesDir(projectPath);
  if (!existsSync(base)) return [];

  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = toFieldNotesRelativePath(projectPath, path);
      if (!shouldSkipRelative(relativePath)) files.push(path);
    }
  };
  visit(base);
  return files.sort();
}

function prepareDocument(projectPath: string, absolutePath: string): Result<PreparedDocument | null, ElefantError> {
  const membership = assertInsideFieldNotes(projectPath, absolutePath, { requireMarkdown: true });
  if (!membership.ok) return membership;

  const canonicalPath = membership.data;
  const relativePath = toFieldNotesRelativePath(projectPath, canonicalPath);
  if (shouldSkipRelative(relativePath)) return ok(null);

  const stat = statSync(canonicalPath);
  if (stat.size > MAX_FILE_BYTES) {
    indexerLog.warn('file too large, skipped', { path: relativePath, sizeKB: Math.round(stat.size / 1024) });
    return ok(null);
  }

  const raw = readFileSync(canonicalPath, 'utf8');
  const parsed = parseFrontmatter(raw);
  if (!parsed.ok) return parsed;

  return ok({
    absolutePath: canonicalPath,
    relativePath,
    bodyHash: hashBody(parsed.data.body),
    frontmatter: parsed.data.frontmatter,
    body: parsed.data.body,
    chunks: chunkMarkdown(parsed.data.body),
  });
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function embedChunks(provider: EmbeddingProvider, chunks: Chunk[], maxConcurrentEmbeds: number): Promise<Result<(Float32Array | null)[], ElefantError>> {
  if (chunks.length === 0 || provider.name === 'disabled') return ok(chunks.map(() => null));

  const init = await provider.init();
  if (!init.ok) return init;

  try {
    const results = await mapWithConcurrency(chunks, maxConcurrentEmbeds, async (chunk) => {
      const embedded = await provider.embed([chunk.text]);
      if (!embedded.ok) throw embedded.error;
      return embedded.data.vectors[0] ?? null;
    });
    return ok(results);
  } catch (error) {
    return { ok: false, error: elefantError(error) };
  }
}

function toStoreChunks(chunks: Chunk[], embeddings: (Float32Array | null)[]): UpsertChunkInput[] {
  const now = new Date().toISOString();
  return chunks.map((chunk, index) => ({
    chunkIndex: chunk.index,
    headingSlug: chunk.headingSlug,
    text: chunk.text,
    tokens: chunk.tokens,
    tags: chunk.tags,
    embedding: embeddings[index] ?? null,
    updated: now,
  }));
}

export async function runPreparedBulkIndex(opts: PreparedBulkIndexOptions): Promise<BulkIndexSummary> {
  const summary: BulkIndexSummary = { indexed: 0, skipped: 0, errors: [] };
  const storeResult = FieldNotesStore.open(opts.projectPath);
  if (!storeResult.ok) return { ...summary, errors: [storeResult.error.message] };
  const store = storeResult.data;
  const startTime = Date.now();

  try {
    for (let index = 0; index < opts.documents.length; index += 1) {
      const doc = opts.documents[index];
      const total = opts.documents.length;
      const fileStartTime = Date.now();
      try {
        const existing = store.getDocumentByPath(doc.relativePath);
        if (!existing.ok) {
          summary.errors.push(`${doc.relativePath}: ${existing.error.message}`);
          indexerLog.error('file index failed', { path: doc.relativePath, error: existing.error.message });
          continue;
        }
        if (existing.data?.bodyHash === doc.bodyHash) {
          summary.skipped += 1;
          continue;
        }

        opts.emitProgress({ projectId: opts.projectId, phase: 'embedding', current: index + 1, total, file: doc.relativePath });
        const embedded = await embedChunks(opts.provider, doc.chunks, opts.maxConcurrentEmbeds);
        if (!embedded.ok) {
          summary.errors.push(`${doc.relativePath}: ${embedded.error.message}`);
          indexerLog.error('file index failed', { path: doc.relativePath, error: embedded.error.message });
          continue;
        }

        opts.emitProgress({ projectId: opts.projectId, phase: 'writing', current: index + 1, total, file: doc.relativePath });
        const upsertDocument = store.upsertDocument({
          ...doc.frontmatter,
          filePath: doc.relativePath,
          frontmatterJson: JSON.stringify(doc.frontmatter),
          bodyHash: doc.bodyHash,
        });
        if (!upsertDocument.ok) {
          summary.errors.push(`${doc.relativePath}: ${upsertDocument.error.message}`);
          indexerLog.error('file index failed', { path: doc.relativePath, error: upsertDocument.error.message });
          continue;
        }
        const upsertChunks = store.upsertChunks(doc.frontmatter.id, toStoreChunks(doc.chunks, embedded.data));
        if (!upsertChunks.ok) {
          summary.errors.push(`${doc.relativePath}: ${upsertChunks.error.message}`);
          indexerLog.error('file index failed', { path: doc.relativePath, error: upsertChunks.error.message });
          continue;
        }
        summary.indexed += 1;
        const fileMs = Date.now() - fileStartTime;
        indexerLog.info('file indexed', { path: doc.relativePath, chunks: doc.chunks.length, ms: fileMs });
      } catch (error) {
        const errMsg = elefantError(error).message;
        summary.errors.push(`${doc.relativePath}: ${errMsg}`);
        indexerLog.error('file index failed', { path: doc.relativePath, error: errMsg });
      }
    }
    const totalMs = Date.now() - startTime;
    indexerLog.info('bulk index complete', { projectId: opts.projectId, indexed: summary.indexed, skipped: summary.skipped, errors: summary.errors.length, totalMs });
    return summary;
  } finally {
    store.close();
  }
}

function providerConfig(provider: EmbeddingProvider): EmbeddingProviderConfig {
  return { name: provider.name };
}

async function runWorker(message: BulkIndexWorkerMessage, provider: EmbeddingProvider, emit: (event: IndexProgressEvent) => void): Promise<BulkIndexSummary> {
  const workerUrl = new URL('./indexer.worker.ts', import.meta.url);
  const worker = new Worker(workerUrl, { type: 'module' });
  return await new Promise<BulkIndexSummary>((resolvePromise) => {
    let settled = false;
    const finish = (summary: BulkIndexSummary): void => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolvePromise(summary);
    };
    worker.onmessage = (event: MessageEvent<WorkerProgressMessage>) => {
      const data = event.data;
      if (data.type === 'progress') emit(data.event);
      else if (data.type === 'done') finish(data.summary);
      else finish({ indexed: 0, skipped: 0, errors: [data.message] });
    };
    worker.onerror = (event) => finish({ indexed: 0, skipped: 0, errors: [String(event.message)] });
    worker.postMessage({ ...message, providerConfig: providerConfig(provider) });
  });
}

export class IndexerService {
  readonly progress = new ProgressEmitter();
  private readonly maxConcurrentEmbeds: number;

  constructor(private readonly opts: IndexerOptions) {
    this.maxConcurrentEmbeds = opts.maxConcurrentEmbeds ?? 4;
  }

  async bulkIndex(): Promise<Result<BulkIndexSummary, ElefantError>> {
    const documents: PreparedDocument[] = [];
    const errors: string[] = [];

    indexerLog.info('bulk index started', { projectId: this.opts.projectId, provider: this.opts.provider.name });

    try {
      const files = walkMarkdownFiles(this.opts.projectPath);
      this.progress.emit({ projectId: this.opts.projectId, phase: 'walking', current: files.length, total: files.length });

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const relativePath = toFieldNotesRelativePath(this.opts.projectPath, file);
        this.progress.emit({ projectId: this.opts.projectId, phase: 'chunking', current: i + 1, total: files.length, file: relativePath });
        const prepared = prepareDocument(this.opts.projectPath, file);
        if (!prepared.ok) errors.push(`${relativePath}: ${prepared.error.message}`);
        else if (prepared.data !== null) documents.push(prepared.data);
      }

      const message: BulkIndexWorkerMessage = {
        type: 'bulk',
        projectPath: this.opts.projectPath,
        projectId: this.opts.projectId,
        documents,
        maxConcurrentEmbeds: this.maxConcurrentEmbeds,
      };

      let summary: BulkIndexSummary;
      try {
        summary = await runWorker(message, this.opts.provider, (event) => this.progress.emit(event));
      } catch {
        summary = await runPreparedBulkIndex({
          projectPath: this.opts.projectPath,
          projectId: this.opts.projectId,
          provider: this.opts.provider,
          documents,
          maxConcurrentEmbeds: this.maxConcurrentEmbeds,
          emitProgress: (event) => this.progress.emit(event),
        });
      }

      const finalSummary = { ...summary, errors: [...errors, ...summary.errors] };
      this.progress.emit({ projectId: this.opts.projectId, phase: finalSummary.errors.length > 0 ? 'error' : 'done', current: documents.length, total: documents.length, error: finalSummary.errors[0] });
      return ok(finalSummary);
    } catch (error) {
      const message = elefantError(error).message;
      const summary = { indexed: 0, skipped: 0, errors: [message] };
      this.progress.emit({ projectId: this.opts.projectId, phase: 'error', current: 0, total: 0, error: message });
      return ok(summary);
    }
  }

  async indexFile(filePath: string): Promise<Result<void, ElefantError>> {
    indexerLog.info('indexFile', { path: filePath });
    const prepared = prepareDocument(this.opts.projectPath, filePath);
    if (!prepared.ok) return prepared;
    if (prepared.data === null) return ok(undefined);

    const doc = prepared.data;
    this.progress.emit({ projectId: this.opts.projectId, phase: 'chunking', current: 1, total: 1, file: doc.relativePath });
    const storeResult = FieldNotesStore.open(this.opts.projectPath);
    if (!storeResult.ok) return storeResult;
    const store = storeResult.data;

    try {
      const existing = store.getDocumentByPath(doc.relativePath);
      if (!existing.ok) return existing;
      if (existing.data?.bodyHash === doc.bodyHash) return ok(undefined);

      this.progress.emit({ projectId: this.opts.projectId, phase: 'embedding', current: 1, total: 1, file: doc.relativePath });
      const embedded = await embedChunks(this.opts.provider, doc.chunks, this.maxConcurrentEmbeds);
      if (!embedded.ok) return embedded;

      this.progress.emit({ projectId: this.opts.projectId, phase: 'writing', current: 1, total: 1, file: doc.relativePath });
      const upsertDocument = store.upsertDocument({
        ...doc.frontmatter,
        filePath: doc.relativePath,
        frontmatterJson: JSON.stringify(doc.frontmatter),
        bodyHash: doc.bodyHash,
      });
      if (!upsertDocument.ok) return upsertDocument;
      const upsertChunks = store.upsertChunks(doc.frontmatter.id, toStoreChunks(doc.chunks, embedded.data));
      if (!upsertChunks.ok) return upsertChunks;

      this.progress.emit({ projectId: this.opts.projectId, phase: 'done', current: 1, total: 1, file: doc.relativePath });
      return ok(undefined);
    } finally {
      store.close();
    }
  }

  async removeFile(filePath: string): Promise<Result<void, ElefantError>> {
    indexerLog.info('removeFile', { path: filePath });
    const absolutePath = resolve(filePath);
    const relativePath = toFieldNotesRelativePath(this.opts.projectPath, absolutePath);
    const storeResult = FieldNotesStore.open(this.opts.projectPath);
    if (!storeResult.ok) return storeResult;
    const store = storeResult.data;
    try {
      const existing = store.getDocumentByPath(relativePath);
      if (!existing.ok) return existing;
      if (!existing.data) return ok(undefined);
      const deleted = store.deleteDocument(existing.data.id);
      if (!deleted.ok) return deleted;
      this.progress.emit({ projectId: this.opts.projectId, phase: 'done', current: 1, total: 1, file: relativePath });
      return ok(undefined);
    } finally {
      store.close();
    }
  }
}
