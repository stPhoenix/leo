import { describe, expect, it } from 'vitest';
import { RotatingFileSink } from '@/platform/rotatingFileSink';
import type { SinkFs } from '@/platform/rotatingFileSink';
import type { LogRecord } from '@/platform/logTypes';
import { formatLine } from '@/platform/logTypes';

class FakeFs implements SinkFs {
  files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async mkdir(_path: string): Promise<void> {
    /* no-op; tests use flat file namespace */
  }
  async stat(path: string): Promise<{ size: number } | null> {
    const v = this.files.get(path);
    return v === undefined ? null : { size: Buffer.byteLength(v, 'utf8') };
  }
  async append(path: string, data: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? '') + data);
  }
  async rename(from: string, to: string): Promise<void> {
    const v = this.files.get(from);
    if (v === undefined) throw new Error(`rename: missing ${from}`);
    this.files.delete(from);
    this.files.set(to, v);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

function record(msg: string, ts = '2026-04-21T10:00:00.000Z'): LogRecord {
  return { ts, level: 'info', event: msg, fields: {} };
}

describe('RotatingFileSink — single file writes', () => {
  it('appends JSON lines with trailing newlines', async () => {
    const fs = new FakeFs();
    const sink = new RotatingFileSink(fs, { path: 'log' });
    await sink.init();
    await sink.write(record('a'));
    await sink.write(record('b'));
    const content = fs.files.get('log') ?? '';
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).event).toBe('a');
    expect(JSON.parse(lines[1]!).event).toBe('b');
  });

  it('picks up pre-existing file size on init', async () => {
    const fs = new FakeFs();
    const existing = 'seed-line\n';
    fs.files.set('log', existing);
    const sink = new RotatingFileSink(fs, { path: 'log', maxBytes: existing.length + 5 });
    await sink.init();
    await sink.write(record('next'));
    expect(fs.files.has('log.1')).toBe(true);
    expect(fs.files.get('log.1')).toBe(existing);
  });
});

describe('RotatingFileSink — rotation boundary (NFR-LOG-02)', () => {
  it('rotates once the next write would push past maxBytes', async () => {
    const fs = new FakeFs();
    const lineBytes = Buffer.byteLength(formatLine(record('x')) + '\n', 'utf8');
    const sink = new RotatingFileSink(fs, {
      path: 'log',
      maxBytes: lineBytes + Math.floor(lineBytes / 2),
    });
    await sink.init();
    await sink.write(record('x'));
    expect(fs.files.has('log.1')).toBe(false);
    await sink.write(record('x'));
    expect(fs.files.has('log.1')).toBe(true);
    expect((fs.files.get('log') ?? '').length).toBe(lineBytes);
    expect((fs.files.get('log.1') ?? '').length).toBe(lineBytes);
  });

  it('never exceeds maxRotations=5 siblings', async () => {
    const fs = new FakeFs();
    const sink = new RotatingFileSink(fs, { path: 'log', maxBytes: 100, maxRotations: 5 });
    await sink.init();
    const big = 'y'.repeat(90);
    for (let i = 0; i < 20; i++) {
      await sink.write(record(big));
    }
    const rotated = [...fs.files.keys()].filter((k) => /^log\.\d+$/.test(k));
    expect(rotated.length).toBeLessThanOrEqual(5);
    for (let i = 1; i <= 5; i++) {
      expect(fs.files.has(`log.${i}`)).toBe(true);
    }
    expect(fs.files.has('log.6')).toBe(false);
  });

  it('cascades renames correctly: .1→.2, .2→.3, …, drops oldest', async () => {
    const fs = new FakeFs();
    fs.files.set('log', 'base');
    fs.files.set('log.1', 'one');
    fs.files.set('log.2', 'two');
    fs.files.set('log.3', 'three');
    fs.files.set('log.4', 'four');
    fs.files.set('log.5', 'five');
    const sink = new RotatingFileSink(fs, { path: 'log', maxBytes: 5 });
    await sink.init();
    await sink.write(record('trigger'));
    expect(fs.files.get('log.1')).toBe('base');
    expect(fs.files.get('log.2')).toBe('one');
    expect(fs.files.get('log.3')).toBe('two');
    expect(fs.files.get('log.4')).toBe('three');
    expect(fs.files.get('log.5')).toBe('four');
    expect(fs.files.has('log.6')).toBe(false);
  });
});

describe('RotatingFileSink — serialized writes', () => {
  it('queues concurrent writes so the queue stays ordered', async () => {
    const fs = new FakeFs();
    const sink = new RotatingFileSink(fs, { path: 'log' });
    await sink.init();
    const events = ['a', 'b', 'c', 'd'];
    await Promise.all(events.map((e) => sink.write(record(e))));
    const lines = (fs.files.get('log') ?? '').split('\n').filter(Boolean);
    expect(lines.map((l) => JSON.parse(l).event)).toEqual(events);
  });
});

describe('RotatingFileSink — bounded flush', () => {
  it('flush resolves within timeout even if a write is stuck', async () => {
    const slowFs: SinkFs = {
      async exists() {
        return false;
      },
      async mkdir() {
        /* */
      },
      async stat() {
        return null;
      },
      append() {
        return new Promise(() => {
          /* never resolves */
        });
      },
      async rename() {
        /* */
      },
      async remove() {
        /* */
      },
    };
    const sink = new RotatingFileSink(slowFs, { path: 'log', flushTimeoutMs: 30 });
    await sink.init();
    void sink.write(record('stuck'));
    const start = Date.now();
    await sink.flush();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
