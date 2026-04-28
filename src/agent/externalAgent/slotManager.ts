export interface SlotHandle {
  readonly threadId: string;
  readonly runId: string;
  release(): void;
}

export interface SlotBusy {
  readonly busy: true;
  readonly activeRunId: string;
}

export interface SlotAcquired {
  readonly busy: false;
  readonly handle: SlotHandle;
}

export type SlotResult = SlotBusy | SlotAcquired;

interface ActiveSlot {
  runId: string;
  released: boolean;
}

export class SlotManager {
  private readonly slots = new Map<string, ActiveSlot>();

  acquire(threadId: string, runId: string): SlotResult {
    const live = this.slots.get(threadId);
    if (live !== undefined && !live.released) {
      return { busy: true, activeRunId: live.runId };
    }
    const slot: ActiveSlot = { runId, released: false };
    this.slots.set(threadId, slot);
    return {
      busy: false,
      handle: {
        threadId,
        runId,
        release: () => {
          if (slot.released) return;
          slot.released = true;
          if (this.slots.get(threadId) === slot) {
            this.slots.delete(threadId);
          }
        },
      },
    };
  }

  active(threadId: string): string | null {
    const live = this.slots.get(threadId);
    if (live === undefined || live.released) return null;
    return live.runId;
  }

  size(): number {
    let n = 0;
    for (const v of this.slots.values()) if (!v.released) n += 1;
    return n;
  }
}
