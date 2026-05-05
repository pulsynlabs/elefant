---
id: field-notes-search-patterns
title: Field Notes Search Patterns
description: Effective query patterns for field_notes_search and field_notes_grep in the Elefant Field Notes.
tags:
  - field-notes
  - researcher
  - workflow
audience:
  - researcher
  - all
version: 1.0.0
---

# Field Notes Search Patterns

Efficient search is the difference between finding the right research in one call and burning context on irrelevant results. This reference covers query construction, mode selection, and tool choice for the Elefant Field Notes.

## Choosing the Right Tool

| Scenario | Use |
|----------|-----|
| "I know what I'm looking for but not where" | `field_notes_search` (hybrid) |
| "Find every document that mentions `sqlite-vec`" | `field_notes_grep` with pattern |
| "Show me everything in the Decisions section" | `field_notes_index` with `section: 03-decisions` |
| "What was added this week?" | `field_notes_index` with `recencyDays: 7` |
| "I have the UUID from a prior search result" | `field_notes_read` with `id` |
| "I clicked a `fieldnotes://` link" | `field_notes_read` with `link` |

## Search Modes

### Semantic Search (`mode: semantic`)

Best for natural language queries where you care about meaning, not exact terms.

**When to use:**
- Exploring a new topic: "What vector databases has Elefant evaluated?"
- Finding conceptually related documents: "approaches to agent memory persistence"
- Queries where terminology may vary: "session context management" (may match documents about "conversation history", "context window", "compaction")

**When to avoid:**
- Searching for specific identifiers: function names, file paths, UUIDs
- Finding exact configuration values: "maxFiles: 20"
- The embedding provider is `disabled` (falls back to keyword)

**Tip:** Semantic search requires an embedding provider. If the project uses `disabled`, stick to `keyword` or `hybrid` (which degrades to keyword).

### Keyword Search (`mode: keyword`)

Best for exact term matching, identifiers, and code symbols.

**When to use:**
- Finding specific terms: "sqlite-vec", "RRF", "Reciprocal Rank Fusion"
- Searching for code-level patterns: "assertInsideFieldNotes", "serializeFieldNotesLink"
- When the embedding provider is `disabled`

**When to avoid:**
- Exploratory queries with vague terminology
- Finding documents by concept rather than specific terms

### Hybrid Search (`mode: hybrid`, default)

Combines semantic and keyword results using Reciprocal Rank Fusion (RRF, k=60). Scores are normalised to 0–1.

**When to use:** Most queries. This is the default and handles the widest range of queries well.

**When to avoid:**
- When you need deterministic, repeatable results (use `keyword`)
- When embedding provider is `disabled` (same as keyword, but with the overhead of a provider check)

## Query Construction

### Specific Over Broad

Bad: `vector database`
Good: `sqlite-vec vs pgvector query latency comparison`

Bad: `agent memory`
Good: `how does Elefant handle conversation history across sessions`

### Use Domain Terms

The Field Notes is indexed by the same terminology used in the codebase. Queries using Elefant-specific terms match more precisely:

Bad: `knowledge storage`  
Good: `field_notes_write frontmatter schema confidence levels`

Bad: `tool for searching files`  
Good: `field_notes_grep ripgrep pattern matching field notes`

### Add Context for Semantic Queries

Semantic search benefits from sentence-like queries that establish context:

Bad: `sqlite`  
Good: `SQLite-based vector search with embedding provider comparison`

Bad: `chunking`  
Good: `document chunking strategy for embedding search results`

### Filter With Section and Tags

Narrow results before the search runs by scoping to a section:

```
field_notes_search({ query: "authentication middleware pattern", section: "03-decisions" })
```

Post-filter with tags for documents you know are tagged:

```
field_notes_search({ query: "memory", tags: ["field-notes", "architecture"] })
```

## `field_notes_grep` Patterns

Use `field_notes_grep` when you need regex-level precision that semantic search cannot provide.

### Finding Code References

```
field_notes_grep({ pattern: "FieldNotesStore\\.open" })
→ Finds every document that references the FieldNotesStore.open() call
```

### Finding Configuration Values

```
field_notes_grep({ pattern: "maxFiles.*20" })
→ Finds documents mentioning the maxFiles default of 20
```

### Section-Scoped Grep

```
field_notes_grep({ pattern: "confidence.*high", section: "03-decisions" })
→ Finds high-confidence claims only in the Decisions section
```

### File-Type Filtering

```
field_notes_grep({ pattern: "TODO|FIXME|HACK", include: "*.md" })
→ Finds marked todos across all research documents
```

### When to Use `field_notes_index` Instead

`field_notes_index` is not a search tool — it's a browser. Use it when you want to see the structure, not find specific content:

- "Show me everything in `02-tech`" → `field_notes_index({ section: "02-tech" })`
- "What's new this month?" → `field_notes_index({ recencyDays: 30, output: "flat" })`
- "Find all documents tagged `vector-search`" → `field_notes_index({ tag: "vector-search" })`

## Example Queries with Expected Results

| Query | Mode | Why |
|-------|------|-----|
| "Field Notes frontmatter schema" | hybrid | Natural language, conceptual — semantic component helps |
| "sqlite-vec benchmark" | keyword | Specific technology name — exact match preferred |
| "field_notes_write PERMISSION_DENIED" | keyword | Error code lookup — must match exactly |
| "How do agents save findings?" | semantic | Conceptual query — terminology may vary across docs |
| "Section 99-scratch validation rules" | hybrid | Mix of specific terms and conceptual intent |

## Query Anti-Patterns

- **Single-word queries without context**: `"database"` matches too broadly. Add qualifiers: `"vector database embedding sqlite-vec"`.
- **Overly long queries**: Queries over ~100 words dilute relevance. Focus on 2–5 key terms.
- **Ignoring `minScore`**: If you get too many low-quality results, add `minScore: 0.3` to filter noise.
- **Using `field_notes_grep` for conceptual searches**: "How does the resolver work?" is a `field_notes_search` query, not a regex pattern.
