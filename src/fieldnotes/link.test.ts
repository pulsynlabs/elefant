import { describe, expect, test } from 'bun:test';
import {
  parseFieldNotesLink,
  serializeFieldNotesLink,
  FIELD_NOTES_LINK_REGEX,
} from './link.ts';
import type { ResearchLink } from './link.ts';

// ─── Canonical links ────────────────────────────────────────────────────────

const URI_SIMPLE: ResearchLink = {
  kind: 'fieldnotes-uri',
  workflow: 'feat-auth',
  path: '02-tech/oauth.md',
  anchor: null,
};

const URI_WITH_ANCHOR: ResearchLink = {
  kind: 'fieldnotes-uri',
  workflow: 'feat-auth',
  path: '02-tech/oauth.md',
  anchor: 'bearer-tokens',
};

const URI_PROJECT_WIDE: ResearchLink = {
  kind: 'fieldnotes-uri',
  workflow: '_',
  path: '04-comparisons/vector-stores.md',
  anchor: null,
};

const URI_DEEP_PATH: ResearchLink = {
  kind: 'fieldnotes-uri',
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

// ─── parseFieldNotesLink ─────────────────────────────────────────────────────

describe('parseFieldNotesLink', () => {
  // ── Happy path: fieldnotes:// URI ──
  test('parses fieldnotes:// URI with workflow slug', () => {
    const result = parseFieldNotesLink('fieldnotes://feat-auth/02-tech/oauth.md');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(URI_SIMPLE);
    }
  });

  test('parses fieldnotes:// URI with anchor', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://feat-auth/02-tech/oauth.md#bearer-tokens',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(URI_WITH_ANCHOR);
    }
  });

  test('parses fieldnotes:// URI with project-wide workflow', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://_/04-comparisons/vector-stores.md',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(URI_PROJECT_WIDE);
    }
  });

  test('parses fieldnotes:// URI with deep nested path', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://feat-auth/02-tech/nested/deep/file.md',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(URI_DEEP_PATH);
    }
  });

  test('parses fieldnotes:// URI with project-wide workflow and anchor', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://_/01-domain/overview.md#introduction',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.kind).toBe('fieldnotes-uri');
      expect(result.data.workflow).toBe('_');
      expect(result.data.path).toBe('01-domain/overview.md');
      expect(result.data.anchor).toBe('introduction');
    }
  });

  test('parses fieldnotes:// URI with multi-word-kebab workflow', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://my-long-workflow-slug/99-scratch/notes.md',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.workflow).toBe('my-long-workflow-slug');
    }
  });

  test('trims leading/trailing whitespace', () => {
    const result = parseFieldNotesLink(
      '  fieldnotes://feat-auth/02-tech/oauth.md  ',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.path).toBe('02-tech/oauth.md');
    }
  });

  // ── Happy path: relative path ──
  test('parses relative path', () => {
    const result = parseFieldNotesLink('.elefant/field-notes/02-tech/foo.md');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(REL_SIMPLE);
    }
  });

  test('parses relative path with anchor', () => {
    const result = parseFieldNotesLink(
      '.elefant/field-notes/02-tech/foo.md#bar',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(REL_WITH_ANCHOR);
    }
  });

  test('parses relative path with deep nesting', () => {
    const result = parseFieldNotesLink(
      '.elefant/field-notes/03-decisions/nested/arch/adr-0001.md',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.path).toBe('03-decisions/nested/arch/adr-0001.md');
    }
  });

  test('parses relative path with section with hyphens', () => {
    const result = parseFieldNotesLink(
      '.elefant/field-notes/00-index/quick-ref.md',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.path).toBe('00-index/quick-ref.md');
    }
  });

  // ── Rejection: workflow validation ──
  test('rejects empty workflow slug', () => {
    const result = parseFieldNotesLink('fieldnotes:///02-tech/foo.md');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('must not be empty');
    }
  });

  test('rejects non-kebab-case workflow slug', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://Invalid_Slug/02-tech/foo.md',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Invalid workflow slug');
    }
  });

  test('rejects workflow with uppercase', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://Feat-Auth/02-tech/foo.md',
    );
    expect(result.ok).toBe(false);
  });

  test('rejects workflow starting with number', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://2fa-workflow/02-tech/foo.md',
    );
    expect(result.ok).toBe(false);
  });

  test('rejects workflow with special characters', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://feat@auth/02-tech/foo.md',
    );
    expect(result.ok).toBe(false);
  });

  // ── Rejection: path validation ──
  test('rejects empty path in research URI', () => {
    const result = parseFieldNotesLink('fieldnotes://feat-auth/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Path must not be empty');
    }
  });

  test('rejects empty path in relative path', () => {
    const result = parseFieldNotesLink('.elefant/field-notes/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Path must not be empty');
    }
  });

  test('rejects path with .. traversal in research URI', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://feat-auth/../secret/file.md',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('..');
    }
  });

  test('rejects path with .. traversal in relative path', () => {
    const result = parseFieldNotesLink(
      '.elefant/field-notes/../../secret/file.md',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('..');
    }
  });

  test('rejects path starting with / in research URI', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://feat-auth//absolute/path.md',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('start with "/"');
    }
  });

  test('rejects path starting with / in relative path', () => {
    const result = parseFieldNotesLink('.elefant/field-notes//absolute/path.md');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('start with "/"');
    }
  });

  test('rejects path not ending in .md in research URI', () => {
    const result = parseFieldNotesLink('fieldnotes://feat-auth/02-tech/foo.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('end with ".md"');
    }
  });

  test('rejects path not ending in .md in relative path', () => {
    const result = parseFieldNotesLink(
      '.elefant/field-notes/02-tech/foo.json',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('end with ".md"');
    }
  });

  test('rejects missing path in research URI (no / after workflow)', () => {
    const result = parseFieldNotesLink('fieldnotes://feat-auth');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('missing path');
    }
  });

  // ── Rejection: unrecognized format ──
  test('rejects completely unrecognized format', () => {
    const result = parseFieldNotesLink('https://example.com/file.md');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Unrecognized');
    }
  });

  test('rejects non-elefant relative path', () => {
    const result = parseFieldNotesLink('./field-notes/02-tech/foo.md');
    expect(result.ok).toBe(false);
  });

  test('rejects empty string', () => {
    const result = parseFieldNotesLink('');
    expect(result.ok).toBe(false);
  });

  // ── Rejection: anchor validation ──
  test('rejects anchor with spaces', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://feat-auth/02-tech/foo.md#bad anchor',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Invalid anchor');
    }
  });

  test('rejects anchor with special characters', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://feat-auth/02-tech/foo.md#bad!char',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Invalid anchor');
    }
  });

  test('accepts anchor with numbers and hyphens', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://feat-auth/02-tech/foo.md#heading-2-with-123',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.anchor).toBe('heading-2-with-123');
    }
  });

  test('accepts anchor with uppercase letters (GitHub-style)', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://feat-auth/02-tech/foo.md#My-Heading',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.anchor).toBe('My-Heading');
    }
  });

  test('accepts empty anchor (just #)', () => {
    const result = parseFieldNotesLink(
      'fieldnotes://feat-auth/02-tech/foo.md#',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.anchor).toBe('');
    }
  });
});

