import type { Message } from '../types/providers.ts';

/**
 * Detects if a string is JSON/code-shaped based on:
 * 1. Starts with `{` or `[` (after trim)
 * 2. OR has >10% density of structural chars: { } [ ] :
 */
function isCodeShaped(content: string): boolean {
	const trimmed = content.trim();

	// Check if starts with { or [
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		return true;
	}

	// Check density of structural characters
	const structuralChars = /[{}\[\]:]/g;
	const matches = content.match(structuralChars);

	if (!matches) {
		return false;
	}

	const density = matches.length / content.length;

	return density > 0.1;
}

/**
 * Estimates token count for a single string.
 * Uses /3 divisor for JSON/code-shaped content, /4 for plain text.
 */
export function estimateStringTokens(content: string): number {
	if (content.length === 0) {
		return 0;
	}

	const divisor = isCodeShaped(content) ? 3 : 4;

	return Math.ceil(content.length / divisor);
}

/**
 * Estimates token count for an array of messages.
 * Concatenates content (JSON.stringify for non-string), applies content-aware estimation per message.
 */
export function estimateMessageTokens(messages: Message[]): number {
	if (messages.length === 0) {
		return 0;
	}

	let totalTokens = 0;

	for (const message of messages) {
		const content =
			typeof message.content === 'string'
				? message.content
				: JSON.stringify(message.content);

		totalTokens += estimateStringTokens(content);
	}

	return totalTokens;
}
