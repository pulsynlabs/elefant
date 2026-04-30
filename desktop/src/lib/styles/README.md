# Elefant Styles — Quire Material

The visual token system for Elefant Desktop, built on the **Quire** material language.

> **Quire** (`kwʌɪə(r)`) — *n.* a gathering of folded sheets bound into a book.
>
> Software-as-bound-pages: editorial typography, hairline edges, tactile micro-detail.

---

## File Map

| File | Purpose |
|---|---|
| `tokens.css` | Color, surface, border, text, motion, radius, spacing tokens for both themes; shadcn-svelte CSS variable mapping |
| `typography.css` | Fraunces (display), Newsreader (body), Geist Mono (telemetry) variable axes; seven canonical type tiers |
| `quire.css` | Three surface tiers (sm, md, lg) and the nested bezel pair (plate + leaf) |
| `texture.css` | Mono labels, hairline borders, structural dividers — non-surface utility classes |
| `forms.css` | Native form control styling (input, select, textarea) as quire-sm |
| `shadcn-overrides.css` | Focus ring, scrollbar, selection, button press feedback, popover/dropdown/dialog/tooltip surfaces |

---

## Quick Start: Add a New Component

1. **Pick the right surface tier** — small details = `quire-sm`; cards/panels = `quire-md`; modals/popovers = `quire-lg`
2. **Use the type utility classes** from `typography.css` — `.text-caption`, `.text-meta`, `.text-body`, `.text-prose`, `.text-title`, `.text-display`, `.text-hero`
3. **Use only `var(--*)` tokens** for colors, borders, shadows, radii, motion — NEVER hex literals in your `<style>` blocks
4. **Apply transitions via composed shorthands** — `var(--transition-fast)`, `var(--transition-base)`, `var(--transition-slow)`, `var(--transition-spring)`
5. **Verify in BOTH light and dark themes** — activate light mode by setting `data-theme="light"` on the document root
6. **If you need a press feedback or focus ring** — leave it. The global `shadcn-overrides.css` handles both

---

## Token Reference

### Colors

| Token | Value | Purpose |
|---|---|---|
| `--color-primary` | `#4049e1` | Electric Indigo. Brand accent. Reserved for primary action, focus, and one ambient glow per view. |
| `--color-primary-hover` | `#5660ed` | Hover state for primary surfaces |
| `--color-primary-pressed` | `#3540d4` | Active/pressed state |
| `--color-primary-subtle` | `rgba(64, 73, 225, 0.14)` | Tinted backgrounds (selected rows, soft highlights) |
| `--color-primary-foreground` | `#ffffff` | Text-on-primary |
| `--color-success` | `#22c55e` | Complete, running, healthy |
| `--color-warning` | `#f59e0b` | Waiting, pending approval, caution |
| `--color-error` | `#ef4444` | Failed, blocked, error |
| `--color-info` | `#3b82f6` | Neutral running, informational |

### Surfaces

| Token | Use |
|---|---|
| `--surface-substrate` | Page background (never pure black) |
| `--surface-plate` | Outer bezel of nested cards; quire-sm fill |
| `--surface-leaf` | Inner page of nested cards; quire-leaf fill |
| `--surface-overlay` | Floating overlays (quire-lg fill) |
| `--surface-hover` | Hover state on surfaces |

### Borders

| Token | Strength | Use |
|---|---|---|
| `--border-hairline` | 6% opacity | Disappears at distance; resolves at reading range |
| `--border-edge` | 10% opacity | Card edges, default visible border |
| `--border-emphasis` | 40% opacity | Selected/active state |
| `--border-focus` | `#4049e1` | Focus outline color (= `--color-primary`) |

### Text

| Token | Use |
|---|---|
| `--text-prose` | Primary body content |
| `--text-meta` | Secondary text (mono labels, timestamps) |
| `--text-muted` | Tertiary, hint, placeholder |
| `--text-disabled` | Disabled inputs |
| `--text-inverse` | On filled buttons |

### Shadows (indigo-tinted both themes)

`--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`

Each shadow is composed of a dark base layer (opacity-graded) plus a subtle indigo tint for cohesion.

### Glows

| Token | Use |
|---|---|
| `--glow-primary` | Soft ambient glow around primary elements |
| `--glow-primary-strong` | Stronger glow for emphasis |
| `--glow-ambient` | Very subtle background glow (use sparingly) |
| `--glow-focus` | 4px ambient halo around focused elements |

### Motion

| Token | Value | Use |
|---|---|---|
| `--duration-micro` | 80ms | Instant feedback (press, dismiss) |
| `--duration-instant` | 50ms | Fastest transitions |
| `--duration-fast` | 150ms | Quick state changes |
| `--duration-base` | 250ms | Standard transitions |
| `--duration-slow` | 400ms | Deliberate, choreographed motion |
| `--ease-out-expo` | Premium expo curve | General motion |
| `--ease-out-quart` | Premium quart curve | Refined motion |
| `--ease-spring` | Spring physics | Tactile feedback |
| `--ease-standard` | Linear-soft | Smooth, non-dramatic |
| `--transition-micro` | Composed shorthand | `transform opacity var(--duration-micro) var(--ease-out-expo)` |
| `--transition-fast` | Composed shorthand | `transform opacity var(--duration-fast) var(--ease-out-expo)` |
| `--transition-base` | Composed shorthand | `transform opacity var(--duration-base) var(--ease-out-quart)` |
| `--transition-slow` | Composed shorthand | `transform opacity var(--duration-slow) var(--ease-out-quart)` |
| `--transition-spring` | Composed shorthand | `transform opacity var(--duration-base) var(--ease-spring)` |

