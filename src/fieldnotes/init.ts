import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIELD_NOTES_SECTIONS, fieldNotesDir } from '../project/paths.js';
import { err, ok, type Result } from '../types/result.js';
import type { ElefantError } from '../types/errors.js';
import { assertInsideFieldNotes } from './membership.js';

const SECTION_DESCRIPTIONS: Record<string, string> = {
  '00-index': 'Entry points, changelogs, and generated navigation for the Field Notes.',
  '01-domain': 'Domain context, user workflows, constraints, and problem framing.',
  '02-tech': 'Technical research, implementation notes, libraries, and architecture references.',
  '03-decisions': 'Decision records, rationale, trade-offs, and accepted constraints.',
  '04-comparisons': 'Comparative evaluations of platforms, approaches, APIs, and tools.',
  '05-references': 'Citable source notes, external links, and primary-source summaries.',
  '06-synthesis': 'Opinionated synthesis, recommendations, and strategic summaries.',
  '99-scratch': 'Temporary notes and low-ceremony working material.',
};

function sectionTitle(section: string): string {
  return section.replace(/^\d+-/, '').split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function writeIfMissing(path: string, content: string, created: string[], existed: string[]): void {
  if (existsSync(path)) {
    existed.push(path);
    return;
  }
  writeFileSync(path, content);
  created.push(path);
}

/**
 * Idempotently creates the .elefant/field-notes/ directory tree with all 8
 * default sections, section README stubs, and root README/INDEX stubs.
 */
export function ensureFieldNotes(projectPath: string): Result<{ created: string[]; existed: string[] }, ElefantError> {
  const created: string[] = [];
  const existed: string[] = [];
  try {
    const base = fieldNotesDir(projectPath);
    if (existsSync(base)) existed.push(base);
    else { mkdirSync(base, { recursive: true }); created.push(base); }

    writeIfMissing(join(base, 'README.md'), '# Field Notes\n\nProject-local markdown knowledge garden.\n\n<!-- managed-by: writer-agent -->\n', created, existed);
    writeIfMissing(join(base, 'INDEX.md'), '# Field Notes Index\n\nGenerated index of Field Notes documents.\n\n<!-- managed-by: writer-agent -->\n', created, existed);

    for (const section of FIELD_NOTES_SECTIONS) {
      const dir = join(base, section);
      if (existsSync(dir)) existed.push(dir);
      else { mkdirSync(dir, { recursive: true }); created.push(dir); }

      const readme = join(dir, 'README.md');
      const guard = assertInsideFieldNotes(projectPath, readme, { requireMarkdown: true });
      if (guard.ok === false) return err(guard.error);
      writeIfMissing(readme, `# ${section} — ${sectionTitle(section)}\n\n${SECTION_DESCRIPTIONS[section]}\n\n<!-- managed-by: writer-agent -->\n`, created, existed);
    }

    return ok({ created, existed });
  } catch (e) {
    return err({ code: 'TOOL_EXECUTION_FAILED', message: String(e), details: e });
  }
}
