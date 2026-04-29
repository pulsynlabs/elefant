# Spec Mode Architecture

This document describes the internal architecture of Elefant's Spec Mode — the database
schema, hook flow, agent dispatch pipeline, state machine, and compaction survival strategy.

## Database Schema

Spec Mode adds 12 new SQLite tables across 5 migrations (0004–0008).

### Core workflow table

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `spec_workflows` | One row per workflow cycle | `id`, `project_id`, `workflow_id`, `phase`, `mode`, `depth`, `autopilot`, `lazy_autopilot`, `spec_locked`, `acceptance_confirmed`, `interview_complete`, `current_wave`, `total_waves`, `status`, `last_activity` |

FOREIGN KEY `project_id → projects(id) ON DELETE CASCADE`. UNIQUE on `(project_id, workflow_id)`.

### Document chain tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `spec_documents` | Full markdown content per doc type (REQUIREMENTS/SPEC/BLUEPRINT/CHRONICLE/ADL) | `workflow_id FK → spec_workflows(id) CASCADE`, `doc_type`, `content_md`, `version`, `locked` |
| `spec_must_haves` | Structured must-haves per workflow | `workflow_id FK → spec_workflows(id) CASCADE`, `mh_id`, `title`, `description`, `dependencies` (JSON), `ordinal` |
| `spec_acceptance_criteria` | Per-MH acceptance criteria | `must_have_id FK → spec_must_haves(id) CASCADE`, `ac_id`, `text` |
| `spec_validation_contracts` | Per-MH behavioral assertions | `must_have_id FK → spec_must_haves(id) CASCADE`, `vc_id`, `text`, `severity` (must/should/may) |
| `spec_out_of_scope` | Out-of-scope items per workflow | `workflow_id FK → spec_workflows(id) CASCADE`, `item`, `reason` |
| `spec_amendments` | Locked-spec amendment trail with prior/new state snapshots | `workflow_id FK → spec_workflows(id) CASCADE`, `version`, `prior_state` (JSON), `new_state` (JSON), `rationale` |
| `spec_blueprints` | Blueprint header — one per version per workflow | `workflow_id FK → spec_workflows(id) CASCADE`, `version` |
| `spec_waves` | Wave decomposition within a blueprint | `blueprint_id FK → spec_blueprints(id) CASCADE`, `wave_number`, `name`, `goal`, `parallel` |
| `spec_tasks` | Atomic tasks within a wave | `wave_id FK → spec_waves(id) CASCADE`, `task_id`, `executor` (low/medium/high/frontend), `files`, `action`, `done`, `verify`, `status`, `agent_run_id` (soft-link, nullable) |

### History tables (RESTRICT delete to preserve audit trails)

| Table | Purpose | FK constraint |
|-------|---------|---------------|
| `spec_chronicle_entries` | Append-only execution log | `workflow_id → spec_workflows(id)` ON DELETE RESTRICT |
| `spec_adl_entries` | Append-only decision/deviations/observations | `workflow_id → spec_workflows(id)` ON DELETE RESTRICT |

### Infrastructure tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `spec_idempotency` | 24h-TTL replay cache for spec_* tool calls | PK `(workflow_id, tool_name, idempotency_key)`, `result_payload` (JSON) |
| `agent_profiles` | Per-agent config (model, provider, tool allow-list, permissions, context mode) | added via 0007 migration with columns `tools_allowlist`, `permissions`, `context_mode`, `prompt_file`, `prompt_override` |
| `projects.legacy_state_mode` | Column on existing `projects` table — opt-out toggle for spec-mode features | added via 0008 migration, defaults to 0 (spec-mode on) |

### Key foreign key relationships

```
projects ──┐
           ├─► spec_workflows ──┬──► spec_documents (CASCADE)
           │                    ├──► spec_must_haves (CASCADE)
           │                    │      ├──► spec_acceptance_criteria (CASCADE)
           │                    │      └──► spec_validation_contracts (CASCADE)
           │                    ├──► spec_out_of_scope (CASCADE)
           │                    ├──► spec_amendments (CASCADE)
           │                    ├──► spec_blueprints (CASCADE)
           │                    │      └──► spec_waves (CASCADE)
           │                    │             └──► spec_tasks (CASCADE)
           │                    ├──► spec_chronicle_entries (RESTRICT)
           │                    └──► spec_adl_entries (RESTRICT)
           │
           └──► agent_runs
```

