import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';

interface EditorCandidate {
  command: string;
  args: string[];
  label: string;
  requiresLookup?: boolean;
}

function splitCommand(value: string): string[] {
  return value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^['"]|['"]$/g, '')) ?? [];
}

function commandExists(command: string): boolean {
  if (command.includes('/') || command.includes('\\')) return existsSync(command);
  const pathValue = Bun.env.PATH ?? '';
  return pathValue.split(delimiter).some((dir) => existsSync(`${dir}/${command}`));
}

function envCandidate(value: string | undefined, absolutePath: string): EditorCandidate | null {
  if (!value?.trim()) return null;
  const parts = splitCommand(value.trim());
  const command = parts[0];
  if (!command) return null;
  return { command, args: [...parts.slice(1), absolutePath], label: value.trim() };
}

function defaultOpenCandidate(absolutePath: string): EditorCandidate {
  if (process.platform === 'darwin') {
    return { command: 'open', args: [absolutePath], label: 'open', requiresLookup: true };
  }
  if (process.platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', absolutePath], label: 'start' };
  }
  return { command: 'xdg-open', args: [absolutePath], label: 'xdg-open', requiresLookup: true };
}

function resolveCandidates(absolutePath: string): EditorCandidate[] {
  return [
    envCandidate(Bun.env.ELEFANT_EDITOR, absolutePath),
    envCandidate(Bun.env.EDITOR, absolutePath),
    { command: 'code', args: ['--wait', absolutePath], label: 'code --wait', requiresLookup: true },
    defaultOpenCandidate(absolutePath),
  ].filter((candidate): candidate is EditorCandidate => candidate !== null);
}

/**
 * Launch a research file in the user's editor.
 *
 * Editor resolution order is: ELEFANT_EDITOR (Elefant-specific override),
 * EDITOR, VS Code (`code --wait`), then the platform file opener.
 */
export async function launchEditor(absolutePath: string): Promise<{ editor: string; launched: boolean }> {
  for (const candidate of resolveCandidates(absolutePath)) {
    try {
      if (candidate.requiresLookup && !commandExists(candidate.command)) continue;
      const proc = Bun.spawn([candidate.command, ...candidate.args], {
        stdout: 'ignore',
        stderr: 'ignore',
        stdin: 'ignore',
      });
      proc.unref?.();
      return { editor: candidate.label, launched: true };
    } catch {
      continue;
    }
  }

  return { editor: 'unavailable', launched: false };
}
