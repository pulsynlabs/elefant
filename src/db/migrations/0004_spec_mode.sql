-- Migration 0004: Spec Mode workflow state engine

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS spec_workflows (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'standard' CHECK(mode IN ('quick','standard','comprehensive','milestone')),
  depth TEXT NOT NULL DEFAULT 'standard' CHECK(depth IN ('shallow','standard','deep')),
  phase TEXT NOT NULL DEFAULT 'idle' CHECK(phase IN ('idle','discuss','plan','research','specify','execute','audit','accept')),
  status TEXT NOT NULL DEFAULT 'idle',
  autopilot INTEGER NOT NULL DEFAULT 0 CHECK(autopilot IN (0, 1)),
  lazy_autopilot INTEGER NOT NULL DEFAULT 0 CHECK(lazy_autopilot IN (0, 1)),
  spec_locked INTEGER NOT NULL DEFAULT 0 CHECK(spec_locked IN (0, 1)),
  acceptance_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(acceptance_confirmed IN (0, 1)),
  interview_complete INTEGER NOT NULL DEFAULT 0 CHECK(interview_complete IN (0, 1)),
  interview_completed_at TEXT,
  current_wave INTEGER NOT NULL DEFAULT 0,
  total_waves INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
  last_activity TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_spec_workflows_project_id ON spec_workflows(project_id);
CREATE INDEX IF NOT EXISTS idx_spec_workflows_active ON spec_workflows(project_id, is_active);
