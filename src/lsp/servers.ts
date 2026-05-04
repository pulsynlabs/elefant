import { dirname, join, resolve } from 'node:path';

import type { Handle, ServerInfo } from './types.js';

type WhichBinary = (binary: string) => string | null | undefined;
type SpawnProcess = (cmd: string[], options: Bun.SpawnOptions.OptionsObject<'pipe', 'pipe', 'pipe'>) => ReturnType<typeof Bun.spawn>;

let whichBinary: WhichBinary = (binary) => Bun.which(binary);
let spawnProcess: SpawnProcess = (cmd, options) => Bun.spawn(cmd, options);

async function fileExists(filePath: string): Promise<boolean> {
  return Bun.file(filePath).exists();
}

export async function walkUpForRoot(startPath: string, markers: readonly string[]): Promise<string | undefined> {
  let current = dirname(resolve(startPath));

  while (true) {
    for (const marker of markers) {
      if (await fileExists(join(current, marker))) {
        return current;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function createRootDetector(markers: readonly string[]): (filePath: string) => Promise<string | undefined> {
  return (filePath) => walkUpForRoot(filePath, markers);
}

function createSpawner(binary: string, args: readonly string[]): (root: string) => Promise<Handle | undefined> {
  return async (root) => {
    const binaryPath = whichBinary(binary);
    if (!binaryPath) {
      return undefined;
    }

    const process = spawnProcess([binaryPath, ...args], {
      cwd: root,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return { process };
  };
}

function defineServer(config: {
  id: string;
  extensions: string[];
  markers: readonly string[];
  binary: string;
  args: readonly string[];
}): ServerInfo {
  return {
    id: config.id,
    extensions: config.extensions,
    root: createRootDetector(config.markers),
    spawn: createSpawner(config.binary, config.args),
  };
}

export const typescript = defineServer({
  id: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
  markers: ['package.json', 'bun.lock', 'bun.lockb', 'package-lock.json'],
  binary: 'typescript-language-server',
  args: ['--stdio'],
});

export const pyright = defineServer({
  id: 'pyright',
  extensions: ['.py'],
  markers: ['pyproject.toml', 'setup.py', 'setup.cfg'],
  binary: 'pyright-langserver',
  args: ['--stdio'],
});

export const pylsp = defineServer({
  id: 'pylsp',
  extensions: ['.py'],
  markers: ['pyproject.toml', 'setup.py', 'setup.cfg'],
  binary: 'pylsp',
  args: [],
});

export const gopls = defineServer({
  id: 'gopls',
  extensions: ['.go'],
  markers: ['go.mod'],
  binary: 'gopls',
  args: [],
});

export const rustAnalyzer = defineServer({
  id: 'rust-analyzer',
  extensions: ['.rs'],
  markers: ['Cargo.toml'],
  binary: 'rust-analyzer',
  args: [],
});

export const css = defineServer({
  id: 'css',
  extensions: ['.css', '.scss', '.less'],
  markers: ['package.json'],
  binary: 'vscode-css-language-server',
  args: ['--stdio'],
});

export const html = defineServer({
  id: 'html',
  extensions: ['.html', '.htm'],
  markers: ['package.json'],
  binary: 'vscode-html-language-server',
  args: ['--stdio'],
});

export const json = defineServer({
  id: 'json',
  extensions: ['.json', '.jsonc'],
  markers: ['package.json'],
  binary: 'vscode-json-language-server',
  args: ['--stdio'],
});

export const yaml = defineServer({
  id: 'yaml',
  extensions: ['.yaml', '.yml'],
  markers: ['package.json', '.yaml-language-server'],
  binary: 'yaml-language-server',
  args: ['--stdio'],
});

export const marksman = defineServer({
  id: 'marksman',
  extensions: ['.md', '.mdx'],
  markers: ['.marksman.toml', 'package.json'],
  binary: 'marksman',
  args: ['server'],
});

export const ALL_SERVERS: ServerInfo[] = [
  typescript,
  pyright,
  pylsp,
  gopls,
  rustAnalyzer,
  css,
  html,
  json,
  yaml,
  marksman,
];

export function __setServerTestOverrides(overrides: {
  which?: WhichBinary;
  spawn?: SpawnProcess;
}): void {
  if (overrides.which) {
    whichBinary = overrides.which;
  }
  if (overrides.spawn) {
    spawnProcess = overrides.spawn;
  }
}

export function __resetServerTestOverrides(): void {
  whichBinary = (binary) => Bun.which(binary);
  spawnProcess = (cmd, options) => Bun.spawn(cmd, options);
}
