import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = join(import.meta.dir, "validate-agent-prompts.ts");

function validPrompt(): string {
  const sections = [
    "# Fixture Agent",
    "## Role",
    "A role paragraph for a fixture agent.",
    "## Mission",
    "- Mission one",
    "- Mission two",
    "- Mission three",
    "## Workflow",
    ...Array.from({ length: 30 }, (_, index) => `${index + 1}. Workflow step ${index + 1}`),
    "## Tools",
    "- read: inspect files",
    "- bash: run tests",
    "## Constraints",
    "- Never escape fixture scope",
    "- Always report errors",
    "## Examples",
    "Input: good prompt. Output: validation passes.",
    "Input: bad prompt. Output: validation fails.",
    "## Anti-Patterns",
    "**DON'T:** Skip required sections.",
    "**DON'T:** Use too few lines.",
    "**DON'T:** Omit anti-pattern entries.",
    ...Array.from({ length: 28 }, (_, index) => `- Extra validation detail ${index + 1}`),
    "## Response Envelope",
    "Return XML evidence.",
  ];

  return `${sections.join("\n")}\n`;
}

async function runValidator(dir: string): Promise<Subprocess> {
  return Bun.spawn(["bun", "run", scriptPath, dir], {
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("validate-agent-prompts", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "elefant-prompts-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("passes a valid prompt fixture", async () => {
    writeFileSync(join(tempDir, "good.md"), validPrompt());

    const proc = await runValidator(tempDir);
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("All 1 agent prompts valid");
  });

  it("fails a prompt missing a required section", async () => {
    writeFileSync(join(tempDir, "bad.md"), validPrompt().replace("## Tools\n", ""));

    const proc = await runValidator(tempDir);
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('missing section "## Tools"');
  });
});
