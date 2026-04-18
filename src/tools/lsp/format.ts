import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Location, LspSymbol } from './client.js';

const SYMBOL_KIND: Record<number, string> = {
  1: 'file',
  2: 'module',
  3: 'namespace',
  4: 'package',
  5: 'class',
  6: 'method',
  7: 'property',
  8: 'field',
  9: 'constructor',
  10: 'enum',
  11: 'interface',
  12: 'function',
  13: 'variable',
  14: 'constant',
  15: 'string',
  16: 'number',
  17: 'boolean',
  18: 'array',
  19: 'object',
  20: 'key',
  21: 'null',
  22: 'enum member',
  23: 'struct',
  24: 'event',
  25: 'operator',
  26: 'type parameter',
};

function toDisplayPath(uri: string): string {
  if (uri.startsWith('file://')) {
    const absolutePath = fileURLToPath(uri);
    const rel = relative(process.cwd(), absolutePath);
    return rel.length > 0 ? rel : absolutePath;
  }
  return uri;
}

function formatLocation(location: Location): string {
  const path = toDisplayPath(location.uri);
  const line = location.range.start.line + 1;
  const character = location.range.start.character + 1;
  return `${path}:${line}:${character}`;
}

function symbolKind(kind: number): string {
  return SYMBOL_KIND[kind] ?? `kind-${kind}`;
}

function formatSymbol(symbol: LspSymbol, depth: number): string {
  const indent = '  '.repeat(depth);
  const kind = symbolKind(symbol.kind);
  const locationPart = symbol.location ? ` - ${formatLocation(symbol.location)}` : '';
  const current = `${indent}${symbol.name} (${kind})${locationPart}`;

  const childLines = (symbol.children ?? []).map((child) => formatSymbol(child, depth + 1));
  return [current, ...childLines].join('\n');
}

export function formatLocations(locations: Location[]): string {
  if (locations.length === 0) {
    return '(no locations found)';
  }

  return locations.map((location) => formatLocation(location)).join('\n');
}

export function formatSymbols(symbols: LspSymbol[]): string {
  if (symbols.length === 0) {
    return '(no symbols found)';
  }

  return symbols.map((symbol) => formatSymbol(symbol, 0)).join('\n');
}

export function formatHover(content: string | null): string {
  return content ?? '(no hover information)';
}
