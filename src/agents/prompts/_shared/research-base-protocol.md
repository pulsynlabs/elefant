# Research Base Protocol

## What it is
`.elefant/markdown-db/` is the project's research knowledge base. All research findings, comparisons, and reference notes live here — NOT in memory entries (which are ephemeral decision logs).

## When to write
Write here when you have: a primary-source finding, a comparison/analysis, a decision record, or a reference summary worth citing later.

## How to write (researcher, writer, librarian only)
Use `research_write`:
- Set `section` to the most specific match from: 01-domain, 02-tech, 03-decisions, 04-comparisons, 05-references, 06-synthesis
- Use `99-scratch` for rough notes only
- `sources` must list every URL or file path you cite
- `confidence`: high = primary source verified; medium = multiple secondaries; low = inference
- `summary` must be a 1–3 sentence TL;DR an agent can act on immediately
- `tags` must include at least the primary technology/topic keyword

## How to search (all agents)
Use `research_search` for semantic/hybrid search. Use `research_grep` for regex patterns. Use `research_read` to read a specific file. Use `research_index` to browse the full structure.

## How to cite
When referencing a finding in your response or handoff, emit a `research://` link:
- Format: `research://<workflow>/<section>/<filename>.md[#anchor]`
- Use `_` as workflow when the scope is project-wide: `research://_/02-tech/sqlite-vec.md`
- These links are clickable in the Elefant client → they open the Research View at that file

## Writer agent owns the indexes
The writer agent runs `research_index` after each wave and rewrites `.elefant/markdown-db/INDEX.md` and each section `README.md`. Never manually edit those files if you are not the writer agent.

## No Obsidian
The Research Base is plain markdown. Do not emit `[[wikilinks]]` syntax. Use standard markdown links or `research://` URIs.
