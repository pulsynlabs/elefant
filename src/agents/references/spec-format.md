---
id: spec-format
title: SPEC.md Format
description: Structure and conventions for Spec Mode SPEC.md files — must-have IDs, acceptance criteria, traceability.
tags:
  - spec-mode
  - planner
  - orchestrator
audience:
  - orchestrator
  - planner
version: 1.0.0
---

# SPEC.md Format

The SPEC.md is the locked contract between the user and the execution pipeline. It defines what must be built, what's optional, and what's explicitly out of scope. Once locked, it can only be changed through the amend flow.

## File Header

Every SPEC.md starts with metadata:

```markdown
# SPEC: Feature Name

**Version:** 1.0.0
**Created:** 2026-05-03
**Last Updated:** 2026-05-03
**Status:** Draft (awaiting Contract Gate)
**Locked:** No
**Workflow:** `workflow-id`
**Branch:** `feat/branch-name`
```

| Field | Required | Description |
|-------|----------|-------------|
| Version | Yes | Semver-ish version (e.g. `1.0.0`) |
| Created | Yes | ISO date |
| Status | Yes | `Draft`, `Locked`, or `Amended` |
| Locked | Yes | `Yes` or `No` — set by the contract gate |
| Workflow | Yes | Kebab-case workflow ID matching `wf_state` |
| Branch | Yes | Git branch name for this work |

## Vision Section

A 1-2 paragraph summary of what this feature delivers and why. This sets context for all must-haves.

## Must-Haves (The Contract)

Each must-have is given a unique ID (MH1, MH2, ...). The format:

```markdown
### MH1: Short descriptive name

Full description of the requirement. What must be delivered, in plain language.

**Acceptance Criteria:**
- [ ] Criterion 1 — measurable, verifiable
- [ ] Criterion 2 — measurable, verifiable

**Traced To:** Wave N, Task N.M
```

**Must-have naming conventions:**
- IDs are `MH1`, `MH2`, `MH3`, ... — sequential, no gaps
- Titles are short and descriptive: "Reference tool with list action" not "MH1"
- Each must-have is independently verifiable
- Acceptance criteria use `- [ ]` checkboxes that become `- [x]` when verified

**Must-have writing guidelines:**
- Use active voice: "The reference tool returns a formatted catalog" not "A catalog should be returned"
- Be specific: "Returns all 16 bundled references" not "Returns references"
- Include error cases: "Returns a clear error message when the name is not found"

## Nice-to-Haves

Optional features that would be good but aren't blocking. Format:

```markdown
- [ ] **NH1: Feature name** — Description. Defer if: [condition].
```

## Out of Scope

Explicitly list what will NOT be built. This prevents scope creep:

```markdown
- **Feature X** — [Reason it's out of scope]
- **Feature Y** — [Reason it's out of scope]
```

## Technical Constraints

A table of non-negotiable stack and convention choices:

```markdown
### Stack (Non-Negotiable)
| Component | Technology | Version |
|-----------|------------|---------|
| Runtime | Bun | latest |
| Language | TypeScript | strict |
| Validation | Zod | existing |

### Conventions
| Aspect | Standard |
|--------|----------|
| Files | kebab-case |
| Functions | camelCase, named exports |
| Tests | Co-located *.test.ts |
```

## Assumptions

Explicitly document assumptions made during planning:

```markdown
- **Assumption 1**: [Statement]. If false: [impact].
- **Assumption 2**: [Statement]. If false: [impact].
```

## Risks & Mitigations

A table of identified risks:

```markdown
| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| [Description] | High/Medium/Low | High/Medium/Low | [How we handle it] |
```

## Traceability Matrix

A summary table showing every must-have is covered by at least one task:

```markdown
| Must-Have | Covered By | Status |
|-----------|------------|--------|
| MH1: list action | W1.T1, W1.T3, W1.T5 | Mapped |
| MH2: load by name | W1.T1, W1.T3, W3.T1 | Mapped |
```

## Acceptance Criteria (Spec-Level)

Overall spec-level criteria for declaring the spec satisfied:

```markdown
1. `reference` tool registered, working, and discoverable via tool list.
2. All 16 bundled references exist and pass frontmatter validation.
3. `bun test src/tools/reference/` passes (full suite).
4. `bun run typecheck` clean.
```

## Amendment History

Track all changes to a locked spec:

```markdown
| Version | Date | Change | Impact | Approved By |
|---------|------|--------|--------|-------------|
| 1.0.0 | 2026-05-03 | Initial draft | — | pending |
```

## Complete Example Skeleton

```markdown
# SPEC: Reference Tool System

**Version:** 1.0.0
**Created:** 2026-05-03
**Status:** Draft (awaiting Contract Gate)
**Locked:** No
**Workflow:** `reference-tool`
**Branch:** `feat/reference-tool`

---

## Vision

Build a reference tool that lets agents load workflow guidance on demand.

---

## Must-Haves (The Contract)

### MH1: Reference tool with list action

The reference tool returns a formatted catalog of all bundled references.

**Acceptance Criteria:**
- [ ] `reference({ list: true })` returns a markdown-formatted catalog
- [ ] Each entry shows name, source tier, description, and tags

**Traced To:** Wave 1, Tasks 1.1, 1.3, 1.5

---

## Out of Scope

- **In-app reference editor UI** — Files are edited directly, not via GUI.
- **Semantic search over references** — Deferred; Field Notes owns semantic search.

---

## Technical Constraints

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| Language | TypeScript (strict) |
| Validation | Zod |

---

## Traceability Matrix

| Must-Have | Covered By | Status |
|-----------|------------|--------|
| MH1: list action | W1.T1, W1.T3, W1.T5 | Mapped |

---

## Acceptance Criteria

1. `reference` tool registered and discoverable.
2. All bundled references pass frontmatter validation.
3. `bun test src/tools/reference/` passes.

---

## Amendment History

| Version | Date | Change | Impact | Approved By |
|---------|------|--------|--------|-------------|
| 1.0.0 | 2026-05-03 | Initial draft | — | pending |
```
