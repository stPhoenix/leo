export interface CodeBlockClipboard {
  copy(text: string): Promise<void>;
  notify(message: string): void;
}

export interface CodeBlockEnhancerOptions {
  readonly clipboard: CodeBlockClipboard;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
}

export function enhanceCodeBlocks(host: HTMLElement, opts: CodeBlockEnhancerOptions): () => void {
  const cleanups: Array<() => void> = [];
  const blocks = host.querySelectorAll<HTMLPreElement>('pre');
  for (const pre of Array.from(blocks)) {
    if (pre.querySelector(':scope > .leo-copy-code-button') !== null) continue;
    const code = pre.querySelector<HTMLElement>('code');
    if (code === null) continue;
    const doc = pre.ownerDocument;

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'leo-copy-code-button';
    button.setAttribute('aria-label', 'Copy code');
    button.tabIndex = 0;
    button.textContent = 'copy';
    if (opts.setIcon !== undefined) {
      try {
        opts.setIcon(button, 'copy');
      } catch {
        /* fallback to text label set above */
      }
    }
    pre.style.position = pre.style.position === '' ? 'relative' : pre.style.position;
    pre.appendChild(button);

    const onClick = (): void => {
      void opts.clipboard.copy(code.textContent ?? '').then(
        () => {
          opts.clipboard.notify('Copied to clipboard');
        },
        () => {
          opts.clipboard.notify('Copy failed');
        },
      );
    };
    button.addEventListener('click', onClick);

    pre.classList.add('leo-code-collapsible', 'is-collapsed');
    pre.setAttribute('data-collapsed', 'true');

    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'leo-code-toggle-button';
    toggle.setAttribute('aria-label', 'Expand code');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.tabIndex = 0;
    toggle.textContent = '▸';
    pre.appendChild(toggle);

    const onToggle = (): void => {
      const collapsed = pre.classList.toggle('is-collapsed');
      pre.classList.toggle('is-expanded', !collapsed);
      pre.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
      toggle.textContent = collapsed ? '▸' : '▾';
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.setAttribute('aria-label', collapsed ? 'Expand code' : 'Collapse code');
    };
    toggle.addEventListener('click', onToggle);

    cleanups.push(() => {
      button.removeEventListener('click', onClick);
      button.remove();
      toggle.removeEventListener('click', onToggle);
      toggle.remove();
      pre.classList.remove('leo-code-collapsible', 'is-collapsed', 'is-expanded');
      pre.removeAttribute('data-collapsed');
    });
  }
  return () => {
    for (const c of cleanups) c();
  };
}
