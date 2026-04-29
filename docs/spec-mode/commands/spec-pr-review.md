# /spec-pr-review

**Description:** Review a GitHub pull request end-to-end — code quality, spec compliance, security, and merge safety.

## Usage
```
/spec-pr-review <pr-url or pr-number>
```

## Prerequisites
- PR must be accessible (GitHub CLI authenticated or public repo)
- Verifier and other agents must have read access to the diff
- Works with or without an active Spec Mode workflow

## What It Does
1. Fetches PR diff, description, and commit history via GitHub CLI
2. Dispatches `goop-verifier` (or full review pipeline) to check:
   - Code correctness and edge cases
   - Design consistency with project patterns
   - Performance concerns (N+1 queries, unnecessary allocations)
   - Security issues (input validation, secret exposure, injection risks)
   - Maintainability (naming, complexity, dead code)
3. Produces structured review with severity classifications
4. Optionally: offers auto-fix for minor issues, comment for moderate, block for major
5. Reports summary in chat with inline code references

## Autopilot Behavior
- **Manual:** User reviews each finding before action
- **Autopilot:** Minor issues auto-fixed; moderate/major flagged for review
- **Lazy Autopilot:** Same as autopilot

## Example
```
/spec-pr-review https://github.com/user/repo/pull/42
/spec-pr-review 42
```

## Anti-Patterns
- **DON'T:** Approve a PR without reading files that changed — the verifier's report is a supplement, not a replacement.
- **DON'T:** Auto-merge on passing review — human sign-off is the final gate.
