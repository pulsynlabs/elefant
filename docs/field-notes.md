# Field Notes

## Overview

Every Elefant project has a **Field Notes** — a structured, versionable, agent-curated knowledge garden at `.elefant/field-notes/`. It is a long-form artifact store separate from the SQLite memory system (which holds ephemeral decision logs). The Field Notes holds citable, human-browsable findings, comparisons, and reference notes authored primarily by researcher, writer, and librarian agents.

The Field Notes is indexed by a self-hosted vector store (SQLite + `sqlite-vec` with `Xenova/all-MiniLM-L6-v2` embeddings by default), searchable by agents through five tools (`field_notes_search`, `field_notes_grep`, `field_notes_read`, `field_notes_write`, `field_notes_index`), and browsable by users through a dedicated **Field Notes** in the desktop client. Findings are linked from chat output via `fieldnotes://` URIs that render as clickable chips.

For the architecture decision rationale (why SQLite + transformers.js, rejected alternatives, fallback strategies), see [ADR-0006](adr/0006-field-notes.md).

---

## Architecture

### Storage Layout

The Field Notes lives at `<projectRoot>/.elefant/field-notes/` (per-project, lazily created on first write). It is never stored under `.goopspec/`.

**Default section structure** (created on first init):

```
.elefant/field-notes/
├── 00-index/              Index and changelog
│   ├── INDEX.md           Master index (auto-maintained by writer agent)
│   └── CHANGELOG.md       Single-line entries per wave
├── 01-domain/             Domain-specific findings
│   └── README.md          Section index
├── 02-tech/               Technology research and comparisons
│   └── README.md          Section index
├── 03-decisions/          Architecture and design decisions
│   └── README.md          Section index
├── 04-comparisons/        Comparative analyses
│   └── README.md          Section index
├── 05-references/         Reference summaries and citations
│   └── README.md          Section index
├── 06-synthesis/          Synthesis and strategic notes
│   └── README.md          Section index
└── 99-scratch/            Rough notes (no strict frontmatter required)
    └── README.md          Section index
```

Each section's `README.md` is auto-maintained by the writer agent and lists all files in that section with title, summary, confidence, tags, and `fieldnotes://` links.

### Frontmatter Schema

Every file in the Field Notes (except `99-scratch/`) must include YAML frontmatter with these fields:

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `id` | UUID | Yes | Unique identifier for the file | `550e8400-e29b-41d4-a716-446655440000` |
| `title` | string | Yes | Human-readable title (1–200 chars) | `SQLite + sqlite-vec for vector storage` |
| `section` | enum | Yes | One of: `00-index`, `01-domain`, `02-tech`, `03-decisions`, `04-comparisons`, `05-references`, `06-synthesis`, `99-scratch` | `02-tech` |
| `tags` | array | No | Searchable tags (default: `[]`) | `["sqlite", "vector-db", "embeddings"]` |
| `sources` | array | No | URLs or file paths cited (default: `[]`) | `["https://github.com/asg017/sqlite-vec", "docs/adr/0006-field-notes.md"]` |
| `confidence` | enum | No | `high` (primary source), `medium` (multiple secondaries), `low` (inference). Default: `medium` | `high` |
| `created` | ISO 8601 | Yes | Creation timestamp (auto-filled by `field_notes_write`) | `2026-05-03T14:22:00Z` |
| `updated` | ISO 8601 | Yes | Last update timestamp (auto-filled by `field_notes_write`) | `2026-05-03T14:22:00Z` |
| `author_agent` | enum | Yes | Agent that created/last edited the file | `researcher`, `writer`, `librarian`, `orchestrator`, `user`, etc. |
| `workflow` | string or null | No | Workflow ID if created during a spec-mode task (default: `null`) | `field-notes-system` |
| `summary` | string | Yes | 1–3 sentence TL;DR (1–500 chars) | `SQLite with the sqlite-vec extension provides a local, single-file vector store suitable for per-project Field Notess.` |

**Example frontmatter:**

