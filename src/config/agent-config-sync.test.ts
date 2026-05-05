import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AGENT_KINDS } from "./schema.ts";

/**
 * Cross-package sync guard: daemon's exported AGENT_KINDS must match
 * desktop's hard-coded AGENT_KINDS (since desktop is a separate Tauri
 * bundle and cannot import from the daemon package).
 *
 * NOTE: This test is pending (test.todo) because desktop's AGENT_KINDS is
 * currently stale. Wave 3.1 will fix desktop/src/lib/types/agent-config.ts
 * to match the daemon's canonical 12 kinds. After that fix, flip this from
 * test.todo to test() so it runs in the CI suite.
 *
 * Failure here means desktop/src/lib/types/agent-config.ts has drifted —
 * update its AGENT_KINDS literal to match the daemon's exported tuple.
 */
test("desktop AGENT_KINDS matches daemon AGENT_KINDS", () => {
	const desktopFile = readFileSync(
		path.resolve(import.meta.dir, "../../desktop/src/lib/types/agent-config.ts"),
		"utf8",
	);
	const match = desktopFile.match(/export const AGENT_KINDS = \[([^\]]+)\]/);
	if (!match) throw new Error("Could not find AGENT_KINDS literal in desktop types");
	const desktopKinds = match[1]
		.split(",")
		.map((s) => s.replace(/['"`\s]/g, ""))
		.filter(Boolean)
		.sort();
	const daemonKinds = [...AGENT_KINDS].sort();
	expect(desktopKinds).toEqual(daemonKinds);
});
