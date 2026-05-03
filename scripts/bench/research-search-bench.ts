/**
 * Research Base search latency benchmark.
 *
 * Creates 100 files (targeting ~2000 chunks), indexes with `disabled` provider,
 * then runs 50 keyword searches and 50 vector searches (with random 384-dim
 * vectors injected into chunks). Measures p50/p95/p99 and asserts against
 * SPEC §3 limits: keyword p95 ≤ 80ms, vector scan p95 ≤ 150ms.
 *
 * Usage: bun run scripts/bench/research-search-bench.ts
 */

import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { IndexerService } from '../../src/research/indexer.ts';
import { createDisabledProvider } from '../../src/research/embeddings/disabled.ts';
import { ResearchStore, type SearchRow } from '../../src/research/store.ts';
import { serializeFrontmatter, autoFillFrontmatter, type Frontmatter } from '../../src/research/frontmatter.ts';
import { researchBaseDir, researchIndexPath } from '../../src/project/paths.ts';

const FILE_COUNT = 100;
const WORDS_PER_FILE = 4000; // target ~2000 chunks total across all files
const SEARCH_ITERATIONS = 50;
const VECTOR_DIM = 384;
const K = 10;

const SECTIONS = [
  '00-index',
  '01-domain',
  '02-tech',
  '03-decisions',
  '04-comparisons',
  '05-references',
  '06-synthesis',
  '99-scratch',
] as const satisfies Frontmatter['section'][];

const AUTHORS = [
  'researcher',
  'writer',
  'librarian',
  'planner',
] as const satisfies Frontmatter['author_agent'][];

// ── Content generation ──────────────────────────────────────────────────────

const TEXT_BLOCKS = [
  'The system architecture follows a modular design with clear separation of concerns between components. Each module communicates through well-defined interfaces, enabling independent development, testing, and deployment cycles without coupling.',
  'Data processing pipelines are structured to handle concurrent workloads efficiently. Stages are connected by bounded queues that provide back-pressure mechanisms, ensuring system stability under variable load conditions.',
  'Performance optimization requires careful measurement before making changes. Profiling tools identify hot paths and resource bottlenecks, while benchmark suites provide reproducible comparisons between implementation alternatives.',
  'Security considerations are built into the design from the start. Input validation guards every entry point, authentication verifies identity, and authorization checks permissions before any sensitive operation proceeds.',
  'The module system supports tree-shaking to eliminate unused code from production builds. Only functions and types that are actually imported at compile time make it into the final output bundle.',
  'Error handling follows the Result pattern rather than throwing exceptions. Every fallible operation returns a discriminated union that the caller must explicitly handle, making error paths visible in the type system.',
  'Configuration is managed through a layered system with sensible defaults for every environment. Production, staging, and development configurations override specific values without duplicating entire configuration files.',
  'Testing strategy follows the testing pyramid with many fast unit tests, fewer integration tests that exercise module boundaries, and critical end-to-end tests covering the most important user journeys.',
  'Observability infrastructure emits structured telemetry that multiple backends can consume. Metrics track quantitative performance, traces follow requests across service boundaries, and logs capture diagnostic context.',
  'Dependency injection decouples components from their concrete implementations. Interfaces define contracts that multiple implementations can satisfy, enabling testing with mock objects and swapping implementations at runtime.',
  'Concurrency primitives like mutexes, channels, and atomic operations provide safe access to shared mutable state. The runtime scheduler ensures fair execution across all active tasks and prevents starvation.',
  'Serialization formats are chosen based on the specific requirements of each use case. JSON excels for human-readable configuration, Protocol Buffers optimize for high-throughput RPC, and MessagePack balances size and speed.',
  'Database schema migrations are versioned and reversible. Each migration includes both forward and rollback paths, ensuring that deployments can be safely reverted if issues are discovered after a release.',
  'Caching strategies vary by data access pattern and freshness tolerance. Write-through caches prioritize consistency, write-back caches optimize write throughput, and read-aside caches give fine-grained invalidation control.',
  'Authentication uses short-lived access tokens with longer-lived refresh tokens. The token rotation policy limits the damage window for compromised credentials, and revocation lists enable immediate invalidation when needed.',
  'The plugin architecture allows third-party extensions to integrate with the core system through stable APIs. Extension points are versioned with semantic versioning, ensuring backward compatibility for plugin authors.',
  'Monitoring dashboards provide real-time visibility into system health across all deployed instances. Key metrics include request latency distributions, error rates by endpoint, throughput trends, and resource utilization.',
  'Code generation reduces boilerplate and ensures consistency across the codebase. Templates produce repetitive code from canonical sources of truth like protocol buffer schemas, database models, and API specifications.',
  'Message queues decouple service producers from consumers, enabling asynchronous communication patterns. Retry logic handles transient failures, dead-letter queues capture unprocessable messages, and routing keys enable selective delivery.',
  'The search index uses an inverted index structure for fast full-text queries. Documents are tokenized at indexing time, and query terms are matched against the posting lists to retrieve ranked results efficiently.',
];

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function generateBody(wordCount: number): string {
  const parts: string[] = [];
  let total = 0;
  let sectionNum = 0;
  while (total < wordCount) {
    const block = TEXT_BLOCKS[(sectionNum * 3 + total) % TEXT_BLOCKS.length]!;
    const title = block.split('.')[0]!;
    parts.push(`## Section ${sectionNum + 1}: ${title}`);
    parts.push(block);
    // Add some bullet points for variety
    const bulletCount = 2 + (sectionNum % 3);
    for (let b = 0; b < bulletCount; b++) {
      parts.push(`- Key insight ${sectionNum + 1}.${b + 1}: ${TEXT_BLOCKS[(sectionNum * 7 + b + 5) % TEXT_BLOCKS.length]!.slice(0, 100)}`);
    }
    total += block.split(/\s+/).length + (bulletCount * 10) + 4;
    sectionNum += 1;
  }
  return parts.join('\n\n');
}

