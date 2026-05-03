import { describe, expect, test } from 'bun:test';
import {
  FrontmatterSchema,
  parseFrontmatter,
  serializeFrontmatter,
  autoFillFrontmatter,
  ConfidenceSchema,
  AuthorAgentSchema,
  SectionSchema,
} from './frontmatter.ts';
import type { Frontmatter } from './frontmatter.ts';

// ─── Canonical test document ────────────────────────────────────────────────

const CANONICAL_DOC = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: Test Document
section: 02-tech
tags:
  - typescript
  - zod
sources:
  - https://example.com
  - https://other.example.com
confidence: high
created: 2026-05-01T00:00:00.000Z
updated: 2026-05-02T00:00:00.000Z
author_agent: researcher
workflow: feat-auth
summary: A test document for validation
---

This is the body of the document.
It can have multiple lines.
`;

const CANONICAL_FRONTMATTER: Frontmatter = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  title: 'Test Document',
  section: '02-tech',
  tags: ['typescript', 'zod'],
  sources: ['https://example.com', 'https://other.example.com'],
  confidence: 'high',
  created: '2026-05-01T00:00:00.000Z',
  updated: '2026-05-02T00:00:00.000Z',
  author_agent: 'researcher',
  workflow: 'feat-auth',
  summary: 'A test document for validation',
};

// ─── Minimal document (all optional fields at defaults) ─────────────────────

const MINIMAL_DOC = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: Minimal
section: 00-index
created: 2026-05-01T00:00:00.000Z
updated: 2026-05-01T00:00:00.000Z
author_agent: user
summary: Minimal doc
---

Minimal body.
`;

const MINIMAL_FRONTMATTER: Frontmatter = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  title: 'Minimal',
  section: '00-index',
  tags: [],
  sources: [],
  confidence: 'medium',
  created: '2026-05-01T00:00:00.000Z',
  updated: '2026-05-01T00:00:00.000Z',
  author_agent: 'user',
  workflow: null,
  summary: 'Minimal doc',
};

// ─── Schema validation ─────────────────────────────────────────────────────

describe('FrontmatterSchema', () => {
  test('accepts a valid complete frontmatter', () => {
    const result = FrontmatterSchema.safeParse(CANONICAL_FRONTMATTER);
    expect(result.success).toBe(true);
  });

  test('accepts a minimal frontmatter with defaults', () => {
    const result = FrontmatterSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'X',
      section: '99-scratch',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
      author_agent: 'user',
      summary: 'Y',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
      expect(result.data.sources).toEqual([]);
      expect(result.data.confidence).toBe('medium');
      expect(result.data.workflow).toBeNull();
    }
  });

  test('rejects missing required field id', () => {
    const { id, ...rest } = CANONICAL_FRONTMATTER;
    const result = FrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test('rejects missing required field title', () => {
    const { title, ...rest } = CANONICAL_FRONTMATTER;
    const result = FrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test('rejects missing required field section', () => {
    const { section, ...rest } = CANONICAL_FRONTMATTER;
    const result = FrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test('rejects missing required field summary', () => {
    const { summary, ...rest } = CANONICAL_FRONTMATTER;
    const result = FrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test('rejects missing required field author_agent', () => {
    const { author_agent, ...rest } = CANONICAL_FRONTMATTER;
    const result = FrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test('rejects unknown keys (strict mode)', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      extra_field: 'should be rejected',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('extra_field');
    }
  });

  test('rejects title longer than 200 characters', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      title: 'x'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty title', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      title: '',
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty summary', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      summary: '',
    });
    expect(result.success).toBe(false);
  });

  test('rejects summary longer than 500 characters', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      summary: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid UUID for id', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid section value', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      section: '99-invalid',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid confidence value', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      confidence: 'unknown',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid author_agent value', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      author_agent: 'not-an-agent',
    });
    expect(result.success).toBe(false);
  });

  test('accepts all valid sections', () => {
    const sections = [
      '00-index',
      '01-domain',
      '02-tech',
      '03-decisions',
      '04-comparisons',
      '05-references',
      '06-synthesis',
      '99-scratch',
    ];
    for (const section of sections) {
      const result = FrontmatterSchema.safeParse({
        ...CANONICAL_FRONTMATTER,
        section,
      });
      expect(result.success).toBe(true);
    }
  });

  test('accepts all valid author_agent values', () => {
    const agents = [
      'researcher',
      'writer',
      'librarian',
      'orchestrator',
      'planner',
      'verifier',
      'debugger',
      'tester',
      'explorer',
      'executor-low',
      'executor-medium',
      'executor-high',
      'executor-frontend',
      'user',
    ];
    for (const agent of agents) {
      const result = FrontmatterSchema.safeParse({
        ...CANONICAL_FRONTMATTER,
        author_agent: agent,
      });
      expect(result.success).toBe(true);
    }
  });

  test('rejects tags that are not an array of strings', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      tags: [42],
    });
    expect(result.success).toBe(false);
  });

  test('rejects sources that are not an array of strings', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      sources: [true],
    });
    expect(result.success).toBe(false);
  });

  test('accepts null workflow', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      workflow: null,
    });
    expect(result.success).toBe(true);
  });

  test('rejects non-string workflow', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      workflow: 123,
    });
    expect(result.success).toBe(false);
  });

  test('SectionSchema has exactly 8 values', () => {
    expect(SectionSchema.options).toHaveLength(8);
  });

  test('ConfidenceSchema has exactly 3 values', () => {
    expect(ConfidenceSchema.options).toHaveLength(3);
  });

  test('AuthorAgentSchema has exactly 14 values', () => {
    expect(AuthorAgentSchema.options).toHaveLength(14);
  });
});

