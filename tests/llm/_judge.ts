import type { LMStudioProvider } from '@/providers/lmStudioProvider';
import type { ChatMessage, ProviderChatRequest } from '@/providers/types';

export interface JudgeInput {
  readonly task: string;
  readonly response: string;
  readonly rubric: string;
}

export interface Verdict {
  readonly pass: boolean;
  readonly score: number;
  readonly reason: string;
}

export interface Judge {
  (input: JudgeInput): Promise<Verdict>;
}

const JUDGE_SYSTEM = `You are a strict test grader. You receive a task description, a model's response, and a rubric. Return ONLY a single JSON object on one line with this exact shape: {"pass": boolean, "score": integer 0-10, "reason": "short string"}. No preamble, no markdown, no code fences. If the response satisfies the rubric, pass=true. Otherwise pass=false. score reflects overall quality: 0 terrible, 10 perfect.`;

export function makeJudge(provider: LMStudioProvider, model: string, timeoutMs = 60_000): Judge {
  return async (input) => {
    const userContent = [
      `Task:\n${input.task}`,
      `Response:\n${input.response}`,
      `Rubric:\n${input.rubric}`,
      'Reply with a single JSON object only.',
    ].join('\n\n');

    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await callJudge(provider, model, userContent, timeoutMs);
      const parsed = tryParseVerdict(raw);
      if (parsed !== null) return parsed;
      if (attempt === 1) {
        throw new Error(`judge: unparseable verdict after retry. raw="${raw.slice(0, 500)}"`);
      }
    }
    throw new Error('judge: unreachable');
  };
}

async function callJudge(
  provider: LMStudioProvider,
  model: string,
  userContent: string,
  timeoutMs: number,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: userContent },
  ];
  const req: ProviderChatRequest = {
    model,
    messages,
    temperature: 0.1,
    maxTokens: 4000,
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let text = '';
  try {
    for await (const ev of provider.stream(req, ctl.signal)) {
      if (ev.type === 'block_delta' && ev.delta.type === 'text_delta') text += ev.delta.text;
    }
  } finally {
    clearTimeout(timer);
  }
  return text.trim();
}

function tryParseVerdict(raw: string): Verdict | null {
  const cleaned = stripFences(raw).trim();
  const jsonSlice = extractFirstJsonObject(cleaned);
  if (jsonSlice === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const pass = obj.pass;
  const score = obj.score;
  const reason = obj.reason;
  if (typeof pass !== 'boolean') return null;
  if (typeof score !== 'number') return null;
  if (typeof reason !== 'string') return null;
  return { pass, score, reason };
}

function stripFences(s: string): string {
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(s);
  if (fence !== null && fence[1] !== undefined) return fence[1];
  return s;
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
