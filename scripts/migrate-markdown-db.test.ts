import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	planMigration,
	applyMigration,
	type PlannedChange,
} from "./migrate-markdown-db.ts";

// Helper to create temp directories
function createTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

// Helper to create directory structure
function createDir(dir: string): void {
	mkdirSync(dir, { recursive: true });
}

describe("migrate-markdown-db", () => {
	describe("planMigration", () => {
		let tempDir: string;

		beforeEach(() => {
			tempDir = createTempDir("migrate-test-");
		});

		afterEach(() => {
			rmSync(tempDir, { recursive: true, force: true });
		});

		it("returns error for non-existent root", async () => {
			const result = await planMigration({ root: "/nonexistent/path" });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("FILE_NOT_FOUND");
			}
		});

		it("returns error for non-directory path", async () => {
			const filePath = join(tempDir, "file.txt");
			writeFileSync(filePath, "content");
			const result = await planMigration({ root: filePath });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("VALIDATION_ERROR");
			}
		});

		it("rewrites prescriptive reference in prompts file", async () => {
			createDir(join(tempDir, "src", "agents", "prompts"));
			writeFileSync(
				join(tempDir, "src", "agents", "prompts", "researcher.md"),
				"Save findings to `markdown-db/02-tech/` for later reference.",
			);

			const result = await planMigration({ root: tempDir });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.length).toBe(1);
				expect(result.data[0].before).toContain("markdown-db/");
				expect(result.data[0].after).toContain(".elefant/markdown-db/");
				expect(result.data[0].reason).toBe("Prescriptive reference");
			}
		});

		it("does NOT rewrite ADR files", async () => {
			createDir(join(tempDir, "docs", "adr"));
			writeFileSync(
				join(tempDir, "docs", "adr", "0001-decision.md"),
				"Based on research in markdown-db/07-research/foo.md we decided...",
			);

			const result = await planMigration({ root: tempDir });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.length).toBe(0);
			}
		});

		it("does NOT rewrite lines mentioning legacy seed", async () => {
			createDir(join(tempDir, "src", "agents", "prompts"));
			writeFileSync(
				join(tempDir, "src", "agents", "prompts", "writer.md"),
				"The legacy seed at markdown-db/ contains historical research.",
			);

			const result = await planMigration({ root: tempDir });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.length).toBe(0);
			}
		});

		it("does NOT rewrite links to existing files in markdown-db/", async () => {
			// Create the legacy markdown-db structure with a real file
			createDir(join(tempDir, "markdown-db", "01-domain"));
			writeFileSync(
				join(tempDir, "markdown-db", "01-domain", "existing.md"),
				"# Existing Research\n\nThis file exists.",
			);

			// Create a prompt that references the existing file
			createDir(join(tempDir, "src", "agents", "prompts"));
			writeFileSync(
				join(tempDir, "src", "agents", "prompts", "librarian.md"),
				"See markdown-db/01-domain/existing.md for reference.",
			);

			const result = await planMigration({ root: tempDir });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.length).toBe(0);
			}
		});

		it("rewrites README.md prescriptive references", async () => {
			writeFileSync(
				join(tempDir, "README.md"),
				"# Project\n\nSave your research findings to markdown-db/02-tech/",
			);

			const result = await planMigration({ root: tempDir });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.length).toBe(1);
				expect(result.data[0].file).toContain("README.md");
			}
		});

		it("rewrites AGENTS.md prescriptive references", async () => {
			writeFileSync(
				join(tempDir, "AGENTS.md"),
				"# Agents\n\nResearch is stored in markdown-db/ for all findings.",
			);

			const result = await planMigration({ root: tempDir });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.length).toBe(1);
				expect(result.data[0].file).toContain("AGENTS.md");
			}
		});

		it("handles multiple prescriptive references in one file", async () => {
			createDir(join(tempDir, "src", "agents", "prompts"));
			writeFileSync(
				join(tempDir, "src", "agents", "prompts", "multi.md"),
				`Line 1: Save findings to markdown-db/01-domain/
Line 2: Some other content
Line 3: Put research in markdown-db/02-tech/
Line 4: More content`,
			);

			const result = await planMigration({ root: tempDir });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.length).toBe(2);
				expect(result.data[0].line).toBe(1);
				expect(result.data[1].line).toBe(3);
			}
		});

		it("returns empty plan when no markdown-db/ references exist", async () => {
			createDir(join(tempDir, "src", "agents", "prompts"));
			writeFileSync(
				join(tempDir, "src", "agents", "prompts", "clean.md"),
				"This file has no markdown-db references at all.",
			);

			const result = await planMigration({ root: tempDir });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.length).toBe(0);
			}
		});
	});

	describe("applyMigration", () => {
		let tempDir: string;

		beforeEach(() => {
			tempDir = createTempDir("migrate-apply-test-");
		});

		afterEach(() => {
			rmSync(tempDir, { recursive: true, force: true });
		});

		it("applies planned changes to files", async () => {
			const filePath = join(tempDir, "test.md");
			writeFileSync(
				filePath,
				"Save findings to markdown-db/01-domain/ for reference.",
			);

			const plan: PlannedChange[] = [
				{
					file: filePath,
					line: 1,
					before: "Save findings to markdown-db/01-domain/ for reference.",
					after: "Save findings to .elefant/markdown-db/01-domain/ for reference.",
					reason: "Prescriptive reference",
				},
			];

			const result = await applyMigration(plan);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.filesWritten).toBe(1);
				expect(result.data.linesChanged).toBe(1);
			}

			// Verify file was changed
			const content = await Bun.file(filePath).text();
			expect(content).toContain(".elefant/markdown-db/");
			// Should not contain standalone markdown-db/ (without .elefant prefix)
			expect(content).not.toMatch(/(?<!\.elefant\/)markdown-db\//);
		});

		it("returns zero counts for empty plan", async () => {
			const result = await applyMigration([]);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.filesWritten).toBe(0);
				expect(result.data.linesChanged).toBe(0);
			}
		});

		it("is idempotent - running twice produces no changes second time", async () => {
			const filePath = join(tempDir, "test.md");
			writeFileSync(
				filePath,
				"Save findings to markdown-db/01-domain/ for reference.",
			);

			// First migration
			const plan1 = await planMigration({ root: tempDir });
			expect(plan1.ok).toBe(true);
			if (plan1.ok) {
				await applyMigration(plan1.data);
			}

			// Second migration should find no changes
			const plan2 = await planMigration({ root: tempDir });
			expect(plan2.ok).toBe(true);
			if (plan2.ok) {
				expect(plan2.data.length).toBe(0);
			}
		});

		it("handles multiple files in one plan", async () => {
			const file1 = join(tempDir, "file1.md");
			const file2 = join(tempDir, "file2.md");

			writeFileSync(file1, "Save to markdown-db/01/");
			writeFileSync(file2, "Store in markdown-db/02/");

			const plan: PlannedChange[] = [
				{
					file: file1,
					line: 1,
					before: "Save to markdown-db/01/",
					after: "Save to .elefant/markdown-db/01/",
					reason: "Prescriptive reference",
				},
				{
					file: file2,
					line: 1,
					before: "Store in markdown-db/02/",
					after: "Store in .elefant/markdown-db/02/",
					reason: "Prescriptive reference",
				},
			];

			const result = await applyMigration(plan);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.filesWritten).toBe(2);
				expect(result.data.linesChanged).toBe(2);
			}
		});

		it("returns error if line has changed since planning", async () => {
			const filePath = join(tempDir, "test.md");
			writeFileSync(filePath, "Original content with markdown-db/01/");

			const plan: PlannedChange[] = [
				{
					file: filePath,
					line: 1,
					before: "Original content with markdown-db/01/",
					after: "Should be changed",
					reason: "Prescriptive reference",
				},
			];

			// Modify file after planning
			writeFileSync(filePath, "Modified content");

			const result = await applyMigration(plan);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("VALIDATION_ERROR");
			}
		});
	});

	describe("CLI integration", () => {
		let tempDir: string;
		const scriptPath = join(import.meta.dir, "migrate-markdown-db.ts");

		beforeEach(() => {
			tempDir = createTempDir("migrate-cli-test-");
		});

		afterEach(() => {
			rmSync(tempDir, { recursive: true, force: true });
		});

		it("--dry-run produces non-empty plan but writes nothing", async () => {
			createDir(join(tempDir, "src", "agents", "prompts"));
			writeFileSync(
				join(tempDir, "src", "agents", "prompts", "researcher.md"),
				"Save findings to `markdown-db/02-tech/...`",
			);

			const proc = Bun.spawn(["bun", "run", scriptPath, "--dry-run", "--root", tempDir], {
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode = await proc.exited;
			const stdout = await new Response(proc.stdout).text();

			expect(exitCode).toBe(0);
			expect(stdout).toContain("markdown-db/");
			expect(stdout).toContain(".elefant/markdown-db/");

			// Verify file was NOT changed
			const content = await Bun.file(join(tempDir, "src", "agents", "prompts", "researcher.md")).text();
			expect(content).toContain("markdown-db/");
			expect(content).not.toContain(".elefant/markdown-db/");
		});

		it("--apply writes changes that match the plan", async () => {
			createDir(join(tempDir, "src", "agents", "prompts"));
			writeFileSync(
				join(tempDir, "src", "agents", "prompts", "researcher.md"),
				"Save findings to `markdown-db/02-tech/...`",
			);

			const proc = Bun.spawn(["bun", "run", scriptPath, "--apply", "--root", tempDir], {
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode = await proc.exited;
			const stdout = await new Response(proc.stdout).text();

			expect(exitCode).toBe(0);
			expect(stdout).toContain("Applied");

			// Verify file WAS changed
			const content = await Bun.file(join(tempDir, "src", "agents", "prompts", "researcher.md")).text();
			expect(content).toContain(".elefant/markdown-db/");
		});

		it("exits 0 on --help", async () => {
			const proc = Bun.spawn(["bun", "run", scriptPath, "--help"], {
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode = await proc.exited;
			expect(exitCode).toBe(0);
		});

		it("exits non-zero on missing root", async () => {
			const proc = Bun.spawn(
				["bun", "run", scriptPath, "--dry-run", "--root", "/tmp/nonexistent-xyz"],
				{
					stdout: "pipe",
					stderr: "pipe",
				},
			);

			const exitCode = await proc.exited;
			expect(exitCode).not.toBe(0);
		});

		it("exits non-zero when neither --dry-run nor --apply specified", async () => {
			const proc = Bun.spawn(["bun", "run", scriptPath], {
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode = await proc.exited;
			expect(exitCode).toBe(1);
		});
	});

	describe("prescriptive vs descriptive detection", () => {
		let tempDir: string;

		beforeEach(() => {
			tempDir = createTempDir("migrate-detect-test-");
		});

		afterEach(() => {
			rmSync(tempDir, { recursive: true, force: true });
		});

		it("detects 'save findings to markdown-db/' as prescriptive", async () => {
			createDir(join(tempDir, "src", "agents", "prompts"));
			writeFileSync(
				join(tempDir, "src", "agents", "prompts", "test.md"),
				"Save findings to markdown-db/01-domain/",
			);

			const result = await planMigration({ root: tempDir });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.length).toBe(1);
			}
		});

		it("detects 'research is stored in markdown-db/' as prescriptive", async () => {
			createDir(join(tempDir, "src", "agents", "prompts"));
			writeFileSync(
				join(tempDir, "src", "agents", "prompts", "test.md"),
				"All research is stored in markdown-db/ for reference.",
			);

			const result = await planMigration({ root: tempDir });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.length).toBe(1);
			}
		});

		it("detects 'see markdown-db/' as prescriptive", async () => {
			createDir(join(tempDir, "src", "agents", "prompts"));
			writeFileSync(
				join(tempDir, "src", "agents", "prompts", "test.md"),
				"See markdown-db/02-tech/ for examples.",
			);

			const result = await planMigration({ root: tempDir });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.length).toBe(1);
			}
		});

		it("skips 'this repo's research seed at markdown-db/' as descriptive", async () => {
			createDir(join(tempDir, "src", "agents", "prompts"));
			writeFileSync(
				join(tempDir, "src", "agents", "prompts", "test.md"),
				"This repo's research seed at markdown-db/ contains historical data.",
			);

			const result = await planMigration({ root: tempDir });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.length).toBe(0);
			}
		});

		it("skips 'the legacy seed markdown-db/' as descriptive", async () => {
			createDir(join(tempDir, "src", "agents", "prompts"));
			writeFileSync(
				join(tempDir, "src", "agents", "prompts", "test.md"),
				"The legacy seed markdown-db/ is preserved for reference.",
			);

			const result = await planMigration({ root: tempDir });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.length).toBe(0);
			}
		});
	});
});
