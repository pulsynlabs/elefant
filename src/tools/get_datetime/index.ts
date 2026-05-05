/**
 * get_datetime — return the current system date/time.
 *
 * Optionally accepts an IANA timezone string (e.g. "America/New_York") and
 * returns the local time in that zone with its DST-aware UTC offset.
 * Invalid timezone strings are returned as a user-facing error string
 * wrapped in an ok() result — they are not ElefantErrors.
 */

import type { ToolDefinition } from '../../types/tools.js';
import type { ElefantError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';

export interface GetDatetimeParams {
  timezone?: string;
}

/**
 * Format a Date as an object of string parts for the given IANA timezone.
 * Uses `formatToParts` so we can extract the timeZoneName independently
 * (needed for DST-correct offset computation).
 */
function formatPartsForZone(
  timeZone: string,
  now: Date,
): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'long',
    hour12: false,
    timeZoneName: 'longOffset',
  }).formatToParts(now);

  const result: Record<string, string> = {};
  for (const part of parts) {
    result[part.type] = part.value;
  }
  return result;
}

/**
 * Normalize a "GMT±HH:MM" offset token into the "UTC±H" / "UTC±H:MM" display
 * format required by the spec.
 *
 * Examples:
 *   "GMT"          → "UTC+0"
 *   "GMT-04:00"    → "UTC-4"
 *   "GMT+05:30"    → "UTC+5:30"
 */
function normalizeOffset(gmtOffset: string): string {
  // V8/Bun renders bare "GMT" (no offset digits) for UTC
  if (gmtOffset === 'GMT') return 'UTC+0';

  let offset = gmtOffset.replace(/^GMT/, 'UTC');

  // Strip leading zero from hour: UTC-04 → UTC-4, UTC+05 → UTC+5, UTC+00 → UTC+0
  offset = offset.replace(/(UTC[+-])0(\d)/, '$1$2');

  // Strip trailing ":00" when minutes are zero
  offset = offset.replace(/:00$/, '');

  return offset;
}

export const getDatetimeTool: ToolDefinition<GetDatetimeParams, string> = {
  name: 'get_datetime',
  description:
    'Get the current system date and time. Optionally specify an IANA timezone ' +
    '(e.g. "America/New_York") to get local time with UTC offset.',
  category: 'utility',
  alwaysLoad: true,
  parameters: {
    timezone: {
      type: 'string',
      description:
        'Optional IANA timezone name (e.g. "America/New_York", "Europe/London", ' +
        '"Asia/Tokyo"). If omitted, returns UTC time.',
      required: false,
    },
  },
  execute: async (params): Promise<Result<string, ElefantError>> => {
    const now = new Date();
    const timeZone = params.timezone || 'UTC';

    // Validate timezone — Intl.DateTimeFormat throws on unknown zones
    try {
      Intl.DateTimeFormat(undefined, { timeZone });
    } catch {
      return ok(
        `Error: Unknown timezone '${timeZone}'. Please use an IANA timezone name ` +
          "(e.g., 'America/New_York', 'Europe/London').",
      );
    }

    try {
      const parts = formatPartsForZone(timeZone, now);
      const { year, month, day, hour, minute, second, weekday, timeZoneName } =
        parts;

      const offset = normalizeOffset(timeZoneName);
      const tzSuffix = params.timezone ? ` [${timeZone}]` : '';

      const output = `${year}-${month}-${day} ${hour}:${minute}:${second} ${offset} (${weekday})${tzSuffix}`;
      return ok(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err({
        code: 'TOOL_EXECUTION_FAILED',
        message: `Failed to format datetime: ${message}`,
      });
    }
  },
};
