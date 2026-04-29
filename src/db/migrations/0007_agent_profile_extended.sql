-- Migration 0007: Extend agent profile storage for Spec Mode fleet configuration

CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  provider TEXT,
  model TEXT,
  behavior TEXT NOT NULL DEFAULT '{}',
  limits TEXT NOT NULL DEFAULT '{}',
  tools TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE agent_profiles ADD COLUMN tools_allowlist TEXT DEFAULT NULL;
ALTER TABLE agent_profiles ADD COLUMN permissions TEXT DEFAULT NULL;
ALTER TABLE agent_profiles ADD COLUMN context_mode TEXT DEFAULT 'inherit_session' CHECK(context_mode IN ('none','inherit_session','snapshot'));
ALTER TABLE agent_profiles ADD COLUMN prompt_file TEXT DEFAULT NULL;
ALTER TABLE agent_profiles ADD COLUMN prompt_override TEXT DEFAULT NULL;
