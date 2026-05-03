/**
 * Markdown-aware chunker for the Research Base indexer.
 *
 * Splits markdown body (post-frontmatter) into H2/H3-bounded chunks capped at
 * a configurable token limit.  Oversized sections are sub-divided on sentence
 * boundaries while never splitting inside ``` code fences.  Adjacent
 * sub-chunks within the same section optionally share a configurable sentence
 * overlap for retrieval-quality continuity.
 *
 * Pure function — no I/O, no third-party dependencies, ~270 LOC.
 */

export interface Chunk {
  index: number;
  text: string;
  headingPath: string[];
  headingSlug: string | null;
  tokens: number;
  tags: string[];
}

export interface ChunkOptions {
  maxTokens?: number;
  overlapSentences?: number;
}

// ─── Token estimation ──────────────────────────────────────────────────────

/** cl100k approximation: ~4 chars per token, ceiling. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Line-ending normalisation ─────────────────────────────────────────────

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// ─── Slug ──────────────────────────────────────────────────────────────────

/** GitHub-style heading slug: lower-kebab, alphanumeric + hyphens only. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Tag extraction ────────────────────────────────────────────────────────

const TAG_RE = /(?:^|\s)#([a-z0-9-]+)/gi;

/** Collect unique `#tag` markers (lowercased, sorted) from `source`. */
function scanTags(source: string): string[] {
  const tags = new Set<string>();
  for (const m of source.matchAll(TAG_RE)) {
    tags.add(m[1].toLowerCase());
  }
  return [...tags].sort();
}

/** Extract tags from the deepest heading text (if any) and the first
 *  non-heading, non-blank line of the chunk body. */
function extractChunkTags(
  lines: string[],
  deepestHeading: string | null,
): string[] {
  const tags = new Set<string>();
  if (deepestHeading !== null) {
    for (const t of scanTags(deepestHeading)) tags.add(t);
  }
  // First non-heading, non-blank line (headings start with "# " not "#word")
  const isHeading = (l: string): boolean => /^#{1,6}\s/.test(l.trim());
  const firstBodyLine = lines.find((l) => l.trim().length > 0 && !isHeading(l));
  if (firstBodyLine !== undefined) {
    for (const t of scanTags(firstBodyLine)) tags.add(t);
  }
  return [...tags].sort();
}

// ─── Sentence splitting ────────────────────────────────────────────────────

/** Words that look like sentence terminators but are abbreviations. */
const ABBREV = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'jr',
  'sr', 'inc', 'ltd', 'co', 'corp', 'jan', 'feb', 'mar', 'apr', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'approx', 'dept', 'est',
  'min', 'max', 'fig', 'eq', 'al', 'no', 'vol', 'rev', 'ed', 'p', 'pp',
]);

/**
 * Find sentence-end positions in `text`.
 *
 * A sentence ends at `.`, `!`, or `?` followed by whitespace and an
 * uppercase letter or digit.  Known abbreviations (e.g.  "e.g.", "Dr.")
 * are excluded.
 *
 * Returns offsets that point one character past the last whitespace of the
 * sentence-ending pattern (i.e. right before the first letter of the next
 * sentence).
 */