```yaml
---
id: 550e8400-e29b-41d4-a716-446655440000
title: SQLite + sqlite-vec for vector storage
section: 02-tech
tags:
  - sqlite
  - vector-db
  - embeddings
sources:
  - https://github.com/asg017/sqlite-vec
  - docs/adr/0006-field-notes.md
confidence: high
created: 2026-05-03T14:22:00Z
updated: 2026-05-03T14:22:00Z
author_agent: researcher
workflow: field-notes-system
summary: SQLite with the sqlite-vec extension provides a local, single-file vector store suitable for per-project Field Notess.
---

# SQLite + sqlite-vec for vector storage

[Your markdown content here...]
```

### URI Scheme: `fieldnotes://`

Files in the Field Notes can be linked using the `fieldnotes://` URI scheme:

```
fieldnotes://<workflow>/<section>/<filename>.md[#anchor]
```

| Component | Description | Example |
|-----------|-------------|---------|
| `<workflow>` | Workflow ID or `_` for project-wide scope | `field-notes-system` or `_` |
| `<section>` | Section directory name | `02-tech` |
| `<filename>` | Filename without `.md` extension | `sqlite-vec` |
| `[#anchor]` | Optional heading anchor (optional) | `#architecture` |

**Examples:**

- `fieldnotes://_/02-tech/sqlite-vec.md` — Project-wide reference to the sqlite-vec file
- `fieldnotes://field-notes-system/03-decisions/provider-switching.md#r7-mitigation` — Workflow-specific reference with anchor
- `fieldnotes://_/06-synthesis/MASTER-SYNTHESIS.md` — Link to synthesis document

Agents emit `fieldnotes://` links in handoff envelopes and chat output. The desktop client renders these as clickable chips that navigate to the Field Notes with the file open and optional anchor scrolled.

### Vector Index & Embedding Providers

#### Default Stack

The default vector index is **SQLite + `sqlite-vec`** at `.elefant/field-notes-index.sqlite`. The default embedder is **`bundled-cpu`** — `Xenova/all-MiniLM-L6-v2` (384 dimensions) via `@xenova/transformers`, running on CPU by default with WebGPU acceleration where available.

#### Hardware Auto-Scaling

On first run, Elefant profiles the host machine (RAM, GPU, NPU) and **recommends** (does not force) a default embedding tier:

- **`bundled-cpu`** (default): `Xenova/all-MiniLM-L6-v2` (384-dim), CPU-only, ~50 MB model, suitable for all machines
- **`bundled-gpu`**: `Xenova/all-MiniLM-L6-v2` (384-dim) with WebGPU acceleration, recommended if GPU detected
- **`bundled-large`**: `bge-base-en-v1.5` (768-dim), recommended if ≥16 GB RAM and GPU/NPU detected; higher quality but slower

Users can pin a provider in **Settings → Field Notes** to override the recommendation.

#### Supported Providers

| Provider | Type | Dimensions | Config Fields | Notes |
|----------|------|-----------|----------------|-------|
| `bundled-cpu` | Local | 384 | None | Default; CPU-only; zero network calls |
| `bundled-gpu` | Local | 384 | None | WebGPU acceleration; zero network calls |
| `bundled-large` | Local | 768 | None | Higher quality; requires ≥16 GB RAM + GPU/NPU; zero network calls |
| `ollama` | Local server | Configurable | `baseUrl`, `model` | Requires Ollama running locally (e.g., `http://localhost:11434`) |
| `lm-studio` | Local server | Configurable | `baseUrl`, `model` | Requires LM Studio running locally |
| `vllm` | Local server | Configurable | `baseUrl`, `model` | Requires vLLM server running locally |
| `openai` | Remote API | 1536 | `apiKey`, `model` | OpenAI Embeddings API; requires API key; **warns user about privacy** |
| `openai-compatible` | Remote API | Configurable | `baseUrl`, `apiKey`, `model` | Any OpenAI-compatible API (e.g., Groq, Together AI); **warns user about privacy** |
| `google` | Remote API | 768 | `apiKey`, `model` | Google Embeddings API; requires API key; **warns user about privacy** |
| `disabled` | Keyword-only | N/A | None | Vector index disabled; search degrades to ripgrep + BM25-style scoring; zero network calls |

**Privacy:** All `bundled-*` and `disabled` modes make zero outbound network calls. Remote providers (`ollama`, `lm-studio`, `vllm`, `openai`, `openai-compatible`, `google`) are opt-in and require explicit user configuration. The Settings tab includes a prominent warning when a remote provider is selected.

