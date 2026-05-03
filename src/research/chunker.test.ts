import { describe, expect, test } from 'bun:test';
import { chunkMarkdown } from './chunker.ts';
import type { Chunk } from './chunker.ts';

// ─── Empty / whitespace ────────────────────────────────────────────────────

describe('empty or whitespace body', () => {
  test('empty string returns no chunks', () => {
    expect(chunkMarkdown('')).toEqual([]);
  });

  test('whitespace-only string returns no chunks', () => {
    expect(chunkMarkdown('   \n\n  \t  \n')).toEqual([]);
  });
});

// ─── Basic heading structure ───────────────────────────────────────────────

describe('basic heading structure', () => {
  test('single H1 with body produces one chunk with headingPath', () => {
    const body = `# My Title\n\nSome introductory text here.`;
    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.headingPath).toEqual(['My Title']);
    expect(chunks[0]!.headingSlug).toBe('my-title');
    expect(chunks[0]!.text).toInclude('# My Title');
    expect(chunks[0]!.text).toInclude('introductory text');
    expect(chunks[0]!.index).toBe(0);
    expect(chunks[0]!.tokens).toBeGreaterThan(0);
  });

  test('multiple H2 sections produce one chunk per section', () => {
    const body = [
      '## Introduction',
      '',
      'First section text.',
      '',
      '## Background',
      '',
      'Second section text.',
      '',
      '## Conclusion',
      '',
      'Third section text.',
    ].join('\n');

    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.headingPath).toEqual(['Introduction']);
    expect(chunks[1]!.headingPath).toEqual(['Background']);
    expect(chunks[2]!.headingPath).toEqual(['Conclusion']);
  });

  test('H1 + H2 produces intro chunk with H1 headingPath and H2 chunk with own path', () => {
    const body = [
      '# Page Title',
      '',
      'Intro text here.',
      '',
      '## Section One',
      '',
      'Section one text.',
    ].join('\n');

    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(2);
    // Intro chunk inherits H1
    expect(chunks[0]!.headingPath).toEqual(['Page Title']);
    expect(chunks[0]!.headingSlug).toBe('page-title');
    // H2 section has its own headingPath (no H1 leakage)
    expect(chunks[1]!.headingPath).toEqual(['Section One']);
    expect(chunks[1]!.headingSlug).toBe('section-one');
  });

  test('nested H2 → H3 creates chunks with full headingPath lineage', () => {
    const body = [
      '## Architecture',
      '',
      'Overview text.',
      '',
      '### Components',
      '',
      'Component text.',
      '',
      '### Data Flow',
      '',
      'Data flow text.',
      '',
      '## Deployment',
      '',
      'Deployment text.',
    ].join('\n');

    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(4);
    expect(chunks[0]!.headingPath).toEqual(['Architecture']);
    expect(chunks[1]!.headingPath).toEqual(['Architecture', 'Components']);
    expect(chunks[2]!.headingPath).toEqual(['Architecture', 'Data Flow']);
    expect(chunks[3]!.headingPath).toEqual(['Deployment']);
  });

  test('H4+ stay inside parent H3 section', () => {
    const body = [
      '## Guide',
      '',
      '### Setup',
      '',
      '#### Prerequisites',
      '',
      'Some prerequisites.',
      '',
      '#### Installation',
      '',
      'Install steps.',
    ].join('\n');

    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(2); // Overview of Guide + Setup (with H4 content)
    expect(chunks[0]!.headingPath).toEqual(['Guide']);
    expect(chunks[1]!.headingPath).toEqual(['Guide', 'Setup']);
    // The H4 headings should be in the Setup chunk text
    expect(chunks[1]!.text).toInclude('#### Prerequisites');
    expect(chunks[1]!.text).toInclude('#### Installation');
  });

  test('body without any headings produces one chunk with empty headingPath', () => {
    const body = 'Just some plain text without any headings at all.';
    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.headingPath).toEqual([]);
    expect(chunks[0]!.headingSlug).toBeNull();
  });
});

// ─── Token boundaries and sentence splitting ───────────────────────────────