function findSentenceEnds(text: string): number[] {
  const ends: number[] = [];
  const re = /[.!?]\s+(?=[A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Word before the punctuation
    const before = text.slice(0, m.index + 1);
    const words = before.split(/\s+/);
    const lastWord = (words.pop() ?? '').toLowerCase();
    const clean = lastWord.replace(/[.!?]$/, '');
    if (ABBREV.has(clean)) continue;
    ends.push(m.index + m[0].length);
  }
  return ends;
}

// ─── Code-fence detection ──────────────────────────────────────────────────

interface FenceSpan {
  start: number;
  end: number;
}

/**
 * Locate every pair of ``` fence delimiters in `text`.
 *
 * Only recognises backtick triples at the start of a line.  An unclosed
 * opening fence is treated as extending to end-of-text so the trailing
 * content is never split.
 */
function findCodeFences(text: string): FenceSpan[] {
  const spans: FenceSpan[] = [];
  let opening: number | null = null;
  let i = 0;
  while (i < text.length) {
    if (
      text[i] === '`' &&
      text[i + 1] === '`' &&
      text[i + 2] === '`' &&
      (i === 0 || text[i - 1] === '\n')
    ) {
      if (opening === null) {
        opening = i;
      } else {
        const end = i + 3 + (text[i + 3] === '\n' ? 1 : 0);
        spans.push({ start: opening, end });
        opening = null;
      }
      i += 3;
      continue;
    }
    i++;
  }
  if (opening !== null) {
    spans.push({ start: opening, end: text.length });
  }
  return spans;
}

function inFence(pos: number, fences: FenceSpan[]): boolean {
  return fences.some((f) => pos > f.start && pos < f.end);
}

// ─── Section parsing ───────────────────────────────────────────────────────

interface RawSection {
  headingPath: string[];
  text: string;
}

/**
 * Walk `body` line-by-line and partition it into H2 / H3-bounded sections.
 *
 * - The implicit "intro" section (content before the first H2/H3) inherits
 *   a leading H1 as its heading path when one exists.
 * - H4+ headings stay inside their parent H3 section.
 * - Line endings are normalised to LF before processing.
 */
function parseSections(body: string): RawSection[] {
  const normalized = normalizeLineEndings(body);
  const lines = normalized.split('\n');

  const sections: RawSection[] = [];
  let h1: string | null = null;
  let h2: string | null = null;
  let h3: string | null = null;
  let buffer: string[] = [];
  let seenHeading = false;

  function flush(): void {
    const text = buffer.join('\n').trim();
    if (text.length > 0) {
      const headingPath: string[] = [];
      if (h1 !== null && h1.length > 0) headingPath.push(h1);
      if (h2 !== null) headingPath.push(h2);
      if (h3 !== null) headingPath.push(h3);
      sections.push({ headingPath, text });
    }
    buffer = [];
  }

  for (const line of lines) {
    // First H1 — capture for the intro heading path only
    if (line.startsWith('# ') && !seenHeading) {
      h1 = line.slice(2).trim();
      buffer.push(line);
      seenHeading = true;
      continue;
    }

    // H2 (and NOT H3+)
    if (line.startsWith('## ') && line[3] !== '#') {
      flush();
      h1 = null; // H1 only applies to the intro section above it
      h2 = line.slice(3).trim();
      h3 = null;
      buffer.push(line);
      seenHeading = true;
      continue;
    }

    // H3 (and NOT H4+)
    if (line.startsWith('### ') && line[4] !== '#') {
      flush();
      h1 = null; // H1 only applies to the intro section
      h3 = line.slice(4).trim();
      buffer.push(line);
      seenHeading = true;
      continue;
    }

    // H4+ or anything else — accumulate
    buffer.push(line);
  }

  flush();
  return sections;
}

// ─── Sentence-level sub-chunking ───────────────────────────────────────────

/**
 * Split a single section's text into sentence-bounded chunks respecting
 * `maxTokens`.  Code fences are never broken.
 *
 * Returns at least one chunk (even if the text is oversized and has no
 * usable sentence boundaries).
 */
function subChunk(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];

  const fences = findCodeFences(text);
  const ends = findSentenceEnds(text);

  // Partition the text into sentences (skipping boundaries inside fences)
  const sentences: string[] = [];
  let start = 0;
  for (const end of ends) {
    if (inFence(end, fences)) continue;
    const sentence = text.slice(start, end).trim();
    if (sentence.length > 0) sentences.push(sentence);
    start = end;
  }
  const last = text.slice(start).trim();
  if (last.length > 0) sentences.push(last);

  // If we found no usable boundaries, return the text as one chunk.
  if (sentences.length <= 1) return [text];

  // Group sentences into ≤ maxTokens chunks
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const combined = current ? `${current} ${sentence}` : sentence;
    if (estimateTokens(combined) > maxTokens && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = combined;
    }
  }
  const tail = current.trim();
  if (tail.length > 0) chunks.push(tail);

  return chunks.length > 0 ? chunks : [text];
}

