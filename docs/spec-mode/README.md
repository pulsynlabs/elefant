# Spec Mode — Elefant's Plan/Mission Mode

Spec Mode is Elefant's structured, spec-driven development workflow. It transforms vague
requests into locked specifications, executable blueprints, and verified implementations.

## Philosophy

Elefant Spec Mode is **spec-anchored**: the spec lives alongside your code as a locked
artifact, gates execution, and is updated only via explicit amendment. It is the open-source
answer to Cursor Plan Mode and Factory Missions — but with:

- **DB-backed state** instead of project-side markdown files
- **Hook-level behavioral enforcement** (not just prompt guidance)
- **13 specialist agents** with per-role model configurability
- **Validation-contract-before-features** (Factory Missions pattern)
- **Verifier dispatched in fresh context** for unbiased audit
- **Full GUI** — no slash commands required

## Quick Start

Type `/spec-quick build a settings page` to run the full pipeline in lazy autopilot.

Or, step-by-step:

1. `/spec-discuss` — gather requirements
2. `/spec-plan` — create spec + blueprint
3. `/spec-execute` — wave-based implementation
4. `/spec-audit` — verify against spec
5. `/spec-accept` — final confirmation

## The 5-Phase Loop

```
Discuss → Plan → Execute → Audit → Accept
```

Each phase is gated. The spec locks before execute. The verifier runs in fresh context.
The user confirms at accept.

### Phase details

| Phase | What happens | Agent dispatched |
|-------|-------------|-----------------|
| **Discuss** | Discovery interview captures vision, must-haves, constraints | Orchestrator |
| **Plan** | SPEC + BLUEPRINT drafted with validation contracts | Planner |
| **Execute** | Wave-by-wave implementation by tier-matched executors | Executor (low/medium/high/frontend) |
| **Audit** | Fresh-context verifier checks every VC against shipped code | Verifier |
| **Accept** | User reviews results and confirms | Orchestrator |

## Concepts

### Workflows
A workflow is a single spec cycle. Projects can have multiple workflows (one active at a time). Each workflow has its own mode (quick/standard/comprehensive/milestone), depth (shallow/standard/deep), and autopilot state.

### Must-Haves
Formal requirements with numeric IDs (MH1, MH2, ...). Each must-have carries acceptance criteria and a validation contract (VC assertions). The verifier checks every VC for every MH.

### Validation Contract
A set of behavioral assertions written before implementation. Following the Factory Missions / 2026 best-practice pattern, the planner produces VCs alongside ACs. The verifier runs against them independently.

### Agent Fleet
13 specialist agents, each with a dedicated system prompt, tool allow-list, permission scope, and configurable model. See [Agent Profiles](./agents/) for the full roster.

### Autopilot Tiers
- **Manual**: confirm at every phase boundary
- **Autopilot**: run unattended, pause only at final accept
- **Lazy Autopilot**: skip discovery entirely, infer from prompt; one human checkpoint at SPEC lock

## Coming from GoopSpec?

Spec Mode is the spiritual successor to [GoopSpec](https://github.com/jacobjove/goopspec). Key differences:

| Concept | GoopSpec | Elefant Spec Mode |
|---------|----------|-------------------|
| State storage | `.goopspec/*.md` files in project repo | SQLite in `.elefant/db.sqlite` |
| Enforcement | Orchestrator prompt guidance only | Hook-level (`permission:ask`, `tool:before`) |
| UI | Terminal slash commands only | Desktop GUI + terminal |
| Agent config | Implicit in provider selection | 13 agents, per-role model, allow-list, permissions |
| Validation contract | Not structured | Structured VCs, fresh-context verifier dispatch |

See the [Migration Guide](./migration.md) for upgrade steps.

## Documentation Index

| Document | What it covers |
|----------|---------------|
| [Architecture](./architecture.md) | DB schema, hooks, agent dispatch, state machine, compaction survival |
| [Agents](./agents/) | 13 agent profiles — purpose, tools, model recommendations, anti-patterns |
| [Commands](./commands/) | 15 slash commands — usage, autopilot behavior, examples |
| [Tools Reference](./tools.md) | 11 spec_* tools — schemas, phases, error codes, idempotency |
| [Migration Guide](./migration.md) | From GoopSpec or fresh start — automatic migration, troubleshooting |

## Tool Index

| Tool | Purpose |
|------|---------|
| `spec_status` | Full workflow status snapshot |
| `spec_state` | Phase transitions, lock/unlock, mode/depth/autopilot |
| `spec_workflow` | List, create, set-active workflows |
| `spec_requirements` | Read/write REQUIREMENTS document |
| `spec_spec` | Read/write/lock/amend the SPEC contract |
| `spec_blueprint` | Read/write/section the BLUEPRINT plan |
| `spec_chronicle` | Append/read the CHRONICLE execution log |
| `spec_adl` | Append/read the ADL decision log |
| `spec_checkpoint` | Save/load/list execution checkpoints |
| `spec_skill` | List/load bundled skill references |
| `spec_reference` | List/load/section reference documents |