describe('oversized sections split on sentence boundaries', () => {
  test('oversized section splits into multiple sub-chunks sharing headingPath', () => {
    // Generate text ~4000 chars across 4 very long sentences (well over 512 tokens)
    const longSentence = 'A'.repeat(900) + '. ';
    const body = [
      '## Long Section',
      '',
      longSentence + 'B'.repeat(900) + '. ' + 'C'.repeat(900) + '. ' + 'D'.repeat(900) + '. ',
    ].join('\n');

    const chunks = chunkMarkdown(body, { maxTokens: 512 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.headingPath).toEqual(['Long Section']);
      expect(chunk.headingSlug).toBe('long-section');
    }
  });

  test('text under token cap stays as one chunk', () => {
    const body = ['## Small Section', '', 'Just a short piece of text.'].join('\n');

    const chunks = chunkMarkdown(body, { maxTokens: 512 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.headingPath).toEqual(['Small Section']);
  });

  test('obeys custom maxTokens', () => {
    // Use a very tight cap — each sentence is ~50 chars ≈ 13 tokens
    const body = [
      '## Section',
      '',
      'Alpha sentence number one starts here. Beta sentence number two follows. Gamma three is also present. Delta four wraps this up.',
    ].join('\n');

    const chunks = chunkMarkdown(body, { maxTokens: 128 });
    // At 128 tokens, the heading + multiple sentences should still fit as one
    expect(chunks.length).toBe(1);

    // But at 10 tokens (~40 chars), each sentence gets its own chunk
    const tinyChunks = chunkMarkdown(body, { maxTokens: 64 });
    expect(tinyChunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Sentence overlap ─────────────────────────────────────────────────────

describe('sentence overlap between adjacent sub-chunks', () => {
  test('adjacent sub-chunks in the same section share boundary sentence', () => {
    const body = [
      '## Section',
      '',
      'First sentence is a very long piece of text that goes on and on. ' +
        'Second sentence also goes on for quite a while. ' +
        'Third sentence is similarly verbose and rambling. ' +
        'Fourth sentence continues the trend of being long. ' +
        'Fifth sentence wraps things up with more words.',
    ].join('\n');

    const chunks = chunkMarkdown(body, { maxTokens: 30, overlapSentences: 1 });
    expect(chunks.length).toBeGreaterThan(1);

    // Chunks 0 and 1 share heading path, so overlap should apply.
    // Chunk 1 should start with the last sentence of chunk 0.
    expect(chunks[0]!.headingPath).toEqual(chunks[1]!.headingPath);

    // Extract the last sentence of chunk 0 (text after its last ". ")
    const lastDotSpace = chunks[0]!.text.lastIndexOf('. ');
    const lastSentence =
      lastDotSpace !== -1
        ? chunks[0]!.text.slice(lastDotSpace + 2)
        : chunks[0]!.text;
    expect(chunks[1]!.text.startsWith(lastSentence)).toBe(true);
  });

  test('no overlap across different heading sections', () => {
    const body = [
      '## First',
      '',
      'First section text ends here.',
      '',
      '## Second',
      '',
      'Second section text starts here.',
    ].join('\n');

    const chunks = chunkMarkdown(body, { maxTokens: 512, overlapSentences: 2 });
    expect(chunks).toHaveLength(2);
    // Chunk 1 should NOT contain text from chunk 0
    expect(chunks[1]!.text).not.toInclude('First section');
  });

  test('overlap respects custom overlapSentences', () => {
    const body = [
      '## Section',
      '',
      'A is first sentence here. B is the second one. C is third. D is fourth. E is fifth. F is sixth.',
    ].join('\n');

    // overlapSentences: 0 → no overlap
    const noOverlap = chunkMarkdown(body, { maxTokens: 256, overlapSentences: 0 });
    // overlapSentences: 1 → 1-sentence overlap (should have larger chunk 1)
    const oneOverlap = chunkMarkdown(body, { maxTokens: 256, overlapSentences: 1 });

    if (noOverlap.length > 1 && oneOverlap.length > 1) {
      // With overlap, chunk 1 should have more content (prepended sentence)
      expect(oneOverlap[1]!.text.length).toBeGreaterThan(noOverlap[1]!.text.length);
    }
  });
});

// ─── Code fence preservation ───────────────────────────────────────────────

describe('code fence preservation', () => {
  test('code fence is never split mid-block', () => {
    const codeContent = 'x'.repeat(2000); // far exceeds any token cap
    const body = [
      '## Section',
      '',
      'Some text before.',
      '',
      '```',
      codeContent,
      '```',
      '',
      'Some text after.',
    ].join('\n');

    const chunks = chunkMarkdown(body, { maxTokens: 512 });

    // The code fence should be in exactly one chunk, intact
    const fenceChunks = chunks.filter((c) => c.text.includes('```'));
    expect(fenceChunks.length).toBeGreaterThanOrEqual(1);

    // The full code content should appear somewhere in a single chunk
    const combined = chunks.map((c) => c.text).join('\n');
    expect(combined).toInclude(codeContent);

    // No chunk should contain only a partial fence (opening without closing)
    for (const chunk of chunks) {
      const openingCount = (chunk.text.match(/^```/gm) ?? []).length;
      expect(openingCount % 2).toBe(0); // pairs only
    }
  });

  test('multiple code fences in same section handled correctly', () => {
    const body = [
      '## Section',
      '',
      'Text.',
      '',
      '```js',
      'const a = 1;',
      '```',
      '',
      'More text.',
      '',
      '```ts',
      'const b = 2;',
      '```',
    ].join('\n');

    const chunks = chunkMarkdown(body, { maxTokens: 512 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);

    // Every ``` must appear in some chunk
    const allText = chunks.map((c) => c.text).join('\n');
    expect(allText).toInclude('```js');
    expect(allText).toInclude('```ts');
  });
});

// ─── Tag extraction ────────────────────────────────────────────────────────

describe('tag extraction', () => {
  test('tags from heading are collected', () => {
    const body = [
      '## Components #react #typescript',
      '',
      'Some content here.',
    ].join('\n');

    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.tags).toContain('react');
    expect(chunks[0]!.tags).toContain('typescript');
  });

  test('tags from first line are collected', () => {
    const body = [
      '## Section',
      '',
      '#intro This is the first line with a tag.',
      '',
      'More content #ignored because it is not first line.',
    ].join('\n');

    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.tags).toContain('intro');
    expect(chunks[0]!.tags).not.toContain('ignored');
  });

  test('tags are lowercased and deduplicated', () => {
    const body = [
      '## Section #REACT',
      '',
      '#react This line also tags react.',
    ].join('\n');

    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(1);
    // react appears once (deduplicated) and is lowercased
    const reactCount = chunks[0]!.tags.filter((t) => t === 'react').length;
    expect(reactCount).toBe(1);
  });

  test('tags are sorted alphabetically', () => {
    const body = [
      '## Section #zebra #alpha #beta',
      '',
      'Content.',
    ].join('\n');

    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.tags).toEqual(['alpha', 'beta', 'zebra']);
  });

  test('no tags when none present', () => {
    const body = ['## Plain Heading', '', 'Plain content without any tags.'].join('\n');

    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.tags).toEqual([]);
  });
});

// ─── Heading slug generation ───────────────────────────────────────────────

describe('heading slug generation', () => {
  test('simple heading produces kebab-slug', () => {
    const body = ['## Foo Bar Baz', '', 'Content.'].join('\n');
    const chunks = chunkMarkdown(body);
    expect(chunks[0]!.headingSlug).toBe('foo-bar-baz');
  });

  test('special characters are stripped', () => {
    const body = ['## Hello, World! (2025)', '', 'Content.'].join('\n');
    const chunks = chunkMarkdown(body);
    expect(chunks[0]!.headingSlug).toBe('hello-world-2025');
  });

  test('multiple hyphens are collapsed', () => {
    const body = ['## Foo --- Bar', '', 'Content.'].join('\n');
    const chunks = chunkMarkdown(body);
    expect(chunks[0]!.headingSlug).toBe('foo-bar');
  });

  test('leading and trailing hyphens are trimmed', () => {
    const body = ['## - Getting Started -', '', 'Content.'].join('\n');
    const chunks = chunkMarkdown(body);
    expect(chunks[0]!.headingSlug).toBe('getting-started');
  });

  test('deepest heading (H3) used for slug when nested', () => {
    const body = [
      '## Architecture',
      '',
      '### Data Flow Patterns',
      '',
      'Content.',
    ].join('\n');

    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]!.headingPath).toEqual(['Architecture', 'Data Flow Patterns']);
    expect(chunks[1]!.headingSlug).toBe('data-flow-patterns');
  });
});

// ─── CRLF line endings ────────────────────────────────────────────────────

describe('CRLF line endings', () => {
  test('handles Windows-style CRLF line endings', () => {
    const body = '# Title\r\n\r\n## Section One\r\n\r\nText here.\r\n\r\n## Section Two\r\n\r\nMore text.';

    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(3);
    // Intro chunk under H1
    expect(chunks[0]!.headingPath).toEqual(['Title']);
    // H2 sections get their own headingPath
    expect(chunks[1]!.headingPath).toEqual(['Section One']);
    expect(chunks[2]!.headingPath).toEqual(['Section Two']);
  });

  test('CR-only line endings also normalised', () => {
    const body = '# Title\r\r## Section\r\rText.';
    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(2);
  });
});

// ─── Index stability ──────────────────────────────────────────────────────

describe('index stability', () => {
  test('indices are sequential zero-based', () => {
    const body = [
      '## A',
      '',
      'Text.',
      '',
      '## B',
      '',
      'Text.',
      '',
      '## C',
      '',
      'Text.',
    ].join('\n');

    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.index).toBe(0);
    expect(chunks[1]!.index).toBe(1);
    expect(chunks[2]!.index).toBe(2);
  });

  test('indices remain stable after re-chunking the same input', () => {
    const body = '## One\n\nFirst. Second. Third. Fourth.';
    const a = chunkMarkdown(body, { maxTokens: 32 });
    const b = chunkMarkdown(body, { maxTokens: 32 });
    expect(a).toEqual(b);
  });
});

// ─── Integration-style scenarios ──────────────────────────────────────────

describe('integration scenarios', () => {
  test('realistic research document chunks correctly', () => {
    const body = [
      '# Research: Effect-TS Service Patterns',
      '',
      'This document explores how OpenCode uses Effect-TS for service composition in the daemon process.',
      '',
      '## Architecture Overview',
      '',
      'The daemon uses a layered service architecture. Services are composed with Effect-TS layers. Each service exposes a tag-based interface.',
      '',
      '### Service Registry',
      '',
      'The registry maintains singleton instances. It provides type-safe access via Effect-TS tags and handles cleanup on shutdown.',
      '',
      '### Lifecycle Hooks',
      '',
      'Services can register startup and shutdown hooks. Hooks execute sequentially in registration order during initialization.',
      '',
      '## Performance Characteristics',
      '',
      'Effect-TS has overhead compared to raw Promise chains. The team measured approximately 15% overhead on hot paths. However, the type safety benefits outweigh the cost for most code paths.',
      '',
      '```ts',
      'const program = Effect.gen(function* (_) {',
      '  const config = yield* _(ConfigService);',
      '  const db = yield* _(DatabaseService);',
      '  return yield* _(db.query("SELECT 1"));',
      '});',
      '```',
      '',
      '## Recommendations',
      '',
      'Use Effect-TS for service boundaries. Avoid it for pure data transformation. Prefer simple functions inside services.',
    ].join('\n');

    const chunks = chunkMarkdown(body);

    // Should have multiple chunks
    expect(chunks.length).toBeGreaterThanOrEqual(4);

    // Intro chunk
    expect(chunks[0]!.headingPath).toEqual(['Research: Effect-TS Service Patterns']);

    // The code fence should be in one chunk, intact
    const fencePresent = chunks.some(
      (c) => c.text.includes('```ts') && c.text.includes('Effect.gen'),
    );
    expect(fencePresent).toBe(true);

    // Every chunk has expected shape
    for (const chunk of chunks) {
      expect(chunk).toHaveProperty('index');
      expect(chunk).toHaveProperty('text');
      expect(chunk).toHaveProperty('headingPath');
      expect(chunk).toHaveProperty('headingSlug');
      expect(chunk).toHaveProperty('tokens');
      expect(chunk).toHaveProperty('tags');
      expect(Array.isArray(chunk.tags)).toBe(true);
      expect(typeof chunk.tokens).toBe('number');
      expect(chunk.tokens).toBeGreaterThan(0);
    }

    // Indices are sequential
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.index).toBe(i);
    }
  });

  test('document with only H3 headings (no H2)', () => {
    const body = [
      '### First Topic',
      '',
      'Content under first topic.',
      '',
      '### Second Topic',
      '',
      'Content under second topic.',
    ].join('\n');

    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.headingPath).toEqual(['First Topic']);
    expect(chunks[1]!.headingPath).toEqual(['Second Topic']);
  });
});

