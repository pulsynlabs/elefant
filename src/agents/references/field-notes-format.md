---
id: field-notes-format
title: Field Notes Format
description: Frontmatter schema, section structure, and confidence levels for Elefant's field-notes research base.
tags:
  - field-notes
  - researcher
  - writer
audience:
  - researcher
  - writer
version: 1.0.0
---

# Field Notes Format

Every Elefant project has a **Field Notes** at `.elefant/field-notes/` — a structured knowledge garden for long-form findings, comparisons, and reference notes. This is separate from the SQLite memory system (which holds ephemeral decision logs).

## Section Structure

The Field Notes is organized into 8 section directories. Every file lives in exactly one section.

| Section | Label | Purpose |
|---------|-------|---------|
| `00-index` | Indexes | Index and changelog (auto-maintained by writer agent) |
| `01-domain` | Domain Knowledge | Domain-specific findings |
| `02-tech` | Technologies | Technology research and comparisons |
| `03-decisions` | Decisions | Architecture and design decisions |
| `04-comparisons` | Comparisons | Comparative analyses |
| `05-references` | References | Reference summaries and citations |
| `06-synthesis` | Synthesis | Synthesis and strategic notes |
| `99-scratch` | Scratch | Rough notes (no strict frontmatter required) |

The writer agent maintains `INDEX.md` at the root and a `README.md` in each section. Never manually edit those files if you are not the writer agent.

## Frontmatter Schema

Every research file starts with a YAML frontmatter block delimited by `---`. The schema is Zod-validated and `.strict()` — unknown keys are rejected.

### Required Fields

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | `string` | UUID v4 generated on first write; preserved on updates |
| `title` | `string` | 1–200 characters |
| `section` | `enum` | One of the 8 section names listed above |
| `summary` | `string` | 1–500 character TL;DR an agent can act on immediately |
| `author_agent` | `enum` | One of: `researcher`, `writer`, `librarian`, `orchestrator`, `planner`, `verifier`, `debugger`, `tester`, `explorer`, `executor-low`, `executor-medium`, `executor-high`, `executor-frontend`, `user` |

### Auto-Filled Fields

These are set by the system on `field_notes_write` — do not specify manually unless you know the existing ID for an update:

| Field | Type | Behaviour |
|-------|------|-----------|
| `id` | `string` | `crypto.randomUUID()` on first write; preserved if re-submitted |
| `created` | `ISO 8601` | Set when the file is first written; preserved on updates |
| `updated` | `ISO 8601` | Updated to `new Date().toISOString()` on every write |

### Optional Fields (with defaults)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `tags` | `string[]` | `[]` | At minimum, include the primary technology/topic keyword |
| `sources` | `string[]` | `[]` | Every URL or file path you cite must be listed here |
| `confidence` | `enum` | `medium` | `high`, `medium`, or `low` |
| `workflow` | `string \| null` | `null` | Workflow slug for `fieldnotes://` links; `null` for project-wide docs |

### Confidence Levels

| Level | Meaning | When to Use |
|-------|---------|-------------|
| `high` | Primary source verified | You read the source code, ran the tool, or tested the hypothesis directly |
| `medium` | Multiple secondary sources | Cross-referenced documentation, blog posts, or community consensus |
| `low` | Inference or single source | Extrapolated from limited data; may change with more research |

## Example Frontmatter Block

```yaml
---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
title: SQLite Vector Search Performance
section: 02-tech
summary: Benchmarks comparing sqlite-vec with pgvector for embedding search under 1M vectors. sqlite-vec is 3x faster for k=10 queries on consumer hardware.
tags:
  - sqlite
  - vector-search
  - embeddings
  - benchmarking
sources:
  - https://github.com/asg017/sqlite-vec
  - https://github.com/pgvector/pgvector
  - src/fieldnotes/benchmarks/vector-search-results.json
confidence: high
created: 2026-05-01T12:00:00.000Z
updated: 2026-05-03T08:30:00.000Z
author_agent: researcher
workflow: null
---
```

## Section-Specific Rules

### 99-scratch

Files in `99-scratch/` are exempt from strict frontmatter validation. They can have malformed or missing YAML blocks — the `field_notes_read` tool uses lenient parsing for scratch files. Use this section for rough notes, works-in-progress, and temporary dumps.

### All Other Sections (00–06)

Files outside `99-scratch/` must pass full Zod validation. The `field_notes_write` tool enforces this: if frontmatter fails validation, the write is rejected with a descriptive error.

## Cross-References with Memory

The Field Notes stores long-form findings. The memory system stores ephemeral decision logs. Never write research findings directly to memory — use `field_notes_write` instead.

When you need to reference a research finding in a memory entry, use the `fieldnotes://` URI format (see `field-notes-workflow` reference for citation details).

## Anti-Patterns

- **No Obsidian**: The Field Notes is plain markdown. Do not emit `[[wikilinks]]` syntax. Use standard markdown links or `fieldnotes://` URIs.
- **No undated claims**: Every file tracks `created` and `updated` timestamps. Assertions without temporal context are not actionable.
- **No halluciated sources**: Every URL and file path in `sources` must be a real, accessible resource you reviewed.
- **No opinion without evidence**: Tag speculative findings with `confidence: low` and explain the inference chain.
