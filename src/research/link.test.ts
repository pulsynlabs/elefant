import { describe, expect, test } from 'bun:test';
import {
  parseResearchLink,
  serializeResearchLink,
  RESEARCH_LINK_REGEX,
} from './link.ts';
import type { ResearchLink } from './link.ts';

// ─── Canonical links ────────────────────────────────────────────────────────

const URI_SIMPLE: ResearchLink = {
  kind: 'research-uri',
  workflow: 'feat-auth',
  path: '02-tech/oauth.md',
  anchor: null,
};

const URI_WITH_ANCHOR: ResearchLink = {
  kind: 'research-uri',
  workflow: 'feat-auth',
  path: '02-tech/oauth.md',
  anchor: 'bearer-tokens',
};

const URI_PROJECT_WIDE: ResearchLink = {
  kind: 'research-uri',
  workflow: '_',
  path: '04-comparisons/vector-stores.md',
  anchor: null,
};

const URI_DEEP_PATH: ResearchLink = {
  kind: 'research-uri',
  workflow: 'feat-auth',
  path: '02-tech/nested/deep/file.md',
  anchor: null,
};

const REL_SIMPLE: ResearchLink = {
  kind: 'relative-path',
  workflow: null,
  path: '02-tech/foo.md',
  anchor: null,
};

const REL_WITH_ANCHOR: ResearchLink = {
  kind: 'relative-path',
  workflow: null,
  path: '02-tech/foo.md',
  anchor: 'bar',
};

// ─── parseResearchLink ─────────────────────────────────────────────────────

describe('parseResearchLink', () => {
  // ── Happy path: research:// URI ──
  test('parses research:// URI with workflow slug', () => {
    const result = parseResearchLink('research://feat-auth/02-tech/oauth.md');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(URI_SIMPLE);
    }
  });

  test('parses research:// URI with anchor', () => {
    const result = parseResearchLink(
      'research://feat-auth/02-tech/oauth.md#bearer-tokens',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(URI_WITH_ANCHOR);
    }
  });

  test('parses research:// URI with project-wide workflow', () => {
    const result = parseResearchLink(
      'research://_/04-comparisons/vector-stores.md',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(URI_PROJECT_WIDE);
    }
  });

  test('parses research:// URI with deep nested path', () => {
    const result = parseResearchLink(
      'research://feat-auth/02-tech/nested/deep/file.md',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(URI_DEEP_PATH);
    }
  });

  test('parses research:// URI with project-wide workflow and anchor', () => {
    const result = parseResearchLink(
      'research://_/01-domain/overview.md#introduction',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.kind).toBe('research-uri');
      expect(result.data.workflow).toBe('_');
      expect(result.data.path).toBe('01-domain/overview.md');
      expect(result.data.anchor).toBe('introduction');
    }
  });

  test('parses research:// URI with multi-word-kebab workflow', () => {
    const result = parseResearchLink(
      'research://my-long-workflow-slug/99-scratch/notes.md',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.workflow).toBe('my-long-workflow-slug');
    }
  });

  test('trims leading/trailing whitespace', () => {
    const result = parseResearchLink(
      '  research://feat-auth/02-tech/oauth.md  ',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.path).toBe('02-tech/oauth.md');
    }
  });

  // ── Happy path: relative path ──
  test('parses relative path', () => {
    const result = parseResearchLink('.elefant/markdown-db/02-tech/foo.md');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(REL_SIMPLE);
    }
  });

  test('parses relative path with anchor', () => {
    const result = parseResearchLink(
      '.elefant/markdown-db/02-tech/foo.md#bar',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(REL_WITH_ANCHOR);
    }
  });

  test('parses relative path with deep nesting', () => {
    const result = parseResearchLink(
      '.elefant/markdown-db/03-decisions/nested/arch/adr-0001.md',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.path).toBe('03-decisions/nested/arch/adr-0001.md');
    }
  });

  test('parses relative path with section with hyphens', () => {
    const result = parseResearchLink(
      '.elefant/markdown-db/00-index/quick-ref.md',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.path).toBe('00-index/quick-ref.md');
    }
  });

  // ── Rejection: workflow validation ──
  test('rejects empty workflow slug', () => {
    const result = parseResearchLink('research:///02-tech/foo.md');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('must not be empty');
    }
  });

  test('rejects non-kebab-case workflow slug', () => {
    const result = parseResearchLink(
      'research://Invalid_Slug/02-tech/foo.md',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Invalid workflow slug');
    }
  });

  test('rejects workflow with uppercase', () => {
    const result = parseResearchLink(
      'research://Feat-Auth/02-tech/foo.md',
    );
    expect(result.ok).toBe(false);
  });

  test('rejects workflow starting with number', () => {
    const result = parseResearchLink(
      'research://2fa-workflow/02-tech/foo.md',
    );
    expect(result.ok).toBe(false);
  });

  test('rejects workflow with special characters', () => {
    const result = parseResearchLink(
      'research://feat@auth/02-tech/foo.md',
    );
    expect(result.ok).toBe(false);
  });

  // ── Rejection: path validation ──
  test('rejects empty path in research URI', () => {
    const result = parseResearchLink('research://feat-auth/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Path must not be empty');
    }
  });

  test('rejects empty path in relative path', () => {
    const result = parseResearchLink('.elefant/markdown-db/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Path must not be empty');
    }
  });

  test('rejects path with .. traversal in research URI', () => {
    const result = parseResearchLink(
      'research://feat-auth/../secret/file.md',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('..');
    }
  });

  test('rejects path with .. traversal in relative path', () => {
    const result = parseResearchLink(
      '.elefant/markdown-db/../../secret/file.md',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('..');
    }
  });

  test('rejects path starting with / in research URI', () => {
    const result = parseResearchLink(
      'research://feat-auth//absolute/path.md',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('start with "/"');
    }
  });

  test('rejects path starting with / in relative path', () => {
    const result = parseResearchLink('.elefant/markdown-db//absolute/path.md');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('start with "/"');
    }
  });

  test('rejects path not ending in .md in research URI', () => {
    const result = parseResearchLink('research://feat-auth/02-tech/foo.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('end with ".md"');
    }
  });

  test('rejects path not ending in .md in relative path', () => {
    const result = parseResearchLink(
      '.elefant/markdown-db/02-tech/foo.json',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('end with ".md"');
    }
  });

  test('rejects missing path in research URI (no / after workflow)', () => {
    const result = parseResearchLink('research://feat-auth');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('missing path');
    }
  });

  // ── Rejection: unrecognized format ──
  test('rejects completely unrecognized format', () => {
    const result = parseResearchLink('https://example.com/file.md');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Unrecognized');
    }
  });

  test('rejects non-elefant relative path', () => {
    const result = parseResearchLink('./markdown-db/02-tech/foo.md');
    expect(result.ok).toBe(false);
  });

  test('rejects empty string', () => {
    const result = parseResearchLink('');
    expect(result.ok).toBe(false);
  });

  // ── Rejection: anchor validation ──
  test('rejects anchor with spaces', () => {
    const result = parseResearchLink(
      'research://feat-auth/02-tech/foo.md#bad anchor',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Invalid anchor');
    }
  });

  test('rejects anchor with special characters', () => {
    const result = parseResearchLink(
      'research://feat-auth/02-tech/foo.md#bad!char',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Invalid anchor');
    }
  });

  test('accepts anchor with numbers and hyphens', () => {
    const result = parseResearchLink(
      'research://feat-auth/02-tech/foo.md#heading-2-with-123',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.anchor).toBe('heading-2-with-123');
    }
  });

  test('accepts anchor with uppercase letters (GitHub-style)', () => {
    const result = parseResearchLink(
      'research://feat-auth/02-tech/foo.md#My-Heading',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.anchor).toBe('My-Heading');
    }
  });

  test('accepts empty anchor (just #)', () => {
    const result = parseResearchLink(
      'research://feat-auth/02-tech/foo.md#',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.anchor).toBe('');
    }
  });
});

