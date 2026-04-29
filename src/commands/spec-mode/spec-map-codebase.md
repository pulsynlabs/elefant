# /spec-map-codebase

**Description:** Dispatch the explorer agent to map a brownfield codebase — identifies architecture, stack, entry points, patterns, and conventions. Results are saved to the Project Knowledge Base for injection into future agent contexts.
**Category:** Spec Mode

## When to Use
When starting work on an existing project where you need to understand the codebase structure before planning. Also useful after large refactors to refresh the knowledge base.

## Prerequisites
- The project must exist and have source files to explore.
- The explorer agent must have read access to the project directory.

## Process
1. Dispatch the `explorer` agent via `task({ subagent_type: "explorer", input: { projectPath, scope: "full" | "src-only" | "specific-directory" } })`.
2. The explorer agent:
   - Identifies the **stack:** runtime, language, framework, libraries, build system.
   - Maps the **directory structure:** entry points, source layout, test layout, config locations.
   - Detects **patterns:** naming conventions, export styles, error handling, validation approaches.
   - Finds **integration points:** auth, API, database access, middleware.
   - Notes **concerns:** known gotchas, tech debt indicators, missing tests.
3. The explorer writes findings to `PROJECT_KNOWLEDGE_BASE.md` in the project root.
4. The explorer saves structured observations to memory with concepts: `["codebase", projectId, "exploration"]`.
5. Log the exploration to ADL: `spec_adl.append({ type: "observation", title: "Codebase mapped", body: "Explorer produced PKB with N sections covering stack, patterns, and concerns." })`.
6. Present a summary of the top 5 findings to the user.

## Tools Used
- `task` — dispatch explorer agent
- `spec_adl.append` — log exploration observation
- `memory_save` — persist structured findings for future retrieval

## Autopilot Behavior
When `autopilot=true`:
- Exploration runs without interaction. Results are saved and available for context injection.
When `lazyAutopilot=true`:
- Same as autopilot.

## Output
- A populated or updated `PROJECT_KNOWLEDGE_BASE.md` in the project root.
- Memory entries with codebase patterns tagged by concept.
- An ADL entry documenting the exploration.
- Injected into every future spec-mode agent's system prompt via the `context:transform` hook.

## Success Criteria
- [ ] PKB contains at minimum: stack identification, directory map, and detected conventions.
- [ ] At least 3 patterns are documented with file path examples.
- [ ] Memory entries are tagged with the project ID and "exploration" concept.
- [ ] The exploration summary is visible to the user.

## Anti-Patterns
**DON'T:** Skip the PKB write — the whole point of exploration is to make findings available for automated context injection.
**DON'T:** Map the entire codebase at surface level — focus on patterns, entry points, and integration surfaces, not line-by-line documentation.
**DON'T:** Overwrite a user-maintained PKB without diff — check if `PROJECT_KNOWLEDGE_BASE.md` already has manual content and augment rather than replace.
**DON'T:** Run exploration without first checking memory — prior explorations may already have most of what you need.
