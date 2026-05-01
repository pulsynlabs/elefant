-- Migration 0010: Rename spec_locked column to locked
--
-- Adds a new 'locked' column and backfills from 'spec_locked' if the old
-- column is still present and populated. The old 'spec_locked' column is
-- kept for backward compatibility during this sprint but is deprecated
-- and will be removed in a future migration.
--
-- StateManager (src/state/manager.ts) now reads/writes the 'locked' column
-- going forward via SpecWorkflowRow.locked and the Zod SpecWorkflowSchema.

ALTER TABLE spec_workflows ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;

UPDATE spec_workflows SET locked = spec_locked;
