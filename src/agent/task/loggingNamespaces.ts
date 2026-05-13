export const TASK_LOG = {
  start: 'task.start',
  busy: 'task.busy',
  denied: 'task.denied',
  phase: 'task.phase',
  toolCall: 'task.tool_call',
  done: 'task.done',
  cancelled: 'task.cancelled',
  error: 'task.error',
  noSummary: 'task.no_summary',
  reload: 'task.reload',
  ctxSignalAborted: 'task.ctxSignal.aborted',
  forbiddenToolBlocked: 'task.forbidden_tool_blocked',
} as const;