### Radius

| Token | Value | Use |
|---|---|---|
| `--radius-leaf` | 6px | Inner content surfaces (nested bezel inner) |
| `--radius-plate` | 10px | Outer bezels (cards) |
| `--radius-fold` | 14px | Large folded surfaces (avatar squircle) |
| `--radius-none` | 0px | No rounding |
| `--radius-xs` | 2px | Minimal rounding |
| `--radius-sm` | 4px | Small elements |
| `--radius-md` | 6px | Medium elements |
| `--radius-lg` | 8px | Large elements |
| `--radius-xl` | 12px | Extra large |
| `--radius-2xl` | 16px | Huge |
| `--radius-full` | 9999px | Pill-shaped |

### Spacing

`--space-1` through `--space-12` on a 4px base.

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 24px |
| `--space-6` | 32px |
| `--space-7` | 48px |
| `--space-8` | 64px |
| `--space-9` | 96px |
| `--space-10` | 128px |

---

## Type Tiers

| Class | Family | Size | Variation Settings | Use |
|---|---|---|---|---|
| `.text-caption` | Geist Mono | 10px | uppercase widest tracking | Labels, metadata |
| `.text-meta` | Geist Mono | 12px | tabular | Timestamps, telemetry |
| `.text-body` | Newsreader | 14px | opsz 14, wght 400 | Default body |
| `.text-prose` | Newsreader | 16px | opsz 16, wght 400 | Long-form, max-width 65ch |
| `.text-title` | Fraunces | 24px | opsz 24, wght 400 | Section titles |
| `.text-display` | Fraunces | 40px | opsz 40, wght 350 | Page titles |
| `.text-hero` | Fraunces | clamp(40-64px) | opsz 60, wght 320 | Hero moments |

Italic variants available via `.italic` utility — Fraunces and Newsreader both support italic axes.

---

## Surface Tiers

| Class | Use | Backdrop-filter | Inset Highlights |
|---|---|---|---|
| `.quire-sm` | TopBar, chips, pills, status indicators | None | Top + bottom inset edges |
| `.quire-md` | Sidebar, cards, panels | None | Subtle linear gradient + inset edges |
| `.quire-lg` | Modals, command palette, popovers, tooltips | Yes (only tier permitted) | Strong inset edges + outer shadow |

`.quire-interactive` adds hover lift (`transform: translateY(-1px)`) + focus ring using `--border-focus`.

---

## Nested Bezel

The nested bezel pair is the Quire signature — a folded-sheet metaphor replacing glass-morphism.

```html
<div class="quire-plate">
  <div class="quire-leaf">
    <!-- content -->
  </div>
</div>
```

**How it works:**

- `.quire-plate` — outer shell with `--radius-plate` (10px), 2px padding, hairline border
- `.quire-leaf` — inner core with `border-radius: calc(var(--radius-plate) - 2px)` for mathematical concentricity
- The gap between them creates the "folded sheet" visual metaphor
- Inset shadows on both layers simulate light catching the fold

**When to use:**

- Primary cards that need editorial weight
- Key panels in the UI
- Anywhere you want the "bound pages" signature

---

## Anti-Patterns (Do Not Do)

- **No `Inter` or `DM Sans`** — Quire body is Newsreader (serif)
- **No `h-screen`** — use `min-h-[100dvh]` for full-height
- **No emojis** in code or copy
- **No hex literals in component `<style>` blocks** — always `var(--*)` tokens
- **No animating `top`, `left`, `width`, or `height`** — use `transform` + `opacity` only (the progress-bar `width` transition is the documented exception)
- **No external animation libraries** — pure CSS keyframes
- **No `backdrop-filter` on scrolling content** — reserve for `quire-lg` floating overlays only
- **No `#000000`** — use `var(--surface-substrate)` (subtly tinted off-black)
- **No default shadcn radii or shadows** — global overrides re-route them through Quire tokens
- **No per-component focus rings** — global `:focus-visible` from `shadcn-overrides.css` covers it

---

## Both-Theme Verification

Activate light mode by setting `data-theme="light"` on the document root. Every component must render with equivalent polish in both themes.

**Checklist:**

- [ ] Contrast is readable in both light and dark
- [ ] Hairline borders are visible (not invisible in light mode)
- [ ] Shadows have the same visual weight
- [ ] Text colors are equally legible
- [ ] Hover states are clear in both themes

If you need theme-specific values that tokens can't express, put the override in `[data-theme="light"]` blocks within the component's own `<style>` — but token-only is strongly preferred.

---

## Cross-References

- **Brand archive:** `markdown-db/04-brand/material-language.md` — Quire design philosophy
- **Research:** `markdown-db/04-brand/research-2026-overhaul.md` — 2026 visual research
- **Spec:** `.goopspec/elefant-design-overhaul-v2/SPEC.md` — locked contract

---

*Quire material — Elefant v2.0.0 — 2026-04-30*
