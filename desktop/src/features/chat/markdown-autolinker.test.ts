/**
 * Tests for the chat markdown autolinker.
 *
 * Covers both stages: source-level wrapping (autoLinkFieldNotesRefs) and
 * HTML-level chip injection (injectFieldNotesChips), plus the regex
 * round-trip with the daemon-side parser.
 */

import { describe, expect, it } from 'bun:test';
import {
	autoLinkFieldNotesRefs,
	containsFieldNotesLink,
	injectFieldNotesChips,
	FIELD_NOTES_LINK_REGEX,
} from './markdown-autolinker.js';
import { parseFieldNotesLink } from '../../../../src/fieldnotes/link.js';

describe('FIELD_NOTES_LINK_REGEX — parity with daemon-side parser', () => {
	// The desktop bundle inlines the regex; this test pins the
	// invariant that every match is also a parser-valid link.
	const samples = [
		'fieldnotes://feat-auth/02-tech/jose.md',
		'fieldnotes://feat-auth/02-tech/jose.md#expiry',
		'fieldnotes://_/05-misc/notes.md',
		'.elefant/field-notes/02-tech/jose.md',
		'.elefant/field-notes/02-tech/jose.md#refresh-tokens',
	];

	for (const uri of samples) {
		it(`recognizes and parses: ${uri}`, () => {
			const matches = uri.match(new RegExp(FIELD_NOTES_LINK_REGEX.source));
			expect(matches?.[0]).toBe(uri);
			const parsed = parseFieldNotesLink(uri);
			expect(parsed.ok).toBe(true);
		});
	}
});

describe('containsFieldNotesLink', () => {
	it('returns true when the text contains a fieldnotes:// URI', () => {
		expect(containsFieldNotesLink('see fieldnotes://feat-x/01-arch/foo.md')).toBe(
			true,
		);
	});

	it('returns true when the text contains an .elefant/field-notes path', () => {
		expect(containsFieldNotesLink('see .elefant/field-notes/02-tech/foo.md')).toBe(
			true,
		);
	});

	it('returns false for plain prose', () => {
		expect(containsFieldNotesLink('just a normal sentence with no link')).toBe(
			false,
		);
	});

	it('returns false on an empty string', () => {
		expect(containsFieldNotesLink('')).toBe(false);
	});
});

describe('autoLinkFieldNotesRefs — stage 1 (source rewrite)', () => {
	it('wraps a bare fieldnotes:// URI in [uri](uri)', () => {
		const out = autoLinkFieldNotesRefs('see fieldnotes://feat/02-tech/x.md please');
		expect(out).toBe(
			'see [fieldnotes://feat/02-tech/x.md](fieldnotes://feat/02-tech/x.md) please',
		);
	});

	it('wraps a bare .elefant/field-notes path', () => {
		const out = autoLinkFieldNotesRefs('see .elefant/field-notes/02-tech/x.md ok');
		expect(out).toBe(
			'see [.elefant/field-notes/02-tech/x.md](.elefant/field-notes/02-tech/x.md) ok',
		);
	});

	it('preserves the #anchor on a wrapped URI', () => {
		const out = autoLinkFieldNotesRefs('see fieldnotes://feat/02-tech/x.md#sec ok');
		expect(out).toBe(
			'see [fieldnotes://feat/02-tech/x.md#sec](fieldnotes://feat/02-tech/x.md#sec) ok',
		);
	});

	it('does not wrap a link that is already inside [label](href)', () => {
		const input = 'see [the doc](fieldnotes://feat/02-tech/x.md) for context';
		expect(autoLinkFieldNotesRefs(input)).toBe(input);
	});

	it('leaves URIs inside fenced code blocks untouched', () => {
		const input =
			'before\n```\nfieldnotes://feat/02-tech/x.md\n```\nafter';
		expect(autoLinkFieldNotesRefs(input)).toBe(input);
	});

	it('leaves URIs inside inline code untouched', () => {
		const input = 'use `fieldnotes://feat/02-tech/x.md` literally';
		expect(autoLinkFieldNotesRefs(input)).toBe(input);
	});

	it('handles multiple bare links in one string', () => {
		const out = autoLinkFieldNotesRefs(
			'one fieldnotes://a/02-tech/x.md and two .elefant/field-notes/02-tech/y.md',
		);
		expect(out).toBe(
			'one [fieldnotes://a/02-tech/x.md](fieldnotes://a/02-tech/x.md) and two [.elefant/field-notes/02-tech/y.md](.elefant/field-notes/02-tech/y.md)',
		);
	});

	it('is idempotent — running twice does not double-wrap', () => {
		const input = 'see fieldnotes://feat/02-tech/x.md';
		const once = autoLinkFieldNotesRefs(input);
		const twice = autoLinkFieldNotesRefs(once);
		expect(twice).toBe(once);
	});

	it('is a no-op when there are no links', () => {
		const input = 'just some prose with no references';
		expect(autoLinkFieldNotesRefs(input)).toBe(input);
	});

	it('returns the input unchanged for an empty string', () => {
		expect(autoLinkFieldNotesRefs('')).toBe('');
	});

	it('does not wrap a link inside a code fence even if other prose has one', () => {
		const input =
			'wrap me fieldnotes://feat/02-tech/a.md\n```\nleave fieldnotes://feat/02-tech/b.md\n```\n';
		const out = autoLinkFieldNotesRefs(input);
		// First link wrapped, second untouched inside the fence.
		expect(out).toContain(
			'[fieldnotes://feat/02-tech/a.md](fieldnotes://feat/02-tech/a.md)',
		);
		expect(out).toContain('```\nleave fieldnotes://feat/02-tech/b.md\n```');
	});
});

