import type { Highlighter, BundledLanguage } from 'shiki';

let highlighter: Highlighter | null = null;
let initPromise: Promise<Highlighter> | null = null;

const SUPPORTED_LANGUAGES: BundledLanguage[] = [
	'typescript',
	'javascript',
	'python',
	'rust',
	'json',
	'bash',
	'shell',
	'html',
	'css',
	'markdown',
	'yaml',
	'go',
	'java',
	'cpp',
	'c',
	'sql',
	'toml',
	'svelte',
];

export async function getHighlighter(): Promise<Highlighter> {
	if (highlighter) return highlighter;

	if (initPromise) return initPromise;

	initPromise = (async () => {
		const { createHighlighter } = await import('shiki');
		highlighter = await createHighlighter({
			langs: SUPPORTED_LANGUAGES,
			themes: ['github-dark', 'github-light'],
		});
		return highlighter;
	})();

	return initPromise;
}

export async function highlight(code: string, language: string, isDark: boolean): Promise<string> {
	try {
		const hl = await getHighlighter();
		const theme = isDark ? 'github-dark' : 'github-light';
		const lang = SUPPORTED_LANGUAGES.includes(language as BundledLanguage)
			? (language as BundledLanguage)
			: 'text';

		return hl.codeToHtml(code, { lang, theme });
	} catch {
		// Fallback: return escaped plain text
		return `<pre><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
	}
}
