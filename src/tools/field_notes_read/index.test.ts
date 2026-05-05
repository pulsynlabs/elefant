/**
 * Tests for field_notes_read tool — MR-18.
 *
 * Uses a temp directory with real files to avoid mocking the filesystem.
 * Only the store is mocked for id-based lookups.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createFieldNotesReadTool,
  type ResearchReadDeps,
} from './index.js';

// ─── Fixture helpers ────────────────────────────────────────────────────────

const TEST_ROOT = join(import.meta.dirname, '.test-tmp');

/** Well-formed frontmatter for all strict-format tests */
const VALID_FM = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: Test Document
section: 02-tech
tags:
  - typescript
  - testing
sources:
  - https://example.com
confidence: high
created: "2025-01-01T00:00:00.000Z"
updated: "2025-01-02T00:00:00.000Z"
author_agent: executor-medium
workflow: test-workflow
summary: A test document for unit tests
---`;

/** Body content with headings for anchor tests */
const BODY_WITH_HEADINGS = `
# Introduction

This is the introduction section.

## Architecture Overview

Some architecture content here.

### Sub-component

More detailed content at H3 level.

## API Reference

API documentation content.

### GET /users

Returns a list of users.

### POST /users

Creates a new user.

## Deployment

Deployment instructions.
`;

/** Full valid markdown document */
const VALID_DOC = VALID_FM + '\n' + BODY_WITH_HEADINGS;

/** Scratch-like file: missing required frontmatter fields */
const SCRATCH_FM = `---
title: Just a scratch note
section: 99-scratch
author_agent: user
summary: Quick thoughts
---`;

const SCRATCH_DOC = SCRATCH_FM + '\n' + `
# Scratch Notes

Just some rough thoughts.
`;

/** File with malformed YAML frontmatter */
const MALFORMED_DOC = `---
id: not-a-uuid
title: Broken
section: bogus-section
author_agent: nobody
summary: ""
---
# Content

This file has invalid frontmatter but should still be readable.
`;

/** File with no frontmatter at all */
const NO_FM_DOC = `# Just a markdown file

No frontmatter here, just plain content.

- Item 1
- Item 2
`;

// ─── Test setup ─────────────────────────────────────────────────────────────

function makeDeps(projectPath: string): ResearchReadDeps {
  return { projectPath };
}

function makeDepsWithStore(
  projectPath: string,
  store: ResearchReadDeps['store'],
): ResearchReadDeps {
  return { projectPath, store };
}

async function writeResearchFile(
  projectPath: string,
  relPath: string,
  content: string,
): Promise<string> {
  const baseDir = join(projectPath, '.elefant', 'markdown-db');
  const dir = join(baseDir, relPath, '..');
  await mkdir(dir, { recursive: true });
  const fullPath = join(baseDir, relPath);
  await writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

let projectPath: string;

beforeEach(async () => {
  projectPath = join(TEST_ROOT, `proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await mkdir(projectPath, { recursive: true });
});

