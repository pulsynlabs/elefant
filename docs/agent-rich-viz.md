# Agent Rich Visualization

The `visualize` tool lets the orchestrator agent inline-render premium
visualization components (mermaid, tables, stat grids, research cards,
etc.) directly in the chat transcript. The full design lives under
`.goopspec/feat-rich-viz/`; this document is the agent-facing guide.

## Tool surface

```ts
visualize({
  type: 'mermaid' | 'table' | 'stat-grid' | 'code'
       | 'research-card' | 'loading' | 'comparison',
  data: { /* per-type payload, validated by Zod */ },
  intent: string,           // why this viz exists (used as accessibility label fallback)
  title?: string,           // optional caption above the renderer
})
```

Each `type` has a strict Zod schema in `src/tools/visualize/schemas.ts`.
Calls that fail validation never reach the frontend.

## Rendering Research Results

The `research-card` viz is the bento-grid renderer for any list of
research-style results — typically the output of `research_search` or
`research_index`. Its payload schema is:

```ts
{
  type: 'research-card',
  cards: Array<{
    title: string;
    summary: string;
    url?: string;        // `research://...` chips route to the Research View
    confidence?: number; // 0–1; rendered as a high/med/low pill
    tags?: string[];     // first 4 displayed; overflow shown as "+N"
  }>;
}
```

### Worked example: search → visualize

The orchestrator runs a search and renders the hits as cards via the
`researchHitsToCards` adapter (in
`src/tools/visualize/adapters/research.ts`):

```ts
import { researchHitsToCards } from '../tools/visualize/adapters/research.js';

// 1. Get hits from research_search.
const hits = await research_search({ query: 'mermaid theming', k: 5 });

// 2. Adapt the tool-shape to the viz-shape.
const cards = researchHitsToCards(hits.results);

// 3. Render inline in the transcript.
await visualize({
  type: 'research-card',
  title: 'Mermaid theming notes',
  intent: 'Surface relevant prior research before answering',
  data: { cards },
});
```

The same adapter accepts `research_index` `TreeFile` / `FlatFile`
output — the discrete `confidence: 'high' | 'medium' | 'low'` band is
mapped to a representative numeric score so the pill renders
consistently regardless of whether the upstream tool ranks numerically
or by frontmatter band.

### Field mapping reference

| Research-tool field | `research-card` field | Notes |
|---|---|---|
| `title` | `title` | Falls back to `'Untitled'` when absent. |
| `summary` / `snippet` | `summary` | Truncated to 400 chars. |
| `research_link` / `path` | `url` | `research://` URIs render as `ResearchChip`. |
| `score` (0–1) | `confidence` | Clamped to [0, 1]; non-finite values dropped. |
| `confidence` ('high'\|'medium'\|'low') | `confidence` | Mapped to 0.9 / 0.6 / 0.3. |
| `tags` | `tags` | Falls back to `[section]` when tags absent. |

### When to render cards vs. plain text

Prefer `research-card` when:

- Surfacing 2–8 results from a `research_*` tool call.
- The user asked "what did we find about X?" or similar.
- Confidence and tags add scanability that prose would obscure.

Prefer plain text (or a follow-up summary) when:

- Reporting a single high-confidence result the user must read in full.
- Synthesising findings rather than listing them.

## Subagent suggest pattern

Subagents (researcher, executor, etc.) cannot call `visualize`
themselves — the tool is enforced as orchestrator-only via the agent
toolkit allowlist. Instead, subagents emit a `<suggest-viz />` hint in
their closing XML envelope; the orchestrator decides whether to render
it. See Wave 5 for the parser and full pattern.
