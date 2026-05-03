/**
 * Reference frontmatter schema tests — Zod validation, defaults, and error messages.
 */

import { describe, it, expect } from 'bun:test';
import { ReferenceFrontmatterSchema } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid frontmatter object. */
function validFrontmatter(overrides: Record<string, unknown> = {}) {
  return {
    id: 'handoff-format',
    title: 'Handoff Format',
    description: 'XML response envelope schema for agent handoffs.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Validation tests
// ---------------------------------------------------------------------------

describe('ReferenceFrontmatterSchema', () => {
  it('accepts valid frontmatter with all required fields', () => {
    const result = ReferenceFrontmatterSchema.safeParse(
      validFrontmatter(),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('handoff-format');
      expect(result.data.title).toBe('Handoff Format');
      expect(result.data.description).toBe(
        'XML response envelope schema for agent handoffs.',
      );
    }
  });

  it('accepts valid frontmatter with optional tags, audience, and version', () => {
    const result = ReferenceFrontmatterSchema.safeParse(
      validFrontmatter({
        tags: ['orchestrator', 'executor'],
        audience: ['orchestrator'],
        version: '1.0.0',
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(['orchestrator', 'executor']);
      expect(result.data.audience).toEqual(['orchestrator']);
      expect(result.data.version).toBe('1.0.0');
    }
  });

  it('rejects frontmatter missing id with clear error', () => {
    const { id, ...withoutId } = validFrontmatter();
    const result = ReferenceFrontmatterSchema.safeParse(withoutId);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(
        messages.some(
          (m) => m.includes('expected') || m.includes('Expected'),
        ),
      ).toBe(true);
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('id');
    }
  });

  it('rejects frontmatter missing title with clear error', () => {
    const { title, ...withoutTitle } = validFrontmatter();
    const result = ReferenceFrontmatterSchema.safeParse(withoutTitle);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('title');
    }
  });

  it('rejects frontmatter missing description with clear error', () => {
    const { description, ...withoutDesc } = validFrontmatter();
    const result = ReferenceFrontmatterSchema.safeParse(withoutDesc);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('description');
    }
  });

  it('rejects id that is not kebab-case', () => {
    const invalidIds = [
      'Handoff-Format',   // uppercase
      'handoff_Format',   // underscore
      'handoff Format',   // space
      '-handoff-format',  // leading hyphen
      'handoff-format-',  // trailing hyphen
      'handoff--format',  // double hyphen
    ];

    for (const id of invalidIds) {
      const result = ReferenceFrontmatterSchema.safeParse(
        validFrontmatter({ id }),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(
          messages.some(
            (m) => m.includes('kebab-case') || m.includes('regex'),
          ),
        ).toBe(true);
      }
    }
  });

  it('rejects unknown extra fields (strict mode)', () => {
    const result = ReferenceFrontmatterSchema.safeParse(
      validFrontmatter({ unknownField: 'should not be here' }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.toLowerCase().includes('unrecognized'))).toBe(
        true,
      );
    }
  });

  it('applies default empty array for tags when absent', () => {
    const result = ReferenceFrontmatterSchema.safeParse(
      validFrontmatter(), // no tags key at all
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
    }
  });

  it('applies default empty array for audience when absent', () => {
    const result = ReferenceFrontmatterSchema.safeParse(
      validFrontmatter(), // no audience key at all
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.audience).toEqual([]);
    }
  });

  it('rejects empty title string', () => {
    const result = ReferenceFrontmatterSchema.safeParse(
      validFrontmatter({ title: '' }),
    );

    expect(result.success).toBe(false);
  });

  it('rejects empty description string', () => {
    const result = ReferenceFrontmatterSchema.safeParse(
      validFrontmatter({ description: '' }),
    );

    expect(result.success).toBe(false);
  });

  it('rejects empty id string', () => {
    const result = ReferenceFrontmatterSchema.safeParse(
      validFrontmatter({ id: '' }),
    );

    expect(result.success).toBe(false);
  });
});
