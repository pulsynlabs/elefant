---
id: anti-patterns
title: Anti-Patterns
description: Common mistakes agents make in Elefant workflows and how to avoid them.
tags:
  - orchestrator
  - executor
  - workflow
audience:
  - all
version: 1.0.0
---

# Anti-Patterns

This reference catalogues mistakes that Elefant agents commonly make — and what to do instead.

## Universal Anti-Patterns (All Agents)

### Write before reading

**DON'T:** Write code before reading the files in scope. Starting from a blank mental model produces code that clashes with existing conventions.

**DO:** Always read every file listed in the task. Read adjacent files to understand patterns. Run `grep` to find similar implementations. Then write.

### Use `any` without justification

**DON'T:**
```typescript
function process(data: any): any { ... }
```

**DO:** Use explicit types, `unknown` with type guards, or generics:
```typescript
function process<T extends Record<string, unknown>>(data: T): Result<T, ElefantError> { ... }
```

### Suppress errors silently

**DON'T:**
```typescript
try { await riskyOperation() } catch { /* ignore */ }
```

**DO:** Wrap with context and rethrow or return a structured error:
```typescript
try {
  return await riskyOperation()
} catch (e) {
  return err({ code: 'OPERATION_FAILED', message: `Failed because: ${e}` })
}
```

### Commit with failing tests

**DON'T:** Git commit when tests are red. Every commit should leave the repo in a buildable, test-passing state.

**DO:** Run `bun test` on the affected files before committing. If a test fails, fix it or update the test if the behavior change was intentional.

### Scope creep without consent

**DON'T:** Notice a "better" approach while implementing and refactor the whole module. The fix may be correct, but the scope expansion is unauthorized.

**DO:** Complete the assigned task first. If you spot an improvement, note it in your response: "I noticed X could be improved by Y. Happy to address in a follow-up task."

### Use `console.log` for debugging

**DON'T:** Leave debug logging in committed code.
```typescript
console.log('DEBUG: user is', user)
```

**DO:** Use the structured logger if available, or remove debug statements before committing. Tests should verify behavior, not console output.

### Write placeholder implementations without TODO comments

**DON'T:**
```typescript
function validateEmail(email: string): boolean {
  return true // TODO later
}
```

If you genuinely need a stub (rare — prefer to implement fully), include a TODO with the responsible task: `// TODO(W5.T3): Implement email validation with zod schema`.

## Orchestrator Anti-Patterns

### Edit implementation files directly

**DON'T:** Open `src/tools/reference/index.ts` and write code. The permission hook will block you, and even if it doesn't, you're violating the orchestration contract.

**DO:** Delegate all implementation to executors via `task({ subagent_type: "executor-...", ... })`.

### Treat `ORCHESTRATOR_NO_WRITE` as a transient error to retry

**DON'T:** Get blocked once, then try writing again with different text.

**DO:** "The permission gate correctly blocked direct implementation. Dispatching executor-medium with the same scope." Re-route immediately.

### Ask the user a long contract question

**DON'T:** Paste the entire SPEC.md into a `question()` call and ask "Is this right?"

**DO:** Present a concise summary: "The spec covers 12 must-haves across 7 waves. Key decisions: [list]. Please confirm this specification."

### Dispatch without must-have mapping

**DON'T:**
```typescript
task({ prompt: "Add auth" })
```

**DO:** Include which must-haves this task satisfies and the verification commands:
```typescript
task({
  prompt: "## TASK: Implement JWT auth per MH3\n## FILES: src/auth/service.ts\n## VERIFY: bun test src/auth/"
})
```

### Mark a wave complete from a summary without checking

**DON'T:** See a COMPLETE status in an XML envelope and immediately mark the wave done.

**DO:** Read the verification evidence. Check that commits exist. Run the wave's verification matrix yourself if possible. Then mark complete.

## Executor Anti-Patterns

### Guess instead of reading the codebase

**DON'T:** Assume the project uses Jest because "most TypeScript projects do."

**DO:** Check `package.json`, read a test file, or grep for test patterns. Use what's already there.

### Over-engineer a simple task

**DON'T:** A task says "add a string field to the frontmatter schema" and you create an entire plugin system for extensible validation.

**DO:** Add the field. Add the test. Commit. Move on. Scope discipline is professionalism.

### Skip writing tests

**DON'T:** "The change was small, so I skipped tests."

**DO:** Every behavior change needs at least one test. If tests already exist, add a case. If no test file exists, ask whether to create one (or create it if the task says to).

### Use internal task IDs in commit messages

**DON'T:**
```
feat(reference): W5.T1 — author handoff-format and deviation-rules
```

**DO:** Use universal language:
```
feat(reference): add handoff format and deviation rules references
```

### Return vague completion reports

**DON'T:** "Done. It works now."

**DO:** Return the XML envelope with status, artifacts, commits, verification evidence, and next steps. See `reference({ name: "handoff-format" })`.

## Spec Mode Anti-Patterns

### Lock the spec before the user confirms

**DON'T:** Call `wf_state({ action: "lock-spec" })` without explicit user confirmation.

**DO:** Present the contract gate. Wait for "confirm + lock" or equivalent explicit approval. Then lock.

### Start execution with an unlocked spec

**DON'T:** Begin executing tasks when `specLocked` is `false`.

**DO:** Check `wf_state({ action: "get" })` before dispatching. If unlocked, stop and surface the gap.

### Mutate state directly

**DON'T:** `Edit("state.json", ...)` or read/write workflow state files directly.

**DO:** Use `wf_state` for all state mutations. The tool validates transitions and prevents invalid state.

### Skip the acceptance gate

**DON'T:** After all waves complete and audit passes, assume the work is accepted and archive.

**DO:** Transition to accept. Present the delivery summary to the user. Wait for explicit confirmation.
