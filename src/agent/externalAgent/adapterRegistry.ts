import type { ExternalAgentAdapter } from './adapters/base';

export interface AdapterEnabledMap {
  readonly [adapterId: string]: boolean | undefined;
}

export interface AdapterRegistryOptions {
  readonly defaultIdSource?: () => string | null | undefined;
  readonly enabledSource?: () => AdapterEnabledMap;
}

export class AdapterRegistry {
  private adapters = new Map<string, ExternalAgentAdapter>();
  private frozen = false;
  private readonly defaultIdSource: () => string | null | undefined;
  private readonly enabledSource: () => AdapterEnabledMap;

  constructor(opts: AdapterRegistryOptions = {}) {
    this.defaultIdSource = opts.defaultIdSource ?? ((): null => null);
    this.enabledSource = opts.enabledSource ?? ((): AdapterEnabledMap => ({}));
  }

  register(adapter: ExternalAgentAdapter): void {
    if (this.frozen) {
      throw new Error(`AdapterRegistry: cannot register ${adapter.id} after freeze`);
    }
    if (this.adapters.has(adapter.id)) {
      throw new Error(`AdapterRegistry: duplicate adapter id ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  freeze(): void {
    this.frozen = true;
  }

  list(): readonly ExternalAgentAdapter[] {
    return [...this.adapters.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): ExternalAgentAdapter | undefined {
    return this.adapters.get(id);
  }

  size(): number {
    return this.adapters.size;
  }

  isEnabled(id: string): boolean {
    if (!this.adapters.has(id)) return false;
    const map = this.enabledSource();
    const flag = map[id];
    return flag !== false;
  }

  defaultId(): string | null {
    const requested = this.defaultIdSource() ?? null;
    if (requested !== null && this.adapters.has(requested) && this.isEnabled(requested)) {
      return requested;
    }
    for (const adapter of this.list()) {
      if (this.isEnabled(adapter.id)) return adapter.id;
    }
    return null;
  }
}
