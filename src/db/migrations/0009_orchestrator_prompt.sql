-- Migration 0009: Add orchestrator_prompt to agent_runs
--
-- Stores the original prompt the orchestrator used to spawn a sub-agent,
-- so the frontend can display it as the initial user message in the
-- child run transcript panel.

ALTER TABLE agent_runs ADD COLUMN orchestrator_prompt TEXT;
