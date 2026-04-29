-- Migration 0008: Project-level settings (legacy state mode toggle)
--
-- Adds opt-out for spec-mode features so existing projects can keep using
-- .elefant/state.json while we iterate. Default 0 means new and existing
-- projects opt into the new path automatically (AVC10 — non-spec-mode
-- projects see no behavior change because the new code only activates when
-- spec_workflows rows exist).

ALTER TABLE projects ADD COLUMN legacy_state_mode INTEGER NOT NULL DEFAULT 0;
