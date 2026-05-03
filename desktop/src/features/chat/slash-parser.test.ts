import { describe, expect, it } from 'bun:test';
import { parseSlashCommand, type SlashCommand } from './slash-parser.js';

describe('parseSlashCommand', () => {
  // ── /btw with body ────────────────────────────────────────
  describe('/btw with body', () => {
    it('parses "/btw hello" as btw command with body "hello"', () => {
      const result = parseSlashCommand('/btw hello');
      expect(result.command).toBe('btw');
      expect(result.body).toBe('hello');
    });

    it('trims whitespace around "/btw" and the body', () => {
      const result = parseSlashCommand('  /btw  hello  ');
      expect(result.command).toBe('btw');
      expect(result.body).toBe('hello');
    });

    it('handles multi-word body after /btw', () => {
      const result = parseSlashCommand('/btw what does this function do?');
      expect(result.command).toBe('btw');
      expect(result.body).toBe('what does this function do?');
    });

    it('handles body with only whitespace after trigger', () => {
      const result = parseSlashCommand('/btw          more text');
      expect(result.command).toBe('btw');
      expect(result.body).toBe('more text');
    });
  });

  // ── /btw without body ─────────────────────────────────────
  describe('/btw without body', () => {
    it('returns null for bare "/btw" with no body', () => {
      const result = parseSlashCommand('/btw');
      expect(result.command).toBeNull();
      expect(result.body).toBe('/btw');
    });

    it('returns null for "/btw " with trailing space but no body', () => {
      const result = parseSlashCommand('/btw ');
      expect(result.command).toBeNull();
      expect(result.body).toBe('/btw ');
    });

    it('returns null for "/btw" with only whitespace after trigger', () => {
      const result = parseSlashCommand('/btw   ');
      expect(result.command).toBeNull();
      expect(result.body).toBe('/btw   ');
    });

    it('returns null for "/btw" followed by newline (no body)', () => {
      const result = parseSlashCommand('/btw \n');
      expect(result.command).toBeNull();
      expect(result.body).toBe('/btw \n');
    });
  });

  // ── /btw not matched as prefix of other text ───────────────
  describe('non-matching /btw-like text', () => {
    it('does not match "/btweet" as a command', () => {
      const result = parseSlashCommand('/btweet');
      expect(result.command).toBeNull();
      expect(result.body).toBe('/btweet');
    });

    it('does not match "tell me about /btw" as a command', () => {
      const result = parseSlashCommand('tell me about /btw');
      expect(result.command).toBeNull();
      expect(result.body).toBe('tell me about /btw');
    });

    it('does not match "/btwfoo bar" as a command', () => {
      const result = parseSlashCommand('/btwfoo bar');
      expect(result.command).toBeNull();
      expect(result.body).toBe('/btwfoo bar');
    });

    it('does not match "  /btweet  " with surrounding whitespace', () => {
      const result = parseSlashCommand('  /btweet  ');
      expect(result.command).toBeNull();
      expect(result.body).toBe('  /btweet  ');
    });
  });

  // ── Exact no-arg commands ──────────────────────────────────
  describe('exact no-arg commands', () => {
    it('matches "/back" as back command', () => {
      const result = parseSlashCommand('/back');
      expect(result.command).toBe('back');
      expect(result.body).toBe('');
    });

    it('matches "/back" with surrounding whitespace', () => {
      const result = parseSlashCommand('  /back  ');
      expect(result.command).toBe('back');
      expect(result.body).toBe('');
    });

    it('matches "/undo" as undo command', () => {
      const result = parseSlashCommand('/undo');
      expect(result.command).toBe('undo');
      expect(result.body).toBe('');
    });

    it('matches "/undo" with surrounding whitespace', () => {
      const result = parseSlashCommand('  /undo  ');
      expect(result.command).toBe('undo');
      expect(result.body).toBe('');
    });

    it('matches "/redo" as redo command', () => {
      const result = parseSlashCommand('/redo');
      expect(result.command).toBe('redo');
      expect(result.body).toBe('');
    });

    it('does NOT match "/undo something" — only exact match', () => {
      const result = parseSlashCommand('/undo something');
      expect(result.command).toBeNull();
      expect(result.body).toBe('/undo something');
    });

    it('does NOT match "/back home" — only exact match', () => {
      const result = parseSlashCommand('/back home');
      expect(result.command).toBeNull();
      expect(result.body).toBe('/back home');
    });
  });

  // ── Normal text ────────────────────────────────────────────
  describe('normal text (no command)', () => {
    it('returns null for plain text', () => {
      const result = parseSlashCommand('hello world');
      expect(result.command).toBeNull();
      expect(result.body).toBe('hello world');
    });

    it('returns null for empty string', () => {
      const result = parseSlashCommand('');
      expect(result.command).toBeNull();
      expect(result.body).toBe('');
    });

    it('returns null for whitespace-only string', () => {
      const result = parseSlashCommand('   ');
      expect(result.command).toBeNull();
      expect(result.body).toBe('   ');
    });

    it('returns null for forward-slash followed by non-matching text', () => {
      const result = parseSlashCommand('/help');
      expect(result.command).toBeNull();
      expect(result.body).toBe('/help');
    });
  });

  // ── Type narrowing (compile-time check via runtime usage) ──
  describe('type narrowing', () => {
    it('narrows command type for switch/case usage', () => {
      const { command, body } = parseSlashCommand('/btw test');

      // Verify the discriminated union works at runtime
      if (command !== null) {
        // This assertion is redundant but documents the expected type set
        const _validCommands: SlashCommand[] = ['btw', 'back', 'undo', 'redo'];
        expect(_validCommands).toContain(command);
      }
      expect(body).toBe('test');
    });

    it('provides empty body for no-arg commands', () => {
      const { command, body } = parseSlashCommand('/back');
      if (command !== null) {
        expect(body).toBe('');
      }
    });
  });
});
