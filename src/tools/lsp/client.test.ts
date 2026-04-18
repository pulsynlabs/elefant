import { describe, expect, it, mock } from 'bun:test';

import { LspClient } from './client.js';

describe('LspClient', () => {
  it('dispose kills spawned process', () => {
    const kill = mock(() => {});

    const process = {
      stdin: new WritableStream<Uint8Array>(),
      stdout: new ReadableStream<Uint8Array>(),
      stderr: new ReadableStream<Uint8Array>(),
      kill,
    } as unknown as ReturnType<typeof Bun.spawn>;

    const client = new LspClient(process);
    client.dispose();

    expect(kill).toHaveBeenCalledTimes(1);
  });
});
