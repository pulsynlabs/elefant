CREATE TABLE IF NOT EXISTS spec_idempotency (
  workflow_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  result_payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workflow_id, tool_name, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_spec_idempotency_created
  ON spec_idempotency(created_at);
