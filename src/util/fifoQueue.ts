export class FifoQueue {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.tail;
    this.tail = next;
    await prev;
    return release;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return this.acquire().then(async (release) => {
      try {
        return await task();
      } finally {
        release();
      }
    });
  }
}
