# Migration Guide

## Coming from GoopSpec

If you have existing projects using [GoopSpec](https://github.com/jacobjove/goopspec), Elefant
detects your `.goopspec/` directory and offers a guided migration. Your state moves from
markdown files in the project tree to SQLite tables in `.elefant/db.sqlite`.

### Automatic Migration

1. Open your project in Elefant
2. Elefant detects `.goopspec/state.json` and shows a migration prompt
3. Click **"Migrate"** — your workflows move to the new SQLite backend
4. Existing `.goopspec/<workflow>/SPEC.md` files are imported as structured SPEC documents
5. BLUEPRINT.md and REQUIREMENTS.md are imported if present
6. The original `state.json` is renamed to `state.json.bak.<timestamp>`
7. You can continue using the project immediately

### Manual Migration

If you prefer to run migration from the command line:

```bash
bun run src/state/migrate-legacy.ts --project-path /path/to/project
```

### What Changes

| Before (GoopSpec) | After (Elefant Spec Mode) |
|-------------------|---------------------------|
| State in `.goopspec/state.json` | State in `.elefant/db.sqlite` → `spec_workflows` table |
| SPEC in `.goopspec/<wf>/SPEC.md` | SPEC in `spec_documents` + `spec_must_haves` + `spec_acceptance_criteria` + `spec_validation_contracts` |
| BLUEPRINT in `.goopspec/<wf>/BLUEPRINT.md` | BLUEPRINT in `spec_blueprints` + `spec_waves` + `spec_tasks` |
| CHRONICLE in `.goopspec/<wf>/CHRONICLE.md` | CHRONICLE in `spec_chronicle_entries` |
| ADL in `.goopspec/<wf>/ADL.md` | ADL in `spec_adl_entries` |
| Commands via orchestrator prompt | Same 15 slash commands, plus GUI panel |
| Agent dispatch via prompt | 13-agent fleet with per-role model/config |

### What Stays the Same

- Slash command names and workflows (`/spec-discuss`, `/spec-plan`, etc.)
- Agent roles (planner, verifier, executor tiers, etc.)
- Validation contract pattern
- Phase gating and spec lock semantics
- Autopilot tiers (Manual / Autopilot / Lazy Autopilot)

## Opting Out

If you prefer to keep using the GoopSpec file-based state:

1. Open Elefant Settings → Project
2. Toggle **"Use legacy state.json"** to ON
3. The Spec Mode panel shows a banner: **"Legacy mode — Spec Mode disabled"**
4. The daemon will not write to spec-mode tables for this project

You can toggle back at any time — migration is non-destructive.

## Fresh Start (No Migration)

If you're new to spec-driven development and have no GoopSpec history:

1. Open your project in Elefant
2. Type `/spec-discuss` in the chat to start your first workflow
3. No migration needed — you start with a clean DB-backed workflow

## Verifying Migration

After migration, verify:

1. **Workflows intact:** Type `/spec-status` — you should see all your migrated workflows
2. **SPEC content preserved:** Open the SPEC viewer tab for a migrated workflow — content should render identically
3. **No data loss:** Check that `state.json.bak.<timestamp>` exists and matches the pre-migration file
4. **Idempotency:** Run migration again — it should report `skipped: true`

## Troubleshooting

### "Migration failed" error
Check that `.goopspec/state.json` is valid JSON. If it's corrupted, restore from your git history or backup.

### "Already migrated" message
State is already in the SQLite DB. Re-running migration is safe and idempotent — no duplicate rows are created. The message `skipped: true` means everything is already in place.

### "Legacy mode" banner
You have the legacy state toggle enabled. Go to Settings → Project and toggle "Use legacy state.json" OFF to use the new DB-backed mode.

### SPEC content looks different after migration
The markdown renderer produces byte-stable output, but formatting may differ slightly from hand-authored GoopSpec files (trailing whitespace, header style). The structured data (must-haves, ACs, VCs) is preserved exactly. If a specific formatting issue blocks your workflow, use `/spec-amend` to adjust the rendered content.

### Migration left both old and new state
This is normal during the cutover window. The `.bak.<timestamp>` file preserves your original state as a safety net. Once you've verified the migration, you can delete the `.bak` file or leave it for audit trail.

## Database Location

Post-migration, your spec-mode state lives in:

```
.elefant/db.sqlite
```

This file is typically git-ignored (like `node_modules`). The daemon owns it. You can inspect it with:

```bash
sqlite3 .elefant/db.sqlite ".schema spec_*"
```

Or use the Spec Mode GUI which renders everything as human-readable markdown.