// ─── serializeResearchLink ─────────────────────────────────────────────────

describe('serializeResearchLink', () => {
  test('serializes research URI without anchor', () => {
    expect(serializeResearchLink(URI_SIMPLE)).toBe(
      'research://feat-auth/02-tech/oauth.md',
    );
  });

  test('serializes research URI with anchor', () => {
    expect(serializeResearchLink(URI_WITH_ANCHOR)).toBe(
      'research://feat-auth/02-tech/oauth.md#bearer-tokens',
    );
  });

  test('serializes project-wide research URI', () => {
    expect(serializeResearchLink(URI_PROJECT_WIDE)).toBe(
      'research://_/04-comparisons/vector-stores.md',
    );
  });

  test('serializes relative path without anchor', () => {
    expect(serializeResearchLink(REL_SIMPLE)).toBe(
      '.elefant/markdown-db/02-tech/foo.md',
    );
  });

  test('serializes relative path with anchor', () => {
    expect(serializeResearchLink(REL_WITH_ANCHOR)).toBe(
      '.elefant/markdown-db/02-tech/foo.md#bar',
    );
  });

  test('does not append # for null anchor', () => {
    const link: ResearchLink = {
      kind: 'research-uri',
      workflow: 'feat',
      path: '99-scratch/test.md',
      anchor: null,
    };
    const serialized = serializeResearchLink(link);
    expect(serialized).not.toContain('#');
    expect(serialized).toBe('research://feat/99-scratch/test.md');
  });

  test('does not append # for empty string anchor', () => {
    const link: ResearchLink = {
      kind: 'research-uri',
      workflow: 'feat',
      path: '99-scratch/test.md',
      anchor: '',
    };
    const serialized = serializeResearchLink(link);
    expect(serialized).not.toContain('#');
  });

  // ── Round-trip tests ──
  test('round-trips research URI without anchor', () => {
    const input = 'research://feat-auth/02-tech/oauth.md';
    const parsed = parseResearchLink(input);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializeResearchLink(parsed.data)).toBe(input);
    }
  });

  test('round-trips research URI with anchor', () => {
    const input = 'research://feat-auth/02-tech/oauth.md#bearer-tokens';
    const parsed = parseResearchLink(input);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializeResearchLink(parsed.data)).toBe(input);
    }
  });

  test('round-trips project-wide URI', () => {
    const input = 'research://_/04-comparisons/vector-stores.md';
    const parsed = parseResearchLink(input);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializeResearchLink(parsed.data)).toBe(input);
    }
  });

  test('round-trips relative path without anchor', () => {
    const input = '.elefant/markdown-db/02-tech/foo.md';
    const parsed = parseResearchLink(input);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializeResearchLink(parsed.data)).toBe(input);
    }
  });

  test('round-trips relative path with anchor', () => {
    const input = '.elefant/markdown-db/02-tech/foo.md#bar';
    const parsed = parseResearchLink(input);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializeResearchLink(parsed.data)).toBe(input);
    }
  });

  test('round-trips canonical input through parse → serialize → parse → serialize', () => {
    const input = 'research://feat-auth/02-tech/oauth.md#bearer-tokens';
    const p1 = parseResearchLink(input);
    expect(p1.ok).toBe(true);
    if (!p1.ok) throw new Error('unexpected');

    const s1 = serializeResearchLink(p1.data);
    const p2 = parseResearchLink(s1);
    expect(p2.ok).toBe(true);
    if (!p2.ok) throw new Error('unexpected');

    const s2 = serializeResearchLink(p2.data);
    expect(s2).toBe(s1);
  });

  test('serializes deep nested path correctly', () => {
    const link: ResearchLink = {
      kind: 'research-uri',
      workflow: 'feat-auth',
      path: '02-tech/nested/deep/file.md',
      anchor: null,
    };
    expect(serializeResearchLink(link)).toBe(
      'research://feat-auth/02-tech/nested/deep/file.md',
    );
  });
});

