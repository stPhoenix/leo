import { expect, it } from 'vitest';
import { AgentRunner } from '@/agent/agentRunner';
import type { FocusedContextSource } from '@/agent/agentRunner';
import type { AgentTurnEvent } from '@/agent/types';
import { NULL_FOCUSED_CONTEXT } from '@/editor/types';
import { LMStudioProvider } from '@/providers/lmStudioProvider';
import { AcceptRejectController } from '@/agent/acceptRejectController';
import { createReadNoteTool } from '@/tools/readNoteTool';
import { createEditNoteTool } from '@/tools/editNoteTool';
import { liveDescribe, skipIfUnreachable } from './_liveEnv';
import { makeJudge } from './_judge';
import { InMemoryVault, inactiveBridge, silentLogger, spyingRegistry } from './_fakes';

const NOTE_PATH = 'Notes/ProjectAlpha.md';
const NOTE_CONTENT = [
  '# Project Alpha',
  '',
  'Alpha is a weekend prototype for a local-first bookmark manager.',
  'It stores everything in SQLite and uses a Rust CLI.',
  'Next milestone: export to Markdown.',
].join('\n');

const focus: FocusedContextSource = { current: () => NULL_FOCUSED_CONTEXT };

liveDescribe('live: AgentRunner end-to-end', (getCtx) => {
  it('calls read_note then produces a judge-approved summary', async (t) => {
    const ctx = getCtx();
    if (skipIfUnreachable(t, ctx)) return;

    const vault = new InMemoryVault({ [NOTE_PATH]: NOTE_CONTENT });
    const acceptReject = new AcceptRejectController();
    autoAccept(acceptReject);
    const { logger } = silentLogger();
    const { registry, calls } = spyingRegistry([
      createReadNoteTool(vault),
      createEditNoteTool({ vault, bridge: inactiveBridge(), acceptReject, logger }),
    ]);
    const provider = new LMStudioProvider({ endpoint: () => ctx.env.endpoint });

    const runner = new AgentRunner({
      provider,
      focusedContext: focus,
      logger,
      model: () => ctx.env.chatModel,
      toolRegistry: registry,
      maxToolRoundTrips: 4,
      confirmTool: async () => 'allow-once',
    });

    const text = await runTurn(
      runner,
      't-read',
      [
        `Read the note at path "${NOTE_PATH}" using the read_note tool, then summarise its contents in one sentence.`,
      ].join(' '),
    );
    runner.dispose();

    expect(calls.map((c) => c.id)).toContain('read_note');
    const readArgs = calls.find((c) => c.id === 'read_note')?.args as { path?: string } | undefined;
    expect(readArgs?.path).toBe(NOTE_PATH);

    const judge = makeJudge(provider, ctx.env.judgeModel, ctx.env.timeoutMs);
    const verdict = await judge({
      task: `Summarise the contents of a note describing "${NOTE_PATH}" in one sentence.`,
      response: text,
      rubric:
        'Must mention Project Alpha OR bookmark manager OR SQLite OR Rust. Must be one or two sentences. Must not be empty.',
    });
    if (!verdict.pass) {
      throw new Error(`judge rejected: ${verdict.reason}\n--- response ---\n${text}`);
    }
  }, 240_000);

  it('does not invoke tools for plain conversational prompts', async (t) => {
    const ctx = getCtx();
    if (skipIfUnreachable(t, ctx)) return;

    const vault = new InMemoryVault();
    const acceptReject = new AcceptRejectController();
    autoAccept(acceptReject);
    const { logger } = silentLogger();
    const { registry, calls } = spyingRegistry([
      createReadNoteTool(vault),
      createEditNoteTool({ vault, bridge: inactiveBridge(), acceptReject, logger }),
    ]);
    const provider = new LMStudioProvider({ endpoint: () => ctx.env.endpoint });

    const runner = new AgentRunner({
      provider,
      focusedContext: focus,
      logger,
      model: () => ctx.env.chatModel,
      toolRegistry: registry,
      maxToolRoundTrips: 2,
      confirmTool: async () => 'allow-once',
    });

    const text = await runTurn(runner, 't-chat', 'Say hello back to me in one short sentence.');
    runner.dispose();

    expect(calls.length).toBe(0);
    expect(text.trim().length).toBeGreaterThan(0);
  }, 180_000);
});

async function runTurn(runner: AgentRunner, thread: string, content: string): Promise<string> {
  const events: AgentTurnEvent[] = [];
  let text = '';
  for await (const ev of runner.send({ thread, message: { role: 'user', content } })) {
    events.push(ev);
    if (ev.type === 'token') text += ev.text;
    if (ev.type === 'error') {
      throw ev.error;
    }
    if (ev.type === 'done') break;
  }
  return text;
}

function autoAccept(controller: AcceptRejectController): () => void {
  return controller.subscribe((pending) => {
    if (pending !== null) {
      queueMicrotask(() => controller.resolve('accept'));
    }
  });
}
