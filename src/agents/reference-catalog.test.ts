import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	agentKindToAudience,
	buildReferenceCatalog,
	DEFAULT_WAVE_REFERENCES,
	formatTagIndex,
	invalidateReferenceCatalog,
	loadForAudience,
	loadForWaveStart,
} from './reference-catalog.js';

function makeTempDir(): string {
	return join(
		tmpdir(),
		`elefant-ref-catalog-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
}

function writeProjectRef(
	cwd: string,
	name: string,
	fields: { tags: string[]; audience: string[]; description?: string; body?: string },
): void {
	const refDir = join(cwd, '.elefant', 'references');
	mkdirSync(refDir, { recursive: true });
	writeFileSync(
		join(refDir, `${name}.md`),
		[
			'---',
			`id: ${name}`,
			`title: ${name}`,
			`description: ${fields.description ?? `${name} description`}`,
			'tags:',
			...fields.tags.map((tag) => `  - ${tag}`),
			'audience:',
			...fields.audience.map((audience) => `  - ${audience}`),
			'version: 1.0.0',
			'---',
			'',
			fields.body ?? `# ${name}`,
		].join('\n'),
		'utf-8',
	);
}

describe('reference catalog', () => {
	let cwd: string;
	let home: string;

	beforeEach(() => {
		cwd = makeTempDir();
		home = makeTempDir();
		mkdirSync(cwd, { recursive: true });
		mkdirSync(home, { recursive: true });
		invalidateReferenceCatalog();
	});

	afterEach(() => {
		invalidateReferenceCatalog();
		rmSync(cwd, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	it('builds byTag and byAudience maps for references with frontmatter', async () => {
		writeProjectRef(cwd, 'planner-guide', {
			tags: ['planner', 'workflow'],
			audience: ['planner'],
		});
		writeProjectRef(cwd, 'shared-guide', {
			tags: ['workflow'],
			audience: ['all'],
		});

		const catalog = await buildReferenceCatalog({ cwd, home });

		expect(catalog.all.some((ref) => ref.name === 'planner-guide')).toBe(true);
		expect(catalog.byTag.get('planner')).toEqual(expect.arrayContaining(['planner-guide']));
		expect(catalog.byTag.get('workflow')).toEqual(expect.arrayContaining(['planner-guide', 'shared-guide']));
		expect(catalog.byAudience.get('planner')).toEqual(expect.arrayContaining(['planner-guide']));
		expect(catalog.byAudience.get('all')).toEqual(expect.arrayContaining(['shared-guide']));
	});

	it('returns the same cached object for the same cwd and home', async () => {
		writeProjectRef(cwd, 'cache-guide', {
			tags: ['cache'],
			audience: ['executor'],
		});

		const first = await buildReferenceCatalog({ cwd, home });
		const second = await buildReferenceCatalog({ cwd, home });

		expect(second).toBe(first);
	});

	it('clears cache when invalidated', async () => {
		writeProjectRef(cwd, 'before', {
			tags: ['cache'],
			audience: ['executor'],
		});

		const first = await buildReferenceCatalog({ cwd, home });
		writeProjectRef(cwd, 'after', {
			tags: ['cache'],
			audience: ['executor'],
		});

		const cached = await buildReferenceCatalog({ cwd, home });
		expect(cached).toBe(first);
		expect(cached.all.some((ref) => ref.name === 'after')).toBe(false);

		invalidateReferenceCatalog();
		const rebuilt = await buildReferenceCatalog({ cwd, home });

		expect(rebuilt).not.toBe(first);
		expect(rebuilt.all.some((ref) => ref.name === 'after')).toBe(true);
	});

	it('formats a compact tag index as markdown', async () => {
		writeProjectRef(cwd, 'alpha-ref', {
			tags: ['git', 'orchestrator'],
			audience: ['orchestrator'],
		});
		writeProjectRef(cwd, 'beta-ref', {
			tags: ['git'],
			audience: ['executor'],
		});

		const catalog = await buildReferenceCatalog({ cwd, home });
		const output = formatTagIndex(catalog, { maxChars: 5000 });

		expect(output).toStartWith('## Available References (Tag Index)');
		expect(output).toContain('- **git**: alpha-ref, beta-ref');
		expect(output).toContain('alpha-ref');
		expect(output).toContain('reference({ name: "X" })');
	});

	it('truncates the tag index when it exceeds maxChars', async () => {
		for (let i = 0; i < 8; i += 1) {
			writeProjectRef(cwd, `ref-${i}`, {
				tags: [`tag-${i}`],
				audience: ['executor'],
			});
		}

		const catalog = await buildReferenceCatalog({ cwd, home });
		const output = formatTagIndex(catalog, { maxChars: 220 });

		expect(output).toContain('_... [');
		expect(output.length).toBeLessThanOrEqual(260);
	});

	it('loads only matching audience references plus all-audience references', async () => {
		writeProjectRef(cwd, 'executor-guide', {
			tags: ['executor'],
			audience: ['executor'],
		});
		writeProjectRef(cwd, 'shared-guide', {
			tags: ['all'],
			audience: ['all'],
		});
		writeProjectRef(cwd, 'writer-guide', {
			tags: ['writer'],
			audience: ['writer'],
		});

		const catalog = await buildReferenceCatalog({ cwd, home });
		const output = await loadForAudience(catalog, 'executor', { cwd, home, maxChars: 50_000 });

		expect(output).toContain('## Loaded References (audience: executor)');
		expect(output).toContain('# Reference: executor-guide');
		expect(output).toContain('# Reference: shared-guide');
		expect(output).not.toContain('# Reference: writer-guide');
	});

	it('respects maxChars by omitting whole reference blocks and adding a footer', async () => {
		writeProjectRef(cwd, 'alpha-guide', {
			tags: ['writer'],
			audience: ['writer'],
			body: '# Alpha',
		});
		writeProjectRef(cwd, 'zeta-guide', {
			tags: ['writer'],
			audience: ['writer'],
			body: `# Zeta\n\n${'large body '.repeat(200)}`,
		});

		const catalog = await buildReferenceCatalog({ cwd, home });
		const output = await loadForAudience(catalog, 'writer', { cwd, home, maxChars: 500 });

		expect(output.length).toBeLessThanOrEqual(500);
		expect(output).toContain('# Reference: alpha-guide');
		expect(output).not.toContain('# Reference: zeta-guide');
		expect(output).toContain('_Reference content truncated. Omitted:');
		expect(output).toContain('zeta-guide');
		expect(output).toContain('reference({ name: "X" })');
	});

	it('returns an empty string when no references match an audience', async () => {
		writeProjectRef(cwd, 'executor-guide', {
			tags: ['executor'],
			audience: ['executor'],
		});

		const catalog = await buildReferenceCatalog({ cwd, home });

		expect(await loadForAudience(catalog, 'planner', { cwd, home })).toBe('');
	});

	it('loads default wave-start references', async () => {
		for (const name of DEFAULT_WAVE_REFERENCES) {
			writeProjectRef(cwd, name, {
				tags: ['workflow'],
				audience: ['orchestrator'],
				body: `# ${name}`,
			});
		}

		const catalog = await buildReferenceCatalog({ cwd, home });
		const output = await loadForWaveStart(catalog, undefined, { cwd, home, maxChars: 5000 });

		expect(output).toStartWith('## Wave Start References');
		for (const name of DEFAULT_WAVE_REFERENCES) {
			expect(output).toContain(`# Reference: ${name}`);
		}
	});

	it('uses custom wave-start references instead of defaults', async () => {
		writeProjectRef(cwd, 'custom-wave-ref', {
			tags: ['workflow'],
			audience: ['orchestrator'],
		});
		writeProjectRef(cwd, 'handoff-format', {
			tags: ['workflow'],
			audience: ['orchestrator'],
		});

		const catalog = await buildReferenceCatalog({ cwd, home });
		const output = await loadForWaveStart(catalog, ['custom-wave-ref'], { cwd, home, maxChars: 5000 });

		expect(output).toContain('# Reference: custom-wave-ref');
		expect(output).not.toContain('# Reference: handoff-format');
	});

	it('returns an empty string for an empty custom wave-start reference set', async () => {
		writeProjectRef(cwd, 'handoff-format', {
			tags: ['workflow'],
			audience: ['orchestrator'],
		});

		const catalog = await buildReferenceCatalog({ cwd, home });

		expect(await loadForWaveStart(catalog, [], { cwd, home })).toBe('');
	});

	it('respects maxChars for wave-start references by omitting whole blocks', async () => {
		writeProjectRef(cwd, 'small-wave-ref', {
			tags: ['workflow'],
			audience: ['orchestrator'],
			body: '# Small',
		});
		writeProjectRef(cwd, 'large-wave-ref', {
			tags: ['workflow'],
			audience: ['orchestrator'],
			body: `# Large\n\n${'large body '.repeat(200)}`,
		});

		const catalog = await buildReferenceCatalog({ cwd, home });
		const output = await loadForWaveStart(catalog, ['small-wave-ref', 'large-wave-ref'], { cwd, home, maxChars: 500 });

		expect(output.length).toBeLessThanOrEqual(500);
		expect(output).toContain('# Reference: small-wave-ref');
		expect(output).not.toContain('# Reference: large-wave-ref');
		expect(output).toContain('Not included: large-wave-ref');
	});

	it('notes missing wave-start references in the footer', async () => {
		writeProjectRef(cwd, 'present-wave-ref', {
			tags: ['workflow'],
			audience: ['orchestrator'],
		});

		const catalog = await buildReferenceCatalog({ cwd, home });
		const output = await loadForWaveStart(catalog, ['present-wave-ref', 'missing-wave-ref'], { cwd, home, maxChars: 5000 });

		expect(output).toContain('# Reference: present-wave-ref');
		expect(output).toContain('_Not included: missing-wave-ref. Use `reference({ name: "X" })` to load on demand._');
	});

	it('maps registered and compatibility agent kinds to reference audiences', () => {
		expect(agentKindToAudience('orchestrator')).toBe('orchestrator');
		expect(agentKindToAudience('planner')).toBe('planner');
		expect(agentKindToAudience('researcher')).toBe('researcher');
		expect(agentKindToAudience('writer')).toBe('writer');
		expect(agentKindToAudience('librarian')).toBe('writer');
		expect(agentKindToAudience('explorer')).toBe('executor');
		expect(agentKindToAudience('verifier')).toBe('executor');
		expect(agentKindToAudience('debugger')).toBe('executor');
		expect(agentKindToAudience('tester')).toBe('executor');
		expect(agentKindToAudience('executor')).toBe('executor');
		expect(agentKindToAudience('executor-high')).toBe('executor');
		expect(agentKindToAudience('goop-executor-high')).toBe('executor');
		expect(agentKindToAudience('general')).toBe('executor');
		expect(agentKindToAudience('custom')).toBeNull();
	});
});
