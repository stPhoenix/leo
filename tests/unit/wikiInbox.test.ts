import { describe, expect, it } from 'vitest';
import {
  annotateErrorOnRef,
  appendRow,
  parseInbox,
  serializeInbox,
  tickRef,
} from '@/agent/wiki/inbox/parse';
import { createInboxAddTool, INBOX_ADD_TOOL_ID } from '@/tools/builtin/inboxAdd';
import { WIKI_INBOX_PATH } from '@/agent/wiki/paths';
import type { ToolCtx } from '@/tools/types';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async mkdir(): Promise<void> {}
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.files.set(p, d);
  }
  async rename(): Promise<void> {}
  async remove(): Promise<void> {}
  async list(): Promise<VaultListing> {
    return { files: [], folders: [] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

function ctx(vault: FakeVault): ToolCtx {
  return {
    thread: 't1',
    signal: new AbortController().signal,
    vault,
    editor: {
      isActiveNote: () => false,
      applyActiveEdit: async () => ({ ok: false, error: 'na' }),
    },
  };
}

const SAMPLE_INBOX = `# Wiki inbox

| Source | Status | Note |
| ------ | ------ | ---- |
| https://example.com/post | open | maybe useful? |
not a row
| vault/note.md | done |  |
| attachment:abc | open |  |
`;

describe('parseInbox', () => {
  it('parses table rows + ignores non-table lines', () => {
    const parsed = parseInbox(SAMPLE_INBOX);
    expect(parsed.rows.length).toBe(3);
    expect(parsed.rows[0]).toMatchObject({
      status: 'open',
      ref: 'https://example.com/post',
      note: 'maybe useful?',
    });
    expect(parsed.rows[1]?.status).toBe('done');
    expect(parsed.rows[1]?.note).toBeNull();
    expect(parsed.otherLines.length).toBeGreaterThan(0);
  });

  it('serializeInbox preserves non-row lines verbatim', () => {
    const parsed = parseInbox(SAMPLE_INBOX);
    const serialized = serializeInbox(parsed);
    for (const o of parsed.otherLines) {
      expect(serialized.split(/\r?\n/)[o.lineIndex]).toBe(o.raw);
    }
  });

  it('parses an error row with code: msg in note cell', () => {
    const md = `| Source | Status | Note |
| ------ | ------ | ---- |
| x | error | error: fetch_failed: dns |
`;
    const parsed = parseInbox(md);
    const row = parsed.rows[0]!;
    expect(row.status).toBe('error');
    expect(row.note).toBe('error: fetch_failed: dns');
  });

  it('treats lines outside the table as non-rows', () => {
    const md = `# preamble
| not a header | foo | bar |
| more | rows | here |
`;
    const parsed = parseInbox(md);
    expect(parsed.rows.length).toBe(0);
  });
});

describe('appendRow', () => {
  it('seeds header + separator when text is empty', () => {
    const next = appendRow('', 'https://x', 'because');
    expect(next).toBe(
      '| Source | Status | Note |\n| ------ | ------ | ---- |\n| https://x | open | because |\n',
    );
  });

  it('appends below existing table when header present', () => {
    const start = `# inbox

| Source | Status | Note |
| ------ | ------ | ---- |
| earlier | open |  |
`;
    const next = appendRow(start, 'later');
    expect(next.endsWith('| later | open |  |\n')).toBe(true);
    expect(next.split('| Source | Status | Note |').length).toBe(2);
  });

  it('escapes pipe characters in ref/note', () => {
    const next = appendRow('', 'https://x?a=1|b=2', 'has | pipe');
    expect(next).toContain('| https://x?a=1\\|b=2 | open | has \\| pipe |');
  });

  it('adds header when missing in non-empty text', () => {
    const next = appendRow('# inbox\n', 'vault/a.md');
    expect(next).toContain('| Source | Status | Note |');
    expect(next).toContain('| vault/a.md | open |  |');
  });
});

describe('tickRef', () => {
  it('flips matching open row to done; leaves other rows alone', () => {
    const next = tickRef(SAMPLE_INBOX, 'https://example.com/post');
    const parsed = parseInbox(next);
    expect(parsed.rows[0]?.status).toBe('done');
    expect(parsed.rows[1]?.status).toBe('done');
    expect(parsed.rows[2]?.status).toBe('open');
  });

  it('is idempotent — ticking already-done leaves text unchanged', () => {
    const once = tickRef(SAMPLE_INBOX, 'vault/note.md');
    expect(once).toBe(SAMPLE_INBOX);
  });

  it('returns input unchanged when ref not present', () => {
    expect(tickRef(SAMPLE_INBOX, 'unknown:ref')).toBe(SAMPLE_INBOX);
  });
});

describe('annotateErrorOnRef', () => {
  it('promotes open row to error and merges code: msg into note cell', () => {
    const next = annotateErrorOnRef(
      SAMPLE_INBOX,
      'https://example.com/post',
      'fetch_failed',
      'dns',
    );
    const parsed = parseInbox(next);
    expect(parsed.rows[0]?.status).toBe('error');
    expect(parsed.rows[0]?.note).toBe('maybe useful? — error: fetch_failed: dns');
  });

  it('does not mutate already-done rows', () => {
    const next = annotateErrorOnRef(SAMPLE_INBOX, 'vault/note.md', 'extract_invalid', 'bad json');
    expect(next).toBe(SAMPLE_INBOX);
  });

  it('writes error fragment alone when row had no prior note', () => {
    const next = annotateErrorOnRef(SAMPLE_INBOX, 'attachment:abc', 'busy', 'mutex');
    const parsed = parseInbox(next);
    expect(parsed.rows[2]?.status).toBe('error');
    expect(parsed.rows[2]?.note).toBe('error: busy: mutex');
  });
});

describe('inbox_add tool', () => {
  it('registered as read-only, no confirmation, builtin', () => {
    const tool = createInboxAddTool({ vault: new FakeVault() });
    expect(tool.id).toBe(INBOX_ADD_TOOL_ID);
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.isReadOnly).toBe(true);
    expect(tool.source).toBe('builtin');
  });

  it('seeds wiki-inbox.md with header + first row when empty', async () => {
    const vault = new FakeVault();
    const tool = createInboxAddTool({ vault });
    const r = await tool.invoke({ ref: 'https://x', note: 'priority' }, ctx(vault));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.added).toBe(true);
    expect(vault.files.get(WIKI_INBOX_PATH)).toBe(
      '| Source | Status | Note |\n| ------ | ------ | ---- |\n| https://x | open | priority |\n',
    );
  });

  it('preserves existing inbox content when appending', async () => {
    const vault = new FakeVault();
    vault.files.set(
      WIKI_INBOX_PATH,
      '# inbox\n\n| Source | Status | Note |\n| ------ | ------ | ---- |\n| earlier | open |  |\n',
    );
    const tool = createInboxAddTool({ vault });
    await tool.invoke({ ref: 'later' }, ctx(vault));
    const next = vault.files.get(WIKI_INBOX_PATH)!;
    expect(next).toContain('| earlier | open |  |');
    expect(next).toContain('| later | open |  |');
  });
});