afterEach(async () => {
  try {
    await rm(TEST_ROOT, { recursive: true, force: true });
  } catch {
    /* cleanup is best-effort */
  }
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('field_notes_read', () => {
  // ── Happy paths ────────────────────────────────────────────────────────

  describe('read by path', () => {
    it('returns frontmatter + body for a valid file', async () => {
      await writeResearchFile(projectPath, '02-tech/foo.md', VALID_DOC);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({ path: '02-tech/foo.md' });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');

      const data = result.data;
      expect(data.path).toBe('02-tech/foo.md');
      expect(data.frontmatter).not.toBeNull();
      expect(data.frontmatter!.title).toBe('Test Document');
      expect(data.frontmatter!.section).toBe('02-tech');
      expect(data.frontmatter!.id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(data.body).toContain('# Introduction');
      expect(data.body).toContain('## Architecture Overview');
      expect(data.body).not.toContain('---'); // frontmatter stripped
      expect(data.fieldnotes_link).toBe('fieldnotes://_/02-tech/foo.md');
      expect(data.wordCount).toBeGreaterThan(0);
      expect(data.anchorBody).toBeUndefined();
    });
  });

  describe('read by id (mocked store)', () => {
    it('resolves path from store and reads file', async () => {
      await writeResearchFile(projectPath, '03-decisions/adr-001.md', VALID_DOC);

      const store = {
        getDocumentById(id: string) {
          return {
            ok: true as const,
            data: id === 'mock-uuid'
              ? { filePath: '03-decisions/adr-001.md' }
              : null,
          };
        },
      };

      const tool = createFieldNotesReadTool(makeDepsWithStore(projectPath, store));

      const result = await tool.execute({ id: 'mock-uuid' });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');

      expect(result.data.path).toBe('03-decisions/adr-001.md');
      expect(result.data.frontmatter!.title).toBe('Test Document');
      expect(result.data.fieldnotes_link).toBe('fieldnotes://_/03-decisions/adr-001.md');
    });

    it('returns FILE_NOT_FOUND when store returns null', async () => {
      const store = {
        getDocumentById(_id: string) {
          return { ok: true as const, data: null };
        },
      };

      const tool = createFieldNotesReadTool(makeDepsWithStore(projectPath, store));

      const result = await tool.execute({ id: 'nonexistent-id' });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected error');
      expect(result.error.code).toBe('FILE_NOT_FOUND');
    });
  });

  describe('read by link', () => {
    it('resolves fieldnotes:// URI and reads file', async () => {
      await writeResearchFile(projectPath, '02-tech/foo.md', VALID_DOC);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({ link: 'fieldnotes://_/02-tech/foo.md' });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');

      expect(result.data.path).toBe('02-tech/foo.md');
      expect(result.data.frontmatter!.title).toBe('Test Document');
      expect(result.data.fieldnotes_link).toBe('fieldnotes://_/02-tech/foo.md');
    });

    it('extracts anchorBody from link anchor', async () => {
      await writeResearchFile(projectPath, '02-tech/foo.md', VALID_DOC);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({
        link: 'fieldnotes://_/02-tech/foo.md#architecture-overview',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');

      expect(result.data.anchorBody).toBeDefined();
      expect(result.data.anchorBody).toContain('Some architecture content here.');
      expect(result.data.anchorBody).not.toContain('## API Reference'); // stops at next H2
    });

    it('param anchor overrides when link has no anchor', async () => {
      await writeResearchFile(projectPath, '02-tech/foo.md', VALID_DOC);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({
        link: 'fieldnotes://_/02-tech/foo.md',
        anchor: 'api-reference',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');

      expect(result.data.anchorBody).toBeDefined();
      expect(result.data.anchorBody).toContain('API documentation content.');
    });
  });

  describe('anchor extraction', () => {
    it('returns anchorBody for H2 heading', async () => {
      await writeResearchFile(projectPath, '02-tech/foo.md', VALID_DOC);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({
        path: '02-tech/foo.md',
        anchor: 'deployment',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');

      expect(result.data.anchorBody).toBeDefined();
      expect(result.data.anchorBody).toContain('## Deployment');
      expect(result.data.anchorBody).toContain('Deployment instructions.');
      expect(result.data.body).toContain('# Introduction'); // full body preserved
    });

    it('returns anchorBody for H3 heading', async () => {
      await writeResearchFile(projectPath, '02-tech/foo.md', VALID_DOC);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({
        path: '02-tech/foo.md',
        anchor: 'get-users',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');

      expect(result.data.anchorBody).toBeDefined();
      expect(result.data.anchorBody).toContain('Returns a list of users.');
      // Should stop at next H3 (POST /users) — same level
      expect(result.data.anchorBody).not.toContain('Creates a new user.');
    });

    it('anchorBody stops at same-level heading', async () => {
      await writeResearchFile(projectPath, '02-tech/foo.md', VALID_DOC);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      // architecture-overview is H2; next H2 is API Reference
      const result = await tool.execute({
        path: '02-tech/foo.md',
        anchor: 'architecture-overview',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');

      expect(result.data.anchorBody).toBeDefined();
      expect(result.data.anchorBody).toContain('Some architecture content here.');
      expect(result.data.anchorBody).toContain('### Sub-component');
      expect(result.data.anchorBody).toContain('More detailed content at H3 level.');
      expect(result.data.anchorBody).not.toContain('## API Reference');
      expect(result.data.anchorBody).not.toContain('## Deployment');
    });

    it('anchorBody stops at higher-level heading', async () => {
      await writeResearchFile(projectPath, '02-tech/foo.md', VALID_DOC);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      // sub-component is H3; next H2 (higher level) is API Reference
      const result = await tool.execute({
        path: '02-tech/foo.md',
        anchor: 'sub-component',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');

      expect(result.data.anchorBody).toBeDefined();
      expect(result.data.anchorBody).toContain('More detailed content at H3 level.');
      expect(result.data.anchorBody).not.toContain('## API Reference');
    });

    it('returns anchorBody=undefined for non-existent heading, no error', async () => {
      await writeResearchFile(projectPath, '02-tech/foo.md', VALID_DOC);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({
        path: '02-tech/foo.md',
        anchor: 'nonexistent-heading',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');

      expect(result.data.anchorBody).toBeUndefined();
      expect(result.data.body).toContain('# Introduction'); // still readable
    });

    it('returns anchorBody=undefined for empty body, no error', async () => {
      const emptyDoc = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: Empty
section: 02-tech
created: "2025-01-01T00:00:00.000Z"
updated: "2025-01-01T00:00:00.000Z"
summary: empty
author_agent: user
---`;

      await writeResearchFile(projectPath, '02-tech/empty.md', emptyDoc);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({ path: '02-tech/empty.md', anchor: 'introduction' });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');
      expect(result.data.anchorBody).toBeUndefined();
      expect(result.data.body).toBe('');
      expect(result.data.wordCount).toBe(0);
    });

    it('preserves empty body from valid but empty document', async () => {
      const doc = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: Empty Body
section: 02-tech
created: "2025-01-01T00:00:00.000Z"
updated: "2025-01-01T00:00:00.000Z"
author_agent: user
summary: empty body test
---`;

      await writeResearchFile(projectPath, '02-tech/empty-body.md', doc);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({ path: '02-tech/empty-body.md' });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');
      expect(result.data.frontmatter!.title).toBe('Empty Body');
      expect(result.data.body).toBe('');
      expect(result.data.wordCount).toBe(0);
    });
  });

  // ── Error paths ─────────────────────────────────────────────────────────

  describe('validation errors', () => {
    it('rejects when no resolver param is provided', async () => {
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({});

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected error');
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('Exactly one');
    });

    it('rejects when multiple resolver params are provided', async () => {
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({
        path: '02-tech/foo.md',
        id: 'some-id',
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected error');
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('Only one');
    });

    it('rejects when id is provided but no store is configured', async () => {
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({ id: 'some-id' });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected error');
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('store');
    });
  });

  describe('file not found', () => {
    it('returns FILE_NOT_FOUND for non-existent path', async () => {
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({ path: '02-tech/nope.md' });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected error');
      expect(result.error.code).toBe('FILE_NOT_FOUND');
    });
  });

  describe('traversal rejection', () => {
    it('returns PERMISSION_DENIED for path with ..', async () => {
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({ path: '../outside.md' });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected error');
      expect(result.error.code).toBe('PERMISSION_DENIED');
    });

    it('returns VALIDATION_ERROR for fieldnotes:// URI with ..', async () => {
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({
        link: 'fieldnotes://_/../outside.md',
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected error');
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('..');
    });
  });

  // ── Lenient reads ───────────────────────────────────────────────────────

  describe('lenient frontmatter handling', () => {
    it('reads scratch file with missing required frontmatter fields', async () => {
      await writeResearchFile(projectPath, '99-scratch/notes.md', SCRATCH_DOC);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({ path: '99-scratch/notes.md' });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');

      expect(result.data.frontmatter).toBeNull();
      expect(result.data.body).toContain('# Scratch Notes');
      expect(result.data.body).toContain('Just some rough thoughts.');
      expect(result.data.path).toBe('99-scratch/notes.md');
    });

    it('reads file with malformed YAML frontmatter', async () => {
      await writeResearchFile(projectPath, '02-tech/broken.md', MALFORMED_DOC);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({ path: '02-tech/broken.md' });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');

      expect(result.data.frontmatter).toBeNull();
      expect(result.data.body).toContain('# Content');
      expect(result.data.body).toContain('This file has invalid frontmatter');
      expect(result.data.body).not.toContain('id: not-a-uuid');
      expect(result.data.wordCount).toBeGreaterThan(0);
    });

    it('reads file with no frontmatter at all', async () => {
      await writeResearchFile(projectPath, '99-scratch/plain.md', NO_FM_DOC);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({ path: '99-scratch/plain.md' });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');

      expect(result.data.frontmatter).toBeNull();
      expect(result.data.body).toContain('# Just a markdown file');
      expect(result.data.body).toContain('- Item 1');
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('wordCount is correct for a known body', async () => {
      const doc = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: Word Count Test
section: 02-tech
created: "2025-01-01T00:00:00.000Z"
updated: "2025-01-01T00:00:00.000Z"
author_agent: user
summary: Testing word count
---
Exactly six words in this sentence.

Another paragraph here.`;

      await writeResearchFile(projectPath, '02-tech/count.md', doc);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({ path: '02-tech/count.md' });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');
      expect(result.data.wordCount).toBe(9); // 6 + 3 words across two paragraphs
    });

    it('handles anchor with special characters in heading', async () => {
      const doc = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: Special Chars
section: 02-tech
created: "2025-01-01T00:00:00.000Z"
updated: "2025-01-01T00:00:00.000Z"
author_agent: user
summary: testing special chars
---
## Foo & Bar's "Baz"!

Content about special characters.`;

      await writeResearchFile(projectPath, '02-tech/special.md', doc);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({
        path: '02-tech/special.md',
        anchor: 'foo-bars-baz',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');
      expect(result.data.anchorBody).toBeDefined();
    });

    it('link anchor takes precedence over param anchor', async () => {
      await writeResearchFile(projectPath, '02-tech/foo.md', VALID_DOC);
      const tool = createFieldNotesReadTool(makeDeps(projectPath));

      const result = await tool.execute({
        link: 'fieldnotes://_/02-tech/foo.md#deployment',
        anchor: 'introduction',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected error');

      expect(result.data.anchorBody).toBeDefined();
      expect(result.data.anchorBody).toContain('Deployment instructions.');
      expect(result.data.anchorBody).not.toContain('This is the introduction section.');
    });
  });
});
