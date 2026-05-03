---
id: git-workflow
title: Git Workflow
description: Git branch, commit, and PR patterns for Elefant — branch naming, commit message conventions, safe operations.
tags:
  - git
  - orchestrator
  - workflow
audience:
  - orchestrator
  - executor
version: 1.0.0
---

# Git Workflow

All Elefant agents follow professional Git practices. Commits must be reviewable by any developer without internal tooling knowledge.

## Universal Commit Messages

**CRITICAL: Commit messages must be universally understandable.** Never reference:

- Elefant internal task IDs (W1.T2, MH3, etc.)
- Internal document names (SPEC.md, BLUEPRINT.md)
- Agent types or orchestration terminology
- Phase or wave identifiers
- Tool implementation details

Write commits as if you're on a team where no one knows Elefant exists.

## Branch Naming

Format: `type/short-description`

| Type | Use For |
|------|---------|
| `feat/` | New features and capabilities |
| `fix/` | Bug fixes |
| `refactor/` | Code restructuring without behavior change |
| `chore/` | Config, dependencies, build tooling |
| `docs/` | Documentation changes only |
| `test/` | Adding or updating tests |
| `perf/` | Performance improvements |

**Examples:**
```
feat/reference-tool
fix/login-race-condition
refactor/skill-resolver
chore/update-dependencies
```

**Rules:**
- Use lowercase kebab-case
- Keep names short but descriptive
- No internal task IDs in branch names
- If a similar branch exists, make yours more specific: `feat/auth` → `feat/auth-oauth2`

## Commit Message Format

```
type(scope): concise title (max 72 characters)

[2-4 sentence paragraph explaining context and motivation.
Why was this change needed? What problem does it solve?]

Changes:
- Specific change with context
- Another change with why it matters
```

### Types

| Type | Use For |
|------|---------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code restructuring (no behavior change) |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Config, dependencies, build tooling |
| `style` | Formatting, whitespace (no logic change) |
| `perf` | Performance improvements |

### Scope

The affected module or area. Required for non-trivial changes.

Examples: `auth`, `api`, `ui`, `database`, `config`, `deps`, `reference`

### Good Commit Examples

```
feat(reference): add 3-tier resolver for bundled reference files

References are resolved from project, user, and builtin directories
in priority order. This mirrors the skill tool resolver pattern so
agents get a consistent loading experience.

Changes:
- Add resolver module with project > user > builtin priority
- Add flat .md file scanning (references are files, not directories)
- Add unit tests covering all tiers and missing-directory handling
```

```
fix(reference): handle CRLF line endings in frontmatter parser

The hand-rolled YAML parser only handled LF endings, causing
validation failures on Windows-generated files.

Changes:
- Add \r\n detection in delimiter scanning
- Add CRLF handling in line-splitting logic
- Add cross-platform fixture test
```

### Bad Commit Examples

```
feat: W5.T1 complete                       ← References internal task ID
feat(reference): implemented per MH4       ← References must-have ID
Update files                                ← Too vague
Fix bug                                     ← Says nothing about what was fixed
feat(reference): added feature             ← Redundant, past tense
```

## Single vs Multiple Commits

**Single commit when:**
- All changes serve one purpose
- Changes are tightly coupled
- Total scope is small (< 100 lines, < 5 files)

**Multiple commits when:**
- Changes include unrelated fixes or features
- Refactoring is mixed with new functionality
- Tests are added separately from implementation
- Documentation or config changes are independent

### Multi-Commit Order

Order from independent to dependent:

```
1. chore(deps): update axios to v1.6.0
2. fix(ui): correct typo in welcome message
3. feat(users): add avatar upload with resizing
```

## Atomic Commit Protocol

Every executor MUST commit at least once per completed task. Task completion without a commit is non-compliant.

After any significant work:

```bash
git add src/tools/reference/resolver.ts src/tools/reference/resolver.test.ts
git commit -m "feat(reference): implement 3-tier reference resolver

References are resolved from project, user, and builtin directories
in priority order. This provides per-project overrides while shipping
sensible defaults.

Changes:
- Add resolver module with project > user > builtin priority
- Add flat .md file scanning for reference files
- Add 12 unit tests covering all tiers and edge cases"
```

## Pre-Commit Checklist

Before every commit:

- [ ] All tests pass: `bun test <affected-files>`
- [ ] Typecheck clean: `bun run typecheck`
- [ ] No console.log or debug statements
- [ ] No unused imports
- [ ] Commit message is specific and explains why
- [ ] No internal task IDs, wave numbers, or must-have references

## Safe Git Operations

### Always Safe

```bash
git status
git diff
git log
git branch
git checkout -b feat/new-feature
git add <specific-files>
git commit -m "..."
git push origin <branch>
```

### Never Do (Without Explicit User Request)

```bash
git push --force origin main         # NEVER force-push to main
git reset --hard HEAD~5              # Destructive history rewrite
git commit --no-verify               # Skips hooks
git commit --no-gpg-sign             # Disables signing
git rebase -i main                   # Interactive — requires terminal input
```

### Only With Explicit Permission

```bash
git push --force                     # Only on feature branches, only when requested
git commit --amend                   # Only when HEAD wasn't pushed yet
```

## Pre-Push Verification

Before pushing:

```bash
bun test                              # Full suite passes
bun run typecheck                     # No type errors
bun run build                         # Build succeeds
git log --oneline origin/main..HEAD   # Review what you're about to push
```

## Working with Pull Requests

See `reference({ name: "pr-creation" })` for full PR creation protocol.

Quick summary:
- Title: `type(scope): descriptive summary`
- Body: Summary, Changes, Testing sections
- Target branch: ask the user which branch (don't assume `main`)
- Never include internal task IDs in PR title or body

## Recovery Commands

```bash
# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo last commit (discard changes)
git reset --hard HEAD~1

# Amend last commit (ONLY if not pushed)
git commit --amend

# Stash working changes
git stash
git stash pop
```

## Branch Management

```bash
# Create and switch to a new branch
git checkout -b feat/feature-name

# Update your branch with main
git fetch origin
git merge origin/main

# See what branches exist
git branch --list
```
