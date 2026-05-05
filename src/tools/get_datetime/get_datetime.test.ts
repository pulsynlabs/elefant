/**
 * Unit tests for the get_datetime tool.
 */

import { describe, it, expect } from 'bun:test';
import { getDatetimeTool } from './index.js';

describe('getDatetimeTool', () => {
  /* ──────────── Test 1: No-args call — format check ──────────── */

  it('returns a formatted UTC datetime when called with no arguments', async () => {
    const result = await getDatetimeTool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC[+-]\d+(:\d{2})? \(\w+\)$/,
      );
    }
  });

  /* ────── Test 2: Valid timezone — America/New_York ────── */

  it('returns local time when given a valid IANA timezone', async () => {
    const result = await getDatetimeTool.execute({
      timezone: 'America/New_York',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Output must end with the timezone name in brackets
      expect(result.data).toEndWith('[America/New_York]');

      // UTC offset must be UTC-4 or UTC-5 (DST-aware — don't hardcode one)
      const hasExpectedOffset =
        result.data.includes('UTC-4') || result.data.includes('UTC-5');
      expect(hasExpectedOffset).toBe(true);

      // Day-of-week must be present
      expect(result.data).toMatch(/\([A-Z][a-z]+day\)/);
    }
  });

  /* ──────────── Test 3: Invalid timezone — error string ──────────── */

  it('returns an error string for an invalid timezone', async () => {
    const result = await getDatetimeTool.execute({
      timezone: 'Mars/Olympus',
    });

    // The tool wraps the error message in ok(), not err() —
    // invalid user input is not a system error.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('Unknown timezone');
      expect(result.data).toContain('IANA');
      expect(result.data).toContain("Mars/Olympus");
    }
  });

  /* ──────────── Test 4: Half-hour zone — Asia/Kolkata ──────────── */

  it('returns the correct half-hour UTC offset for Asia/Kolkata', async () => {
    const result = await getDatetimeTool.execute({
      timezone: 'Asia/Kolkata',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Asia/Kolkata is always UTC+5:30 — no DST
      expect(result.data).toContain('UTC+5:30');
      expect(result.data).toEndWith('[Asia/Kolkata]');
    }
  });
});