function generateFile(
  index: number,
  section: Frontmatter['section'],
  baseDir: string,
): void {
  const body = generateBody(WORDS_PER_FILE);
  const fm = autoFillFrontmatter({
    title: `Search Benchmark Document ${String(index).padStart(4, '0')}: ${section}`,
    section,
    summary: `Auto-generated search benchmark document ${index} in section ${section}.`,
    author_agent: randomFrom(AUTHORS),
    tags: ['benchmark', 'search', 'performance', section.split('-')[1] ?? section],
    sources: ['https://example.com/bench-source'],
    confidence: randomFrom(['high', 'medium', 'low'] as const),
  });

  const content = serializeFrontmatter(fm, body);
  mkdirSync(join(baseDir, section), { recursive: true });
  writeFileSync(join(baseDir, section, `search-doc-${String(index).padStart(5, '0')}.md`), content, 'utf8');
}

// ── Vector helpers ──────────────────────────────────────────────────────────

function makeRandomVector(dim: number): Float32Array {
  const vector = new Float32Array(dim);
  const randomWords = new Uint32Array(vector.buffer);
  crypto.getRandomValues(randomWords);
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] = (randomWords[i]! / 0xffffffff) * 2 - 1; // [-1, 1] range
  }
  return vector;
}

function vectorToBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

function injectRandomEmbeddings(indexPath: string, dim: number): void {
  const db = new Database(indexPath);
  try {
    const chunkCount = (db.query('SELECT COUNT(*) AS cnt FROM research_chunks').get() as { cnt: number }).cnt;
    if (chunkCount === 0) return;

    const embedStmt = db.prepare('UPDATE research_chunks SET embedding = ?, embedding_dim = ? WHERE id = ?');
    const rows = db.query('SELECT id FROM research_chunks ORDER BY id').all() as { id: number }[];
    const injectMany = db.transaction(() => {
      for (const row of rows) {
        const v = makeRandomVector(dim);
        embedStmt.run(vectorToBlob(v), dim, row.id);
      }
    });
    injectMany();
    console.log(`  Injected ${rows.length} random ${dim}-dim embedding vectors`);
  } finally {
    db.close();
  }
}

// ── Percentile computation ─────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Linear interpolation for more accurate percentile
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

// ── Query terms ─────────────────────────────────────────────────────────────

const SEARCH_TERMS = [
  'architecture', 'system', 'module', 'design', 'pipeline', 'data', 'interface',
  'component', 'security', 'performance', 'testing', 'configuration', 'error',
  'handling', 'dependency', 'injection', 'concurrency', 'serialization', 'caching',
  'authentication', 'plugin', 'monitoring', 'code generation', 'message queue',
  'search index', 'database schema', 'observability', 'deployment', 'optimization',
  'authorization', 'token', 'migration', 'benchmark', 'protocol', 'routing',
  'validation', 'logging', 'rate limiting', 'throttling', 'load balancing',
  'backup', 'recovery', 'sharding', 'replication', 'consensus', 'encryption',
];