RESTRICT on chronicle/adl means a workflow cannot be silently deleted while
history entries exist — explicit history clearing is required first.

## Hook Flow

Spec Mode enforcement lives in hooks. The flow for every tool call:

```
┌──────────────┐    ┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│ Agent issues  │───►│ tool:before │───►│ Permission   │───►│ Tool         │
│ tool call     │    │ hook        │    │ Gate         │    │ executes     │
└──────────────┘    └─────────────┘    └──────────────┘    └──────────────┘
                           │                    │                    │
                           ▼                    ▼                    ▼
                    Phase precondition    Orchestrator gate:     tool:after hook
                    check (spec_* only):  deny write|edit on    fires → SSE/WS
                    currentPhase ∈        source files for      publish → state
                    tool.allowedPhases    orchestrators          mutation → DB write
```

### Hook events emitted during Spec Mode lifecycle

| Event | Payload | Emitted when |
|-------|---------|-------------|
| `spec:locked` | `{ workflowId, lockedAt, lockedBy }` | SPEC contract locked |
| `spec:amended` | `{ workflowId, amendmentVersion, priorState, newState }` | SPEC amended via amend flow |
| `spec:unlocked` | `{ workflowId, unlockedAt, unlockedBy }` | SPEC unlocked (amend flow temporarily lifts lock) |
| `blueprint:created` | `{ workflowId, blueprintVersion }` | First BLUEPRINT write for a workflow |
| `wave:started` | `{ workflowId, waveNumber, taskCount }` | Wave transitions to in-progress |
| `wave:completed` | `{ workflowId, waveNumber, taskCount, completedCount }` | All tasks in wave completed |
| `task:assigned` | `{ workflowId, taskId, agentRunId, executor }` | Task dispatched to an executor |
| `task:completed` | `{ workflowId, taskId, outputs, commitSha? }` | Executor reports task done |
| `phase:transitioned` | `{ workflowId, from, to, forced? }` | Workflow phase changes |

## Agent Dispatch Sequence

When the orchestrator issues `task({ subagent_type: "executor-high" })`:

```
┌──────────────────┐     ┌────────────────┐     ┌────────────────┐
│ Orchestrator     │────►│ task tool      │────►│ AgentRegistry  │
│ calls task()     │     │ handler        │     │ .resolve(name) │
└──────────────────┘     └────────────────┘     └────────────────┘
                                                       │
                                                       ▼
                         ┌─────────────────────────────────────────┐
                         │ 1. Read agent profile from DB            │
                         │ 2. Load prompt from src/agents/prompts/  │
                         │    (or prompt_override if set)           │
                         │ 3. Resolve _shared/ partial includes     │
                         │ 4. Apply context mode:                   │
                         │    - "none" → verifier, fresh context   │
                         │    - "inherit_session" → executors       │
                         │    - "snapshot" → checkpoint restore     │
                         │ 5. Filter tools by allow-list            │
                         │ 6. Inject PKB content via context:transform│
                         └─────────────────────────────────────────┘
                                                       │
                                                       ▼
                         ┌─────────────────────────────────────────┐
                         │ permission:ask hook runs classifier:     │
                         │ - If orchestrator + write/edit → DENY   │
                         │   with ORCHESTRATOR_NO_WRITE             │
                         │ - Executor with out-of-scope tool → DENY │
                         │ - Lazy autopilot + question tool → DENY  │
                         └─────────────────────────────────────────┘
```

### Verifier independence

The verifier is always dispatched with `contextMode: "none"` — it receives:
- The locked SPEC's full validation contract
- The list of files changed since SPEC lock (from CHRONICLE)
- No executor reasoning trace, no chat history, no prior agent turns

This guarantees unbiased audit — the verifier sees only the contract and the code.

### Lazy Autopilot auto-progression

