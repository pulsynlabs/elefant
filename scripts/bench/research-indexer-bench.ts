/**
 * Research Base indexer performance benchmark.
 *
 * Generates 1000 markdown files with valid frontmatter, indexes them with the
 * `disabled` embedding provider (isolating I/O + chunking + DB pipeline),
 * and asserts the total time ≤ 30 seconds per SPEC §3 / MR spec.
 *
 * Usage: bun run scripts/bench/research-indexer-bench.ts
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { IndexerService } from '../../src/research/indexer.ts';
import { createDisabledProvider } from '../../src/research/embeddings/disabled.ts';
import { serializeFrontmatter, autoFillFrontmatter, type Frontmatter } from '../../src/research/frontmatter.ts';
import { researchBaseDir } from '../../src/project/paths.ts';

const FILE_COUNT = 1000;
const TIME_LIMIT_MS = 30_000;
const TARGET_WORDS = 200;

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

// Pre-baked text blocks for deterministic but varied content.
const TEXT_BLOCKS = [
  'The system architecture follows a modular design with clear separation of concerns. Each component communicates through well-defined interfaces, enabling independent development and testing.',
  'Data flows through the pipeline in stages, with each stage performing a specific transformation. The stages are connected by queues that provide back-pressure and fault tolerance.',
  'Performance optimization requires careful measurement before any changes are made. Profile the hot paths, identify bottlenecks, and apply targeted improvements rather than premature optimization.',
  'Security considerations are built into the design from the start rather than added as an afterthought. Input validation, authentication, and authorization checks guard every entry point.',
  'The module system supports tree-shaking to eliminate unused code from production bundles. Only the functions and types that are actually imported make it into the final output.',
  'Error handling follows the Result pattern rather than throwing exceptions. Every fallible operation returns a discriminated union that the caller must explicitly handle.',
  'Configuration is managed through a layered system with sensible defaults. Environment-specific overrides can be applied without modifying the core configuration files.',
  'Testing strategy follows the testing pyramid: many unit tests, fewer integration tests, and even fewer end-to-end tests. Each layer catches different classes of bugs.',
  'The observable layer emits structured telemetry that can be consumed by various backends. Metrics, traces, and logs follow consistent naming conventions across the system.',
  'Dependency injection decouples components from their implementations. Interfaces define contracts, and concrete implementations are provided at runtime through an inversion-of-control container.',
  'Concurrency primitives like mutexes, channels, and atomic operations provide safe access to shared state. The runtime scheduler ensures fair execution across all active tasks.',
  'Serialization formats are chosen based on the specific requirements of each use case. JSON for human-readable configs, Protocol Buffers for high-throughput RPC, and MessagePack for balanced performance.',
  'Database schema migrations are versioned and reversible. Each migration includes both an up and down path, ensuring that deployments can be rolled back if issues are discovered.',
  'Caching strategies vary by data access pattern and freshness requirements. Write-through, write-back, and read-aside patterns each have different trade-offs for consistency and performance.',
  'Authentication uses a token-based approach with short-lived access tokens and longer-lived refresh tokens. The refresh token rotation policy limits the window for compromised credentials.',
  'The plugin architecture allows third-party extensions to integrate deeply with the core system. Extension points are defined through stable APIs with semantic versioning guarantees.',
  'Monitoring dashboards provide real-time visibility into system health. Key metrics include request latency, error rates, throughput, and resource utilization across all service instances.',
  'Code generation reduces boilerplate and ensures consistency across the codebase. Templates generate repetitive code from canonical sources of truth like protobuf schemas and database models.',
  'Message queues provide asynchronous communication between services. They decouple producers from consumers, enable retry logic, and smooth out traffic spikes during peak load.',
  'The search index uses an inverted index data structure for fast full-text queries. Tokenization, stemming, and stop-word removal are applied during both indexing and query processing.',
];

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function generateBody(wordCount: number): string {
  const parts: string[] = [];
  let total = 0;
  // Cycle through text blocks with section headings to create realistic chunked content
  let sectionNum = 0;
  while (total < wordCount) {
    const block = TEXT_BLOCKS[(sectionNum + total) % TEXT_BLOCKS.length]!;
    parts.push(`## Section ${sectionNum + 1}: ${block.split('.')[0]!}`);
    parts.push(block);
    total += block.split(/\s+/).length + 4; // rough word count
    sectionNum += 1;
  }
  return parts.join('\n\n');
}

function generateFile(
  index: number,
  section: Frontmatter['section'],
  baseDir: string,
): void {
  const words = TARGET_WORDS + Math.floor(Math.random() * 50);
  const body = generateBody(words);

  const fm = autoFillFrontmatter({
    title: `Research Document ${String(index).padStart(4, '0')}: ${section}`,
    section,
    summary: `Auto-generated benchmark document ${index} covering research topics in section ${section}.`,
    author_agent: randomFrom(AUTHORS),
    tags: ['benchmark', 'auto-generated', section.split('-')[1] ?? section],
    sources: ['https://example.com/bench-source'],
    confidence: randomFrom(['high', 'medium', 'low'] as const),
  });

  const content = serializeFrontmatter(fm, body);
  const filePath = join(baseDir, section, `doc-${String(index).padStart(5, '0')}.md`);
  mkdirSync(join(baseDir, section), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

async function main(): Promise<void> {
  const tmp = join(tmpdir(), `elefant-idx-bench-${Date.now()}`);

  try {
    // ── Setup: create project structure ────────────────────────────────────
    mkdirSync(tmp, { recursive: true });
    const base = researchBaseDir(tmp);
    mkdirSync(base, { recursive: true });

    console.log(`Generating ${FILE_COUNT} markdown files...`);
    const genStart = performance.now();
    for (let i = 0; i < FILE_COUNT; i++) {
      const section = SECTIONS[i % SECTIONS.length]!;
      generateFile(i, section, base);
    }
    const genElapsed = performance.now() - genStart;
    console.log(`  Generated ${FILE_COUNT} files in ${Math.round(genElapsed)}ms (${(FILE_COUNT / (genElapsed / 1000)).toFixed(0)} files/s)`);

    // ── Benchmark: bulk index ──────────────────────────────────────────────
    const provider = createDisabledProvider();
    const service = new IndexerService({
      projectPath: tmp,
      projectId: 'idx-bench',
      provider,
    });

    console.log(`\nIndexing ${FILE_COUNT} files with '${provider.name}' provider...`);
    const idxStart = performance.now();
    const result = await service.bulkIndex();
    const idxElapsed = performance.now() - idxStart;

    const indexed = result.ok ? result.data.indexed : 0;
    const skipped = result.ok ? result.data.skipped : 0;
    const errors = result.ok ? result.data.errors : [];
    const rate = indexed / (idxElapsed / 1000);

    // ── Report ─────────────────────────────────────────────────────────────
    console.log('');
    console.log('=== Research Base Indexer Bench ===');
    console.log(`  indexed: ${indexed} files`);
    if (skipped > 0) console.log(`  skipped: ${skipped} files`);
    if (errors.length > 0) {
      console.log(`  errors: ${errors.length}`);
      for (const err of errors.slice(0, 5)) console.log(`    - ${err}`);
    }
    console.log(`  time: ${Math.round(idxElapsed)}ms`);
    console.log(`  rate: ${rate.toFixed(1)} files/s`);

    const passed = idxElapsed <= TIME_LIMIT_MS;
    console.log(`  ${passed ? 'PASS' : 'FAIL'} ≤${TIME_LIMIT_MS / 1000}s`);
    console.log('');

    if (!passed) {
      process.exit(1);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

await main();
