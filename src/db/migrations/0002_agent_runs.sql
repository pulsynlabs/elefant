-- Migration 0002: Agent run tracking

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_run_id TEXT REFERENCES agent_runs(run_id) ON DELETE SET NULL,
  agent_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','done','error','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  context_mode TEXT NOT NULL CHECK(context_mode IN ('none','inherit_session','snapshot')),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_session_created
  ON agent_runs(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_project_created
  ON agent_runs(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_parent
  ON agent_runs(parent_run_id);
