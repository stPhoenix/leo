// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';
import { enhanceCodeBlocks } from '@/ui/chat/codeBlockEnhancer';

afterEach(() => {
  document.body.innerHTML = '';
});

function makeHostWith(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe('enhanceCodeBlocks', () => {
  it('attaches a copy button per code block with aria-label and tabindex 0', () => {
    const host = makeHostWith('<pre><code>a()</code></pre><pre><code>b()</code></pre>');
    enhanceCodeBlocks(host, { clipboard: { copy: vi.fn(), notify: vi.fn() } });
    const buttons = host.querySelectorAll('.leo-copy-code-button');
    expect(buttons.length).toBe(2);
    for (const b of Array.from(buttons)) {
      expect(b.getAttribute('aria-label')).toBe('Copy code');
      expect((b as HTMLElement).tabIndex).toBe(0);
    }
  });

  it('skips a pre without an inner code element', () => {
    const host = makeHostWith('<pre>plain</pre>');
    enhanceCodeBlocks(host, { clipboard: { copy: vi.fn(), notify: vi.fn() } });
    expect(host.querySelector('.leo-copy-code-button')).toBeNull();
  });

  it('does not double-attach if called twice', () => {
    const host = makeHostWith('<pre><code>x</code></pre>');
    const opts = { clipboard: { copy: vi.fn(), notify: vi.fn() } };
    enhanceCodeBlocks(host, opts);
    enhanceCodeBlocks(host, opts);
    expect(host.querySelectorAll('.leo-copy-code-button').length).toBe(1);
  });

  it('cleanup removes the button and its listener', async () => {
    const host = makeHostWith('<pre><code>x</code></pre>');
    const copy = vi.fn(async () => undefined);
    const notify = vi.fn();
    const cleanup = enhanceCodeBlocks(host, { clipboard: { copy, notify } });
    cleanup();
    expect(host.querySelector('.leo-copy-code-button')).toBeNull();
  });

  it('clicking the button copies the exact code text and notifies on success', async () => {
    const host = makeHostWith('<pre><code>const x = 42;</code></pre>');
    const copy = vi.fn(async () => undefined);
    const notify = vi.fn();
    enhanceCodeBlocks(host, { clipboard: { copy, notify } });
    const button = host.querySelector<HTMLButtonElement>('.leo-copy-code-button')!;
    button.click();
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Copied to clipboard'));
    expect(copy).toHaveBeenCalledWith('const x = 42;');
  });
});