// ─── serializeFieldNotesLink ─────────────────────────────────────────────────

describe('serializeFieldNotesLink', () => {
  test('serializes research URI without anchor', () => {
    expect(serializeFieldNotesLink(URI_SIMPLE)).toBe(
      'fieldnotes://feat-auth/02-tech/oauth.md',
    );
  });

  test('serializes research URI with anchor', () => {
    expect(serializeFieldNotesLink(URI_WITH_ANCHOR)).toBe(
      'fieldnotes://feat-auth/02-tech/oauth.md#bearer-tokens',
    );
  });

  test('serializes project-wide research URI', () => {
    expect(serializeFieldNotesLink(URI_PROJECT_WIDE)).toBe(
      'fieldnotes://_/04-comparisons/vector-stores.md',
    );
  });

  test('serializes relative path without anchor', () => {
    expect(serializeFieldNotesLink(REL_SIMPLE)).toBe(
      '.elefant/field-notes/02-tech/foo.md',
    );
  });

  test('serializes relative path with anchor', () => {
    expect(serializeFieldNotesLink(REL_WITH_ANCHOR)).toBe(
      '.elefant/field-notes/02-tech/foo.md#bar',
    );
  });

  test('does not append # for null anchor', () => {
    const link: ResearchLink = {
      kind: 'fieldnotes-uri',
      workflow: 'feat',
      path: '99-scratch/test.md',
      anchor: null,
    };
    const serialized = serializeFieldNotesLink(link);
    expect(serialized).not.toContain('#');
    expect(serialized).toBe('fieldnotes://feat/99-scratch/test.md');
  });

  test('does not append # for empty string anchor', () => {
    const link: ResearchLink = {
      kind: 'fieldnotes-uri',
      workflow: 'feat',
      path: '99-scratch/test.md',
      anchor: '',
    };
    const serialized = serializeFieldNotesLink(link);
    expect(serialized).not.toContain('#');
  });

  // ── Round-trip tests ──
  test('round-trips research URI without anchor', () => {
    const input = 'fieldnotes://feat-auth/02-tech/oauth.md';
    const parsed = parseFieldNotesLink(input);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializeFieldNotesLink(parsed.data)).toBe(input);
    }
  });

  test('round-trips research URI with anchor', () => {
    const input = 'fieldnotes://feat-auth/02-tech/oauth.md#bearer-tokens';
    const parsed = parseFieldNotesLink(input);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializeFieldNotesLink(parsed.data)).toBe(input);
    }
  });

  test('round-trips project-wide URI', () => {
    const input = 'fieldnotes://_/04-comparisons/vector-stores.md';
    const parsed = parseFieldNotesLink(input);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializeFieldNotesLink(parsed.data)).toBe(input);
    }
  });

  test('round-trips relative path without anchor', () => {
    const input = '.elefant/field-notes/02-tech/foo.md';
    const parsed = parseFieldNotesLink(input);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializeFieldNotesLink(parsed.data)).toBe(input);
    }
  });

  test('round-trips relative path with anchor', () => {
    const input = '.elefant/field-notes/02-tech/foo.md#bar';
    const parsed = parseFieldNotesLink(input);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializeFieldNotesLink(parsed.data)).toBe(input);
    }
  });

  test('round-trips canonical input through parse → serialize → parse → serialize', () => {
    const input = 'fieldnotes://feat-auth/02-tech/oauth.md#bearer-tokens';
    const p1 = parseFieldNotesLink(input);
    expect(p1.ok).toBe(true);
    if (!p1.ok) throw new Error('unexpected');

    const s1 = serializeFieldNotesLink(p1.data);
    const p2 = parseFieldNotesLink(s1);
    expect(p2.ok).toBe(true);
    if (!p2.ok) throw new Error('unexpected');

    const s2 = serializeFieldNotesLink(p2.data);
    expect(s2).toBe(s1);
  });

  test('serializes deep nested path correctly', () => {
    const link: ResearchLink = {
      kind: 'fieldnotes-uri',
      workflow: 'feat-auth',
      path: '02-tech/nested/deep/file.md',
      anchor: null,
    };
    expect(serializeFieldNotesLink(link)).toBe(
      'fieldnotes://feat-auth/02-tech/nested/deep/file.md',
    );
  });
});

