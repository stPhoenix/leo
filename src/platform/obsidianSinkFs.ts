import type { DataAdapter } from 'obsidian';
import type { SinkFs } from './rotatingFileSink';

export function createObsidianSinkFs(adapter: DataAdapter): SinkFs {
  return {
    async exists(path) {
      return adapter.exists(path);
    },
    async mkdir(path) {
      if (!(await adapter.exists(path))) {
        await adapter.mkdir(path);
      }
    },
    async stat(path) {
      const s = await adapter.stat(path);
      if (s === null || s === undefined) return null;
      return { size: s.size };
    },
    async append(path, data) {
      await adapter.append(path, data);
    },
    async rename(from, to) {
      await adapter.rename(from, to);
    },
    async remove(path) {
      await adapter.remove(path);
    },
  };
}
