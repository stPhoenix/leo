import { describe, expect, it } from 'vitest';
import { CompactWidgetController } from '@/agent/compact/widgetController';
import {
  COMPACT_TERMINAL_KIND,
  tryParseCompactTerminalSnapshot,
} from '@/agent/compact/terminalSnapshot';

function make(opts?: {
  trigger?: 'manual' | 'auto';
  customInstructions?: string;
}): CompactWidgetController {
  return new CompactWidgetController({
    runId: 'cmp-20260507-100000-abcdef',
    threadId: 't-1',
    trigger: opts?.trigger ?? 'manual',
    ...(opts?.customInstructions !== undefined
      ? { customInstructions: opts.customInstructions }
      : {}),
  });
}

describe('CompactWidgetController', () => {
  it('starts in idle phase with null token counts', () => {
    const c = make();
    const vm = c.viewModel();
    expect(vm.phase).toBe('idle');
    expect(vm.startedAt).toBeNull();
    expect(vm.endedAt).toBeNull();
    expect(vm.preTokens).toBeNull();
    expect(vm.error).toBeNull();
    expect(vm.trigger).toBe('manual');
  });

  it('setPhase stamps startedAt on first non-idle transition', () => {
    const c = make();
    c.setPhase('preparing', { preTokens: 1234 });
    const vm = c.viewModel();
    expect(vm.phase).toBe('preparing');
    expect(vm.startedAt).not.toBeNull();
    expect(vm.endedAt).toBeNull();
    expect(vm.preTokens).toBe(1234);
  });

  it('setPhase stamps endedAt on terminal transition (done)', () => {
    const c = make();
    c.setPhase('preparing');
    c.setPhase('done', { preTokens: 1000, postTokens: 200 });
    const vm = c.viewModel();
    expect(vm.phase).toBe('done');
    expect(vm.endedAt).not.toBeNull();
  });

  it('recordError sets phase=error with code+message', () => {
    const c = make();
    c.recordError('circuit_broken', 'breaker tripped');
    const vm = c.viewModel();
    expect(vm.phase).toBe('error');
    expect(vm.error).toEqual({ code: 'circuit_broken', message: 'breaker tripped' });
    expect(vm.endedAt).not.toBeNull();
  });

  it('subscribe fires on update', () => {
    const c = make();
    const seen: string[] = [];
    const unsub = c.subscribe((vm) => seen.push(vm.phase));
    c.setPhase('preparing');
    c.setPhase('summarizing');
    c.setPhase('done');
    unsub();
    c.setPhase('idle');
    expect(seen).toEqual(['preparing', 'summarizing', 'done']);
  });

  it('listener errors are isolated', () => {
    const c = make();
    c.subscribe(() => {
      throw new Error('boom');
    });
    expect(() => c.setPhase('preparing')).not.toThrow();
  });

  it('dispose clears listeners + ignores subsequent updates', () => {
    const c = make();
    const seen: string[] = [];
    c.subscribe((vm) => seen.push(vm.phase));
    c.dispose();
    c.setPhase('summarizing');
    expect(seen).toEqual([]);
  });

  it('reloadRehydrate produces phase=error code=reload', () => {
    const c = CompactWidgetController.reloadRehydrate({
      runId: 'cmp-x',
      threadId: 't-1',
      trigger: 'manual',
    });
    const vm = c.viewModel();
    expect(vm.phase).toBe('error');
    expect(vm.error?.code).toBe('reload');
  });

  it('toTerminalSnapshot encodes done with token deltas', () => {
    const c = make();
    c.setPhase('preparing', { preTokens: 90_000 });
    c.update({
      phase: 'done',
      postTokens: 12_000,
      inputTokens: 88_000,
      outputTokens: 1_500,
      attachmentCount: 3,
      endedAt: (c.viewModel().startedAt ?? 0) + 5_000,
    });
    const snap = c.toTerminalSnapshot();
    expect(snap.terminalPhase).toBe('done');
    expect(snap.preTokens).toBe(90_000);
    expect(snap.postTokens).toBe(12_000);
    expect(snap.attachmentCount).toBe(3);
    expect(snap.durationMs).toBe(5_000);
    expect(snap.error).toBeNull();
  });

  it('toTerminalSnapshot encodes error with non-null error', () => {
    const c = make();
    c.recordError('no_stream', 'no stream');
    const snap = c.toTerminalSnapshot();
    expect(snap.terminalPhase).toBe('error');
    expect(snap.error).toEqual({ code: 'no_stream', message: 'no stream' });
  });

  it('terminal snapshot round-trips through Zod', () => {
    const c = make({ customInstructions: 'foo' });
    c.recordError('prompt_too_long', 'too long');
    const snap = c.toTerminalSnapshot();
    const json = JSON.parse(JSON.stringify(snap)) as unknown;
    const parsed = tryParseCompactTerminalSnapshot(json);
    expect(parsed).not.toBeNull();
    expect(parsed?.error?.code).toBe('prompt_too_long');
    expect(parsed?.customInstructions).toBe('foo');
  });

  it('exports the terminal kind constant', () => {
    expect(COMPACT_TERMINAL_KIND).toBe('compact_terminal');
  });

  it('mid-non-terminal-phase update does not stamp endedAt', () => {
    const c = make();
    c.setPhase('preparing');
    c.setPhase('summarizing');
    expect(c.viewModel().endedAt).toBeNull();
  });
});
