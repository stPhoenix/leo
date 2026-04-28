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
    const button = pre.ownerDocument.createElement('button');
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
    cleanups.push(() => {
      button.removeEventListener('click', onClick);
      button.remove();
    });
  }
  return () => {
    for (const c of cleanups) c();
  };
}
