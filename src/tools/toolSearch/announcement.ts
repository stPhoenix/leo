export function formatDeferredAnnouncement(
  deferredNames: ReadonlySet<string>,
  previouslyAnnounced: ReadonlySet<string>,
): string | null {
  if (deferredNames.size === 0 && previouslyAnnounced.size === 0) return null;
  if (setsEqual(deferredNames, previouslyAnnounced)) return null;
  if (deferredNames.size === 0) {
    return '<system-reminder>\nDeferred tool pool is now empty.\n</system-reminder>';
  }
  const sorted = [...deferredNames].sort((a, b) => a.localeCompare(b));
  const lines = sorted.join('\n');
  return (
    '<system-reminder>\n' +
    'The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:\n' +
    lines +
    '\n</system-reminder>'
  );
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
