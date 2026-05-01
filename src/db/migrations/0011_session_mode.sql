-- Migration 0011: Add mode column to sessions table
--
-- Values: 'spec' (structured workflow) | 'quick' (freeform)
-- Set at session creation. Immutable thereafter — the application layer
-- (sessions repo) will reject any update that tries to change mode.
--
-- Existing rows are backfilled with 'quick' via the DEFAULT clause.

ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'quick'
  CHECK(mode IN ('spec', 'quick'));