```
interview complete ──► auto-dispatch /spec-plan
spec:locked        ──► auto-dispatch /spec-execute
last wave complete ──► auto-dispatch /spec-audit
audit complete     ──► STOP — human must confirm accept
```

Hard-cap: 50 phase transitions per workflow per hour prevents runaway loops.

## State Machine

### Phase transitions

| From | Allowed `to` |
|------|-------------|
| `idle` | `discuss` |
| `discuss` | `plan`, `research` (optional) |
| `research` | `plan` |
| `plan` | `specify` |
| `specify` | `execute` |
| `execute` | `audit` |
| `audit` | `accept`, `execute` (back on remediation) |
| `accept` | (terminal) |

Non-allowed transitions return `{ code: "INVALID_TRANSITION", from, to, allowed: [...] }`.
Forced transitions (with `force=true`) are allowed but log an ADL `decision` entry.

### Spec lock semantics

- **Lock condition**: `spec_locked = 1` after user confirms SPEC at the contract gate
- **Lock effect**: Write to must-haves, acceptance criteria, out-of-scope, or validation contracts returns `SPEC_LOCKED`
- **Lock alone**: `spec_locked = 1` alone does NOT lock `content_md` in `spec_documents` — only structured rows are gated
- **Amendment flow**: BEGIN TX → snapshot prior state → temporarily clear lock → apply change → re-set lock → insert amendment row → COMMIT. Entire window is transactional.
- **Lock + missing VCs**: Calling `lock-spec` when any must-have lacks a validation contract returns `VALIDATION_CONTRACT_INCOMPLETE` — the lock is refused

### Phase gate behavior

At each `tool:before` hook, for `spec_*` tools only:
- Read the tool's `allowedPhases` declaration (from SpecTool base class)
- Read `currentPhase` for the active workflow
- If `currentPhase ∉ allowedPhases`, veto the call with structured error `{ code: "INVALID_PHASE" }`
- Non-spec tools are unaffected

## Compaction Survival

When a `session:pre_compact` event fires mid-execute, the system injects a Spec Mode block
into the surviving context. The block contains:

```
## SPEC MODE — <workflowId>
Phase: execute | Mode: standard | Depth: deep
> LAZY AUTOPILOT ACTIVE — DO NOT ASK QUESTIONS, INFER FROM CONTEXT.
  (present only when lazyAutopilot=true)

Locked Must-Haves: MH1, MH2, MH3, MH4, MH5 (5 of 11 — more exist)
Current Wave: 7/13 — Wave 7: Desktop GUI — 4/6 tasks complete

Last 3 ADL:
- [decision] Used jose library for JWT over jsonwebtoken — 2026-04-28
- [deviation] Migration numbers drifted — 2026-04-28
- [decision] Reused ToolCardShell for spec viewer tabs — 2026-04-28
```

### Block composition rules
- **Must-haves capped at 5** — prevents context bloat. Always list by ordinal order.
- **ADL capped at 3 most recent** — decisions and deviations only (excludes observations).
- **Wave summary** includes wave number, name, task completion count.
- **Lazy directive** prepended when `lazyAutopilot=true` — agent instructions in the block
  key on this literal phrase for behavior.
- **Total block size** typically under 1500 characters.

## Error Code Reference

All spec_* tools return errors from a closed `SpecToolErrorCode` enum:

| Code | HTTP status | Meaning |
|------|-------------|---------|
| `SPEC_LOCKED` | 423 | Attempted write to locked structured spec data |
| `INVALID_PHASE` | 409 | Tool called outside its allowed phases |
| `INVALID_TRANSITION` | 409 | Attempted invalid phase transition |
| `WORKFLOW_NOT_FOUND` | 404 | workflowId does not exist for the project |
| `WORKFLOW_EXISTS` | 409 | Duplicate workflowId for the same project |
| `IDEMPOTENT_REPLAY` | 200 (not an error) | Cached result returned, no re-execution |
| `VALIDATION_FAILED` | 400 | Schema validation of tool input failed |
| `VALIDATION_CONTRACT_INCOMPLETE` | 409 | Lock attempted with must-haves lacking VCs |
| `ORCHESTRATOR_NO_WRITE` | 403 | Orchestrator attempted write/edit on source files |