#### Provider Switching

Switching embedding providers is **non-destructive**:

1. Each chunk records its embedding dimension
2. If the new provider has a different dimension, Elefant triggers a forced reindex
3. Source markdown files are never modified; only derived chunks and embeddings are rebuilt
4. A `fieldnotes:provider-changed` WebSocket event is emitted so the UI can request user confirmation
5. Reindexing runs in the background with progress streamed via SSE

#### Fallback: Keyword-Only Mode

If the vector index is disabled or unavailable, agent search transparently degrades to:

- **ripgrep** for pattern matching across all files
- **BM25-style scoring** for relevance ranking
- **Snippet extraction** from matched files
- Same tool interface (`field_notes_search` with `mode: 'keyword'`)

---

## Indexing Pipeline

### File Watcher

A file watcher monitors `.elefant/field-notes/` per active project with a 500 ms debounce. When files are created, modified, or deleted, the indexer is triggered for incremental re-indexing.

### Chunking Strategy

Markdown files are split into chunks at H2 and H3 boundaries:

- **Max chunk size:** 512 tokens
- **Overlap:** 1 sentence between chunks (for context preservation)
- **Frontmatter:** Treated as metadata, never embedded as content
- **Headings:** Preserved as chunk titles for navigation

### Chunk Schema

Each chunk in the vector index has this structure:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique chunk identifier |
| `file_path` | string | Relative path within `.elefant/field-notes/` |
| `section` | string | Section directory (e.g., `02-tech`) |
| `title` | string | Chunk title (from heading or file title) |
| `chunk_index` | integer | Position within the file (0-indexed) |
| `text` | string | Chunk content (plain text) |
| `embedding` | BLOB | Vector embedding (Float32Array) |
| `tokens` | integer | Token count |
| `tags` | JSON array | Tags from frontmatter |
| `frontmatter_json` | JSON | Full frontmatter object |
| `updated_at` | ISO 8601 | Last update timestamp |

### Indexing Phases

**Initial bulk index** (on first run or after provider switch):
- Runs in a worker thread to avoid blocking the daemon
- Progress streamed via SSE on `/v1/fieldnotes/index/progress`
- Typical performance: 1000 files indexed in ≤30 seconds on `bundled-cpu`

**Incremental index** (on file changes):
- Triggered by file watcher (500 ms debounce)
- Only modified files are re-chunked and re-embedded
- Runs in background without blocking

### Index Health

The `/v1/fieldnotes/status` endpoint reports:

- Total documents
- Total chunks
- Last-indexed timestamp
- Current embedding provider
- Hardware tier recommendation
- Drift count (chunks with mismatched dimensions after provider switch)
- Disk size of `.elefant/field-notes-index.sqlite`

---

## Agent Tools Reference

All Field Notes tools are registered in `src/tools/registry.ts` and allow-listed per-agent in YAML configs.

### `field_notes_search`

**Description:** Semantic, keyword, or hybrid search across the Field Notes.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `query` | string | Yes | — | Search query (natural language or keywords) |
| `k` | integer | No | 8 | Number of results to return (max 25) |
| `section` | string | No | — | Filter by section (e.g., `02-tech`) |
| `tags` | array | No | — | Filter by tags (AND logic) |
| `mode` | enum | No | `hybrid` | Search mode: `semantic`, `keyword`, or `hybrid` |
| `minScore` | number | No | 0.0 | Minimum relevance score (0–1) |

**Returns:**

```typescript
{
  results: [
    {
      path: string;              // Relative path in .elefant/field-notes/
      section: string;           // Section directory
      title: string;             // Chunk title
      summary: string;           // File summary from frontmatter
      score: number;             // Relevance score (0–1)
      snippet: string;           // Excerpt from chunk
      frontmatter: Frontmatter;   // Full frontmatter object
      fieldnotes_link: string;      // fieldnotes:// URI for the file
    }
  ];
  total: number;                 // Total matches (may exceed k)
}
```

**Who can use:** All agents (read-only).

**Example:**

```
field_notes_search({
  query: "vector database comparison",
  k: 5,
  section: "02-tech",
  mode: "hybrid"
})
```

### `field_notes_grep`

