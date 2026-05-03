import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { parseFrontmatter } from '../../research/frontmatter.ts';
import { researchBaseDir } from '../../project/paths.ts';
import { ok, type Result } from '../../types/result.ts';
import type { ElefantError } from '../../types/errors.ts';
import { createResearchWriteTool, type ResearchWriteParams } from './index.ts';

let tempProjects: string[] = [];

afterEach(async () => {
  await Promise.all(tempProjects.map((path) => rm(path, { recursive: true, force: true })));
  tempProjects = [];
});

async function tempProject(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'elefant-research-write-'));
  tempProjects.push(path);
  return path;
}

function assertOk<T>(result: Result<T, ElefantError>): T {
  if (!result.ok) throw new Error(`Expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.data;
}

function assertError<T>(result: Result<T, ElefantError>): ElefantError {
  if (result.ok) throw new Error(`Expected error, got ${JSON.stringify(result.data)}`);
  return result.error;
}

async function readWritten(projectPath: string, relativePath: string) {
  const raw = await readFile(join(researchBaseDir(projectPath), relativePath), 'utf8');
  return assertOk(parseFrontmatter(raw));
}

function validParams(overrides: Partial<ResearchWriteParams> = {}): ResearchWriteParams {
  return {
    path: '02-tech/my-notes.md',
    title: 'My Notes',
    summary: 'Useful technical findings.',
    section: '02-tech',
    body: '## Finding\n\nResearch body.',
    tags: ['tools'],
    sources: ['https://example.com'],
    confidence: 'high',
    workflow: 'research-base-system',
    ...overrides,
  };
}

describe('research_write tool', () => {
  it('writes a valid research file with valid frontmatter and returned id', async () => {
    const projectPath = await tempProject();
    const tool = createResearchWriteTool({ projectPath, ctx: { agentName: 'researcher' } });

    const output = assertOk(await tool.execute(validParams()));
    const written = await readWritten(projectPath, '02-tech/my-notes.md');

    expect(existsSync(join(researchBaseDir(projectPath), '02-tech/my-notes.md'))).toBe(true);
    expect(output.path).toBe('02-tech/my-notes.md');
    expect(output.id).toBe(written.frontmatter.id);
    expect(output.created).toBe(true);
    expect(output.research_link).toBe('research://research-base-system/02-tech/my-notes.md');
    expect(written.frontmatter.title).toBe('My Notes');
    expect(written.frontmatter.section).toBe('02-tech');
    expect(written.frontmatter.author_agent).toBe('researcher');
    expect(written.body).toBe('## Finding\n\nResearch body.');
  });

  it('preserves provided id on update', async () => {
    const projectPath = await tempProject();
    const id = crypto.randomUUID();
    const tool = createResearchWriteTool({ projectPath, ctx: { agentName: 'writer' } });

    const output = assertOk(await tool.execute(validParams({ id, title: 'Updated Title' })));
    const written = await readWritten(projectPath, '02-tech/my-notes.md');

    expect(output.id).toBe(id);
    expect(written.frontmatter.id).toBe(id);
    expect(written.frontmatter.title).toBe('Updated Title');
  });

  it('returns VALIDATION_ERROR when title is missing', async () => {
    const projectPath = await tempProject();
    const tool = createResearchWriteTool({ projectPath, ctx: { agentName: 'researcher' } });

    const error = assertError(await tool.execute({ ...validParams(), title: undefined }));

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('title');
  });

  it('returns VALIDATION_ERROR for invalid section', async () => {
    const projectPath = await tempProject();
    const tool = createResearchWriteTool({ projectPath, ctx: { agentName: 'researcher' } });

    const error = assertError(await tool.execute(validParams({ section: '07-invalid' })));

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('section');
  });

  it('returns PERMISSION_DENIED for traversal path', async () => {
    const projectPath = await tempProject();
    const tool = createResearchWriteTool({ projectPath, ctx: { agentName: 'researcher' } });

    const error = assertError(await tool.execute(validParams({ path: '../escape.md' })));

    expect(error.code).toBe('PERMISSION_DENIED');
  });

  it('denies disallowed agent writes', async () => {
    const projectPath = await tempProject();
    const tool = createResearchWriteTool({ projectPath, ctx: { agentName: 'executor-medium' } });

    const error = assertError(await tool.execute(validParams()));

    expect(error.code).toBe('PERMISSION_DENIED');
  });

  it('allows researcher writes', async () => {
    const projectPath = await tempProject();
    const tool = createResearchWriteTool({ projectPath, ctx: { agentName: 'researcher' } });

    const output = assertOk(await tool.execute(validParams()));

    expect(output.path).toBe('02-tech/my-notes.md');
  });

  it('allows degraded/manual calls when no agent context is available', async () => {
    const projectPath = await tempProject();
    const tool = createResearchWriteTool({ projectPath });

    const output = assertOk(await tool.execute(validParams()));
    const written = await readWritten(projectPath, '02-tech/my-notes.md');

    expect(output.path).toBe('02-tech/my-notes.md');
    expect(written.frontmatter.author_agent).toBe('user');
  });

  it('supports scratch writes without explicit section or confidence', async () => {
    const projectPath = await tempProject();
    const tool = createResearchWriteTool({ projectPath, ctx: { agentName: 'librarian' } });

    const output = assertOk(await tool.execute({
      path: '99-scratch/note.md',
      title: 'Scratch Note',
      summary: 'Temporary note.',
      body: 'loose scratch content',
    }));
    const written = await readWritten(projectPath, '99-scratch/note.md');

    expect(output.path).toBe('99-scratch/note.md');
    expect(written.frontmatter.section).toBe('99-scratch');
    expect(written.frontmatter.confidence).toBe('medium');
    expect(written.frontmatter.author_agent).toBe('librarian');
  });

  it('auto-fills id, created, updated, and author_agent', async () => {
    const projectPath = await tempProject();
    const tool = createResearchWriteTool({ projectPath, ctx: { agentName: 'researcher' } });

    const output = assertOk(await tool.execute(validParams({ id: undefined })));
    const written = await readWritten(projectPath, '02-tech/my-notes.md');

    expect(output.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(written.frontmatter.id).toBe(output.id);
    expect(Date.parse(written.frontmatter.created)).not.toBeNaN();
    expect(Date.parse(written.frontmatter.updated)).not.toBeNaN();
    expect(written.frontmatter.author_agent).toBe('researcher');
  });

  it('updates updated timestamp but preserves created when writing same id twice', async () => {
    const projectPath = await tempProject();
    const id = crypto.randomUUID();
    const tool = createResearchWriteTool({ projectPath, ctx: { agentName: 'writer' } });

    assertOk(await tool.execute(validParams({ id, body: 'first' })));
    const first = await readWritten(projectPath, '02-tech/my-notes.md');
    await new Promise((resolve) => setTimeout(resolve, 5));

    const secondOutput = assertOk(await tool.execute(validParams({ id, body: 'second' })));
    const second = await readWritten(projectPath, '02-tech/my-notes.md');

    expect(secondOutput.created).toBe(false);
    expect(second.frontmatter.id).toBe(id);
    expect(second.frontmatter.created).toBe(first.frontmatter.created);
    expect(Date.parse(second.frontmatter.updated)).toBeGreaterThanOrEqual(Date.parse(first.frontmatter.updated));
    expect(second.body).toBe('second');
  });

  it('triggers indexFile after writing when an indexer service is injected', async () => {
    const projectPath = await tempProject();
    const indexed: string[] = [];
    const indexerService = {
      indexFile(path: string): Promise<Result<void, ElefantError>> {
        indexed.push(path);
        return Promise.resolve(ok(undefined));
      },
    };
    const tool = createResearchWriteTool({ projectPath, ctx: { agentName: 'researcher' }, indexerService });

    assertOk(await tool.execute(validParams()));

    expect(indexed).toEqual([join(researchBaseDir(projectPath), '02-tech/my-notes.md')]);
  });
});
