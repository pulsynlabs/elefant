# /spec-map-codebase

**Description:** Map an existing (brownfield) codebase — discover architecture, stack, conventions, and integration points.

## Usage
```
/spec-map-codebase [project-path?]
```

## Prerequisites
- Project must be open in Elefant or path must be accessible
- Useful before `/spec-plan` on an unfamiliar codebase

## What It Does
1. Dispatches `goop-explorer` agent
2. Explorer maps: directory structure, entry points, framework/runtime detection, naming conventions, test patterns, dependency graph
3. Identifies integration points where new code would plug in
4. Saves findings to memory with concept tags (stack, patterns, structure)
5. Updates or creates PROJECT_KNOWLEDGE_BASE.md with discovered conventions
6. Outputs a structured codebase summary in chat

## Autopilot Behavior
- No autopilot-specific behavior — mapping is always user-initiated

## Example
```
/spec-map-codebase
/spec-map-codebase /home/user/projects/legacy-monolith
```

## Anti-Patterns
- **DON'T:** Try to read every file — the explorer samples strategically.
- **DON'T:** Skip saving findings to memory — the planner needs this map.
