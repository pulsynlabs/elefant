---
id: pr-creation
title: PR Creation Protocol
description: How to create well-formatted pull requests in Elefant — title format, description structure, review checklist.
tags:
  - git
  - orchestrator
  - workflow
audience:
  - orchestrator
version: 1.0.0
---

# PR Creation Protocol

Pull requests are the delivery mechanism for completed work. Every PR must be professional, self-contained, and reviewable by any developer.

## When to Create a PR

Create a PR when:
- A feature branch is complete (all waves done, all tests pass)
- A significant milestone is reached and should be reviewed
- The user explicitly requests one

## PR Title

Format: `type(scope): Descriptive summary`

Same as commit messages — universal language, no internal task references.

**Good titles:**
```
feat(reference): add bundled reference tool with tag filtering
fix(resolver): handle missing directories gracefully
refactor(auth): extract token logic into shared service
```

**Bad titles:**
```
Wave 5 Complete                                ← References internal structure
feat: MH1-MH12 implemented                      ← References must-have IDs
PR for reference tool                           ← Too vague, no type prefix
```

## PR Description Template

```markdown
## Summary

[2-4 sentences: WHAT this PR does and WHY it was needed.
What problem does it solve? What's the approach?]

## Changes

- [Specific change with context]
- [Another change with why it matters]
- [Group related changes together]

## Testing

- [How was this tested?]
- [Manual testing performed]
- [Automated tests added/modified]

## Notes

[Breaking changes, migration steps, follow-up work, deployment notes]
```

## Complete Example

```markdown
## Summary

Adds a reference tool that lets agents load bundled markdown guidance
files by name or tag during any workflow phase. This replaces scattered
inline prompt text with addressable, filterable references that can be
updated without redeploying agent prompts.

The tool mirrors the existing skill resolver pattern (3-tier priority,
project > user > builtin) and supports list, load, multi-load, tag
filtering, and section extraction.

## Changes

- Add 3-tier resolver (`src/tools/reference/resolver.ts`) that scans
  `.elefant/references/`, `~/.config/elefant/references/`, and
  `src/agents/references/` in priority order
- Add frontmatter parser (`src/tools/reference/frontmatter.ts`) with
  Zod validation for id, title, description, tags, audience, and version
- Add reference tool (`src/tools/reference/index.ts`) supporting five
  actions: list, load by name, multi-load with separators, tag filtering,
  and section extraction by heading
- Register tool in both static and per-run tool registries
- Add 16 bundled reference markdown files covering orchestrator protocols,
  agent guidance, spec-mode formats, git workflow, and Research Base usage
- Add comprehensive test suites across all modules (80+ tests)

## Testing

- `bun test src/tools/reference/` — 80 tests pass (resolver, frontmatter,
  tool actions, section extraction, format helpers)
- `bun run typecheck` — clean (0 errors)
- `bun run build` — succeeds
- Manual verification: `reference({ list: true })` returns all 16 bundled
  references; `reference({ name: "handoff-format" })` returns full content

## Notes

- The reference tool is the single supported interface for loading references;
  no legacy spec-mode reference alias is retained
- Reference files use a flat layout (`name.md`) unlike skills which use
  directory-based layout (`name/SKILL.md`)
- No new runtime dependencies were added
```

## Pre-PR Checklist

Before creating a PR:

- [ ] **Tests pass:** `bun test` on the affected module or full suite
- [ ] **Typecheck clean:** `bun run typecheck` with no errors
- [ ] **Build succeeds:** `bun run build` completes without errors
- [ ] **No debug code:** No `console.log`, debugger statements, or commented-out code
- [ ] **No secrets:** No API keys, tokens, or credentials in committed files
- [ ] **Commits are atomic:** Each commit is one logical change
- [ ] **Commit messages are universal:** No internal task IDs or phase references
- [ ] **Branch is pushed:** `git push -u origin feat/branch-name`
- [ ] **PR description is complete:** Summary, Changes, Testing sections filled

## Creating the PR

### Using `gh pr create`

```bash
gh pr create \
  --title "feat(reference): add bundled reference tool with tag filtering" \
  --body "$(cat <<'EOF'
## Summary

Adds a reference tool for loading bundled markdown guidance files.

## Changes

- Add 3-tier resolver and frontmatter parser
- Add reference tool with list, load, multi-load, tag filter, section extraction
- Add 16 bundled reference files
- Register tool in both static and per-run registries

## Testing

- `bun test src/tools/reference/` — 80 tests pass
- `bun run typecheck` — clean
- `bun run build` — succeeds

## Notes

Breaking change: the previous spec-mode reference alias has been removed; use the
global `reference` tool instead.
EOF
)"
```

### Target Branch Selection

Before creating a PR, confirm the target branch:

1. Detect the repository default branch:
   ```bash
   git remote show origin | grep 'HEAD branch' | sed 's/.*: //'
   ```
2. If detection fails, default to `main`
3. Prompt for confirmation: "Which base branch should this PR target? [main]"
4. Use `--base <branch>` with `gh pr create`

## Review Etiquette

When your PR is reviewed:

- **Respond to all comments** — even if just "Done" or "Addressed in [commit]"
- **Don't take feedback personally** — reviews improve the code, not critique you
- **Ask for clarification** if a comment is unclear
- **Resolve threads** when the issue is addressed
- **Push fix commits** rather than force-pushing amended history during review

When reviewing someone else's PR:

- **Be specific** — "This could be cleaner" is not helpful; "Use a Map instead of a plain object for O(1) lookups" is
- **Distinguish blocking from suggestions** — use labels: `[blocking]`, `[suggestion]`, `[question]`, `[nit]`
- **Acknowledge good code** — positive feedback helps maintain quality standards
- **Test the branch locally** if the change is complex or touches areas you own

## After Merge

1. **Delete the feature branch** (GitHub offers this after merge)
2. **Update the chronicle** — mark the workflow as complete
3. **Archive if appropriate** — for milestone workflows, extract learnings
4. **Clean up locally:**
   ```bash
   git checkout main
   git pull
   git branch -d feat/branch-name
   ```
