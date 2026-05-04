import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, mock } from 'bun:test';

import { extensionToServerIds } from './language.js';
import {
  __resetServerTestOverrides,
  __setServerTestOverrides,
  ALL_SERVERS,
  gopls,
  pyright,
  rustAnalyzer,
  typescript,
} from './servers.js';

const tempDirs: string[] = [];

async function makeTempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'elefant-lsp-'));
  tempDirs.push(dir);
  return dir;
}

function createMockProcess(): ReturnType<typeof Bun.spawn> {
  return {
    stdin: new WritableStream<Uint8Array>(),
    stdout: new ReadableStream<Uint8Array>(),
    stderr: new ReadableStream<Uint8Array>(),
    exited: Promise.resolve(0),
    killed: false,
    pid: 12345,
    ref() {},
    unref() {},
    kill() {
      return true;
    },
  } as unknown as ReturnType<typeof Bun.spawn>;
}

afterEach(async () => {
  __resetServerTestOverrides();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('LSP server registry', () => {
  it('exports server definitions for all supported languages', () => {
    const ids = ALL_SERVERS.map((s) => s.id);
    // Spot-check key entries rather than asserting the full list, so adding
    // more servers doesn't require updating this test.
    expect(ids).toContain('typescript');
    expect(ids).toContain('svelte');
    expect(ids).toContain('vue');
    expect(ids).toContain('pyright');
    expect(ids).toContain('pylsp');
    expect(ids).toContain('ruff');
    expect(ids).toContain('gopls');
    expect(ids).toContain('rust-analyzer');
    expect(ids).toContain('clangd');
    expect(ids).toContain('css');
    expect(ids).toContain('html');
    expect(ids).toContain('json');
    expect(ids).toContain('yaml');
    expect(ids).toContain('marksman');
    expect(ids).toContain('kotlin');
    expect(ids).toContain('gleam');
    expect(ids).toContain('zig');
    expect(ids).toContain('solidity');
    // No duplicates
    expect(ids.length).toBe(new Set(ids).size);
    // At least 40 servers registered
    expect(ids.length).toBeGreaterThanOrEqual(40);
  });

  it('routes common extensions to server ids', () => {
    expect(extensionToServerIds('example.ts')).toEqual(['typescript']);
    expect(extensionToServerIds('example.py')).toEqual(['pyright', 'pylsp', 'ruff']);
    expect(extensionToServerIds('example.go')).toEqual(['gopls']);
    expect(extensionToServerIds('example.rs')).toEqual(['rust-analyzer']);
    expect(extensionToServerIds('example.css')).toEqual(['css']);
    expect(extensionToServerIds('example.json')).toEqual(['json']);
    expect(extensionToServerIds('example.md')).toEqual(['marksman']);
    expect(extensionToServerIds('example.svelte')).toEqual(['svelte']);
    expect(extensionToServerIds('example.gleam')).toEqual(['gleam']);
    expect(extensionToServerIds('example.sol')).toEqual(['solidity']);
    expect(extensionToServerIds('example.unknown')).toEqual([]);
  });

  it('walks up from a nested file to find a TypeScript project root', async () => {
    const project = await makeTempProject();
    const nestedFile = join(project, 'src', 'features', 'index.ts');
    await mkdir(join(project, 'src', 'features'), { recursive: true });
    await writeFile(join(project, 'package.json'), '{}');
    await writeFile(nestedFile, 'export const value = 1;');

    await expect(typescript.root(nestedFile)).resolves.toBe(project);
  });

  it('walks up from a nested file to find a Python project root', async () => {
    const project = await makeTempProject();
    const nestedFile = join(project, 'pkg', 'module', 'main.py');
    await mkdir(join(project, 'pkg', 'module'), { recursive: true });
    await writeFile(join(project, 'pyproject.toml'), '[project]\nname = "example"\n');
    await writeFile(nestedFile, 'print("hello")\n');

    await expect(pyright.root(nestedFile)).resolves.toBe(project);
  });

  it('returns undefined when no project root marker is found', async () => {
    const project = await makeTempProject();
    const filePath = join(project, 'src', 'main.go');
    await mkdir(join(project, 'src'), { recursive: true });
    await writeFile(filePath, 'package main\n');

    await expect(gopls.root(filePath)).resolves.toBeUndefined();
  });

  it('detects language-specific project markers', async () => {
    const goProject = await makeTempProject();
    const rustProject = await makeTempProject();
    const goFile = join(goProject, 'cmd', 'server', 'main.go');
    const rustFile = join(rustProject, 'src', 'main.rs');

    await mkdir(join(goProject, 'cmd', 'server'), { recursive: true });
    await mkdir(join(rustProject, 'src'), { recursive: true });
    await writeFile(join(goProject, 'go.mod'), 'module example.com/project\n');
    await writeFile(goFile, 'package main\n');
    await writeFile(join(rustProject, 'Cargo.toml'), '[package]\nname = "example"\n');
    await writeFile(rustFile, 'fn main() {}\n');

    await expect(gopls.root(goFile)).resolves.toBe(goProject);
    await expect(rustAnalyzer.root(rustFile)).resolves.toBe(rustProject);
  });

  it('returns undefined from spawn when the language server binary is missing', async () => {
    __setServerTestOverrides({ which: () => null });

    await expect(typescript.spawn('/tmp')).resolves.toBeUndefined();
  });

  it('spawns with stdio pipes when the language server binary exists', async () => {
    const spawned = mock((_cmd: string[], options: Bun.SpawnOptions.OptionsObject<'pipe', 'pipe', 'pipe'>) => {
      void options;
      return createMockProcess();
    });
    __setServerTestOverrides({
      which: (binary) => `/usr/bin/${binary}`,
      spawn: spawned,
    });

    const handle = await typescript.spawn('/workspace');

    expect(handle).toBeDefined();
    expect(spawned).toHaveBeenCalledWith(
      ['/usr/bin/typescript-language-server', '--stdio'],
      { cwd: '/workspace', stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    );
  });
});