// ─── FIELD_NOTES_LINK_REGEX ────────────────────────────────────────────────────

describe('FIELD_NOTES_LINK_REGEX', () => {
  test('matches fieldnotes:// URI', () => {
    const text = 'See fieldnotes://feat-auth/02-tech/oauth.md for details.';
    const matches = [...text.matchAll(FIELD_NOTES_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe('fieldnotes://feat-auth/02-tech/oauth.md');
  });

  test('matches fieldnotes:// URI with anchor', () => {
    const text = 'See fieldnotes://feat-auth/02-tech/oauth.md#bearer-tokens for details.';
    const matches = [...text.matchAll(FIELD_NOTES_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe(
      'fieldnotes://feat-auth/02-tech/oauth.md#bearer-tokens',
    );
  });

  test('matches relative path', () => {
    const text = 'Check .elefant/field-notes/02-tech/foo.md for ref.';
    const matches = [...text.matchAll(FIELD_NOTES_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe('.elefant/field-notes/02-tech/foo.md');
  });

  test('matches relative path with anchor', () => {
    const text = 'See .elefant/field-notes/02-tech/foo.md#bar.';
    const matches = [...text.matchAll(FIELD_NOTES_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe('.elefant/field-notes/02-tech/foo.md#bar');
  });

  test('matches multiple links in one string', () => {
    const text =
      'See fieldnotes://a/01-domain/x.md and .elefant/field-notes/02-tech/y.md#section.';
    const matches = [...text.matchAll(FIELD_NOTES_LINK_REGEX)];
    expect(matches).toHaveLength(2);
    expect(matches[0][0]).toBe('fieldnotes://a/01-domain/x.md');
    expect(matches[1][0]).toBe('.elefant/field-notes/02-tech/y.md#section');
  });

  test('does not match non-research URLs', () => {
    const text = 'See https://example.com/file.md for details.';
    const matches = [...text.matchAll(FIELD_NOTES_LINK_REGEX)];
    expect(matches).toHaveLength(0);
  });

  test('does not match non-elefant relative paths', () => {
    const text = 'See ./field-notes/02-tech/foo.md.';
    const matches = [...text.matchAll(FIELD_NOTES_LINK_REGEX)];
    expect(matches).toHaveLength(0);
  });

  test('matches research link in parentheses', () => {
    const text = '(see fieldnotes://feat-auth/02-tech/oauth.md)';
    const matches = [...text.matchAll(FIELD_NOTES_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    // The regex excludes `)` from the match
    expect(matches[0][0]).toBe('fieldnotes://feat-auth/02-tech/oauth.md');
  });

  test('matches research link in brackets', () => {
    const text = '[fieldnotes://feat-auth/02-tech/oauth.md]';
    const matches = [...text.matchAll(FIELD_NOTES_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe('fieldnotes://feat-auth/02-tech/oauth.md');
  });

  test('matches project-wide research link', () => {
    const text = 'Global ref: fieldnotes://_/06-synthesis/master.md';
    const matches = [...text.matchAll(FIELD_NOTES_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe('fieldnotes://_/06-synthesis/master.md');
  });

  test('matches workflow with underscores', () => {
    const text = 'See fieldnotes://feat_auth_v2/02-tech/oauth.md.';
    const matches = [...text.matchAll(FIELD_NOTES_LINK_REGEX)];
    expect(matches).toHaveLength(1);
    // REGEX allows underscores, but parseFieldNotesLink would reject non-kebab
    // That's intentional — regex is lenient, parser is strict
    expect(matches[0][0]).toBe('fieldnotes://feat_auth_v2/02-tech/oauth.md');
  });

  test('is safe to use for matchAll on empty string', () => {
    const matches = [...''.matchAll(FIELD_NOTES_LINK_REGEX)];
    expect(matches).toHaveLength(0);
  });
});