// ─── RESEARCH_LINK_REGEX ────────────────────────────────────────────────────

describe('RESEARCH_LINK_REGEX', () => {
  test('matches research:// URI', () => {
    const text = 'See research://feat-auth/02-tech/oauth.md for details.';
    const matches = [...text.matchAll(RESEARCH_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe('research://feat-auth/02-tech/oauth.md');
  });

  test('matches research:// URI with anchor', () => {
    const text = 'See research://feat-auth/02-tech/oauth.md#bearer-tokens for details.';
    const matches = [...text.matchAll(RESEARCH_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe(
      'research://feat-auth/02-tech/oauth.md#bearer-tokens',
    );
  });

  test('matches relative path', () => {
    const text = 'Check .elefant/markdown-db/02-tech/foo.md for ref.';
    const matches = [...text.matchAll(RESEARCH_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe('.elefant/markdown-db/02-tech/foo.md');
  });

  test('matches relative path with anchor', () => {
    const text = 'See .elefant/markdown-db/02-tech/foo.md#bar.';
    const matches = [...text.matchAll(RESEARCH_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe('.elefant/markdown-db/02-tech/foo.md#bar');
  });

  test('matches multiple links in one string', () => {
    const text =
      'See research://a/01-domain/x.md and .elefant/markdown-db/02-tech/y.md#section.';
    const matches = [...text.matchAll(RESEARCH_LINK_REGEX)];
    expect(matches).toHaveLength(2);
    expect(matches[0][0]).toBe('research://a/01-domain/x.md');
    expect(matches[1][0]).toBe('.elefant/markdown-db/02-tech/y.md#section');
  });

  test('does not match non-research URLs', () => {
    const text = 'See https://example.com/file.md for details.';
    const matches = [...text.matchAll(RESEARCH_LINK_REGEX)];
    expect(matches).toHaveLength(0);
  });

  test('does not match non-elefant relative paths', () => {
    const text = 'See ./markdown-db/02-tech/foo.md.';
    const matches = [...text.matchAll(RESEARCH_LINK_REGEX)];
    expect(matches).toHaveLength(0);
  });

  test('matches research link in parentheses', () => {
    const text = '(see research://feat-auth/02-tech/oauth.md)';
    const matches = [...text.matchAll(RESEARCH_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    // The regex excludes `)` from the match
    expect(matches[0][0]).toBe('research://feat-auth/02-tech/oauth.md');
  });

  test('matches research link in brackets', () => {
    const text = '[research://feat-auth/02-tech/oauth.md]';
    const matches = [...text.matchAll(RESEARCH_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe('research://feat-auth/02-tech/oauth.md');
  });

  test('matches project-wide research link', () => {
    const text = 'Global ref: research://_/06-synthesis/master.md';
    const matches = [...text.matchAll(RESEARCH_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe('research://_/06-synthesis/master.md');
  });

  test('matches workflow with underscores', () => {
    const text = 'See research://feat_auth_v2/02-tech/oauth.md.';
    const matches = [...text.matchAll(RESEARCH_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    // REGEX allows underscores, but parseResearchLink would reject non-kebab
    // That's intentional — regex is lenient, parser is strict
    expect(matches[0][0]).toBe('research://feat_auth_v2/02-tech/oauth.md');
  });

  test('is safe to use for matchAll on empty string', () => {
    const matches = [...''.matchAll(RESEARCH_LINK_REGEX)];
    expect(matches).toHaveLength(0);
  });
});