**Description:** Ripgrep-based pattern search scoped to `.elefant/field-notes/`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pattern` | string | Yes | Regex pattern (ripgrep syntax) |
| `section` | string | No | Filter by section |
| `maxMatches` | integer | No | Max results per file (default: 10) |

**Returns:**

```typescript
{
  results: [
    {
      file: string;              // Relative path
      matches: [
        {
          lineNumber: number;
          line: string;
          snippet: string;       // Context around match
        }
      ];
    }
  ];
}
```

**Who can use:** All agents (read-only).

### `field_notes_read`

**Description:** Read a file by ID, path, or `fieldnotes://` link.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | UUID | No | File UUID from frontmatter |
| `path` | string | No | Relative path (e.g., `02-tech/sqlite-vec.md`) |
| `link` | string | No | `fieldnotes://` URI with optional `#anchor` |

**Returns:**

```typescript
{
  frontmatter: Frontmatter;
  body: string;              // Markdown content (without frontmatter)
  path: string;
  section: string;
}
```

**Who can use:** All agents (read-only).

### `field_notes_write`

**Description:** Write or append to a file in the Field Notes. Enforces frontmatter schema and triggers per-file reindex.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `section` | string | Yes | Target section (e.g., `02-tech`) |
| `filename` | string | Yes | Filename without `.md` extension |
| `title` | string | Yes | Human-readable title |
| `body` | string | Yes | Markdown content (without frontmatter) |
| `tags` | array | No | Tags for searchability |
| `sources` | array | No | URLs or file paths cited |
| `confidence` | enum | No | `high`, `medium`, or `low` |
| `summary` | string | Yes | 1–3 sentence TL;DR |
| `append` | boolean | No | If true, append to existing file (default: false) |

**Returns:**

```typescript
{
  id: string;                // File UUID
  path: string;              // Relative path
  frontmatter: Frontmatter;
  reindexed: boolean;        // Whether file was re-indexed
}
```

**Who can use:** `researcher`, `writer`, `librarian` only (enforced via `allowedAgents` in tool definition).

**Behavior:**

- Auto-fills `id`, `created`, `updated`, `author_agent`, `workflow` fields
- Validates `section` against the enum
- Appends to `99-scratch/` without strict frontmatter validation
- Triggers per-file reindex in background
- Emits `fieldnotes:indexed` WebSocket event on completion

### `field_notes_index`

**Description:** List and browse the Field Notes structure by section, tag, or recency.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `mode` | enum | No | `tree` (hierarchical) or `flat` (list). Default: `tree` |
| `section` | string | No | Filter by section |
| `tag` | string | No | Filter by tag |
| `sortBy` | enum | No | `updated` (default), `created`, `title` |

**Returns (tree mode):**

```typescript
{
  sections: [
    {
      name: string;          // e.g., "02-tech"
      label: string;         // e.g., "Technology research"
      files: [
        {
          id: string;
          title: string;
          summary: string;
          tags: string[];
          confidence: string;
          updated: string;
          fieldnotes_link: string;
        }
      ];
    }
  ];
}
```

**Returns (flat mode):**

```typescript
{
  files: [
    {
      id: string;
      path: string;
      title: string;
      section: string;
      summary: string;
      tags: string[];
      confidence: string;
      updated: string;
      fieldnotes_link: string;
    }
  ];
}
```

**Who can use:** All agents (read-only).

---

## Field Notes (Desktop UI)

### Navigation

The Field Notes is accessible via a new **"Field Notes"** entry in the left sidebar (between sessions and pinned settings). The entry shows a book icon (Hugeicons) and is labeled "Field Notes" in expanded mode; icon-only in collapsed mode (≤900 px).

### Layout

The Field Notes uses a **two-pane layout**:

**Left pane (Tree):**
- Hierarchical section tree with expand/collapse
- Section icons (folder icons per section type)
- Recency badges (e.g., "Updated 2h ago")
- Tag chips (clickable to filter)
- Search input (queries via `/v1/fieldnotes/search`)
- Keyboard shortcuts: `j`/`k` to navigate, `/` to focus search

