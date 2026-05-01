// Spec Mode — client-side prompt optimizer.
//
// Wraps a user's raw vision text into a structured, agent-friendly prompt
// using deterministic heuristics. This runs entirely on the client: no
// network, no daemon, no store mutations. It exists so the user can take
// a quick napkin sketch ("add dark mode toggle") and get a more
// architecturally framed brief before sending it into Spec Mode discovery.
//
// The function is async to leave room for a future async backend
// (e.g. an LLM-assisted rewrite) without breaking call sites.

const MIN_LENGTH_FOR_OPTIMIZATION = 20;

// Sentinel header used to detect already-optimized text. If a caller pipes
// the output back into optimizePrompt, we return it unchanged rather than
// re-wrapping. Keeps the function idempotent.
const OPTIMIZED_HEADER = 'You are a senior software architect and product engineer.';

const UI_KEYWORDS = ['ui', 'component', 'button', 'form', 'modal', 'page'] as const;
const BACKEND_KEYWORDS = [
	'api',
	'endpoint',
	'backend',
	'database',
	'server',
] as const;
const BUG_KEYWORDS = ['fix', 'bug', 'broken', 'error', 'issue'] as const;

const UI_FRAMING =
	'This appears to be a UI task. Consider accessibility, responsive design, and existing design system patterns.';
const BACKEND_FRAMING =
	'This appears to be a backend task. Consider security, error handling, and data validation.';
const BUG_FRAMING =
	'This appears to be a bug fix. Consider root cause analysis before patching.';

/**
 * Collapse runs of 2+ blank lines down to a single blank line, and trim
 * leading/trailing whitespace from the whole string. Preserves intentional
 * single blank lines (paragraph breaks).
 */
function normalizeWhitespace(text: string): string {
	return text
		.replace(/\r\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Word-boundary, case-insensitive match. Avoids substring false positives
 * (e.g. "buttons" matching "button" is fine, but "abutton" should not).
 */
function containsWord(haystack: string, needle: string): boolean {
	const pattern = new RegExp(`\\b${needle}\\b`, 'i');
	return pattern.test(haystack);
}

function pickHeuristicFraming(text: string): string | null {
	if (UI_KEYWORDS.some((word) => containsWord(text, word))) {
		return UI_FRAMING;
	}
	if (BACKEND_KEYWORDS.some((word) => containsWord(text, word))) {
		return BACKEND_FRAMING;
	}
	if (BUG_KEYWORDS.some((word) => containsWord(text, word))) {
		return BUG_FRAMING;
	}
	return null;
}

/**
 * Transform user-provided vision text into a structured, agent-friendly prompt.
 *
 * This is a pure client-side transformation — no network calls, no daemon.
 * It uses heuristics to add structure and framing around the user's intent.
 *
 * Returns the original text unchanged if input is < 20 characters (after trim),
 * since short fragments don't benefit from architectural framing and shouldn't
 * be padded with boilerplate.
 *
 * @param text Raw user vision text.
 * @returns A structured prompt, or the original text if too short.
 */
export async function optimizePrompt(text: string): Promise<string> {
	if (text.trim().length < MIN_LENGTH_FOR_OPTIMIZATION) {
		return text;
	}

	// Idempotency: don't re-wrap an already-optimized prompt.
	if (text.trimStart().startsWith(OPTIMIZED_HEADER)) {
		return text;
	}

	const goal = normalizeWhitespace(text);
	const heuristic = pickHeuristicFraming(goal);

	const sections: string[] = [
		OPTIMIZED_HEADER,
		'',
		'## Goal',
		goal,
		'',
		'## What I\'m asking for',
		'Based on the above, help me build this systematically. Please:',
		'- Understand the core problem being solved',
		'- Identify the key components needed',
		'- Consider edge cases and failure modes',
		'- Ask clarifying questions before diving into implementation',
		'',
		'## Context',
		'This is a new development task. Approach it methodically: spec first, then plan, then implement.',
	];

	if (heuristic) {
		sections.push('', heuristic);
	}

	return sections.join('\n');
}
