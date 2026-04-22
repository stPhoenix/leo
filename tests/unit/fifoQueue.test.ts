import { describe, expect, it } from 'vitest';
import { FifoQueue } from '@/util/fifoQueue';

describe('FifoQueue', () => {
  it('serializes acquire() so only one slot is active at a time', async () => {
    const queue = new FifoQueue();
    const order: string[] = [];

    const a = (async () => {
      const release = await queue.acquire();
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('a-end');
      release();
    })();
    const b = (async () => {
      const release = await queue.acquire();
      order.push('b-start');
      release();
    })();

    await Promise.all([a, b]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start']);
  });

  it('preserves enqueue order under concurrent enqueues', async () => {
    const queue = new FifoQueue();
    const order: number[] = [];
    const tasks = [0, 1, 2, 3, 4].map((i) =>
      queue.run(async () => {
        order.push(i);
      }),
    );
    await Promise.all(tasks);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('continues to next task even when a prior task throws', async () => {
    const queue = new FifoQueue();
    const failing = queue.run(async () => {
      throw new Error('boom');
    });
    const next = queue.run(async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
