import { createElement, icons } from 'lucide';

const toPascal = (s: string): string =>
  s.replace(/(^|-)([a-z])/g, (_m, _p, c: string) => c.toUpperCase());

export function setIcon(el: HTMLElement, name: string): void {
  const node = (icons as Record<string, unknown>)[toPascal(name)];
  if (!node) {
    el.textContent = `[${name}]`;
    return;
  }
  const svg = createElement(node as Parameters<typeof createElement>[0]);
  svg.classList.add('svg-icon', `lucide-${name}`);
  el.replaceChildren(svg);
}

export class Notice {
  constructor(message: string) {
    // eslint-disable-next-line no-console
    console.log(`[Notice] ${message}`);
  }
}

export class Component {
  load(): void {}
  unload(): void {}
}

export const Platform = { isMobile: false, isDesktop: true };

export interface Debouncer<T extends unknown[], V> {
  (...args: T): this;
  cancel(): this;
  run(): V | void;
}

export function debounce<T extends unknown[], V>(
  cb: (...args: T) => V,
  timeout = 0,
  resetTimer = false,
): Debouncer<T, V> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: T | null = null;
  const fire = (): V | void => {
    timer = null;
    if (lastArgs === null) return;
    const args = lastArgs;
    lastArgs = null;
    return cb(...args);
  };
  const debounced = function (this: unknown, ...args: T): Debouncer<T, V> {
    lastArgs = args;
    if (timer !== null && resetTimer) clearTimeout(timer);
    if (timer === null || resetTimer) timer = setTimeout(fire, timeout);
    return debounced as unknown as Debouncer<T, V>;
  } as Debouncer<T, V>;
  debounced.cancel = function (): Debouncer<T, V> {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
    return debounced;
  };
  debounced.run = function (): V | void {
    if (timer !== null) clearTimeout(timer);
    return fire();
  };
  return debounced;
}

export const MarkdownRenderer = {
  async render(_app: unknown, markdown: string, el: HTMLElement): Promise<void> {
    el.textContent = markdown;
  },
  async renderMarkdown(markdown: string, el: HTMLElement): Promise<void> {
    el.textContent = markdown;
  },
};
