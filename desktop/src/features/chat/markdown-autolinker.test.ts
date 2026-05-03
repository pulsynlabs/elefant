/**
 * Tests for the chat markdown autolinker.
 *
 * Covers both stages: source-level wrapping (autoLinkResearchRefs) and
 * HTML-level chip injection (injectResearchChips), plus the regex
 * round-trip with the daemon-side parser.
 */

import { describe, expect, it } from 'bun:test';
import {
	autoLinkResearchRefs,
	containsResearchLink,
	injectResearchChips,
	RESEARCH_LINK_REGEX,
} from './markdown-autolinker.js';
import { parseResearchLink } from '../../../../src/research/link.js';

describe('RESEARCH_LINK_REGEX — parity with daemon-side parser', () => {
	// The desktop bundle inlines the regex; this test pins the
	// invariant that every match is also a parser-valid link.
	const samples = [
		'research://feat-auth/02-tech/jose.md',
		'research://feat-auth/02-tech/jose.md#expiry',
		'research://_/05-misc/notes.md',
		'.elefant/markdown-db/02-tech/jose.md',
		'.elefant/markdown-db/02-tech/jose.md#refresh-tokens',
	];

	for (const uri of samples) {
		it(`recognizes and parses: ${uri}`, () => {
			const matches = uri.match(new RegExp(RESEARCH_LINK_REGEX.source));
			expect(matches?.[0]).toBe(uri);
			const parsed = parseResearchLink(uri);
			expect(parsed.ok).toBe(true);
		});
	}
});

describe('containsResearchLink', () => {
	it('returns true when the text contains a research:// URI', () => {
		expect(containsResearchLink('see research://feat-x/01-arch/foo.md')).toBe(
			true,
		);
	});

	it('returns true when the text contains an .elefant/markdown-db path', () => {
		expect(containsResearchLink('see .elefant/markdown-db/02-tech/foo.md')).toBe(
			true,
		);
	});

	it('returns false for plain prose', () => {
		expect(containsResearchLink('just a normal sentence with no link')).toBe(
			false,
		);
	});

	it('returns false on an empty string', () => {
		expect(containsResearchLink('')).toBe(false);
	});
});

describe('autoLinkResearchRefs — stage 1 (source rewrite)', () => {
	it('wraps a bare research:// URI in [uri](uri)', () => {
		const out = autoLinkResearchRefs('see research://feat/02-tech/x.md please');
		expect(out).toBe(
			'see [research://feat/02-tech/x.md](research://feat/02-tech/x.md) please',
		);
	});

	it('wraps a bare .elefant/markdown-db path', () => {
		const out = autoLinkResearchRefs('see .elefant/markdown-db/02-tech/x.md ok');
		expect(out).toBe(
			'see [.elefant/markdown-db/02-tech/x.md](.elefant/markdown-db/02-tech/x.md) ok',
		);
	});

	it('preserves the #anchor on a wrapped URI', () => {
		const out = autoLinkResearchRefs('see research://feat/02-tech/x.md#sec ok');
		expect(out).toBe(
			'see [research://feat/02-tech/x.md#sec](research://feat/02-tech/x.md#sec) ok',
		);
	});

	it('does not wrap a link that is already inside [label](href)', () => {
		const input = 'see [the doc](research://feat/02-tech/x.md) for context';
		expect(autoLinkResearchRefs(input)).toBe(input);
	});

	it('leaves URIs inside fenced code blocks untouched', () => {
		const input =
			'before\n```\nresearch://feat/02-tech/x.md\n```\nafter';
		expect(autoLinkResearchRefs(input)).toBe(input);
	});

	it('leaves URIs inside inline code untouched', () => {
		const input = 'use `research://feat/02-tech/x.md` literally';
		expect(autoLinkResearchRefs(input)).toBe(input);
	});

	it('handles multiple bare links in one string', () => {
		const out = autoLinkResearchRefs(
			'one research://a/02-tech/x.md and two .elefant/markdown-db/02-tech/y.md',
		);
		expect(out).toBe(
			'one [research://a/02-tech/x.md](research://a/02-tech/x.md) and two [.elefant/markdown-db/02-tech/y.md](.elefant/markdown-db/02-tech/y.md)',
		);
	});

	it('is idempotent — running twice does not double-wrap', () => {
		const input = 'see research://feat/02-tech/x.md';
		const once = autoLinkResearchRefs(input);
		const twice = autoLinkResearchRefs(once);
		expect(twice).toBe(once);
	});

	it('is a no-op when there are no links', () => {
		const input = 'just some prose with no references';
		expect(autoLinkResearchRefs(input)).toBe(input);
	});

	it('returns the input unchanged for an empty string', () => {
		expect(autoLinkResearchRefs('')).toBe('');
	});

	it('does not wrap a link inside a code fence even if other prose has one', () => {
		const input =
			'wrap me research://feat/02-tech/a.md\n```\nleave research://feat/02-tech/b.md\n```\n';
		const out = autoLinkResearchRefs(input);
		// First link wrapped, second untouched inside the fence.
		expect(out).toContain(
			'[research://feat/02-tech/a.md](research://feat/02-tech/a.md)',
		);
		expect(out).toContain('```\nleave research://feat/02-tech/b.md\n```');
	});
});