**Right pane (Reader):**
- Read-only markdown renderer
- Frontmatter pill-bar at top (title, confidence, tags, updated timestamp)
- Table of contents (TOC) sidebar
- Sticky header with breadcrumbs
- Syntax-highlighted code blocks
- GitHub-style tables
- Clickable internal links (both `fieldnotes://` URIs and relative `.elefant/field-notes/**/*.md` paths)
- Copy-link-per-heading button
- Prominent **"Open in editor"** button (→ `POST /v1/fieldnotes/open-in-editor`)

### Mobile Responsiveness

At ≤640 px (mobile breakpoint):
- Tree pane becomes a **top-sheet drawer** (slides down from top)
- Reader pane takes full width
- Hamburger icon in header toggles drawer
- Drawer auto-closes on file selection

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `j` | Next file in tree |
| `k` | Previous file in tree |
| `/` | Focus search input |
| `g r` | Focus reader pane |
| `Escape` | Close mobile drawer (if open) |
| `⌘K` (macOS) / `Ctrl+K` (Linux/Windows) | Open command palette → "Search Field Notes" |

### Chat Integration

When agents emit `fieldnotes://` links in chat output, they render as **clickable chips**:

```
Found relevant research: [fieldnotes://_/02-tech/sqlite-vec.md](chip)
```

Clicking a chip navigates to the Field Notes with the file open and optional `#anchor` scrolled into view.

### Settings Tab

**Settings → "Field Notes"** includes:

- **Embedding provider dropdown** — select from supported providers
- **Provider-specific config fields** — e.g., `baseUrl` for Ollama, `apiKey` for OpenAI
- **Hardware tier indicator** — shows detected RAM/GPU/NPU and recommended tier
- **Enable-vector toggle** — disable vector index to use keyword-only mode
- **Reindex button** — manually trigger full reindex
- **Last-indexed timestamp** — when the index was last updated
- **Chunk count** — total chunks in the index
- **"Open Research folder in OS file manager"** — opens `.elefant/field-notes/` in Finder/Explorer/Nautilus
- **Editor binary override** — specify custom editor (default: `$EDITOR` → VS Code → system default)

---

## For Agents: How to Contribute

### When to Write to the Field Notes

Write to the Field Notes when you have:

- **Primary-source findings** — research results, API documentation, source code analysis
- **Comparative analyses** — technology comparisons, trade-off evaluations
- **Decision records** — architecture decisions, design rationale
- **Reference summaries** — curated citations, external resource summaries

**Do NOT write to the Field Notes for:**

- Ephemeral session notes → use the memory system instead
- Temporary debugging logs → use memory or local notes
- Unverified speculation → use `confidence: low` if you must, but prefer verified findings

### How to Write

Use the `field_notes_write` tool:

```typescript
field_notes_write({
  section: "02-tech",
  filename: "sqlite-vec-evaluation",
  title: "SQLite + sqlite-vec for vector storage",
  body: `# SQLite + sqlite-vec for vector storage

## Overview
SQLite with the sqlite-vec extension provides...

## Pros
- Single-file storage
- Zero external dependencies
- ...

## Cons
- Native extension distribution complexity
- ...`,
  tags: ["sqlite", "vector-db", "embeddings"],
  sources: [
    "https://github.com/asg017/sqlite-vec",
    "docs/adr/0006-field-notes.md"
  ],
  confidence: "high",
  summary: "SQLite with sqlite-vec is a viable local vector store for per-project Field Notess."
})
```

The tool auto-fills `id`, `created`, `updated`, `author_agent`, and `workflow` fields.

### How to Search

Use `field_notes_search` for semantic/hybrid search:

```typescript
field_notes_search({
  query: "vector database comparison",
  k: 5,
  section: "02-tech",
  mode: "hybrid"
})
```

Use `field_notes_grep` for pattern matching:

```typescript
field_notes_grep({
  pattern: "sqlite-vec|hnswlib",
  section: "02-tech"
})
```

Use `field_notes_read` to read a specific file:

```typescript
field_notes_read({
  link: "fieldnotes://_/02-tech/sqlite-vec.md#architecture"
})
```

### How to Cite

When referencing a finding in your response or handoff, emit a `fieldnotes://` link:

```
Found relevant research: fieldnotes://_/02-tech/sqlite-vec.md

Based on fieldnotes://_/03-decisions/provider-switching.md#r7-mitigation,
we should implement dimension-mismatch reindexing.
```

