export type ConnectionStatus = 'available' | 'unreachable';

export type ConnectionListener = (status: ConnectionStatus) => void;

export class ConnectionState {
  private status: ConnectionStatus = 'available';
  private readonly listeners = new Set<ConnectionListener>();

  get current(): ConnectionStatus {
    return this.status;
  }

  isReachable(): boolean {
    return this.status === 'available';
  }

  markReachable(): void {
    this.set('available');
  }

  markUnreachable(): void {
    this.set('unreachable');
  }

  on(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const l of this.listeners) {
      l(next);
    }
  }
}