describe('injectResearchChips — stage 2 (HTML rewrite)', () => {
	it('rewrites a research:// anchor into a chip with data-research-uri', () => {
		const html =
			'<a href="research://feat/02-tech/x.md">research://feat/02-tech/x.md</a>';
		const out = injectResearchChips(html);
		expect(out).toContain('class="research-chip"');
		expect(out).toContain('data-research-uri="research://feat/02-tech/x.md"');
		expect(out).toContain('href="#"');
	});

	it('preserves the visible label', () => {
		const html = '<a href="research://feat/02-tech/x.md">read this</a>';
		const out = injectResearchChips(html);
		expect(out).toContain('>read this</a>');
	});

	it('strips target and rel attributes that the markdown renderer adds', () => {
		const html =
			'<a href="research://feat/02-tech/x.md" target="_blank" rel="noopener noreferrer">x</a>';
		const out = injectResearchChips(html);
		expect(out).not.toContain('target=');
		expect(out).not.toContain('rel=');
		expect(out).toContain('class="research-chip"');
	});

	it('leaves non-research anchors alone', () => {
		const html = '<a href="https://example.com">click</a>';
		expect(injectResearchChips(html)).toBe(html);
	});

	it('escapes attribute values to avoid HTML injection', () => {
		// The matcher only accepts research:// or .elefant paths so a
		// malicious href can't even reach this branch — but as a
		// defence in depth we still escape `&` and `"` in attributes.
		const html = '<a href=".elefant/markdown-db/02-tech/x.md">label</a>';
		const out = injectResearchChips(html);
		expect(out).toContain(
			'data-research-uri=".elefant/markdown-db/02-tech/x.md"',
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
			'<a href="research://feat/02-tech/x.md"><script>bad</script></a>';
		const out = injectResearchChips(html);
		expect(out).toBe(html);
	});

	it('escapes ampersand and angle brackets in plain-text labels', () => {
		const html =
			'<a href="research://feat/02-tech/x.md">&lt;ok&gt; &amp; fine</a>';
		const out = injectResearchChips(html);
		// The label arrives already-escaped from the markdown renderer.
		// Our escape pass should re-escape the literal `&` so the
		// output still parses cleanly when re-rendered.
		expect(out).toContain('class="research-chip"');
		expect(out).toContain('&amp;lt;ok&amp;gt;');
	});

	it('handles single-quoted attributes', () => {
		const html =
			"<a href='research://feat/02-tech/x.md'>x</a>";
		const out = injectResearchChips(html);
		expect(out).toContain('class="research-chip"');
		expect(out).toContain('data-research-uri="research://feat/02-tech/x.md"');
	});

	it('rewrites multiple chips in one string', () => {
		const html =
			'<a href="research://a/02-tech/x.md">x</a> and <a href="research://b/02-tech/y.md">y</a>';
		const out = injectResearchChips(html);
		expect(
			(out.match(/class="research-chip"/g) ?? []).length,
		).toBe(2);
	});

	it('returns empty string unchanged', () => {
		expect(injectResearchChips('')).toBe('');
	});
});
