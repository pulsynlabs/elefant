---
id: field-notes-output-format
title: Field Notes Output Format
description: Conventions for writer agents outputting to the Elefant Field Notes — structure, tone, citation format.
tags:
  - field-notes
  - writer
audience:
  - writer
version: 1.0.0
---

# Field Notes Output Format

Writer agents are responsible for producing high-quality, citeable field notes documents in the Elefant Field Notes. This reference defines the structural, tonal, and citation conventions that every writer agent must follow.

## Document Structure

Every research document should follow a three-section structure, even if sections are collapsed into fewer headings for short notes.

### Abstract (Required)

A 1-3 sentence summary at the top of the body (distinct from the frontmatter `summary` field). The abstract answers: *What did we learn? Why does it matter?*

```markdown
## Abstract

sqlite-vec with the bundled-cpu embedding provider achieves 3x faster k=10
queries than pgvector on consumer hardware for datasets under 1M vectors.
This confirms the default embedding configuration is sufficient for all
expected Elefant project sizes.
```

### Findings (Required)

The body of the document. Organize findings by topic or question. Each finding must cite its source.

```markdown
## Findings

### Cold-start query latency

sqlite-vec with Xenova/all-MiniLM-L6-v2 returns k=10 results in 12ms
on a Ryzen 7 7840U with 32 GB RAM [1]. pgvector on the same hardware
takes 38ms for equivalent queries [2].

### Index build time
...
```

### Implications (Optional but Recommended)

What should be built, changed, or investigated based on these findings? Include confidence markers when implications are speculative.

```markdown
## Implications

- **Action**: Keep the default bundled-cpu provider for Elefant 1.0.
  No need to recommend bundled-gpu unless user datasets exceed 500K documents. (confidence: high)
- **Investigate**: sqlite-vec's WAL mode impact on concurrent read/write under
  agent workloads. (confidence: speculative)
```

## Tone

- **Factual, not editorial**: State what you found, not what you think about what you found. Use confidence tags to qualify uncertainty.
- **Sourced, not asserted**: Every claim links to a source in the frontmatter `sources` field. Use inline `[N]` references.
- **Actionable, not academic**: Focus on what an agent or developer should do with this information. Avoid literature-review style.
- **Neutral, not promotional**: Compare technologies objectively. Document tradeoffs, not preferences.

## Citation Format

Use inline numeric references `[1]`, `[2]` that correspond to entries in the frontmatter `sources` array.

**Body:**
```markdown
The OpenCode plugin system uses Effect-TS for service composition [1].
This pattern avoids circular dependencies common in class-based DI [2].
```

**Frontmatter:**
```yaml
sources:
  - https://github.com/anomalyco/opencode/blob/main/docs/plugins.md
  - src/research/02-tech/dependency-injection-comparison.md
```

Do not use footnote-style citations (`[^1]`) or author-date (`(Smith, 2026)`). Keep it simple: numeric references that map 1:1 to `sources` entries.

## Confidence Tagging

Every significant claim must carry a confidence signal, either in the frontmatter `confidence` field (document-level) or inline for claim-level granularity.

### When to Use Each Level

| Tag | Signal | Example |
|-----|--------|---------|
| `confidence: high` | You ran the experiment, read the source, or verified with primary data | "sqlite-vec returns results in 12ms (measured on Ryzen 7 7840U)" |
| `confidence: medium` | Cross-referenced documentation and community consensus | "pgvector is the most widely deployed Postgres vector extension" |
| `confidence: low` | Inference from limited data or single secondary source | "sqlite-vec may support GPU acceleration in a future release" |
| *(speculative)* | Reasoning from first principles without direct evidence | "The RRF fusion approach could degrade with highly overlapping result sets" |

For inline confidence markers, use parenthetical qualifiers:

```markdown
sqlite-vec may support GPU-accelerated indexing in a future release (confidence: low).

The RRF k=60 parameter appears optimal for field notes documents averaging
500–2000 words (confidence: speculative).
```

## Anti-Patterns

### No Opinion Without Evidence

Bad:
```markdown
We should use sqlite-vec because it's clearly the best vector database.
```

Good:
```markdown
sqlite-vec is recommended as the default embedding store because it has zero
external dependencies, matches the existing SQLite stack, and its 12ms query
latency meets Elefant's < 50ms target for search-triggered reads [1].
(confidence: high)
```

### No Undated Claims

Every file carries `created` and `updated` timestamps. When documenting time-sensitive findings (benchmark results, dependency versions, API behaviours), include the date or version in the body:

```markdown
As of sqlite-vec v0.1.6 (May 2026), the cosine distance function uses
f32 precision internally.
```

### No Hallucinated Sources

The `sources` array must contain only real, accessible resources you have reviewed. If you are synthesizing from general knowledge, mark the document `confidence: low` and explain the inference chain in the body.

### No GoopSpec Terminology

The Field Notes is an Elefant feature. Documents should reference Elefant's own tools, agent kinds, and concepts. Do not describe GoopSpec phases, waves, or spec-lock gates — those are foreign concepts in the Elefant system.

## Formatting Rules

- Use standard markdown links: `[text](path-or-url)`
- Use `fieldnotes://` URIs for cross-references to other field notes documents
- Use fenced code blocks with language tags for code snippets
- Use tables for structured comparisons (but keep them narrow — max 4 columns)
- Do not use `[[wikilinks]]` (Obsidian syntax)
- Do not use HTML in body content (fenced code blocks are the exception)