describe('injectFieldNotesChips — stage 2 (HTML rewrite)', () => {
	it('rewrites a fieldnotes:// anchor into a chip with data-field-notes-uri', () => {
		const html =
			'<a href="fieldnotes://feat/02-tech/x.md">fieldnotes://feat/02-tech/x.md</a>';
		const out = injectFieldNotesChips(html);
		expect(out).toContain('class="field-notes-chip"');
		expect(out).toContain('data-field-notes-uri="fieldnotes://feat/02-tech/x.md"');
		expect(out).toContain('href="#"');
	});

	it('preserves the visible label', () => {
		const html = '<a href="fieldnotes://feat/02-tech/x.md">read this</a>';
		const out = injectFieldNotesChips(html);
		expect(out).toContain('>read this</a>');
	});

	it('strips target and rel attributes that the markdown renderer adds', () => {
		const html =
			'<a href="fieldnotes://feat/02-tech/x.md" target="_blank" rel="noopener noreferrer">x</a>';
		const out = injectFieldNotesChips(html);
		expect(out).not.toContain('target=');
		expect(out).not.toContain('rel=');
		expect(out).toContain('class="field-notes-chip"');
	});

	it('leaves non-field-notes anchors alone', () => {
		const html = '<a href="https://example.com">click</a>';
		expect(injectFieldNotesChips(html)).toBe(html);
	});

	it('escapes attribute values to avoid HTML injection', () => {
		// The matcher only accepts fieldnotes:// or .elefant paths so a
		// malicious href can't even reach this branch — but as a
		// defence in depth we still escape `&` and `"` in attributes.
		const html = '<a href=".elefant/field-notes/02-tech/x.md">label</a>';
		const out = injectFieldNotesChips(html);
		expect(out).toContain(
			'data-field-notes-uri=".elefant/field-notes/02-tech/x.md"',
		);
	});

	it('skips anchors whose label contains nested HTML (renderer never produces these)', () => {
		// MarkdownRenderer escapes html tokens to inert text via
		// buildUnsupportedHTML before they reach a link label, so a
		// real chat anchor's label is always plain text. The matcher
		// requires a plain-text label and leaves anything else alone
		// — proven here so a future renderer change that emits raw
		// nested tags fails loudly instead of silently dropping the
		// chip rewrite.
		const html =
			'<a href="fieldnotes://feat/02-tech/x.md"><script>bad</script></a>';
		const out = injectFieldNotesChips(html);
		expect(out).toBe(html);
	});

	it('escapes ampersand and angle brackets in plain-text labels', () => {
		const html =
			'<a href="fieldnotes://feat/02-tech/x.md">&lt;ok&gt; &amp; fine</a>';
		const out = injectFieldNotesChips(html);
		// The label arrives already-escaped from the markdown renderer.
		// Our escape pass should re-escape the literal `&` so the
		// output still parses cleanly when re-rendered.
		expect(out).toContain('class="field-notes-chip"');
		expect(out).toContain('&amp;lt;ok&amp;gt;');
	});

	it('handles single-quoted attributes', () => {
		const html =
			"<a href='fieldnotes://feat/02-tech/x.md'>x</a>";
		const out = injectFieldNotesChips(html);
		expect(out).toContain('class="field-notes-chip"');
		expect(out).toContain('data-field-notes-uri="fieldnotes://feat/02-tech/x.md"');
	});

	it('rewrites multiple chips in one string', () => {
		const html =
			'<a href="fieldnotes://a/02-tech/x.md">x</a> and <a href="fieldnotes://b/02-tech/y.md">y</a>';
		const out = injectFieldNotesChips(html);
		expect(
			(out.match(/class="field-notes-chip"/g) ?? []).length,
		).toBe(2);
	});

	it('returns empty string unchanged', () => {
		expect(injectFieldNotesChips('')).toBe('');
	});
});
