# Agent Rich Visualization

The `visualize` tool lets the orchestrator agent inline-render premium
visualization components (mermaid, tables, stat grids, research cards,
etc.) directly in the chat transcript. The full design lives under
`.goopspec/feat-rich-viz/`; this document is the agent-facing guide.

## Tool surface

```ts
visualize({
  type: 'mermaid' | 'table' | 'stat-grid' | 'code'
       | 'field-notes-card' | 'loading' | 'comparison',
  data: { /* per-type payload, validated by Zod */ },
  intent: string,           // why this viz exists (used as accessibility label fallback)
  title?: string,           // optional caption above the renderer
})
```

Each `type` has a strict Zod schema in `src/tools/visualize/schemas.ts`.
Calls that fail validation never reach the frontend.

## Rendering Research Results

The `field-notes-card` viz is the bento-grid renderer for any list of
research-style results — typically the output of `field_notes_search` or
`field_notes_index`. Its payload schema is:

```ts
{
  type: 'field-notes-card',
  cards: Array<{
    title: string;
    summary: string;
    url?: string;        // `fieldnotes://...` chips route to the Field Notes
    confidence?: number; // 0–1; rendered as a high/med/low pill
    tags?: string[];     // first 4 displayed; overflow shown as "+N"
  }>;
}
```

### Worked example: search → visualize

The orchestrator runs a search and renders the hits as cards via the
`fieldNotesHitsToCards` adapter (in
`src/tools/visualize/adapters/field-notes.ts`):

```ts
import { fieldNotesHitsToCards } from '../tools/visualize/adapters/field-notes.js';

// 1. Get hits from field_notes_search.
const hits = await field_notes_search({ query: 'mermaid theming', k: 5 });

// 2. Adapt the tool-shape to the viz-shape.
const cards = fieldNotesHitsToCards(hits.results);

// 3. Render inline in the transcript.
await visualize({
  type: 'field-notes-card',
  title: 'Mermaid theming notes',
  intent: 'Surface relevant prior research before answering',
  data: { cards },
});
```

The same adapter accepts `field_notes_index` `TreeFile` / `FlatFile`
output — the discrete `confidence: 'high' | 'medium' | 'low'` band is
mapped to a representative numeric score so the pill renders
consistently regardless of whether the upstream tool ranks numerically
or by frontmatter band.

### Field mapping reference

| Field Notes tool field | `field-notes-card` field | Notes |
|---|---|---|
| `title` | `title` | Falls back to `'Untitled'` when absent. |
| `summary` / `snippet` | `summary` | Truncated to 400 chars. |
| `fieldnotes_link` / `path` | `url` | `fieldnotes://` URIs render as `FieldNotesChip`. |
| `score` (0–1) | `confidence` | Clamped to [0, 1]; non-finite values dropped. |
| `confidence` ('high'\|'medium'\|'low') | `confidence` | Mapped to 0.9 / 0.6 / 0.3. |
| `tags` | `tags` | Falls back to `[section]` when tags absent. |

### When to render cards vs. plain text

Prefer `field-notes-card` when:

- Surfacing 2–8 results from a `field_notes_\**` tool call.
- The user asked "what did we find about X?" or similar.
- Confidence and tags add scanability that prose would obscure.

Prefer plain text (or a follow-up summary) when:

- Reporting a single high-confidence result the user must read in full.
- Synthesising findings rather than listing them.

## Subagent Suggest Pattern (MH9)

Subagents cannot call `visualize` directly. Instead, they emit a
`<suggest-viz>` element in their closing XML envelope:

```xml
<goop_report version="0.2.8">
  ...
  <suggest-viz type="stat-grid" data='{"items":[{"label":"Tests","value":42,"trend":"up"}]}' intent="Show test suite results" />
  <handoff>...</handoff>
</goop_report>
```

The main orchestrator reads suggestions via `parseSuggestViz(closingXml)`
and decides whether to call `visualize`.

### Orchestrator Decision Flow

```typescript
import { parseSuggestViz } from '../src/agents/suggest-viz.js';

const suggestions = parseSuggestViz(subagentXml);
for (const suggestion of suggestions) {
  // Orchestrator decides based on context, user preferences, etc.
  await visualizeTool.execute({
    type: suggestion.type,
    data: suggestion.data,
    intent: suggestion.intent ?? 'Agent suggested visualization',
  });
}
```

### Suggest-viz Placement

Place `<suggest-viz>` as a top-level sibling of `<handoff>` under
`<goop_report>`:

```xml
<goop_report>
  <status>COMPLETE</status>
  <summary>...</summary>
  <suggest-viz type="mermaid" data='{"src":"graph LR; A-->B"}' />
  <handoff>...</handoff>
</goop_report>
```

## Adding a New Viz Type

1. Define the Zod schema in `src/tools/visualize/schemas.ts` (add to
   discriminated union)
2. Add the TypeScript type to `src/tools/visualize/types.ts`
3. Create `desktop/src/features/chat/viz/MyNewViz.svelte` (Svelte 5
   runes, Quire tokens)
4. Register in `desktop/src/features/chat/viz/registry.ts`:
   ```typescript
   import MyNewViz from './MyNewViz.svelte';
   registerVizRenderer('my-new-type', MyNewViz);
   ```
5. Add tests for any pure helpers in `*-state.ts`
