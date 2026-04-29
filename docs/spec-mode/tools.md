# Spec Mode Tools Reference

All 11 `spec_*` tools are available to the orchestrator and other agents.
They are registered via `createSpecTools()` in `src/tools/spec/index.ts`.

## Common Fields

All tools accept `workflowId: string` and `projectId: string`.
All tools return structured errors (see `SpecToolErrorCode` enum in [Architecture](./architecture.md#error-code-reference)).
Tools with side effects accept an optional `idempotency_key: string`.

## Idempotency

Any spec tool called with an `idempotency_key` will return the cached result
for the same `(workflow_id, tool_name, idempotency_key)` within 24 hours without
re-executing the side effect. The cache lives in the `spec_idempotency` table.

## Tool Reference

### `spec_status`

**Allowed phases:** Any
**Purpose:** Get full workflow status snapshot
**Input:** `{ workflowId, projectId }`
**Output:** `{ phase, mode, depth, autopilot, lazyAutopilot, specLocked, acceptanceConfirmed, interviewComplete, currentWave, totalWaves, status, lastActivity }`
**Error codes:** `WORKFLOW_NOT_FOUND`
**Idempotency:** N/A (read-only)

### `spec_state`

**Allowed phases:** Any (depends on action)
**Purpose:** Manage workflow state — transitions, lock/unlock, mode/depth/autopilot
**Input:** Discriminated union by `action`:

| Action | Additional fields | Allowed phases |
|--------|-------------------|----------------|
| `get` | (none) | Any |
| `transition` | `{ to: string, force?: boolean }` | Any (gated by transition table) |
| `lock-spec` | (none) | `specify` |
| `unlock-spec` | (none) | `plan, specify` (for amend flow) |
| `set-mode` | `{ mode: string }` | `idle, discuss` |
| `set-depth` | `{ depth: string }` | `idle, discuss` |
| `set-autopilot` | `{ autopilot: boolean, lazyAutopilot?: boolean }` | `idle, discuss` |
| `update-wave` | `{ currentWave: number, totalWaves: number }` | `execute` |

**Error codes:** `INVALID_TRANSITION`, `SPEC_LOCKED` (on unlock without amend), `VALIDATION_CONTRACT_INCOMPLETE` (on lock), `WORKFLOW_NOT_FOUND`
**Idempotency:** Supported for `transition` and `lock-spec`

### `spec_workflow`

**Allowed phases:** Any
**Purpose:** List, create, set-active workflows for a project
**Input:** Discriminated union by `action`:

| Action | Additional fields | Description |
|--------|-------------------|-------------|
| `list` | (none) | Returns all workflows for the project |
| `create` | `{ workflowId, mode?, depth? }` | Creates a new workflow |
| `set-active` | `{ workflowId }` | Sets the active workflow for the session |

**Error codes:** `WORKFLOW_EXISTS` (duplicate on create), `WORKFLOW_NOT_FOUND`
**Idempotency:** Supported for `create`

### `spec_requirements`

**Allowed phases:** `discuss, plan`
**Purpose:** Read or write the REQUIREMENTS document
**Input:** Discriminated union by `action`:

| Action | Additional fields | Description |
|--------|-------------------|-------------|
| `read` | (none) | Returns full REQUIREMENTS as markdown |
| `write` | `{ content: string }` | Replace full REQUIREMENTS content |
| `section` | `{ section: string }` | Read a named section (vision, must-haves, constraints, etc.) |

**Error codes:** `WORKFLOW_NOT_FOUND`, `VALIDATION_FAILED`
**Idempotency:** Supported for `write`

### `spec_spec`

**Allowed phases:** `plan, specify` (read); `specify` (write/lock); `any` for amend
**Purpose:** Read, write, lock, or amend the SPEC contract
**Input:** Discriminated union by `action`:

| Action | Additional fields | Description |
|--------|-------------------|-------------|
| `read` | (none) | Returns full SPEC as markdown |
| `write` | `{ content: string }` | Replace SPEC content (blocked if locked) |
| `lock` | (none) | Lock the spec. Fails if any MH lacks a VC. |
| `amend` | `{ amendment: { rationale, changes } }` | Amend locked spec via transactional flow |

**Error codes:** `SPEC_LOCKED` (write without amend), `VALIDATION_CONTRACT_INCOMPLETE` (lock without VCs), `WORKFLOW_NOT_FOUND`
**Idempotency:** Supported for `write` and `lock`

### `spec_blueprint`

**Allowed phases:** `plan, specify, execute` (read/write); `specify` (section writes)
**Purpose:** Read, write, or query sections of the BLUEPRINT
**Input:** Discriminated union by `action`:

| Action | Additional fields | Description |
|--------|-------------------|-------------|
| `read` | (none) | Returns full BLUEPRINT as markdown |
| `write` | `{ content: string }` | Replace full BLUEPRINT content |
| `section` | `{ sectionType: "wave"|"task", id }` | Read a specific wave or task section |

**Error codes:** `WORKFLOW_NOT_FOUND`, `VALIDATION_FAILED`
**Idempotency:** Supported for `write`

### `spec_chronicle`

**Allowed phases:** `execute, audit, accept` (append); any (read)
**Purpose:** Append execution events or read the log
**Input:** Discriminated union by `action`:

| Action | Additional fields | Description |
|--------|-------------------|-------------|
| `append` | `{ kind: string, payload: object }` | Append an entry (task completed, phase transition, etc.) |
| `read` | `{ since?, limit?, kind? }` | Query entries with optional filters |

**Error codes:** `INVALID_PHASE` (append outside execute/audit/accept), `WORKFLOW_NOT_FOUND`
**Idempotency:** Supported for `append` (prevents duplicate entries)

### `spec_adl`

**Allowed phases:** Any (append/read)
**Purpose:** Append architectural decisions, deviations, or observations; read and query the ADL
**Input:** Discriminated union by `action`:

| Action | Additional fields | Description |
|--------|-------------------|-------------|
| `append` | `{ type, title, body?, rule?, files? }` | Append a decision, deviation, or observation entry |
| `read` | `{ limit?, type?, since? }` | Query entries by type/time |
| `last-n` | `{ n: number }` | Return the last N entries, ordered by `created_at DESC` |

**Error codes:** `WORKFLOW_NOT_FOUND`, `VALIDATION_FAILED`
**Idempotency:** Supported for `append`

### `spec_checkpoint`

**Allowed phases:** Any
**Purpose:** Save, load, or list execution checkpoints for pause/resume
**Input:** Discriminated union by `action`:

| Action | Additional fields | Description |
|--------|-------------------|-------------|
| `save` | `{ id: string, context: object }` | Save full workflow state snapshot |
| `load` | `{ id: string }` | Restore workflow state from checkpoint |
| `list` | (none) | List all checkpoints for the workflow |

**Error codes:** `WORKFLOW_NOT_FOUND`, `VALIDATION_FAILED`
**Idempotency:** `save` overwrites existing checkpoint with same id

### `spec_skill`

**Allowed phases:** Any
**Purpose:** List available bundled skills or load a skill's full markdown content
**Input:** Discriminated union by `action`:

| Action | Additional fields | Description |
|--------|-------------------|-------------|
| `list` | (none) | Return all skill names with one-line descriptions |
| `load` | `{ name: string }` | Load and return a skill's content |

**Error codes:** `VALIDATION_FAILED` (skill name not found)
**Idempotency:** N/A (read-only)

### `spec_reference`

**Allowed phases:** Any
**Purpose:** List bundled reference documents, load a full reference, or extract a specific section
**Input:** Discriminated union by `action`:

| Action | Additional fields | Description |
|--------|-------------------|-------------|
| `list` | (none) | Return all reference names with one-line descriptions |
| `load` | `{ name: string }` | Load and return a full reference document |
| `section` | `{ name: string, section: string }` | Extract and return a specific section from a reference |

**Error codes:** `VALIDATION_FAILED` (name or section not found)
**Idempotency:** N/A (read-only)
