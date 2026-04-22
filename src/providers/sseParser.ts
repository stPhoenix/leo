export async function* parseSseDataFrames(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      if (signal.aborted) return;
      const { value, done } = await reader.read();
      if (done) {
        if (buffer.length > 0) {
          for (const data of extractDataFrames(buffer)) yield data;
        }
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const data of extractDataFrames(block)) yield data;
        sep = buffer.indexOf('\n\n');
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* lock already released by upstream cancel */
    }
  }
}

function* extractDataFrames(block: string): IterableIterator<string> {
  const dataLines: string[] = [];
  for (const raw of block.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (dataLines.length > 0) {
    yield dataLines.join('\n');
  }
}