// ─── parseFrontmatter ──────────────────────────────────────────────────────

describe('parseFrontmatter', () => {
  test('parses a valid canonical document', () => {
    const result = parseFrontmatter(CANONICAL_DOC);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.frontmatter).toEqual(CANONICAL_FRONTMATTER);
      expect(result.data.body).toBe(
        'This is the body of the document.\nIt can have multiple lines.\n',
      );
    }
  });

  test('parses a minimal document with defaults applied by Zod', () => {
    const result = parseFrontmatter(MINIMAL_DOC);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.frontmatter).toEqual(MINIMAL_FRONTMATTER);
    }
  });

  test('returns error for missing opening ---', () => {
    const result = parseFrontmatter('Just body, no frontmatter');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('No valid YAML frontmatter');
    }
  });

  test('returns error for missing closing ---', () => {
    const result = parseFrontmatter(
      '---\ntitle: Bad\nsection: 02-tech\n',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('No valid YAML frontmatter');
    }
  });

  test('returns error for missing required fields', () => {
    const result = parseFrontmatter(
      '---\ntitle: Only Title\n---\n\nBody.',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('returns error for unknown keys in frontmatter', () => {
    const result = parseFrontmatter(
      '---\nid: 550e8400-e29b-41d4-a716-446655440000\ntitle: X\nsection: 02-tech\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\nauthor_agent: user\nsummary: Y\nbogus_field: true\n---\n\nBody.',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('parses quoted string values', () => {
    const doc = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: "Quoted Title"
section: "02-tech"
created: "2026-01-01T00:00:00.000Z"
updated: "2026-01-01T00:00:00.000Z"
author_agent: "researcher"
summary: "Quoted summary"
---

Body.
`;
    const result = parseFrontmatter(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.frontmatter.title).toBe('Quoted Title');
      expect(result.data.frontmatter.section).toBe('02-tech');
      expect(result.data.frontmatter.summary).toBe('Quoted summary');
    }
  });

  test('parses single-quoted string values', () => {
    const doc = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: 'Single Quoted'
section: '02-tech'
created: '2026-01-01T00:00:00.000Z'
updated: '2026-01-01T00:00:00.000Z'
author_agent: 'researcher'
summary: 'Single quoted summary'
---

Body.
`;
    const result = parseFrontmatter(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.frontmatter.title).toBe('Single Quoted');
    }
  });

  test('handles null workflow correctly', () => {
    const doc = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: No Workflow
section: 02-tech
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
author_agent: user
workflow: null
summary: No workflow
---

Body.
`;
    const result = parseFrontmatter(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.frontmatter.workflow).toBeNull();
    }
  });

  test('handles YAML null tilde', () => {
    const doc = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: Tilde Null
section: 02-tech
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
author_agent: user
workflow: ~
summary: Tilde null
---

Body.
`;
    const result = parseFrontmatter(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.frontmatter.workflow).toBeNull();
    }
  });

  test('handles YAML booleans as strings (rejected by Zod on author_agent)', () => {
    const doc = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: Boolean Test
section: 02-tech
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
author_agent: true
summary: Test
---

Body.
`;
    const result = parseFrontmatter(doc);
    expect(result.ok).toBe(false);
  });

  test('strips BOM if present', () => {
    const doc = '\uFEFF---\n' + CANONICAL_DOC.slice(3);
    const result = parseFrontmatter(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.frontmatter.id).toBe(CANONICAL_FRONTMATTER.id);
    }
  });

  test('strips YAML comments', () => {
    const doc = `---
# A comment
id: 550e8400-e29b-41d4-a716-446655440000
# Another comment
title: Test
section: 02-tech
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
author_agent: user
summary: Test
---

Body.
`;
    const result = parseFrontmatter(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.frontmatter.title).toBe('Test');
    }
  });

  test('parses empty tags and sources lists', () => {
    const doc = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: Empty Lists
section: 02-tech
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
author_agent: user
summary: Empty lists
---

Body.
`;
    const result = parseFrontmatter(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.frontmatter.tags).toEqual([]);
      expect(result.data.frontmatter.sources).toEqual([]);
    }
  });

  test('parses values containing colons (ISO datetime)', () => {
    const doc = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: Colon Test
section: 02-tech
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
author_agent: user
summary: Value with colons: here
---

Body.
`;
    const result = parseFrontmatter(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.frontmatter.created).toBe('2026-01-01T00:00:00.000Z');
      expect(result.data.frontmatter.summary).toBe('Value with colons: here');
    }
  });
});

// ─── serializeFrontmatter ──────────────────────────────────────────────────

describe('serializeFrontmatter', () => {
  test('produces valid markdown with YAML block', () => {
    const output = serializeFrontmatter(CANONICAL_FRONTMATTER, 'Body text.\n');
    expect(output.startsWith('---\n')).toBe(true);
    expect(output).toContain('\n---\n');
    expect(output).toContain(`id: ${CANONICAL_FRONTMATTER.id}`);
    expect(output).toContain(`title: ${CANONICAL_FRONTMATTER.title}`);
    expect(output).toContain('Body text.');
  });

  test('serializes tags as YAML list', () => {
    const output = serializeFrontmatter(CANONICAL_FRONTMATTER, '\n');
    expect(output).toContain('tags:\n');
    expect(output).toContain('  - typescript\n');
    expect(output).toContain('  - zod\n');
  });

  test('serializes sources as YAML list', () => {
    const output = serializeFrontmatter(CANONICAL_FRONTMATTER, '\n');
    expect(output).toContain('sources:\n');
    expect(output).toContain('  - https://example.com\n');
  });

  test('omits tags line when tags is empty', () => {
    const output = serializeFrontmatter(MINIMAL_FRONTMATTER, '\n');
    expect(output).not.toContain('tags:');
  });

  test('omits sources line when sources is empty', () => {
    const output = serializeFrontmatter(MINIMAL_FRONTMATTER, '\n');
    expect(output).not.toContain('sources:');
  });

  test('serializes null workflow as literal null', () => {
    const output = serializeFrontmatter(MINIMAL_FRONTMATTER, '\n');
    expect(output).toContain('workflow: null');
  });

  test('serializes workflow when set', () => {
    const output = serializeFrontmatter(CANONICAL_FRONTMATTER, '\n');
    expect(output).toContain('workflow: feat-auth');
  });

  test('round-trips correctly: parse → serialize → parse', () => {
    const parsed = parseFrontmatter(CANONICAL_DOC);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unexpected');

    const serialized = serializeFrontmatter(
      parsed.data.frontmatter,
      parsed.data.body,
    );
    const reparsed = parseFrontmatter(serialized);
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) {
      expect(reparsed.data.frontmatter).toEqual(parsed.data.frontmatter);
      expect(reparsed.data.body).toBe(parsed.data.body);
    }
  });

  test('serialize is idempotent over canonical inputs', () => {
    const parsed = parseFrontmatter(CANONICAL_DOC);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unexpected');

    const first = serializeFrontmatter(parsed.data.frontmatter, parsed.data.body);
    const reParsed = parseFrontmatter(first);
    expect(reParsed.ok).toBe(true);
    if (!reParsed.ok) throw new Error('unexpected');

    const second = serializeFrontmatter(
      reParsed.data.frontmatter,
      reParsed.data.body,
    );
    expect(second).toBe(first);
  });

  test('serializes minimal frontmatter without tags or sources keys', () => {
    const output = serializeFrontmatter(MINIMAL_FRONTMATTER, 'Body.\n');
    const parsed = parseFrontmatter(output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.frontmatter.tags).toEqual([]);
      expect(parsed.data.frontmatter.sources).toEqual([]);
    }
  });
});

// ─── autoFillFrontmatter ───────────────────────────────────────────────────

describe('autoFillFrontmatter', () => {
  test('fills id when missing', () => {
    const result = autoFillFrontmatter({
      title: 'Test',
      section: '02-tech',
      summary: 'Test summary',
      author_agent: 'researcher',
    });
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test('preserves provided id', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const result = autoFillFrontmatter({
      id,
      title: 'Test',
      section: '02-tech',
      summary: 'Test',
      author_agent: 'researcher',
    });
    expect(result.id).toBe(id);
  });

  test('fills created when missing', () => {
    const result = autoFillFrontmatter({
      title: 'Test',
      section: '02-tech',
      summary: 'Test',
      author_agent: 'researcher',
    });
    expect(result.created).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
    );
  });

  test('preserves provided created', () => {
    const created = '2025-01-01T00:00:00.000Z';
    const result = autoFillFrontmatter({
      title: 'Test',
      section: '02-tech',
      summary: 'Test',
      author_agent: 'researcher',
      created,
    });
    expect(result.created).toBe(created);
  });

  test('fills updated when missing', () => {
    const result = autoFillFrontmatter({
      title: 'Test',
      section: '02-tech',
      summary: 'Test',
      author_agent: 'researcher',
    });
    expect(result.updated).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
    );
  });

  test('preserves provided updated', () => {
    const updated = '2025-06-01T00:00:00.000Z';
    const result = autoFillFrontmatter({
      title: 'Test',
      section: '02-tech',
      summary: 'Test',
      author_agent: 'researcher',
      updated,
    });
    expect(result.updated).toBe(updated);
  });

  test('applies default confidence=medium', () => {
    const result = autoFillFrontmatter({
      title: 'Test',
      section: '02-tech',
      summary: 'Test',
      author_agent: 'researcher',
    });
    expect(result.confidence).toBe('medium');
  });

  test('preserves provided confidence', () => {
    const result = autoFillFrontmatter({
      title: 'Test',
      section: '02-tech',
      summary: 'Test',
      author_agent: 'researcher',
      confidence: 'high',
    });
    expect(result.confidence).toBe('high');
  });

  test('applies default tags=[]', () => {
    const result = autoFillFrontmatter({
      title: 'Test',
      section: '02-tech',
      summary: 'Test',
      author_agent: 'researcher',
    });
    expect(result.tags).toEqual([]);
  });

  test('preserves provided tags', () => {
    const result = autoFillFrontmatter({
      title: 'Test',
      section: '02-tech',
      summary: 'Test',
      author_agent: 'researcher',
      tags: ['alpha', 'beta'],
    });
    expect(result.tags).toEqual(['alpha', 'beta']);
  });

  test('applies default sources=[]', () => {
    const result = autoFillFrontmatter({
      title: 'Test',
      section: '02-tech',
      summary: 'Test',
      author_agent: 'researcher',
    });
    expect(result.sources).toEqual([]);
  });

  test('applies default workflow=null', () => {
    const result = autoFillFrontmatter({
      title: 'Test',
      section: '02-tech',
      summary: 'Test',
      author_agent: 'researcher',
    });
    expect(result.workflow).toBeNull();
  });

  test('preserves provided workflow', () => {
    const result = autoFillFrontmatter({
      title: 'Test',
      section: '02-tech',
      summary: 'Test',
      author_agent: 'researcher',
      workflow: 'feat-auth',
    });
    expect(result.workflow).toBe('feat-auth');
  });

  test('preserves provided null workflow', () => {
    const result = autoFillFrontmatter({
      title: 'Test',
      section: '02-tech',
      summary: 'Test',
      author_agent: 'researcher',
      workflow: null,
    });
    expect(result.workflow).toBeNull();
  });

  test('generates unique ids on each call', () => {
    const a = autoFillFrontmatter({
      title: 'A',
      section: '02-tech',
      summary: 'A',
      author_agent: 'researcher',
    });
    const b = autoFillFrontmatter({
      title: 'B',
      section: '02-tech',
      summary: 'B',
      author_agent: 'researcher',
    });
    expect(a.id).not.toBe(b.id);
  });

  test('includes all required fields in output', () => {
    const result = autoFillFrontmatter({
      title: 'Test',
      section: '03-decisions',
      summary: 'Test summary',
      author_agent: 'writer',
      tags: ['tag'],
      sources: ['https://example.com'],
      confidence: 'low',
      workflow: 'feat-x',
    });
    expect(result.id).toBeTruthy();
    expect(result.title).toBe('Test');
    expect(result.section).toBe('03-decisions');
    expect(result.tags).toEqual(['tag']);
    expect(result.sources).toEqual(['https://example.com']);
    expect(result.confidence).toBe('low');
    expect(result.created).toBeTruthy();
    expect(result.updated).toBeTruthy();
    expect(result.author_agent).toBe('writer');
    expect(result.workflow).toBe('feat-x');
    expect(result.summary).toBe('Test summary');
  });

  test('throws (ZodError) if title is empty', () => {
    expect(() =>
      autoFillFrontmatter({
        title: '',
        section: '02-tech',
        summary: 'Test',
        author_agent: 'researcher',
      }),
    ).toThrow();
  });

  test('throws (ZodError) if section is invalid', () => {
    expect(() =>
      autoFillFrontmatter({
        title: 'Test',
        section: '99-invalid' as Frontmatter['section'],
        summary: 'Test',
        author_agent: 'researcher',
      }),
    ).toThrow();
  });

  test('throws (ZodError) if author_agent is invalid', () => {
    expect(() =>
      autoFillFrontmatter({
        title: 'Test',
        section: '02-tech',
        summary: 'Test',
        author_agent: 'not-valid' as Frontmatter['author_agent'],
      }),
    ).toThrow();
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  test('body is empty string', () => {
    const doc = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: Empty Body
section: 02-tech
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
author_agent: user
summary: Test
---

`;
    const result = parseFrontmatter(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.body).toBe('');
    }
  });

  test('body contains --- delimiters within text', () => {
    const doc = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: Delims in Body
section: 02-tech
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
author_agent: user
summary: Test
---

Body with --- inside it.
Still body.
`;
    const result = parseFrontmatter(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.body).toContain('---');
    }
  });

  test('body starts without leading newline after ---', () => {
    const doc = `---
id: 550e8400-e29b-41d4-a716-446655440000
title: No Newline
section: 02-tech
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
author_agent: user
summary: Test
---Body starts immediately.
`;
    const result = parseFrontmatter(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.body).toBe('Body starts immediately.\n');
    }
  });

  test('title at max length 200 passes', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      title: 'x'.repeat(200),
    });
    expect(result.success).toBe(true);
  });

  test('summary at max length 500 passes', () => {
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      summary: 'x'.repeat(500),
    });
    expect(result.success).toBe(true);
  });

  test('tags can have many items', () => {
    const tags = Array.from({ length: 50 }, (_, i) => `tag-${i}`);
    const result = FrontmatterSchema.safeParse({
      ...CANONICAL_FRONTMATTER,
      tags,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toHaveLength(50);
    }
  });

  test('empty string input returns error', () => {
    const result = parseFrontmatter('');
    expect(result.ok).toBe(false);
  });

  test('document with only --- delimiters returns schema error', () => {
    const result = parseFrontmatter('---\n---\n');
    expect(result.ok).toBe(false);
  });
});
