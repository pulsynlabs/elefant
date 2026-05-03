/**
 * Frontmatter parser tests — YAML extraction, list parsing, Zod validation.
 */

import { describe, it, expect } from 'bun:test';
import { parseReferenceFrontmatter } from './frontmatter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withFm(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

const validFlatFm = `id: handoff-format\ntitle: Handoff Format\ndescription: XML response envelope schema for agent handoffs.`;

// ---------------------------------------------------------------------------
// Parsing tests
// ---------------------------------------------------------------------------

describe('parseReferenceFrontmatter', () => {
  // -- Success paths --------------------------------------------------------

  it('parses valid frontmatter with flat fields', () => {
    const content = withFm(validFlatFm, '\n# The Body\n\nSome content.\n');
    const result = parseReferenceFrontmatter(content);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frontmatter.id).toBe('handoff-format');
      expect(result.frontmatter.title).toBe('Handoff Format');
      expect(result.frontmatter.description).toBe(
        'XML response envelope schema for agent handoffs.',
      );
      expect(result.frontmatter.tags).toEqual([]);
      expect(result.frontmatter.audience).toEqual([]);
      expect(result.body).toContain('# The Body');
      expect(result.body).toContain('Some content.');
    }
  });

  it('parses valid frontmatter with list fields (tags, audience)', () => {
    const content = withFm(
      `id: handoff-format
title: Handoff Format
description: XML response envelope schema for agent handoffs.
tags:
  - orchestrator
  - executor
  - format
audience:
  - orchestrator
  - executor
version: 1.0.0`,
      '\n# Body\n',
    );
    const result = parseReferenceFrontmatter(content);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frontmatter.id).toBe('handoff-format');
      expect(result.frontmatter.tags).toEqual([
        'orchestrator',
        'executor',
        'format',
      ]);
      expect(result.frontmatter.audience).toEqual([
        'orchestrator',
        'executor',
      ]);
      expect(result.frontmatter.version).toBe('1.0.0');
    }
  });

  it('handles quoted values in frontmatter', () => {
    const content = withFm(
      `id: "handoff-format"
title: 'Handoff Format'
description: "XML response envelope schema"`,
      '\n# Body\n',
    );
    const result = parseReferenceFrontmatter(content);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frontmatter.id).toBe('handoff-format');
      expect(result.frontmatter.title).toBe('Handoff Format');
    }
  });

  it('handles CRLF line endings in frontmatter', () => {
    const content =
      '---\r\nid: handoff-format\r\ntitle: Handoff Format\r\ndescription: XML response envelope schema.\r\n---\r\n\r\n# Body\r\n';
    const result = parseReferenceFrontmatter(content);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frontmatter.id).toBe('handoff-format');
      expect(result.frontmatter.title).toBe('Handoff Format');
      expect(result.body).toContain('# Body');
    }
  });

  it('extracts body correctly (everything after closing ---)', () => {
    const content = withFm(validFlatFm, '\nLine 1\nLine 2\nLine 3\n');
    const result = parseReferenceFrontmatter(content);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Body should start after the closing ---
      expect(result.body).toBe('Line 1\nLine 2\nLine 3');
    }
  });

  it('handles tags key at end of frontmatter without trailing list items', () => {
    // A `key:` with no value and no subsequent list items is an empty list
    const content = withFm(
      `id: handoff-format
title: Handoff Format
description: Test description.
tags:`,
      '\n# Body\n',
    );
    const result = parseReferenceFrontmatter(content);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frontmatter.tags).toEqual([]);
    }
  });

  it('parses a real reference file (handoff-format.md)', () => {
    const content = `---
id: handoff-format
title: Handoff Format
description: XML response envelope schema for agent-to-orchestrator handoffs in Elefant.
tags:
  - orchestrator
  - executor
  - format
audience:
  - orchestrator
  - executor
version: 1.0.0
---

# Handoff Format

> **Note:** Placeholder.

## Overview

Content here.
`;
    const result = parseReferenceFrontmatter(content);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frontmatter.id).toBe('handoff-format');
      expect(result.frontmatter.title).toBe('Handoff Format');
      expect(result.frontmatter.tags).toEqual([
        'orchestrator',
        'executor',
        'format',
      ]);
      expect(result.frontmatter.audience).toEqual([
        'orchestrator',
        'executor',
      ]);
      expect(result.frontmatter.version).toBe('1.0.0');
      expect(result.body).toContain('# Handoff Format');
      expect(result.body).toContain('## Overview');
    }
  });

  // -- Failure paths --------------------------------------------------------

  it('returns ok: false for file with no frontmatter', () => {
    const result = parseReferenceFrontmatter('# Just a heading\n\nNo frontmatter here.\n');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No frontmatter block');
    }
  });

  it('returns ok: false for unclosed frontmatter block', () => {
    const result = parseReferenceFrontmatter('---\nid: test\ntitle: Test\ndescription: Desc.\n');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unclosed');
    }
  });

  it('returns ok: false with error for malformed YAML line', () => {
    const result = parseReferenceFrontmatter(
      '---\nid: test\nnot a valid line\ntitle: Test\n---\n\nBody\n',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('returns ok: false for unexpected standalone list item', () => {
    const result = parseReferenceFrontmatter(
      '---\n  - orphan-list-item\ntitle: Test\n---\n\nBody\n',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('no preceding key');
    }
  });

  it('returns ok: false for missing required field (no id)', () => {
    const result = parseReferenceFrontmatter(
      '---\ntitle: Test\ndescription: A description.\n---\n\nBody\n',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('validation failed');
    }
  });

  it('returns ok: false for missing required field (no title)', () => {
    const result = parseReferenceFrontmatter(
      '---\nid: test\ndescription: A description.\n---\n\nBody\n',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('validation failed');
    }
  });

  it('returns ok: false for non-kebab-case id', () => {
    const result = parseReferenceFrontmatter(
      '---\nid: Invalid_ID\ntitle: Test\ndescription: A description.\n---\n\nBody\n',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('validation failed');
      expect(result.error).toContain('kebab-case');
    }
  });

  it('includes Zod error details in the error message', () => {
    const result = parseReferenceFrontmatter(
      '---\ntitle: Test\ndescription: A description.\n---\n\nBody\n',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The error message should reference the failing field
      expect(result.error).toContain('id');
    }
  });

  it('returns ok: false for empty key name', () => {
    const result = parseReferenceFrontmatter(
      '---\n: value\ntitle: Test\ndescription: Desc.\n---\n\nBody\n',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Empty key');
    }
  });
});
