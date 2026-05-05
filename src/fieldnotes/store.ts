import { Database } from 'bun:sqlite';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { researchIndexPath } from '../project/paths.js';
import { err, ok, type Result } from '../types/result.js';
import type { ElefantError } from '../types/errors.js';
import { ConfidenceSchema, SectionSchema, AuthorAgentSchema, type Frontmatter } from './frontmatter.js';

type SqliteValue = string | number | null | Uint8Array;
type SqliteVecModule = { load?: (db: Database) => void; getLoadablePath?: () => string };

// Per ADR-0006 the Field Notes index is per-project at
// `.elefant/field-notes-index.sqlite`, not part of the daemon's main DB. Keeping
// the v1 schema inline avoids a second migration system while remaining
// idempotent on every open.
const INIT_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS field_notes_documents (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium',
  tags_json TEXT NOT NULL DEFAULT '[]',
  sources_json TEXT NOT NULL DEFAULT '[]',
  author_agent TEXT NOT NULL,
  workflow TEXT,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  frontmatter_json TEXT NOT NULL,
  body_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_field_notes_docs_section ON field_notes_documents(section);
CREATE INDEX IF NOT EXISTS idx_field_notes_docs_updated ON field_notes_documents(updated);

CREATE TABLE IF NOT EXISTS field_notes_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL REFERENCES field_notes_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  heading_slug TEXT,
  text TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  embedding_dim INTEGER NOT NULL DEFAULT 0,
  embedding BLOB,
  updated TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_field_notes_chunks_doc ON field_notes_chunks(document_id);

CREATE VIRTUAL TABLE IF NOT EXISTS field_notes_chunks_fts USING fts5(
  text,
  content='field_notes_chunks',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS field_notes_chunks_ai AFTER INSERT ON field_notes_chunks BEGIN
  INSERT INTO field_notes_chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS field_notes_chunks_ad AFTER DELETE ON field_notes_chunks BEGIN
  INSERT INTO field_notes_chunks_fts(field_notes_chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS field_notes_chunks_au AFTER UPDATE ON field_notes_chunks BEGIN
  INSERT INTO field_notes_chunks_fts(field_notes_chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO field_notes_chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
`;

export const FIELD_NOTES_STORE_INIT_SQL = INIT_SQL;

export interface DocumentRow {
  id: string;
  filePath: string;
  section: Frontmatter['section'];
  title: string;
  summary: string;
  confidence: Frontmatter['confidence'];
  tags: string[];
  sources: string[];
  authorAgent: Frontmatter['author_agent'];
  workflow: string | null;
  created: string;
  updated: string;
  frontmatter: Frontmatter;
  bodyHash: string;
}

export interface ChunkRow {
  id: number;
  documentId: string;
  chunkIndex: number;
  headingSlug: string | null;
  text: string;
  tokens: number;
  tags: string[];
  embeddingDim: number;
  embedding: Float32Array | null;
  updated: string;
}

export interface UpsertDocumentInput extends Frontmatter {
  filePath: string;
  frontmatterJson?: string;
  bodyHash: string;
}

export interface UpsertChunkInput {
  chunkIndex: number;
  headingSlug?: string | null;
  text: string;
  tokens: number;
  tags?: string[];
  embedding?: Float32Array | null;
  updated?: string;
}

type SearchRow = ChunkRow & { score: number; documentTitle: string; documentPath: string };

const DocumentDbRowSchema = z.object({
  id: z.string(),
  file_path: z.string(),
  section: SectionSchema,
  title: z.string(),
  summary: z.string(),
  confidence: ConfidenceSchema,
  tags_json: z.string(),
  sources_json: z.string(),
  author_agent: AuthorAgentSchema,
  workflow: z.string().nullable(),
  created: z.string(),
  updated: z.string(),
  frontmatter_json: z.string(),
  body_hash: z.string(),
});

const ChunkDbRowSchema = z.object({
  id: z.number(),
  document_id: z.string(),
  chunk_index: z.number(),
  heading_slug: z.string().nullable(),
  text: z.string(),
  tokens: z.number(),
  tags_json: z.string(),
  embedding_dim: z.number(),
  embedding: z.instanceof(Uint8Array).nullable().or(z.instanceof(Buffer).nullable()),
  updated: z.string(),
});

function toError(error: unknown): ElefantError {
  return { code: 'TOOL_EXECUTION_FAILED', message: String(error), details: error };
}

function parseJsonArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function vectorToBlob(vector: Float32Array | null | undefined): Uint8Array | null {
  if (!vector) return null;
  return new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
}

function blobToVector(blob: Uint8Array | Buffer | null, dim: number): Float32Array | null {
  if (!blob || dim === 0) return null;
  const copy = new Uint8Array(blob.length);
  copy.set(blob);
  return new Float32Array(copy.buffer);
}

function mapDocument(row: unknown): DocumentRow {
  const parsed = DocumentDbRowSchema.parse(row);
  return {
    id: parsed.id,
    filePath: parsed.file_path,
    section: parsed.section,
    title: parsed.title,
    summary: parsed.summary,
    confidence: parsed.confidence,
    tags: parseJsonArray(parsed.tags_json),
    sources: parseJsonArray(parsed.sources_json),
    authorAgent: parsed.author_agent,
    workflow: parsed.workflow,
    created: parsed.created,
    updated: parsed.updated,
    frontmatter: JSON.parse(parsed.frontmatter_json) as Frontmatter,
    bodyHash: parsed.body_hash,
  };
}

function mapChunk(row: unknown): ChunkRow {
  const parsed = ChunkDbRowSchema.parse(row);
  return {
    id: parsed.id,
    documentId: parsed.document_id,
    chunkIndex: parsed.chunk_index,
    headingSlug: parsed.heading_slug,
    text: parsed.text,
    tokens: parsed.tokens,
    tags: parseJsonArray(parsed.tags_json),
    embeddingDim: parsed.embedding_dim,
    embedding: blobToVector(parsed.embedding, parsed.embedding_dim),
    updated: parsed.updated,
  };
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function ftsQuery(input: string): string {
  return input.trim().split(/\s+/).filter(Boolean).map((part) => `"${part.replaceAll('"', '""')}"`).join(' AND ');
}

export class FieldNotesStore {
  private closed = false;
  private sqliteVecLoaded = false;

  private constructor(private readonly db: Database, private readonly dbPath: string) {}

  static open(projectPath: string): Result<FieldNotesStore, ElefantError> {
    try {
      const path = researchIndexPath(projectPath);
      mkdirSync(dirname(path), { recursive: true });
      const db = new Database(path, { create: true });
      db.exec(INIT_SQL);
      db.run('PRAGMA foreign_keys = ON');
      return ok(new FieldNotesStore(db, path));
    } catch (e) {
      return err(toError(e));
    }
  }

  upsertDocument(input: UpsertDocumentInput): Result<void, ElefantError> {
    try {
      const frontmatterJson = input.frontmatterJson ?? JSON.stringify({
        id: input.id, title: input.title, section: input.section, tags: input.tags,
        sources: input.sources, confidence: input.confidence, created: input.created,
        updated: input.updated, author_agent: input.author_agent, workflow: input.workflow,
        summary: input.summary,
      });
      this.db.run(
        `INSERT INTO field_notes_documents
        (id, file_path, section, title, summary, confidence, tags_json, sources_json, author_agent, workflow, created, updated, frontmatter_json, body_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET file_path=excluded.file_path, section=excluded.section, title=excluded.title,
        summary=excluded.summary, confidence=excluded.confidence, tags_json=excluded.tags_json,
        sources_json=excluded.sources_json, author_agent=excluded.author_agent, workflow=excluded.workflow,
        created=excluded.created, updated=excluded.updated, frontmatter_json=excluded.frontmatter_json, body_hash=excluded.body_hash`,
        [input.id, input.filePath, input.section, input.title, input.summary, input.confidence,
          JSON.stringify(input.tags), JSON.stringify(input.sources), input.author_agent, input.workflow,
          input.created, input.updated, frontmatterJson, input.bodyHash],
      );
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  getDocumentByPath(filePath: string): Result<DocumentRow | null, ElefantError> {
    try {
      const row = this.db.query('SELECT * FROM field_notes_documents WHERE file_path = ?').get(filePath);
      return ok(row ? mapDocument(row) : null);
    } catch (e) { return err(toError(e)); }
  }

  getDocumentById(id: string): Result<DocumentRow | null, ElefantError> {
    try {
      const row = this.db.query('SELECT * FROM field_notes_documents WHERE id = ?').get(id);
      return ok(row ? mapDocument(row) : null);
    } catch (e) { return err(toError(e)); }
  }

  deleteDocument(id: string): Result<void, ElefantError> {
    try {
      this.db.run('DELETE FROM field_notes_documents WHERE id = ?', [id]);
      return ok(undefined);
    } catch (e) { return err(toError(e)); }
  }

  listDocuments(opts?: { section?: string; limit?: number }): Result<DocumentRow[], ElefantError> {
    try {
      const params: SqliteValue[] = [];
      let sql = 'SELECT * FROM field_notes_documents';
      if (opts?.section) { sql += ' WHERE section = ?'; params.push(opts.section); }
      sql += ' ORDER BY updated DESC';
      if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
      return ok(this.db.query(sql).all(...params).map(mapDocument));
    } catch (e) { return err(toError(e)); }
  }

  upsertChunks(documentId: string, chunks: UpsertChunkInput[]): Result<void, ElefantError> {
    try {
      this.db.run('BEGIN');
      this.db.run('DELETE FROM field_notes_chunks WHERE document_id = ?', [documentId]);
      const stmt = this.db.prepare(`INSERT INTO field_notes_chunks
        (document_id, chunk_index, heading_slug, text, tokens, tags_json, embedding_dim, embedding, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const chunk of chunks) {
        stmt.run(
          documentId,
          chunk.chunkIndex,
          chunk.headingSlug ?? null,
          chunk.text,
          chunk.tokens,
          JSON.stringify(chunk.tags ?? []),
          chunk.embedding?.length ?? 0,
          vectorToBlob(chunk.embedding),
          chunk.updated ?? new Date().toISOString(),
        );
      }
      this.db.run('COMMIT');
      return ok(undefined);
    } catch (e) {
      try { this.db.run('ROLLBACK'); } catch { /* ignore rollback errors */ }
      return err(toError(e));
    }
  }

  searchKeyword(query: string, opts: { k: number; section?: string }): Result<SearchRow[], ElefantError> {
    try {
      const match = ftsQuery(query);
      if (!match) return ok([]);
      const params: SqliteValue[] = [match];
      let sql = `SELECT c.*, -bm25(field_notes_chunks_fts) AS score, d.title AS document_title, d.file_path AS document_path
        FROM field_notes_chunks_fts
        JOIN field_notes_chunks c ON c.id = field_notes_chunks_fts.rowid
        JOIN field_notes_documents d ON d.id = c.document_id
        WHERE field_notes_chunks_fts MATCH ?`;
      if (opts.section) { sql += ' AND d.section = ?'; params.push(opts.section); }
      sql += ' ORDER BY score DESC LIMIT ?'; params.push(opts.k);
      return ok(this.db.query(sql).all(...params).map((row) => ({
        ...mapChunk(row),
        score: Number((row as { score: number }).score),
        documentTitle: String((row as { document_title: string }).document_title),
        documentPath: String((row as { document_path: string }).document_path),
      })));
    } catch (e) { return err(toError(e)); }
  }

  async loadSqliteVec(): Promise<Result<void, ElefantError>> {
    if (this.sqliteVecLoaded) return ok(undefined);
    try {
      const sqliteVec = (await import('sqlite-vec')) as SqliteVecModule;
      if (typeof sqliteVec.load === 'function') sqliteVec.load(this.db);
      else if (typeof sqliteVec.getLoadablePath === 'function') this.db.loadExtension(sqliteVec.getLoadablePath());
      this.sqliteVecLoaded = true;
      return ok(undefined);
    } catch (e) { return err(toError(e)); }
  }

  searchVector(queryEmbedding: Float32Array, opts: { k: number; section?: string }): Result<SearchRow[], ElefantError> {
    try {
      // TODO(v2): switch to sqlite-vec vec0 virtual tables when corpus budgets exceed v1 limits.
      const params: SqliteValue[] = [queryEmbedding.length];
      let sql = `SELECT c.*, d.title AS document_title, d.file_path AS document_path
        FROM field_notes_chunks c JOIN field_notes_documents d ON d.id = c.document_id
        WHERE c.embedding IS NOT NULL AND c.embedding_dim = ?`;
      if (opts.section) { sql += ' AND d.section = ?'; params.push(opts.section); }
      const rows = this.db.query(sql).all(...params);
      const ranked = rows.map((row) => ({
        ...mapChunk(row),
        score: cosine(queryEmbedding, mapChunk(row).embedding ?? new Float32Array(queryEmbedding.length)),
        documentTitle: String((row as { document_title: string }).document_title),
        documentPath: String((row as { document_path: string }).document_path),
      })).sort((a, b) => b.score - a.score).slice(0, opts.k);
      if (ranked.length === 0 && this.totalChunks() > 0) {
        return err({ code: 'VECTOR_DIM_MISMATCH', message: `No embeddings found with dimension ${queryEmbedding.length}` });
      }
      return ok(ranked);
    } catch (e) { return err(toError(e)); }
  }

  totalDocs(): number { return Number((this.db.query('SELECT COUNT(*) AS count FROM field_notes_documents').get() as { count: number }).count); }
  totalChunks(): number { return Number((this.db.query('SELECT COUNT(*) AS count FROM field_notes_chunks').get() as { count: number }).count); }
  diskSizeBytes(): number { try { return statSync(this.dbPath).size; } catch { return 0; } }

  getMaxEmbeddingDim(): number {
    const row = this.db.query('SELECT COALESCE(MAX(embedding_dim), 0) AS max_dim FROM field_notes_chunks').get() as { max_dim: number };
    return row.max_dim;
  }

  deleteAllChunks(): Result<void, ElefantError> {
    try {
      this.db.run('DELETE FROM field_notes_chunks');
      return ok(undefined);
    } catch (e) { return err(toError(e)); }
  }

  clearAllEmbeddings(): Result<void, ElefantError> {
    try {
      this.db.run('UPDATE field_notes_chunks SET embedding = NULL');
      return ok(undefined);
    } catch (e) { return err(toError(e)); }
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }
}
