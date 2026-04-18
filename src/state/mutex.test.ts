import { describe, expect, it } from 'bun:test';
import { AsyncMutex } from './mutex.ts';

describe('AsyncMutex', () => {
  it('serializes concurrent calls', async () => {
    const mutex = new AsyncMutex();
    let counter = 0;

    const tasks = Array.from({ length: 10 }, () =>
      mutex.withLock(async () => {
        const current = counter;
        await Bun.sleep(5);
        counter = current + 1;
      }),
    );

    await Promise.all(tasks);
    expect(counter).toBe(10);
  });
});
