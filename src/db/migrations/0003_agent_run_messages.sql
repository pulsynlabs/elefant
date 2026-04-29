-- Migration 0003: Agent run message persistence

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_run_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT    NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  role        TEXT    NOT NULL CHECK(role IN ('system','user','assistant','tool_call','tool_result')),
  content     TEXT    NOT NULL,
  tool_name   TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_run_messages_run_seq
  ON agent_run_messages(run_id, seq);

CREATE INDEX IF NOT EXISTS idx_agent_run_messages_run_role
  ON agent_run_messages(run_id, role);
