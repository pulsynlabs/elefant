#!/usr/bin/env bun
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const REQUIRED_SECTIONS = [
  "## Role",
  "## Mission",
  "## Workflow",
  "## Tools",
  "## Constraints",
  "## Examples",
  "## Anti-Patterns",
  "## Response",
] as const;

export const MIN_NON_BLANK_LINES = 80;
export const MIN_ANTI_PATTERNS = 3;

export interface PromptValidationResult {
  filesChecked: number;
  failures: string[];
}

export async function validatePromptDirectory(promptsDir: string): Promise<PromptValidationResult> {
  const exists = existsSync(promptsDir) && statSync(promptsDir).isDirectory();
  const files = exists
    ? readdirSync(promptsDir).filter((file) => file.endsWith(".md") && !file.startsWith("_"))
    : [];

  const failures: string[] = [];

  for (const file of files) {
    const content = await Bun.file(join(promptsDir, file)).text();
    const lines = content.split("\n");
    const nonBlank = lines.filter((line) => line.trim()).length;

    for (const section of REQUIRED_SECTIONS) {
      if (!content.includes(section)) {
        failures.push(`FAIL ${file}: missing section "${section}"`);
      }
    }

    const antiPatternCount = (content.match(/\*\*DON'T:\*\*/g) ?? []).length;
    if (antiPatternCount < MIN_ANTI_PATTERNS) {
      failures.push(
        `FAIL ${file}: only ${antiPatternCount} anti-patterns (need ${MIN_ANTI_PATTERNS})`,
      );
    }

    if (nonBlank < MIN_NON_BLANK_LINES) {
      failures.push(`FAIL ${file}: only ${nonBlank} non-blank lines (need ${MIN_NON_BLANK_LINES})`);
    }
  }

  return { filesChecked: files.length, failures };
}

if (import.meta.main) {
  const promptsDir = Bun.argv[2] ?? "src/agents/prompts";
  const result = await validatePromptDirectory(promptsDir);

  if (result.failures.length > 0) {
    for (const failure of result.failures) {
      console.error(failure);
    }
    console.error(`\n${result.failures.length} validation failure(s). Fix prompts and re-run.`);
    process.exit(1);
  }

  console.log(`✓ All ${result.filesChecked} agent prompts valid.`);
}
