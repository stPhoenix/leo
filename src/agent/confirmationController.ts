export type ConfirmationDecision = 'allow-once' | 'allow-thread' | 'deny';

export interface ToolConfirmationRequest {
  readonly toolId: string;
  readonly thread: string;
  readonly argsJson: string;
  readonly argsPretty: string;
  readonly category: 'read' | 'write';
}

export interface PendingConfirmation {
  readonly request: ToolConfirmationRequest;
  readonly resolve: (decision: ConfirmationDecision) => void;
}

export type ConfirmationListener = (pending: PendingConfirmation | null) => void;

const ARGS_SOFT_CAP_BYTES = 4096;

export class ConfirmationController {
  private pending: PendingConfirmation | null = null;
  private readonly listeners = new Set<ConfirmationListener>();

  request(req: ToolConfirmationRequest): Promise<ConfirmationDecision> {
    if (this.pending !== null) {
      this.pending.resolve('deny');
      this.pending = null;
      this.notify();
    }
    return new Promise<ConfirmationDecision>((resolve) => {
      this.pending = {
        request: req,
        resolve: (decision) => {
          if (this.pending === null) return;
          if (this.pending.request !== req) return;
          this.pending = null;
          this.notify();
          resolve(decision);
        },
      };
      this.notify();
    });
  }

  resolve(decision: ConfirmationDecision): void {
    const p = this.pending;
    if (p === null) return;
    p.resolve(decision);
  }

  current(): PendingConfirmation | null {
    return this.pending;
  }

  subscribe(cb: ConfirmationListener): () => void {
    this.listeners.add(cb);
    return (): void => {
      this.listeners.delete(cb);
    };
  }

  dispose(): void {
    if (this.pending !== null) {
      this.pending.resolve('deny');
      this.pending = null;
      this.notify();
    }
    this.listeners.clear();
  }

  private notify(): void {
    const snapshot = this.pending;
    for (const l of this.listeners) l(snapshot);
  }
}

export function prettifyArgs(argsJson: string): string {
  if (argsJson.length === 0) return '{}';
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    const out = JSON.stringify(parsed, null, 2);
    if (out.length <= ARGS_SOFT_CAP_BYTES) return out;
    return `${out.slice(0, ARGS_SOFT_CAP_BYTES)}\n… (truncated, ${out.length} bytes total)`;
  } catch {
    return argsJson;
  }
}
