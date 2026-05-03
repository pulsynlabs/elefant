// Client-side slash-command parser.
//
// Centralises intercept matching so ChatView.handleSend stays readable.
// All rules are pure — easy to unit-test in isolation.
//
// Commands:
//   /undo, /redo, /back — exact trimmed match, no arguments
//   /btw <body>          — requires non-empty body after the trigger
//
// Anything that doesn't match (e.g. /btweet, "tell me about /btw") is
// treated as normal text and forwarded to the daemon unmodified.

export type SlashCommand = 'btw' | 'back' | 'undo' | 'redo';

export function parseSlashCommand(content: string): { command: SlashCommand | null; body: string } {
  const trimmed = content.trim();

  // Exact matches for no-arg commands
  if (trimmed === '/undo') return { command: 'undo', body: '' };
  if (trimmed === '/redo') return { command: 'redo', body: '' };
  if (trimmed === '/back') return { command: 'back', body: '' };

  // /btw requires non-empty body after the trigger
  if (trimmed.startsWith('/btw ')) {
    const body = trimmed.slice(5).trim();
    if (body.length > 0) {
      return { command: 'btw', body };
    }
  }

  // Everything else is not a command
  return { command: null, body: content };
}
