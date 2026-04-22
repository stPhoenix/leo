export interface FocusedPos {
  readonly line: number;
  readonly ch: number;
}

export interface FocusedSelection {
  readonly from: FocusedPos;
  readonly to: FocusedPos;
}

export interface FocusedViewport {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface FocusedContext {
  readonly file: string | null;
  readonly cursor: FocusedPos | null;
  readonly selection: FocusedSelection | null;
  readonly viewport: FocusedViewport | null;
}

export const NULL_FOCUSED_CONTEXT: FocusedContext = {
  file: null,
  cursor: null,
  selection: null,
  viewport: null,
};

export interface FocusedContextSink {
  push(ctx: FocusedContext): void;
}
