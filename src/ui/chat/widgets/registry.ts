import type { ComponentType } from 'react';

export interface WidgetComponentProps {
  readonly props: unknown;
}

export type WidgetComponent = ComponentType<WidgetComponentProps>;

const registry = new Map<string, WidgetComponent>();

export function registerWidget(kind: string, component: WidgetComponent): void {
  registry.set(kind, component);
}

export function lookupWidget(kind: string): WidgetComponent | null {
  return registry.get(kind) ?? null;
}