// ─── Overlap ───────────────────────────────────────────────────────────────

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Prepend the last N sentences of chunk `prev` to chunk `curr` when both
 * share the same heading path (i.e. they are sub-chunks of the same
 * section).  No overlap is applied across major heading boundaries.
 */
function applyOverlap(
  chunks: Omit<Chunk, 'index'>[],
  overlapSentences: number,
): Omit<Chunk, 'index'>[] {
  if (overlapSentences <= 0 || chunks.length <= 1) return chunks;

  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1]!;
    const curr = chunks[i]!;
    if (!arraysEqual(prev.headingPath, curr.headingPath)) continue;

    // Extract tail sentences from the previous chunk
    const prevFences = findCodeFences(prev.text);
    const prevEnds = findSentenceEnds(prev.text);
    const prevSentences: string[] = [];
    let s = 0;
    for (const e of prevEnds) {
      if (inFence(e, prevFences)) continue;
      const sentence = prev.text.slice(s, e).trim();
      if (sentence.length > 0) prevSentences.push(sentence);
      s = e;
    }
    const lastSentence = prev.text.slice(s).trim();
    if (lastSentence.length > 0) prevSentences.push(lastSentence);

    const overlap = prevSentences.slice(-overlapSentences).join(' ');
    if (overlap.length > 0) {
      curr.text = `${overlap} ${curr.text}`;
      curr.tokens = estimateTokens(curr.text);
    }
  }

  return chunks;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Chunk a markdown body (after frontmatter has already been stripped).
 *
 * ```ts
 * const { body } = parseFrontmatter(doc);   // from frontmatter.ts
 * const chunks = chunkMarkdown(body, { maxTokens: 512, overlapSentences: 1 });
 * ```
 */
export function chunkMarkdown(body: string, opts?: ChunkOptions): Chunk[] {
  const maxTokens = opts?.maxTokens ?? 512;
  const overlapSentences = opts?.overlapSentences ?? 1;
  // Suppress overlap only when chunks are tiny relative to overlap cost
  const effectiveOverlap = maxTokens >= 24 ? overlapSentences : 0;

  // Empty / whitespace-only bodies produce no chunks.
  if (body.trim().length === 0) return [];

  // 1. Parse into H2/H3-bounded sections
  const sections = parseSections(body);
  if (sections.length === 0) return [];

  // 2. Sub-chunk each section, producing unindexed chunk objects
  const raw: Omit<Chunk, 'index'>[] = [];
  for (const section of sections) {
    const deepest = section.headingPath.at(-1) ?? null;
    const headingSlug = deepest !== null ? slugify(deepest) : null;
    const subTexts = subChunk(section.text, maxTokens);

    for (const text of subTexts) {
      raw.push({
        text,
        headingPath: [...section.headingPath],
        headingSlug,
        tokens: estimateTokens(text),
        tags: [],
      });
    }
  }

  // 3. Apply sentence-overlap between adjacent chunks of the same section
  const overlapped = applyOverlap(raw, effectiveOverlap);

  // 4. Compute per-chunk tags from heading + first body line
  for (const chunk of overlapped) {
    const deepest = chunk.headingPath.at(-1) ?? null;
    const lines = chunk.text.split('\n');
    chunk.tags = extractChunkTags(lines, deepest);
  }

  // 5. Drop empty chunks (defensive — should never happen after step 2)
  const filtered = overlapped.filter((c) => c.text.trim().length > 0);

  // 6. Assign stable 0-based indices
  return filtered.map((chunk, i) => ({ ...chunk, index: i }));
}
