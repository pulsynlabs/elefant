# /spec-resume

**Description:** Resume a paused workflow from a saved checkpoint.

## Usage
```
/spec-resume [checkpoint-name]
```

## Prerequisites
- Checkpoint must exist
- Workflow must be in a paused state
- The project/DB state must not have changed materially since the checkpoint was saved

## What It Does
1. Lists available checkpoints if no name specified
2. Loads the named checkpoint via `spec_checkpoint.load`
3. Restores workflow phase, current wave, task statuses
4. Reconstructs agent context from checkpoint snapshot
5. Resumes execution from the exact point where `/spec-pause` was called

## Autopilot Behavior
- **Manual:** User explicitly resumes
- **Autopilot/Lazy:** Resume is always explicit — no auto-resume behavior

## Example
```
/spec-resume before-refactoring-wave-4
```

## Anti-Patterns
- **DON'T:** Resume a checkpoint if the underlying code has changed significantly since it was saved — state may be inconsistent.
- **DON'T:** Resume from a checkpoint saved in a different session without verifying state compatibility.
