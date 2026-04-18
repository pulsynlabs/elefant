import { readFileSync } from 'node:fs';

import type { Database } from '../db/database.ts';
import type { StateManager } from '../state/manager.ts';

export function buildStateBlock(
  state: ReturnType<StateManager['getState']>,
): string {
  const w = state.workflow;
  return [
    '## 🔮 Workflow State (Survived Compaction)',
    `- Phase: ${w.phase}`,
    `- Mode: ${w.mode}`,
    `- Depth: ${w.depth}`,
    `- Wave: ${w.currentWave}/${w.totalWaves}`,
    `- Spec Locked: ${w.specLocked}`,
    w.workflowId ? `- Workflow ID: ${w.workflowId}` : '',
    '',
    '> Continue from where you left off. Read project state and spec before taking action.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function buildSpecBlock(specPath: string | null): string {
  if (!specPath) {
    return '';
  }

  try {
    const content = readFileSync(specPath, 'utf-8');
    const lines = content.split('\n');
    if (lines.length <= 200) {
      return `## 📋 Specification Contract\n\n${content}`;
    }

    const sections: string[] = [];
    let inSection = false;

    for (const line of lines) {
      if (line.startsWith('## Must-Haves') || line.startsWith('## Out of Scope')) {
        inSection = true;
        sections.push(line);
        continue;
      }

      if (inSection && line.startsWith('## ')) {
        inSection = false;
        sections.push('');
        continue;
      }

      if (inSection) {
        sections.push(line);
      }
    }

    return sections.length > 0
      ? `## 📋 Specification Contract (Key Sections)\n\n${sections.join('\n')}`
      : '';
  } catch {
    return '';
  }
}

interface AdlEventRow {
  data: string;
  timestamp: string;
}

export function buildAdlBlock(db: Database): string {
  try {
    const rows = db.db
      .query(
        "SELECT data, timestamp FROM events WHERE type IN ('decision', 'adl') ORDER BY timestamp DESC LIMIT 5",
      )
      .all() as AdlEventRow[];

    if (rows.length === 0) {
      return '';
    }

    const entries = rows.map((row) => {
      try {
        const parsed = JSON.parse(row.data) as {
          description?: string;
          action?: string;
        };
        return `- [${row.timestamp}] ${parsed.description ?? ''} → ${parsed.action ?? ''}`;
      } catch {
        return `- [${row.timestamp}] ${row.data}`;
      }
    });

    return [
      '## 📝 Recent Decisions (ADL)',
      '> These decisions have already been made. Honor them.',
      '',
      ...entries,
    ].join('\n');
  } catch {
    return '';
  }
}

export function buildToolInstructionsBlock(toolNames: string[]): string {
  if (toolNames.length === 0) {
    return '';
  }

  return [
    '## 🔧 Available Tools',
    '> After resuming from compaction, run status checks before taking action.',
    '',
    `Tools registered: ${toolNames.join(', ')}`,
  ].join('\n');
}
