// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(() => cleanup());
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ComposerInput, type VaultFileEntry } from '@/ui/chat/ComposerInput';

const vaultFiles: readonly VaultFileEntry[] = [
  { path: 'README.md', name: 'README.md', kind: 'document' },
  { path: 'Projects/leo/CLAUDE.md', name: 'CLAUDE.md', kind: 'document' },
  { path: 'assets/diagram.png', name: 'diagram.png', kind: 'image' },
];

function setup(overrides: Partial<Parameters<typeof ComposerInput>[0]> = {}) {
  const onMentionSelect = vi.fn();
  const onSubmit = vi.fn();
  render(
    <ComposerInput
      collapsed={false}
      onSubmit={onSubmit}
      vaultFiles={vaultFiles}
      onMentionSelect={onMentionSelect}
      {...overrides}
    />,
  );
  const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
  return { ta, onMentionSelect, onSubmit };
}

function typeIntoTextarea(ta: HTMLTextAreaElement, value: string): void {
  act(() => {
    fireEvent.change(ta, { target: { value, selectionStart: value.length } });
  });
}

describe('ComposerInput @ mention picker', () => {
  it('opens picker when typing `@` token', () => {
    const { ta } = setup();
    typeIntoTextarea(ta, 'check @rea');
    const picker = screen.getByRole('listbox', { name: /vault file mentions/i });
    expect(picker).toBeTruthy();
    expect(picker.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
  });

  it('hides picker when no @ token at caret', () => {
    const { ta } = setup();
    typeIntoTextarea(ta, 'plain text');
    expect(screen.queryByRole('listbox', { name: /vault file mentions/i })).toBeNull();
  });

  it('selecting an item calls onMentionSelect and removes the @token', () => {
    const { ta, onMentionSelect } = setup();
    typeIntoTextarea(ta, 'see @cla');
    const option = document.querySelector('[data-path="Projects/leo/CLAUDE.md"]') as HTMLElement;
    expect(option).not.toBeNull();
    fireEvent.mouseDown(option);
    expect(onMentionSelect).toHaveBeenCalledTimes(1);
    expect(onMentionSelect.mock.calls[0]![0]).toEqual({
      path: 'Projects/leo/CLAUDE.md',
      name: 'CLAUDE.md',
      kind: 'document',
    });
    expect((ta as HTMLTextAreaElement).value).toBe('see ');
  });

  it('Enter while picker is open selects the active item, does not submit', () => {
    const { ta, onMentionSelect, onSubmit } = setup();
    typeIntoTextarea(ta, '@dia');
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onMentionSelect).toHaveBeenCalledTimes(1);
    expect(onMentionSelect.mock.calls[0]![0].path).toBe('assets/diagram.png');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
