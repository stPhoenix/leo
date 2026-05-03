export type InlineRoute = 'simple' | 'multistep';
export type RoutingMode = 'auto' | 'simple' | 'deep';

export interface NoteRecord {
  readonly id: string;
  readonly stepIndex: number | null;
  readonly sourceUrl?: string;
  readonly title: string;
  readonly summary: string;
  readonly relevance: number;
  readonly createdAt: number;
}

export interface PublishedArtifact {
  readonly relPath: string;
  readonly summary?: string;
}

export type InlineTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface InlineTodo {
  readonly id: string;
  readonly content: string;
  readonly status: InlineTodoStatus;
}

export interface InlineAgentRunState {
  readonly runId: string;
  readonly sandboxRoot: string;
  route: InlineRoute | null;
  routingMode: RoutingMode;
  plan?: readonly string[];
  currentStep?: number;
  notes: NoteRecord[];
  scratchpad: string;
  iterations: number;
  cumulativeTokens: number;
  sandboxBytes: number;
  publishedArtifacts: PublishedArtifact[];
  todos: InlineTodo[];
  startedAt: number;
}

export const NOTE_SUMMARY_MAX_BYTES = 2 * 1024;

export function createInitialRunState(input: {
  readonly runId: string;
  readonly sandboxRoot: string;
  readonly routingMode: RoutingMode;
  readonly startedAt: number;
}): InlineAgentRunState {
  return {
    runId: input.runId,
    sandboxRoot: input.sandboxRoot,
    route: null,
    routingMode: input.routingMode,
    notes: [],
    scratchpad: '',
    iterations: 0,
    cumulativeTokens: 0,
    sandboxBytes: 0,
    publishedArtifacts: [],
    todos: [],
    startedAt: input.startedAt,
  };
}

export function incrementIterations(state: InlineAgentRunState, n = 1): void {
  if (n < 0) throw new Error('iterations delta must be non-negative');
  state.iterations += n;
}

export function addTokens(state: InlineAgentRunState, n: number): void {
  if (n < 0) throw new Error('token delta must be non-negative');
  state.cumulativeTokens += n;
}

export function setRoute(state: InlineAgentRunState, route: InlineRoute): void {
  state.route = route;
}

export function setPlan(state: InlineAgentRunState, plan: readonly string[]): void {
  state.plan = [...plan];
  state.currentStep = 0;
}

export function advanceStep(state: InlineAgentRunState): void {
  state.currentStep = (state.currentStep ?? 0) + 1;
}

export function appendNote(state: InlineAgentRunState, record: NoteRecord): NoteRecord {
  if (record.relevance < 0 || record.relevance > 1) {
    throw new Error('NoteRecord.relevance must be in [0, 1]');
  }
  const summarySize = Buffer.byteLength(record.summary, 'utf-8');
  if (summarySize > NOTE_SUMMARY_MAX_BYTES) {
    throw new Error('NoteRecord.summary exceeds 2 KB');
  }
  state.notes.push(record);
  return record;
}

export function setSandboxBytes(state: InlineAgentRunState, n: number): void {
  state.sandboxBytes = Math.max(0, n);
}

export function appendPublishedArtifact(
  state: InlineAgentRunState,
  artifact: PublishedArtifact,
): void {
  state.publishedArtifacts.push(artifact);
}

export function setTodos(state: InlineAgentRunState, todos: readonly InlineTodo[]): void {
  state.todos = todos.map((t) => ({ id: t.id, content: t.content, status: t.status }));
}