These links are clickable in the Elefant client and navigate to the Field Notes.

### Writer Agent Responsibilities

The **writer agent** owns the Field Notes indexes:

- Runs `field_notes_index` after each wave
- Rewrites `.elefant/field-notes/INDEX.md` with all files, summaries, and links
- Rewrites each section `README.md` with section-specific index
- Appends single-line entry to `.elefant/field-notes/00-index/CHANGELOG.md` per wave
- Never manually edit `INDEX.md` or section `README.md`s unless you are the writer agent

---

## Migration from Legacy `field-notes/`

The Elefant monorepo's own `field-notes/` at the repository root is kept as the **project's research seed** (legacy, read-only reference). New Elefant projects use `.elefant/field-notes/` by default.

### Migration Script

To migrate in-repo references from the legacy location to the new location:

```bash
bun run scripts/migrate-field-notes.ts --dry-run
```

This script:

- Updates agent prompts, ADRs, README, and AGENTS.md
- Rewrites prescriptive references from `field-notes/` → `.elefant/field-notes/` for references about *other* projects
- Keeps the Elefant-monorepo seed intact (no file moves, no data loss)
- Emits a summary of changes

Run without `--dry-run` to apply changes.

### Legacy Seed

The top-level `field-notes/` gets a soft-alias README:

```markdown
# Legacy Research Seed

This folder is the Elefant monorepo's own research database (kept for reference).

**New content lives in `.elefant/field-notes/`** per project.

If you are working on a new Elefant project, use `.elefant/field-notes/` instead.
```

---

## Performance & Constraints

### Indexing Performance

- **1000-file index:** ≤30 seconds on `bundled-cpu`
- **Search latency (p95):** ≤150 ms (semantic), ≤80 ms (keyword) on 10k-chunk corpus
- **Model size:** Bundled embedder ≤50 MB

### Disk Footprint

- `.elefant/field-notes-index.sqlite` grows with corpus size
- Periodic `VACUUM` keeps disk usage reasonable
- Status endpoint reports disk size; users can cap chunk count in settings

### Privacy

- **`bundled-*` and `disabled` modes:** Zero outbound network calls
- **Remote providers:** Opt-in; Settings tab includes prominent privacy warning
- **No data sharing:** Source markdown files are never sent to external services

---

## Troubleshooting

### Vector Index Not Updating

**Symptom:** Files added to `.elefant/field-notes/` but not appearing in search results.

**Solution:**
1. Check **Settings → Field Notes** → "Last-indexed timestamp"
2. Click **"Reindex"** button to manually trigger full reindex
3. Monitor progress via SSE on `/v1/fieldnotes/index/progress`

### Provider Switch Fails

**Symptom:** Switching embedding providers in Settings causes an error.

**Solution:**
1. Check daemon logs for `fieldnotes:` namespace errors
2. Verify provider configuration (e.g., Ollama running at `http://localhost:11434`)
3. Try switching to `disabled` mode (keyword-only) to isolate the issue
4. If dimension mismatch, reindex is triggered automatically

### Search Returns No Results

**Symptom:** `field_notes_search` returns empty results even for files that exist.

**Solution:**
1. Verify files have valid frontmatter (use `field_notes_read` to check)
2. Try `field_notes_grep` with a simple pattern to confirm files are indexed
3. Check **Settings → Field Notes** → "Chunk count" (should be > 0)
4. If vector index is disabled, search falls back to keyword-only mode

### "Open in Editor" Does Not Work

**Symptom:** Clicking "Open in editor" button does not open the file.

**Solution:**
1. Check **Settings → Field Notes** → "Editor binary override"
2. Verify `$EDITOR` environment variable is set (or override in Settings)
3. Ensure the editor binary is in `$PATH`
4. Try opening the folder directly: **Settings → "Open Research folder in OS file manager"**

---

## See Also

- [ADR-0006: Field Notes storage and embeddings](adr/0006-field-notes.md) — Architecture decision rationale
- [Field Notes Protocol](../src/agents/prompts/_shared/field-notes-protocol.md) — Agent protocol for contributing to the Field Notes
- [Spec Mode](spec-mode/README.md) — How Spec Mode uses the Field Notes for findings
- [Memory System](memory.md) — Ephemeral decision logs (separate from Field Notes)
