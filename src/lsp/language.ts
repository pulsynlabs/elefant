import { extname } from 'node:path';

const EXT_TO_SERVER_IDS: Record<string, string[]> = {
  '.ts': ['typescript'],
  '.tsx': ['typescript'],
  '.js': ['typescript'],
  '.jsx': ['typescript'],
  '.mjs': ['typescript'],
  '.cjs': ['typescript'],
  '.mts': ['typescript'],
  '.cts': ['typescript'],
  '.py': ['pyright', 'pylsp'],
  '.go': ['gopls'],
  '.rs': ['rust-analyzer'],
  '.css': ['css'],
  '.scss': ['css'],
  '.less': ['css'],
  '.html': ['html'],
  '.htm': ['html'],
  '.json': ['json'],
  '.jsonc': ['json'],
  '.yaml': ['yaml'],
  '.yml': ['yaml'],
  '.md': ['marksman'],
  '.mdx': ['marksman'],
};

export function extensionToServerIds(filePath: string): string[] {
  const ext = extname(filePath).toLowerCase();
  return EXT_TO_SERVER_IDS[ext] ?? [];
}
