import { describe, expect, it } from 'bun:test';

import { extensionToServerIds } from './language.js';

describe('extensionToServerIds', () => {
  it.each([
    ['file.ts', ['typescript']],
    ['file.tsx', ['typescript']],
    ['file.js', ['typescript']],
    ['file.jsx', ['typescript']],
    ['file.mjs', ['typescript']],
    ['file.cjs', ['typescript']],
    ['file.mts', ['typescript']],
    ['file.cts', ['typescript']],
    ['file.py', ['pyright', 'pylsp']],
    ['file.go', ['gopls']],
    ['file.rs', ['rust-analyzer']],
    ['file.css', ['css']],
    ['file.scss', ['css']],
    ['file.less', ['css']],
    ['file.html', ['html']],
    ['file.htm', ['html']],
    ['file.json', ['json']],
    ['file.jsonc', ['json']],
    ['file.yaml', ['yaml']],
    ['file.yml', ['yaml']],
    ['file.md', ['marksman']],
    ['file.mdx', ['marksman']],
  ])('maps %s to %p', (filePath, expected) => {
    expect(extensionToServerIds(filePath)).toEqual(expected);
  });

  it('is case-insensitive for extensions', () => {
    expect(extensionToServerIds('COMPONENT.TSX')).toEqual(['typescript']);
  });

  it('returns an empty array for unknown extensions', () => {
    expect(extensionToServerIds('archive.zip')).toEqual([]);
  });
});