function randomQuery(): string {
  const a = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)]!;
  let b = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)]!;
  while (b === a) {
    b = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)]!;
  }
  return `${a} ${b}`;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const tmp = join(tmpdir(), `elefant-search-bench-${Date.now()}`);
  let keywordPassed = true;
  let vectorPassed = true;

  try {
    // ── Setup ──────────────────────────────────────────────────────────────
    mkdirSync(tmp, { recursive: true });
    const base = researchBaseDir(tmp);
    mkdirSync(base, { recursive: true });

    console.log(`Generating ${FILE_COUNT} markdown files (~${WORDS_PER_FILE} words each)...`);
    const genStart = performance.now();
    for (let i = 0; i < FILE_COUNT; i++) {
      generateFile(i, SECTIONS[i % SECTIONS.length]!, base);
    }
    const genElapsed = performance.now() - genStart;
    console.log(`  Generated in ${Math.round(genElapsed)}ms`);

    // ── Index ──────────────────────────────────────────────────────────────
    const provider = createDisabledProvider();
    const indexer = new IndexerService({
      projectPath: tmp,
      projectId: 'search-bench',
      provider,
    });

    console.log(`\nIndexing with '${provider.name}' provider...`);
    const idxStart = performance.now();
    const idxResult = await indexer.bulkIndex();
    const idxElapsed = performance.now() - idxStart;
    console.log(`  Indexed ${idxResult.ok ? idxResult.data.indexed : 0} files in ${Math.round(idxElapsed)}ms`);

    // ── Open store for queries ─────────────────────────────────────────────
    const storeResult = ResearchStore.open(tmp);
    if (!storeResult.ok) {
      console.error(`Failed to open store: ${storeResult.error.message}`);
      process.exit(1);
    }
    const store = storeResult.data;
    const totalChunks = store.totalChunks();
    console.log(`  Total chunks in index: ${totalChunks}`);

    // ── Pre-generate queries ───────────────────────────────────────────────
    const queries = Array.from({ length: SEARCH_ITERATIONS }, () => randomQuery());
    const vectors = Array.from({ length: SEARCH_ITERATIONS }, () => makeRandomVector(VECTOR_DIM));

    // ── Benchmark: keyword search ──────────────────────────────────────────
    console.log(`\n  Running ${SEARCH_ITERATIONS} keyword searches...`);
    const keywordTimes: number[] = [];
    for (const q of queries) {
      const start = performance.now();
      const result = store.searchKeyword(q, { k: K });
      const elapsed = performance.now() - start;
      if (result.ok) keywordTimes.push(elapsed);
    }
    const kwSorted = [...keywordTimes].sort((a, b) => a - b);
    const kwP50 = percentile(kwSorted, 50);
    const kwP95 = percentile(kwSorted, 95);
    const kwP99 = percentile(kwSorted, 99);

    store.close();

    // ── Inject embeddings for vector search ────────────────────────────────
    console.log(`\n  Injecting random ${VECTOR_DIM}-dim embeddings into chunks...`);
    injectRandomEmbeddings(researchIndexPath(tmp), VECTOR_DIM);

    // Re-open store
    const store2Result = ResearchStore.open(tmp);
    if (!store2Result.ok) {
      console.error(`Failed to reopen store: ${store2Result.error.message}`);
      process.exit(1);
    }
    const store2 = store2Result.data;

    // ── Benchmark: vector search (raw DB scan) ─────────────────────────────
    console.log(`  Running ${SEARCH_ITERATIONS} vector searches (raw DB scan)...`);
    const vectorTimes: number[] = [];
    for (const v of vectors) {
      const start = performance.now();
      const result = store2.searchVector(v, { k: K });
      const elapsed = performance.now() - start;
      if (result.ok) vectorTimes.push(elapsed);
    }
    const vecSorted = [...vectorTimes].sort((a, b) => a - b);
    const vecP50 = percentile(vecSorted, 50);
    const vecP95 = percentile(vecSorted, 95);
    const vecP99 = percentile(vecSorted, 99);

    store2.close();

    // ── Report ─────────────────────────────────────────────────────────────
    keywordPassed = kwP95 <= 80;
    vectorPassed = vecP95 <= 150;

    console.log('');
    console.log('=== Research Base Performance Bench ===');
    console.log('Indexer:');
    console.log(`  1000 files indexed in N/A (indexer bench in separate run)`);
    console.log('');
    console.log('Search (keyword):');
    console.log(`  ${SEARCH_ITERATIONS} queries, ${totalChunks} chunks`);
    console.log(`  p50=${kwP50.toFixed(2)}ms  p95=${kwP95.toFixed(2)}ms  p99=${kwP99.toFixed(2)}ms  [${keywordPassed ? 'PASS p95≤80ms' : 'WARN p95>80ms'}]`);
    console.log('');
    console.log('Search (vector scan, raw):');
    console.log(`  ${vectorTimes.length} queries, ${totalChunks} chunks`);
    console.log(`  p50=${vecP50.toFixed(2)}ms  p95=${vecP95.toFixed(2)}ms  p99=${vecP99.toFixed(2)}ms  [${vectorPassed ? 'PASS p95≤150ms' : 'WARN p95>150ms'}]`);
    console.log('');

    if (!keywordPassed || !vectorPassed) {
      process.exit(1);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

await main();
