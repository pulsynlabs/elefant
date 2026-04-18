import { LspClient } from './client.js';

const clientCache = new Map<string, LspClient>();

type WhichBinary = (binary: string) => string | null | undefined;
type SpawnProcess = (cmd: [string, string]) => ReturnType<typeof Bun.spawn>;

let whichBinary: WhichBinary = (binary) => Bun.which(binary);
let spawnProcess: SpawnProcess = (cmd) => Bun.spawn(cmd, {
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
});

export async function getClient(language: string): Promise<LspClient | null> {
  const cached = clientCache.get(language);
  if (cached) {
    return cached;
  }

  const binaryMap: Record<string, string> = {
    typescript: 'typescript-language-server',
    javascript: 'typescript-language-server',
  };

  const binary = binaryMap[language];
  if (!binary) {
    return null;
  }

  const binaryPath = whichBinary(binary);
  if (!binaryPath) {
    return null;
  }

  const client = new LspClient(spawnProcess([binaryPath, '--stdio']));

  try {
    await client.initialize(`file://${process.cwd()}`);
    clientCache.set(language, client);
    return client;
  } catch {
    client.dispose();
    return null;
  }
}

export function clearClientCache(): void {
  for (const client of clientCache.values()) {
    client.dispose();
  }
  clientCache.clear();
}

export function __setManagerTestOverrides(overrides: {
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

export function __resetManagerTestOverrides(): void {
  whichBinary = (binary) => Bun.which(binary);
  spawnProcess = (cmd) => Bun.spawn(cmd, {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
}
