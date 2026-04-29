-- Migration 0005: Spec Mode document chain tables
-- Stores the full REQUIREMENTS → SPEC → BLUEPRINT → CHRONICLE → ADL chain,
-- plus must-haves, acceptance criteria, validation contracts, out-of-scope,
-- amendments, blueprints/waves/tasks, chronicle entries, and ADL entries.
-- All FKs to spec_workflows(id) ON DELETE CASCADE except chronicle/adl
-- which use ON DELETE RESTRICT to preserve execution history.

PRAGMA foreign_keys = ON;

-- Full markdown content per doc type (REQUIREMENTS/SPEC/BLUEPRINT/CHRONICLE/ADL)
CREATE TABLE IF NOT EXISTS spec_documents (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES spec_workflows(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK(doc_type IN ('REQUIREMENTS','SPEC','BLUEPRINT','CHRONICLE','ADL')),
  content_md TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workflow_id, doc_type)
);
CREATE INDEX IF NOT EXISTS idx_spec_documents_workflow ON spec_documents(workflow_id);

-- Structured must-haves per workflow
CREATE TABLE IF NOT EXISTS spec_must_haves (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES spec_workflows(id) ON DELETE CASCADE,
  mh_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  dependencies TEXT NOT NULL DEFAULT '[]',
  ordinal INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workflow_id, mh_id)
);
CREATE INDEX IF NOT EXISTS idx_spec_must_haves_workflow ON spec_must_haves(workflow_id);

-- Per-MH acceptance criteria
CREATE TABLE IF NOT EXISTS spec_acceptance_criteria (
  id TEXT PRIMARY KEY NOT NULL,
  must_have_id TEXT NOT NULL REFERENCES spec_must_haves(id) ON DELETE CASCADE,
  ac_id TEXT NOT NULL,
  text TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(must_have_id, ac_id)
);
CREATE INDEX IF NOT EXISTS idx_spec_ac_must_have ON spec_acceptance_criteria(must_have_id);

-- Per-MH validation contract assertions
CREATE TABLE IF NOT EXISTS spec_validation_contracts (
  id TEXT PRIMARY KEY NOT NULL,
  must_have_id TEXT NOT NULL REFERENCES spec_must_haves(id) ON DELETE CASCADE,
  vc_id TEXT NOT NULL,
  text TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'must' CHECK(severity IN ('must','should','may')),
  ordinal INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(must_have_id, vc_id)
);
CREATE INDEX IF NOT EXISTS idx_spec_vc_must_have ON spec_validation_contracts(must_have_id);

-- Out-of-scope items per workflow
CREATE TABLE IF NOT EXISTS spec_out_of_scope (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES spec_workflows(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  ordinal INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spec_oos_workflow ON spec_out_of_scope(workflow_id);

-- Append-only amendment log capturing prior+new state snapshots
CREATE TABLE IF NOT EXISTS spec_amendments (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES spec_workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  prior_state TEXT NOT NULL,
  new_state TEXT NOT NULL,
  rationale TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workflow_id, version)
);
CREATE INDEX IF NOT EXISTS idx_spec_amendments_workflow ON spec_amendments(workflow_id);

-- Blueprint header — one row per version per workflow
CREATE TABLE IF NOT EXISTS spec_blueprints (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES spec_workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workflow_id, version)
);
CREATE INDEX IF NOT EXISTS idx_spec_blueprints_workflow ON spec_blueprints(workflow_id);

-- Wave decomposition within a blueprint version
CREATE TABLE IF NOT EXISTS spec_waves (
  id TEXT PRIMARY KEY NOT NULL,
  blueprint_id TEXT NOT NULL REFERENCES spec_blueprints(id) ON DELETE CASCADE,
  wave_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  parallel INTEGER NOT NULL DEFAULT 0,
  ordinal INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(blueprint_id, wave_number)
);
CREATE INDEX IF NOT EXISTS idx_spec_waves_blueprint ON spec_waves(blueprint_id);

-- Tasks within a wave
-- agent_run_id is intentionally nullable TEXT (not a hard FK) to avoid coupling
-- spec_tasks to agent_runs lifecycle. If an agent_run row is deleted, the task
-- row retains its history.
CREATE TABLE IF NOT EXISTS spec_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  wave_id TEXT NOT NULL REFERENCES spec_waves(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  name TEXT NOT NULL,
  executor TEXT NOT NULL CHECK(executor IN ('goop-executor-low','goop-executor-medium','goop-executor-high','goop-executor-frontend')),
  files TEXT NOT NULL DEFAULT '[]',
  action TEXT NOT NULL,
  done TEXT NOT NULL,
  verify TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','complete','blocked','skipped')),
  agent_run_id TEXT,
  ordinal INTEGER NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(wave_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_spec_tasks_wave ON spec_tasks(wave_id);
CREATE INDEX IF NOT EXISTS idx_spec_tasks_status ON spec_tasks(status);

-- Append-only execution log (CHRONICLE)
-- ON DELETE RESTRICT preserves history — workflows cannot be silently deleted
-- while chronicle entries exist — explicit history-clearing is required first.
CREATE TABLE IF NOT EXISTS spec_chronicle_entries (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES spec_workflows(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spec_chronicle_workflow ON spec_chronicle_entries(workflow_id);
CREATE INDEX IF NOT EXISTS idx_spec_chronicle_created ON spec_chronicle_entries(workflow_id, created_at);

-- Append-only architectural decision log (ADL)
-- ON DELETE RESTRICT preserves history — same semantics as chronicle.
CREATE TABLE IF NOT EXISTS spec_adl_entries (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES spec_workflows(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK(type IN ('decision','deviation','observation')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  rule INTEGER,
  files TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spec_adl_workflow ON spec_adl_entries(workflow_id);
CREATE INDEX IF NOT EXISTS idx_spec_adl_created ON spec_adl_entries(workflow_id, created_at);
