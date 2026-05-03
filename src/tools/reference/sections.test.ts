/**
 * Section extractor tests — heading matching, boundaries, error cases.
 */

import { describe, it, expect } from 'bun:test';
import { extractSection } from './sections.js';

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe('extractSection', () => {
  it('extracts content of a matching ## section', () => {
    const content = [
      '# Top Level Heading',
      '',
      '## Overview',
      '',
      'This is the overview section.',
      'It has multiple lines.',
      '',
      '## Usage',
      '',
      'How to use it.',
    ].join('\n');

    const result = extractSection(content, 'Overview');
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.content).toContain('This is the overview section.');
      expect(result.content).toContain('It has multiple lines.');
      expect(result.content).not.toContain('How to use it.');
    }
  });

  it('matches case-insensitively', () => {
    const content = [
      '# Top',
      '',
      '## Overview',
      '',
      'Section body.',
      '',
      '## Details',
      '',
      'More details.',
    ].join('\n');

    const result = extractSection(content, 'overview');
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.content).toContain('Section body.');
    }
  });

  it('preserves ### sub-headings within extracted content', () => {
    const content = [
      '## Status Values',
      '',
      'This section has sub-headings.',
      '',
      '### Sub A',
      '',
      'Content A.',
      '',
      '### Sub B',
      '',
      'Content B.',
      '',
      '## Next Section',
      '',
      'Not included.',
    ].join('\n');

    const result = extractSection(content, 'Status Values');
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.content).toContain('### Sub A');
      expect(result.content).toContain('### Sub B');
      expect(result.content).toContain('Content A.');
      expect(result.content).toContain('Content B.');
      expect(result.content).not.toContain('Next Section');
    }
  });

  it('stops at sibling ## heading but not ### sub-heading', () => {
    const content = [
      '## First',
      '',
      'First body.',
      '',
      '### First Sub',
      '',
      'First sub content.',
      '',
      '## Second',
      '',
      'Second body.',
    ].join('\n');

    const result = extractSection(content, 'First');
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.content).toContain('First body.');
      expect(result.content).toContain('### First Sub');
      expect(result.content).toContain('First sub content.');
      expect(result.content).not.toContain('Second body.');
    }
  });

  it('returns first match when multiple headings with same text exist', () => {
    const content = [
      '## Section',
      '',
      'First occurrence.',
      '',
      '## Section',
      '',
      'Second occurrence.',
    ].join('\n');

    const result = extractSection(content, 'Section');
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.content).toContain('First occurrence.');
      expect(result.content).not.toContain('Second occurrence.');
    }
  });

  it('trims whitespace from extracted content', () => {
    const content = [
      '## Padded',
      '',
      '',
      '  content with leading space  ',
      '',
      '',
      '## Next',
    ].join('\n');

    const result = extractSection(content, 'Padded');
    expect(result.found).toBe(true);
    if (result.found) {
      // Should not start with blank line
      expect(result.content.startsWith('\n')).toBe(false);
      expect(result.content.endsWith('\n')).toBe(false);
      expect(result.content).toContain('content with leading space');
    }
  });

  it('extracts last section up to end of file', () => {
    const content = [
      '## First',
      '',
      'First body.',
      '',
      '## Last',
      '',
      'Last body.',
      'Trailing line.',
    ].join('\n');

    const result = extractSection(content, 'Last');
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.content).toContain('Last body.');
      expect(result.content).toContain('Trailing line.');
    }
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('extractSection missing section', () => {
  it('returns found: false with available headings', () => {
    const content = [
      '## Overview',
      '',
      'Content.',
      '',
      '## Usage',
      '',
      'More content.',
      '',
      '## Status Values',
      '',
      'Even more.',
    ].join('\n');

    const result = extractSection(content, 'nonexistent');
    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.available).toEqual(['Overview', 'Usage', 'Status Values']);
    }
  });

  it('returns empty available when no ## headings exist', () => {
    const content = '# Just a top-level heading\n\nNo ## sections here.\n';

    const result = extractSection(content, 'anything');
    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.available).toEqual([]);
    }
  });

  it('ignores # and ### headings in available list', () => {
    const content = [
      '# Top Level',
      '',
      '## Section A',
      '',
      'A content.',
      '',
      '### Sub A',
      '',
      'Sub content.',
    ].join('\n');

    const result = extractSection(content, 'nonexistent');
    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.available).toEqual(['Section A']);
      expect(result.available).not.toContain('Top Level');
      expect(result.available).not.toContain('Sub A');
    }
  });
});
