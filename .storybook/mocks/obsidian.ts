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

export const MarkdownRenderer = {
  async render(_app: unknown, markdown: string, el: HTMLElement): Promise<void> {
    el.textContent = markdown;
  },
  async renderMarkdown(markdown: string, el: HTMLElement): Promise<void> {
    el.textContent = markdown;
  },
};
