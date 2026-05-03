---
id: research-base-workflow
title: Research Base Workflow
description: How to use research_search, research_read, research_write, research_index, and research_grep tools effectively.
tags:
  - research-base
  - researcher
  - writer
  - workflow
audience:
  - researcher
  - writer
  - librarian
version: 1.0.0
---

# Research Base Workflow

The Research Base is the project's knowledge repository. Five tools provide read, write, search, and browse access. This reference covers when and how to use each tool.

## Tool Summary

| Tool | Purpose | Who Can Write |
|------|---------|---------------|
| `research_search` | Semantic/hybrid/keyword search | All agents (read-only) |
| `research_grep` | Ripgrep pattern matching within documents | All agents (read-only) |
| `research_read` | Read a file by ID, path, or `research://` link | All agents (read-only) |
| `research_write` | Write or update a file; enforces frontmatter | `researcher`, `writer`, `librarian` |
| `research_index` | List/browse by section, tag, or recency | All agents (read-only) |

## When to Write to Research Base vs. Memory

| Write to Research Base | Write to Memory |
|------------------------|-----------------|
| Primary-source finding | Ephemeral decision log |
| Comparison or analysis | Quick observation |
| Architecture decision record | Session state tracking |
| Reference summary worth citing later | Temporary context |

Rule of thumb: If another agent should cite your finding in a future session, it belongs in the Research Base. If it's relevant only to the current workflow, use memory.

## Writing: `research_write`

Only `researcher`, `writer`, and `librarian` agents can write. Other agents receive a `PERMISSION_DENIED` error.

### Required Parameters

| Parameter | Type | Notes |
|-----------|------|-------|
| `path` | `string` | Relative path from `.elefant/markdown-db/`, e.g. `02-tech/my-notes.md` |
| `title` | `string` | Document title (1–200 chars) |
| `summary` | `string` | Concise summary for indexes and search results (1–500 chars) |
| `body` | `string` | Full markdown body without frontmatter |

### Optional Parameters

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| `section` | `enum` | Required outside `99-scratch/` | One of the 8 section names |
| `tags` | `string[]` | `[]` | String tags for filtering and browsing |
| `sources` | `string[]` | `[]` | Source URLs or citations |
| `confidence` | `'high' \| 'medium' \| 'low'` | `'medium'` | Confidence level |
| `workflow` | `string` | — | Workflow slug for `research://` links |
| `id` | `string` | Auto-generated | Existing UUID to preserve on update |

### Update Behaviour

When `path` matches an existing file, frontmatter is merged: the existing `id` and `created` date are preserved, while `updated`, `title`, `summary`, `body`, and other fields are replaced with the new values. The file is reindexed automatically after each write.

### Section Validation

- `section` must match the first path segment. Writing `02-tech/foo.md` with `section: 03-decisions` is rejected.
- `99-scratch/` paths skip strict frontmatter validation — any section value is accepted.

## Searching: `research_search`

Use `research_search` for finding documents by meaning or keyword.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `string` (required) | — | Search query text |
| `mode` | `'semantic' \| 'keyword' \| 'hybrid'` | `'hybrid'` | Search mode |
| `k` | `number` | 8 | Max results (1–25) |
| `section` | `string` | — | Filter by section, e.g. `02-tech` |
| `tags` | `string[]` | — | Filter by tags; OR logic (any matching tag includes the result) |
| `minScore` | `number` | — | Minimum normalised score threshold (0–1) |

### Search Modes

- **semantic**: Embedding-based retrieval. Falls back to keyword when the embedding provider is `disabled`.
- **keyword**: FTS5 keyword matching. Works without an embedding provider.
- **hybrid**: Combines semantic and keyword results with Reciprocal Rank Fusion (RRF, k=60). Normalised scores 0–1.

### Return Shape

Each result includes:

| Field | Description |
|-------|-------------|
| `path` | Relative path from `.elefant/markdown-db/` |
| `section` | Section directory |
| `title` | Document title from frontmatter |
| `summary` | Summary from frontmatter |
| `score` | Normalised relevance score (0–1) |
| `snippet` | Context window around the matching sentence |
| `frontmatter` | Full parsed frontmatter object |
| `research_link` | Clickable `research://` URI |

## Pattern Matching: `research_grep`

Use `research_grep` for regex-based search within research documents. It delegates to the system's `ripgrep` binary with scope fixed to `.elefant/markdown-db/`.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `pattern` | `string` (required) | — | Regex pattern to search for |
| `section` | `string` | — | Limit to a specific section directory |
| `include` | `string` | — | File glob pattern within the research base |
| `maxFiles` | `number` | 20 | Maximum unique files to return |

### Return Shape

```json
{
  "files": [
    {
      "path": "02-tech/vector-search.md",
      "section": "02-tech",
      "title": "Vector Search Comparison",
      "research_link": "research://_/02-tech/vector-search.md",
      "matches": [
        { "line": 42, "snippet": "sqlite-vec outperforms pgvector by 3x" }
      ],
      "matchCount": 5
    }
  ],
  "totalMatches": 12
}
```

## Reading: `research_read`

Use `research_read` to read a specific file. Provide exactly one of `id`, `path`, or `link`.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Frontmatter UUID (requires store/DB lookup) |
| `path` | `string` | Relative path from `.elefant/markdown-db/` |
| `link` | `string` | `research://` URI |
| `anchor` | `string` | Optional heading slug to extract a specific section |

### Return Shape

| Field | Description |
|-------|-------------|
| `path` | Relative file path |
| `frontmatter` | Parsed frontmatter, or `null` for scratch/lenient reads |
| `body` | Full markdown body after frontmatter stripping |
| `anchorBody` | Extracted section when matching heading found, or `undefined` |
| `research_link` | `research://` URI for this file |
| `wordCount` | Whitespace-delimited word count of body text |

## Browsing: `research_index`

Use `research_index` to browse the Research Base structure without a search query.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `output` | `'tree' \| 'flat'` | `'tree'` | Output format |
| `section` | `string` | — | Filter to a single section |
| `tag` | `string` | — | Exact tag match |
| `recencyDays` | `number` | — | Only documents updated within N days |
| `limit` | `number` | 50 | Maximum documents to return |

### Output Formats

- **tree**: Grouped by section in canonical order (`00-index` through `99-scratch`), each with title, summary, tags, confidence, and a `research_link`.
- **flat**: Sorted by `updated` descending (most recent first).

## Citation Format

When referencing a research finding in your response or handoff, emit a `research://` link:

```
research://<workflow>/<section>/<filename>.md[#anchor]
```

- Use `_` as the workflow when the scope is project-wide: `research://_/02-tech/sqlite-vec.md`
- These links are clickable in the Elefant client — they open the Research View at that file
- Anchors are GitHub-style heading slugs (lowercase, kebab-case): `research://_/02-tech/foo.md#benchmark-results`

### Examples

```
See research://_/03-decisions/vector-store-selection.md for the full decision record.

Per the benchmarks in research://elefant-search/02-tech/embedding-providers.md#performance, bundled-cpu is sufficient for < 100K documents.
```

## Writer Agent Index Maintenance

The writer agent runs `research_index` after each wave and rewrites:
- `.elefant/markdown-db/INDEX.md` — the top-level index
- `00-index/README.md` — the section index

Never manually edit these files if you are not the writer agent.
