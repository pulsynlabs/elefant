# /spec-help

**Description:** List all available Spec Mode commands with one-line descriptions.

## Usage
```
/spec-help [command-name]
```

## Prerequisites
- None — works in any phase, any project

## What It Does
1. If no argument: lists all 15 commands with one-line descriptions
2. Queried from the command discovery API (`GET /api/spec-mode/commands`)
3. If command name provided: shows detailed help for that command
4. Output includes: command name, description, example usage, related commands

## Autopilot Behavior
- No autopilot-specific behavior — this is a read-only help query.

## Example
```
/spec-help
/spec-help spec-execute
```

## Anti-Patterns
- **DON'T:** Hard-code command listings — the help text comes from the discovery API (which reads command markdown files).
- **DON'T:** Skip updating the help when adding a new command — the discovery API handles this automatically.
