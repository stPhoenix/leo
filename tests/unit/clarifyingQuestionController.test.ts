import { describe, expect, it } from 'vitest';
import { ClarifyingQuestionController } from '@/agent/clarifyingQuestionController';

describe('ClarifyingQuestionController', () => {
  it('present resolves with answer when resolve(answer) is called', async () => {
    const c = new ClarifyingQuestionController();
    const p = c.present({ threadId: 't-1', question: 'pick one?', options: ['a', 'b'] });
    expect(c.current()).not.toBeNull();
    c.resolve({ type: 'answer', answer: 'a' });
    const outcome = await p;
    expect(outcome).toEqual({ type: 'answer', answer: 'a' });
    expect(c.current()).toBeNull();
  });

  it('present resolves with multi-answer for multiSelect', async () => {
    const c = new ClarifyingQuestionController();
    const p = c.present({
      threadId: 't-1',
      question: 'tags?',
      options: ['x', 'y', 'z'],
      multiSelect: true,
    });
    c.resolve({ type: 'answerMulti', answers: ['x', 'z'] });
    expect(await p).toEqual({ type: 'answerMulti', answers: ['x', 'z'] });
  });

  it('present resolves with cancel when resolve(cancel) is called', async () => {
    const c = new ClarifyingQuestionController();
    const p = c.present({ threadId: 't-1', question: 'foo?' });
    c.resolve({ type: 'cancel' });
    expect(await p).toEqual({ type: 'cancel' });
  });

  it('second present while first is pending cancels the first and replaces it', async () => {
    const c = new ClarifyingQuestionController();
    const p1 = c.present({ threadId: 't-1', question: 'first?' });
    const p2 = c.present({ threadId: 't-1', question: 'second?' });
    expect(await p1).toEqual({ type: 'cancel' });
    c.resolve({ type: 'answer', answer: 'ok' });
    expect(await p2).toEqual({ type: 'answer', answer: 'ok' });
  });

  it('subscribe is called on present and resolve', async () => {
    const c = new ClarifyingQuestionController();
    const events: number[] = [];
    c.subscribe(() => events.push(events.length));
    const p = c.present({ threadId: 't-1', question: 'foo?' });
    expect(events.length).toBe(1);
    c.resolve({ type: 'answer', answer: 'x' });
    await p;
    expect(events.length).toBe(2);
  });

  it('dispose cancels pending and clears listeners', async () => {
    const c = new ClarifyingQuestionController();
    const p = c.present({ threadId: 't-1', question: 'foo?' });
    c.dispose();
    expect(await p).toEqual({ type: 'cancel' });
    expect(c.current()).toBeNull();
  });
});
