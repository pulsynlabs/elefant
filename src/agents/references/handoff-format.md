---
id: handoff-format
title: Handoff Format
description: XML response envelope schema for agent-to-orchestrator handoffs in Elefant.
tags:
  - orchestrator
  - executor
  - format
audience:
  - orchestrator
  - executor
version: 1.0.0
---

# Handoff Format

> **Note:** This is a placeholder reference. Full content will be added in Wave 5.

## Overview

The handoff format defines how Elefant agents communicate results back to the orchestrator
after completing a task. Agents return a structured XML response envelope.

## Basic Structure

```xml
<elefant_report>
  <status>COMPLETE|PARTIAL|BLOCKED</status>
  <agent>goop-executor-medium</agent>
  <summary>One-sentence summary of what was accomplished.</summary>
  <artifacts>
    <files>
      <file path="src/example.ts" action="created">Description</file>
    </files>
  </artifacts>
  <handoff>
    <ready>true</ready>
    <next_action>Description of next step for orchestrator</next_action>
  </handoff>
</elefant_report>
```

## Status Values

| Status | Meaning |
|--------|---------|
| `COMPLETE` | Task fully finished, all deliverables produced |
| `PARTIAL` | Task partially done, context or clarification needed |
| `BLOCKED` | Cannot proceed, requires orchestrator decision |

*This reference will be expanded in Wave 5 with full handoff protocol details.*
