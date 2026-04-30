import { describe, expect, it } from 'bun:test';
import { getBundledRegistry } from './bundled.ts';
import type { RegistryEntry } from './types.ts';

const BUNDLED_SOURCE = 'bundled';
const VALID_TRANSPORTS = ['stdio', 'sse', 'streamable-http'];
const OFFICIAL_SERVERS = [
  'filesystem',
  'github',
  'postgres',
  'fetch',
  'puppeteer',
  'sqlite',
  'memory',
  'time',
  'everything',
];

function validateEntry(entry: RegistryEntry): void {
  expect(typeof entry.id).toBe('string');
  expect(entry.id.length).toBeGreaterThan(0);
  expect(entry.source).toBe(BUNDLED_SOURCE);
  expect(typeof entry.name).toBe('string');
  expect(entry.name.length).toBeGreaterThan(0);
  expect(typeof entry.displayName).toBe('string');
  expect(entry.displayName.length).toBeGreaterThan(0);
  expect(typeof entry.description).toBe('string');
  expect(VALID_TRANSPORTS).toContain(entry.transport);

  if (entry.transport === 'stdio') {
    expect(Array.isArray(entry.command)).toBe(true);
    expect(entry.command!.length).toBeGreaterThan(0);
  }

  if (entry.useCases !== undefined) {
    expect(Array.isArray(entry.useCases)).toBe(true);
  }

  if (entry.toolNames !== undefined) {
    expect(Array.isArray(entry.toolNames)).toBe(true);
  }
}

describe('bundled registry', () => {
  it('contains at least 30 entries', () => {
    const entries = getBundledRegistry();
    expect(entries.length).toBeGreaterThanOrEqual(30);
  });

  it('all entries pass RegistryEntry schema validation', () => {
    const entries = getBundledRegistry();
    for (const entry of entries) {
      validateEntry(entry);
    }
  });

  it('includes all 9 official modelcontextprotocol servers', () => {
    const entries = getBundledRegistry();
    const entryNames = new Set(entries.map((e) => e.name));

    for (const officialName of OFFICIAL_SERVERS) {
      expect(entryNames.has(officialName)).toBe(true);
    }
  });

  it('has unique ids', () => {
    const entries = getBundledRegistry();
    const ids = new Set(entries.map((e) => e.id));
    expect(ids.size).toBe(entries.length);
  });

  it('has unique names', () => {
    const entries = getBundledRegistry();
    const names = new Set(entries.map((e) => e.name));
    expect(names.size).toBe(entries.length);
  });

  it('all stdio entries have commands', () => {
    const entries = getBundledRegistry();
    const stdioEntries = entries.filter((e) => e.transport === 'stdio');

    for (const entry of stdioEntries) {
      expect(Array.isArray(entry.command)).toBe(true);
      expect(entry.command!.length).toBeGreaterThan(0);
    }
  });

  it('all entries have a oneLiner', () => {
    const entries = getBundledRegistry();
    for (const entry of entries) {
      expect(typeof entry.oneLiner).toBe('string');
      expect(entry.oneLiner!.length).toBeGreaterThan(0);
    }
  });
});