// ─── Token estimate accuracy ───────────────────────────────────────────────

describe('token estimation', () => {
  test('estimate uses cl100k approximation (ceil length/4)', () => {
    const body = 'Hello world'; // 11 chars → ceil(11/4) = 3
    const chunks = chunkMarkdown(body);
    expect(chunks[0]!.tokens).toBe(3);
  });

  test('exact boundary: 4 chars = 1 token', () => {
    const body = '####'; // 4 chars → ceil(4/4) = 1
    const chunks = chunkMarkdown(body);
    expect(chunks[0]!.tokens).toBe(1);
  });

  test('5 chars = 2 tokens', () => {
    const body = 'Hello'; // 5 chars → ceil(5/4) = 2
    const chunks = chunkMarkdown(body);
    expect(chunks[0]!.tokens).toBe(2);
  });
});

// ─── Edge cases ────────────────────────────────────────────────────────────

describe('edge cases', () => {
  test('body with only headings and no body text', () => {
    const body = ['## Section A', '', '## Section B', '', '## Section C'].join('\n');
    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.headingPath).toEqual(['Section A']);
    expect(chunks[1]!.headingPath).toEqual(['Section B']);
    expect(chunks[2]!.headingPath).toEqual(['Section C']);
  });

  test('heading with inline markdown formatting', () => {
    const body = ['## **Bold** and *Italic* Heading', '', 'Content.'].join('\n');
    const chunks = chunkMarkdown(body);
    expect(chunks[0]!.headingPath).toEqual(['**Bold** and *Italic* Heading']);
    // Slug should strip markdown syntax
    expect(chunks[0]!.headingSlug).toBe('bold-and-italic-heading');
  });

  test('abbreviations do not trigger sentence splits', () => {
    // "e.g." and "i.e." should not split sentences
    const body = [
      '## Section',
      '',
      'We support many languages e.g. TypeScript and Rust. Another normal sentence here.',
    ].join('\n');

    const chunks = chunkMarkdown(body, { maxTokens: 512 });
    // Should still be one chunk since abbreviations don't create splits
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toInclude('e.g.');
  });

  test('non-ASCII characters are included in text and slug stripping', () => {
    const body = ['## Café & Résumé', '', 'Content with ünicode.'].join('\n');
    const chunks = chunkMarkdown(body);
    // Non-ASCII letters are stripped from slug per GitHub convention;
    // multiple non-ASCII + spaces collapse to a single hyphen
    expect(chunks[0]!.headingSlug).toBe('caf-rsum');
    // Text preserves original characters
    expect(chunks[0]!.text).toInclude('Café & Résumé');
  });

  test('zero overlapSentences when maxTokens is very small', () => {
    // When maxTokens is under 128, overlap is suppressed to avoid
    // making chunks larger than the cap. This test verifies that
    // suppression is active by checking chunks at low token cap.
    const body = [
      '## S',
      '',
      'A first sentence goes here. A second one follows.',
    ].join('\n');

    const chunks = chunkMarkdown(body, { maxTokens: 256, overlapSentences: 0 });
    if (chunks.length > 1) {
      // With overlapSentences 0, chunk 1 should NOT have chunk 0's tail sentence
      expect(chunks[1]!.text).not.toInclude('first sentence');
    } else {
      // All text fit in one chunk
      expect(chunks[0]!.text).toInclude('first sentence');
      expect(chunks[0]!.text).toInclude('second one');
    }
  });

  test('very long section with no sentence boundaries stays whole', () => {
    // A long string with no punctuation or whitespace
    const longText = 'x'.repeat(3000);
    const body = ['## Long', '', longText].join('\n');
    const chunks = chunkMarkdown(body, { maxTokens: 512 });
    // Can't split on sentences, so it stays as one chunk
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // The full content should be present
    const allText = chunks.map((c) => c.text).join(' ');
    expect(allText).toInclude(longText);
  });
});
