import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
	projectsStore,
	resetProjectsStore,
	_setProjects,
	_setActiveProjectId,
	_setSessionsByProject,
	_setActiveSessionId,
} from "./projects.svelte.js";
import type { Project, Session } from "$lib/types/project.js";

// ─── Test Fixtures ───────────────────────────────────────────────────────────

const mockProject = (overrides: Partial<Project> = {}): Project => ({
	id: "proj-1",
	name: "Test Project",
	path: "/home/user/test-project",
	description: null,
	createdAt: "2026-04-18T00:00:00Z",
	updatedAt: "2026-04-18T00:00:00Z",
	...overrides,
});

const mockSession = (overrides: Partial<Session> = {}): Session => ({
	id: "sess-1",
	projectId: "proj-1",
	workflowId: null,
	mode: "quick",
	phase: "idle",
	status: "active",
	startedAt: "2026-04-18T00:00:00Z",
	completedAt: null,
	updatedAt: "2026-04-18T00:00:00Z",
	...overrides,
});

// ─── Fetch Mock Helper ───────────────────────────────────────────────────────

function createFetchMock(responses: {
	[url: string]: { status: number; body: unknown };
}) {
	return mock((input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		const match = Object.entries(responses).find(([key]) => url.includes(key));

		if (!match) {
			return Promise.resolve(
				new Response("Not Found", { status: 404 })
			);
		}

		const [, { status, body }] = match;
		return Promise.resolve(
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			})
		);
	});
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("projectsStore", () => {
	beforeEach(() => {
		resetProjectsStore();
	});

	afterEach(() => {
		globalThis.fetch = fetch;
	});

	// ── loadProjects ───────────────────────────────────────────────────────

	describe("loadProjects", () => {
		it("populates projects array on successful fetch", async () => {
			const projects = [
				mockProject({ id: "p1", name: "Alpha" }),
				mockProject({ id: "p2", name: "Beta" }),
			];

			globalThis.fetch = createFetchMock({
				"/api/projects": { status: 200, body: projects },
			}) as unknown as typeof globalThis.fetch;

			await projectsStore.loadProjects();

			expect(projectsStore.projects).toHaveLength(2);
			expect(projectsStore.projects[0].name).toBe("Alpha");
			expect(projectsStore.projects[1].name).toBe("Beta");
			expect(projectsStore.lastError).toBeNull();
			expect(projectsStore.isLoading).toBe(false);
		});

		it("sets lastError when fetch fails", async () => {
			globalThis.fetch = createFetchMock({
				"/api/projects": { status: 500, body: {} },
			}) as unknown as typeof globalThis.fetch;

			await projectsStore.loadProjects();

			expect(projectsStore.projects).toHaveLength(0);
			expect(projectsStore.lastError).toContain("HTTP 500");
			expect(projectsStore.isLoading).toBe(false);
		});

		it("sets lastError when network throws", async () => {
			globalThis.fetch = mock(() =>
				Promise.reject(new Error("Network down"))
			) as unknown as typeof globalThis.fetch;

			await projectsStore.loadProjects();

			expect(projectsStore.lastError).toBe("Network down");
			expect(projectsStore.isLoading).toBe(false);
		});
	});

	// ── openProject ────────────────────────────────────────────────────────

	describe("openProject", () => {
		it("creates project, adds to list, and sets active", async () => {
			const created = mockProject({ id: "new-proj", name: "New Project" });

			globalThis.fetch = createFetchMock({
				"/api/projects": { status: 201, body: created },
			}) as unknown as typeof globalThis.fetch;

			const result = await projectsStore.openProject("/path/to/new");

			expect(result.id).toBe("new-proj");
			expect(projectsStore.projects).toHaveLength(1);
			expect(projectsStore.projects[0].id).toBe("new-proj");
			expect(projectsStore.activeProjectId).toBe("new-proj");
			expect(projectsStore.lastError).toBeNull();
		});

		it("upserts existing project instead of duplicating", async () => {
			// Pre-populate with an existing project
			_setProjects([mockProject({ id: "existing", name: "Old Name" })]);

			const updated = mockProject({
				id: "existing",
				name: "Updated Name",
			});

			globalThis.fetch = createFetchMock({
				"/api/projects": { status: 200, body: updated },
			}) as unknown as typeof globalThis.fetch;

			await projectsStore.openProject("/path");

			expect(projectsStore.projects).toHaveLength(1);
			expect(projectsStore.projects[0].name).toBe("Updated Name");
			expect(projectsStore.activeProjectId).toBe("existing");
		});

		it("throws and sets error on failure", async () => {
			globalThis.fetch = createFetchMock({
				"/api/projects": { status: 400, body: {} },
			}) as unknown as typeof globalThis.fetch;

			await expect(
				projectsStore.openProject("/invalid/path")
			).rejects.toThrow();

			expect(projectsStore.lastError).toContain("HTTP 400");
		});
	});

	// ── selectProject ──────────────────────────────────────────────────────

	describe("selectProject", () => {
		it("sets activeProjectId and loads sessions", async () => {
			const sessions = [
				mockSession({ id: "s1" }),
				mockSession({ id: "s2" }),
			];

			globalThis.fetch = createFetchMock({
				"/api/projects/proj-1/sessions": {
					status: 200,
					body: sessions,
				},
			}) as unknown as typeof globalThis.fetch;

			await projectsStore.selectProject("proj-1");

			expect(projectsStore.activeProjectId).toBe("proj-1");
			expect(projectsStore.sessionsByProject["proj-1"]).toHaveLength(2);
			expect(projectsStore.sessionsByProject["proj-1"][0].id).toBe("s1");
		});

		it("sets lastError when session load fails", async () => {
			globalThis.fetch = createFetchMock({
				"/api/projects/proj-1/sessions": {
					status: 500,
					body: {},
				},
			}) as unknown as typeof globalThis.fetch;

			await projectsStore.selectProject("proj-1");

			expect(projectsStore.activeProjectId).toBe("proj-1");
			expect(projectsStore.lastError).toContain("HTTP 500");
		});
	});

	// ── renameProject ──────────────────────────────────────────────────────

	describe("renameProject", () => {
		it("updates project name in place", async () => {
			_setProjects([mockProject({ id: "p1", name: "Old Name" })]);

			const updated = mockProject({ id: "p1", name: "New Name" });

			globalThis.fetch = createFetchMock({
				"/api/projects/p1": { status: 200, body: updated },
			}) as unknown as typeof globalThis.fetch;

			await projectsStore.renameProject("p1", "New Name");

			expect(projectsStore.projects).toHaveLength(1);
			expect(projectsStore.projects[0].name).toBe("New Name");
			expect(projectsStore.lastError).toBeNull();
		});

		it("sets error when rename fails", async () => {
			globalThis.fetch = createFetchMock({
				"/api/projects/p1": { status: 404, body: {} },
			}) as unknown as typeof globalThis.fetch;

			await projectsStore.renameProject("p1", "New Name");

			expect(projectsStore.lastError).toContain("HTTP 404");
		});
	});

	// ── deleteProject ──────────────────────────────────────────────────────

	describe("deleteProject", () => {
		it("removes project from list", async () => {
			_setProjects([
				mockProject({ id: "p1", name: "To Delete" }),
				mockProject({ id: "p2", name: "Keep" }),
			]);

			globalThis.fetch = createFetchMock({
				"/api/projects/p1": { status: 200, body: {} },
			}) as unknown as typeof globalThis.fetch;

			await projectsStore.deleteProject("p1");

			expect(projectsStore.projects).toHaveLength(1);
			expect(projectsStore.projects[0].id).toBe("p2");
		});

		it("clears activeProjectId if deleted project was active", async () => {
			_setProjects([mockProject({ id: "active-proj", name: "Active" })]);
			_setActiveProjectId("active-proj");

			globalThis.fetch = createFetchMock({
				"/api/projects/active-proj": { status: 200, body: {} },
			}) as unknown as typeof globalThis.fetch;

			await projectsStore.deleteProject("active-proj");

			expect(projectsStore.activeProjectId).toBeNull();
			expect(projectsStore.projects).toHaveLength(0);
		});

		it("cleans up cached sessions for deleted project", async () => {
			_setProjects([mockProject({ id: "p1" })]);
			_setSessionsByProject({
				p1: [mockSession()],
				p2: [mockSession({ id: "other" })],
			});

			globalThis.fetch = createFetchMock({
				"/api/projects/p1": { status: 200, body: {} },
			}) as unknown as typeof globalThis.fetch;

			await projectsStore.deleteProject("p1");

			expect(projectsStore.sessionsByProject["p1"]).toBeUndefined();
			expect(projectsStore.sessionsByProject["p2"]).toBeDefined();
		});

		it("sets error when delete fails", async () => {
			globalThis.fetch = createFetchMock({
				"/api/projects/p1": { status: 500, body: {} },
			}) as unknown as typeof globalThis.fetch;

			await projectsStore.deleteProject("p1");

			expect(projectsStore.lastError).toContain("HTTP 500");
		});
	});

	// ── createSession ──────────────────────────────────────────────────────

	describe("createSession", () => {
		it("prepends session to project and sets active", async () => {
			const existingSession = mockSession({ id: "old-sess" });
			const newSession = mockSession({ id: "new-sess" });

			_setSessionsByProject({
				"proj-1": [existingSession],
			});

			globalThis.fetch = createFetchMock({
				"/api/projects/proj-1/sessions": {
					status: 201,
					body: newSession,
				},
			}) as unknown as typeof globalThis.fetch;

			const result = await projectsStore.createSession("proj-1");

			expect(result.id).toBe("new-sess");
			expect(projectsStore.sessionsByProject["proj-1"]).toHaveLength(2);
			expect(projectsStore.sessionsByProject["proj-1"][0].id).toBe("new-sess");
			expect(projectsStore.activeSessionId).toBe("new-sess");
		});

		it("throws and sets error on failure", async () => {
			globalThis.fetch = createFetchMock({
				"/api/projects/proj-1/sessions": {
					status: 400,
					body: {},
				},
			}) as unknown as typeof globalThis.fetch;

			await expect(
				projectsStore.createSession("proj-1")
			).rejects.toThrow();

			expect(projectsStore.lastError).toContain("HTTP 400");
		});

		it("sends an empty body when no mode is supplied", async () => {
			const newSession = mockSession({ id: "no-mode-sess", mode: "quick" });
			let observedBody: string | undefined;
			globalThis.fetch = mock(
				(input: RequestInfo | URL, init?: RequestInit) => {
					observedBody = init?.body as string;
					return Promise.resolve(
						new Response(JSON.stringify(newSession), {
							status: 201,
							headers: { "Content-Type": "application/json" },
						}),
					);
				},
			) as unknown as typeof globalThis.fetch;

			await projectsStore.createSession("proj-1");
			expect(observedBody).toBe("{}");
		});

		it("forwards mode=spec to the daemon when supplied", async () => {
			const newSession = mockSession({ id: "spec-sess", mode: "spec" });
			let observedBody: string | undefined;
			globalThis.fetch = mock(
				(input: RequestInfo | URL, init?: RequestInit) => {
					observedBody = init?.body as string;
					return Promise.resolve(
						new Response(JSON.stringify(newSession), {
							status: 201,
							headers: { "Content-Type": "application/json" },
						}),
					);
				},
			) as unknown as typeof globalThis.fetch;

			const result = await projectsStore.createSession("proj-1", {
				mode: "spec",
			});

			expect(observedBody).toBe('{"mode":"spec"}');
			expect(result.mode).toBe("spec");
		});

		it("forwards mode=quick to the daemon when supplied", async () => {
			const newSession = mockSession({ id: "quick-sess", mode: "quick" });
			let observedBody: string | undefined;
			globalThis.fetch = mock(
				(input: RequestInfo | URL, init?: RequestInit) => {
					observedBody = init?.body as string;
					return Promise.resolve(
						new Response(JSON.stringify(newSession), {
							status: 201,
							headers: { "Content-Type": "application/json" },
						}),
					);
				},
			) as unknown as typeof globalThis.fetch;

			await projectsStore.createSession("proj-1", { mode: "quick" });
			expect(observedBody).toBe('{"mode":"quick"}');
		});
	});

	// ── selectSession ──────────────────────────────────────────────────────

	describe("selectSession", () => {
		it("sets activeSessionId", () => {
			projectsStore.selectSession("sess-42");
			expect(projectsStore.activeSessionId).toBe("sess-42");
		});
	});

	// ── activeProject derived ──────────────────────────────────────────────

	describe("activeProject (derived)", () => {
		it("returns null when no active project", () => {
			// $derived returns a proxy; check raw value for null
			expect((projectsStore.activeProject as any)?.__raw).toBeNull();
		});

		it("returns the active project when set", () => {
			_setProjects([
				mockProject({ id: "active", name: "Active Project" }),
			]);
			_setActiveProjectId("active");

			expect(projectsStore.activeProject?.name).toBe("Active Project");
		});

		it("returns null when activeProjectId doesn't match any project", () => {
			_setActiveProjectId("nonexistent");

			expect((projectsStore.activeProject as any)?.__raw).toBeNull();
		});
	});

	// ── resetProjectsStore ─────────────────────────────────────────────────

	describe("resetProjectsStore", () => {
		it("resets all state to initial values", () => {
			// Pollute the store
			_setProjects([mockProject()]);
			_setActiveProjectId("dirty");
			_setSessionsByProject({ dirty: [] });
			_setActiveSessionId("dirty");
			// Manually set error and loading via store methods
			// Since we can't directly set these, we'll test reset after a failed operation
			// For now, just verify the main state properties reset

			resetProjectsStore();

			expect(projectsStore.projects).toEqual([]);
			expect(projectsStore.activeProjectId).toBeNull();
			expect(projectsStore.sessionsByProject).toEqual({});
			expect(projectsStore.activeSessionId).toBeNull();
			expect(projectsStore.isLoading).toBe(false);
		});
	});
});