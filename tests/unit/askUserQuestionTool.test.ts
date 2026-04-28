import { describe, expect, it } from 'vitest';
import { makeToolCtx } from './_toolCtx';
import { ClarifyingQuestionController } from '@/agent/clarifyingQuestionController';
import { createAskUserQuestionTool } from '@/tools/builtin/askUserQuestion';
import type { ToolCtx } from '@/tools/types';

function mainCtx(): ToolCtx {
  return { ...makeToolCtx({ thread: 't-1' }), agentId: null };
}

function subagentCtx(): ToolCtx {
  return { ...makeToolCtx({ thread: 't-1' }), agentId: 'sub-1' };
}

describe('AskUserQuestion tool', () => {
  it('schema rejects empty question, options of size 1 or 5, and unknown keys', () => {
    const tool = createAskUserQuestionTool({ controller: new ClarifyingQuestionController() });
    expect(tool.validate({ question: '' }).ok).toBe(false);
    expect(tool.validate({ question: 'q?', options: ['only-one'] }).ok).toBe(false);
    expect(tool.validate({ question: 'q?', options: ['a', 'b', 'c', 'd', 'e'] }).ok).toBe(false);
    expect(tool.validate({ question: 'q?', extra: 'no' }).ok).toBe(false);
    expect(tool.validate({ question: 'q?' }).ok).toBe(true);
    expect(tool.validate({ question: 'q?', options: ['a', 'b'] }).ok).toBe(true);
  });

  it('rejects subagent context with typed error', async () => {
    const controller = new ClarifyingQuestionController();
    const tool = createAskUserQuestionTool({ controller });
    const res = await tool.invoke({ question: 'q?' }, subagentCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/forbidden in subagent/);
    expect(controller.current()).toBeNull();
  });

  it('forwards args to controller and returns the answer on resolve', async () => {
    const controller = new ClarifyingQuestionController();
    const tool = createAskUserQuestionTool({ controller });
    const resP = tool.invoke(
      { question: 'pick?', options: ['a', 'b'], header: 'Choice' },
      mainCtx(),
    );
    await Promise.resolve();
    const pending = controller.current();
    expect(pending?.request.question).toBe('pick?');
    expect(pending?.request.options).toEqual(['a', 'b']);
    expect(pending?.request.header).toBe('Choice');
    controller.resolve({ type: 'answer', answer: 'a' });
    const res = await resP;
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ answer: 'a' });
  });

  it('returns multi answers for multiSelect', async () => {
    const controller = new ClarifyingQuestionController();
    const tool = createAskUserQuestionTool({ controller });
    const resP = tool.invoke(
      { question: 'tags?', options: ['x', 'y', 'z'], multiSelect: true },
      mainCtx(),
    );
    await Promise.resolve();
    controller.resolve({ type: 'answerMulti', answers: ['x', 'z'] });
    const res = await resP;
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ answers: ['x', 'z'] });
  });

  it('returns user-cancelled error on cancel', async () => {
    const controller = new ClarifyingQuestionController();
    const tool = createAskUserQuestionTool({ controller });
    const resP = tool.invoke({ question: 'q?' }, mainCtx());
    await Promise.resolve();
    controller.resolve({ type: 'cancel' });
    const res = await resP;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/user cancelled/);
  });

  it('is read-only and requires no confirmation', () => {
    const tool = createAskUserQuestionTool({ controller: new ClarifyingQuestionController() });
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.isReadOnly).toBe(true);
  });
});
