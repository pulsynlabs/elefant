# /spec-discuss

**Description:** Start the discovery interview to gather requirements, vision, constraints, and risks for a new workflow.

## Usage
```
/spec-discuss [topic]
```

## Prerequisites
- Project must be open in Elefant
- No active workflow in discuss/plan/execute phase (can create new)

## What It Does
1. Creates a new workflow in `discuss` phase
2. Conducts a discovery interview (unless lazy autopilot skips this)
3. Captures vision, must-haves (with IDs), out-of-scope items, constraints, assumptions, risks
4. Writes the REQUIREMENTS document to the DB
5. Transitions to `plan` phase (or pauses for user confirmation in manual mode)

## Autopilot Behavior
- **Manual:** Questions asked for each section of REQUIREMENTS
- **Autopilot:** Interview runs, inferred output shown at lock gate
- **Lazy Autopilot:** Interview skipped entirely — REQUIREMENTS inferred from the initial `/spec-quick` prompt; user reviews at the SPEC lock gate

## Example
```
/spec-discuss Build a user authentication system with OAuth2 support
```

## Anti-Patterns
- **DON'T:** Skip the interview for complex features — lazy autopilot is for well-understood, small-scope tasks.
- **DON'T:** Run `/spec-discuss` on an already-active workflow — create a new workflow instead.
