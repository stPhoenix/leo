import { setupServer } from 'msw/node';
import type { SetupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

export function setupMswServer(): SetupServer {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}

export function sseChunk(payload: unknown): string {
  return `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`;
}

export function chatChunk(content: string): string {
  return sseChunk({
    id: 'chunk',
    object: 'chat.completion.chunk',
    choices: [{ delta: { content }, finish_reason: null }],
  });
}

export function chatUsageChunk(input: number, output: number): string {
  return sseChunk({
    id: 'chunk',
    object: 'chat.completion.chunk',
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
  });
}

export const SSE_DONE = sseChunk('[DONE]');
