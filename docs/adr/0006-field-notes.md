# ADR-0006: Field Notes storage and embeddings

**Status:** Accepted
**Date:** 2026-05-02
**Workflow:** field-notes-system
**MR:** MR-40

## Context

Elefant's Field Notes needs a per-project, self-hosted storage and retrieval stack for long-form, citable markdown artifacts at `<projectRoot>/.elefant/field-notes/`. The architecture-of-record in `.goopspec/field-notes-system/SPEC.md` §1 requires a bundled vector index that works zero-config, preserves privacy by default, supports semantic and keyword search, and remains separate from the existing SQLite memory system.

The decision boundary is the vector store and embedding-provider stack. It must support Bun + TypeScript, cross-platform desktop distribution, local-first operation, pluggable remote providers, provider switching, and a disabled vector mode that degrades to keyword-only search. SPEC §4 also makes native Obsidian integration explicitly out of scope: Elefant stores plain markdown and ships its own reader, indexer, and link resolver; users may open the folder elsewhere, but Elefant will not bundle, recommend, or test a native Obsidian vault adapter or plugin.

## Decision

Use SQLite plus the `sqlite-vec` extension as the default vector store, located at `<projectRoot>/.elefant/field-notes-index.sqlite`. The default embedder is `Xenova/all-MiniLM-L6-v2` (384 dimensions) via `@xenova/transformers` / transformers.js, running on CPU by default and using WebGPU when available.

Add hardware-aware tier escalation: when the host has at least 16 GB RAM and a GPU or NPU is detected, recommend `bge-base-en-v1.5` (768 dimensions) as the bundled-large tier. This recommendation is not forced; users can pin a provider in settings.

Keep the embedding layer pluggable behind the `EmbeddingProvider` contract. Supported modes are bundled local tiers plus Ollama, LM Studio, vLLM, OpenAI-compatible APIs, Google embeddings, and `disabled` keyword-only mode. Remote providers remain opt-in because bundled modes and disabled mode must make zero outbound network calls.

Rejected alternatives:

1. **LanceDB:** LanceDB has excellent developer experience and a good local-vector-store story, but its native build matrix does not cleanly cover every Elefant desktop target we need to support. Choosing it as the default would make distribution and support depend on a heavier native dependency surface than the Field Notes needs.

2. **Qdrant:** Qdrant is a strong vector database with mature search features, but it requires running a separate server process. That violates the Field Notes goal of a self-hosted, bundled, per-project knowledge store that works without operating another daemon beside Elefant.

3. **Chroma:** Chroma is useful for prototyping, but it is Python-first. Embedding a Python runtime or requiring one from users is a non-starter for Elefant's Bun/Tauri distribution and would expand the operational surface far beyond this feature's storage requirements.

4. **FAISS:** FAISS is proven and performant, but it brings C++ build complexity and fragile bindings for the Bun ecosystem. As of 2026-05, Bun-compatible bindings are not stable enough to make FAISS the default vector layer for a cross-platform desktop app.

5. **pgvector:** pgvector is excellent when Postgres is already part of the deployment, but requiring Postgres for a per-project Field Notes is too heavy. Elefant needs a single-file local index that can be created lazily beside project research files.

6. **Plain in-memory cosine over JSON:** Keeping vectors in JSON and running in-memory cosine search would simplify the first prototype, but it does not scale, has no durable indexing story, and would force every search path to reload and scan the corpus. It fails the persistence and performance expectations in SPEC §1 and MR-40.

Risk R1 is accepted with a contingency: if `sqlite-vec` native builds do not cover a target platform, Elefant will fall back to an `hnswlib` WASM build or pure-JS HNSW implementation behind the same `EmbeddingProvider` and `VectorStore` interfaces. This fallback is documented as a mitigation, not the default path.

Risk R7 is accepted with an explicit provider-switch policy: each chunk records its embedding dimension, and switching to a provider with a different dimension triggers a forced non-destructive reindex. The reindex rewrites chunks and embeddings only, never source markdown files, and emits a `fieldnotes:provider-changed` WebSocket event so the UI can request user confirmation.

### Files modified
- `docs/adr/0006-field-notes.md` — Recorded the Field Notes storage and embedding-provider architecture decision, rejected alternatives, R1 fallback, R7 dimension-mismatch reindex policy, and Obsidian out-of-scope boundary

### Commit(s)
Not committed; documentation file authored for W1.1 handoff.

## Consequences

### Positive
- The default stack is local-first, per-project, and zero-config while preserving a single-file index at `.elefant/field-notes-index.sqlite`
- `sqlite-vec` aligns with Elefant's existing SQLite direction and avoids a separate vector database service
- transformers.js via `@xenova/transformers` keeps the default embedder bundled and private, with CPU as the safe baseline and WebGPU acceleration where available
- Provider abstraction leaves room for local servers, remote APIs, and keyword-only operation without changing agent tool contracts
- Recording embedding dimensions per chunk makes provider changes auditable and recoverable without touching source markdown

### Negative / accepted trade-offs
- `sqlite-vec` is still a native extension, so distribution must validate target-platform loading and maintain the documented HNSW fallback path
- Local embedding models add package/distribution weight and may have first-run initialization cost
- Supporting multiple provider modes increases configuration and testing surface
- Reindexing after dimension changes can be expensive for large corpora, but this is safer than mixing incompatible vectors

### Backward compatibility
This ADR introduces no code-level compatibility break. The Field Notes is new, lives under `.elefant/field-notes/` and `.elefant/field-notes-index.sqlite`, and remains separate from the existing SQLite memory system. Provider changes are non-destructive by policy: markdown source files are preserved and only derived chunks/index rows are rebuilt.

## Evidence

- `.goopspec/field-notes-system/SPEC.md` §1 — Locks the architecture-of-record: `.elefant/field-notes/`, SQLite + `sqlite-vec`, `Xenova/all-MiniLM-L6-v2`, provider matrix, HNSW fallback, `fieldnotes:provider-changed`, and ADR-0006 scope
- `.goopspec/field-notes-system/SPEC.md` §2.2 — Defines MR-6 through MR-10 for the bundled vector index, pluggable providers, hardware recommendation, non-destructive provider switching, and keyword fallback
- `.goopspec/field-notes-system/SPEC.md` §4 — Marks native Obsidian integration / vault adapter / plugin as out of scope
- `.goopspec/field-notes-system/SPEC.md` §6 — Records R1 (`sqlite-vec` native build coverage) and R7 (mixed-dimension provider switching) mitigations
- `.goopspec/field-notes-system/SPEC.md` §9 — Maps MR-40 to ADR-0006 and `docs/field-notes.md`

## Follow-ups

W1.2 validates `sqlite-vec` loading under Bun on Linux and confirms whether the default path is viable on the primary CI target. W1.3 validates `@xenova/transformers` under Bun and measures MiniLM CPU latency. Later provider-switch implementation must enforce the dimension-mismatch reindex policy and emit `fieldnotes:provider-changed` before rebuilding derived chunks.

---

*Captured during Wave 1 of the field-notes-system workflow.*
