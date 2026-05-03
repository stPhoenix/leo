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

- [ ] https://example.com/post  <!-- maybe useful? -->
not a row
- [x] vault/note.md
- [ ] attachment:abc
`;

describe('parseInbox', () => {
  it('parses open / done rows + ignores non-matching lines', () => {
    const parsed = parseInbox(SAMPLE_INBOX);
    expect(parsed.rows.length).toBe(3);
    expect(parsed.rows[0]).toMatchObject({
      status: 'open',
      ref: 'https://example.com/post',
      note: 'maybe useful?',
    });
    expect(parsed.rows[1]?.status).toBe('done');
    expect(parsed.otherLines.length).toBeGreaterThan(0);
  });

  it('serializeInbox round-trips when no edits applied (byte-identical for non-row lines)', () => {
    const parsed = parseInbox(SAMPLE_INBOX);
    const serialized = serializeInbox(parsed);
    // The serialization may slightly normalise whitespace inside rows but
    // every non-row line is preserved verbatim.
    for (const o of parsed.otherLines) {
      expect(serialized.split(/\r?\n/)[o.lineIndex]).toBe(o.raw);
    }
  });

  it('captures error annotation and treats it independently of note', () => {
    const md = `- [ ] x  <!-- pending --> <!-- error: fetch_failed: dns -->\n`;
    const parsed = parseInbox(md);
    const row = parsed.rows[0]!;
    expect(row.note).toBe('pending');
    expect(row.error?.code).toBe('fetch_failed');
    expect(row.error?.msg).toBe('dns');
  });
});

describe('appendRow', () => {
  it('appends a fresh `- [ ] ref  <!-- note -->` line', () => {
    const next = appendRow('# inbox\n', 'https://x', 'because');
    expect(next.endsWith('- [ ] https://x  <!-- because -->\n')).toBe(true);
  });

  it('omits note when not supplied', () => {
    const next = appendRow('', 'vault/a.md');
    expect(next).toBe('- [ ] vault/a.md\n');
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
  it('appends error annotation while preserving open status', () => {
    const next = annotateErrorOnRef(
      SAMPLE_INBOX,
      'https://example.com/post',
      'fetch_failed',
      'dns',
    );
    const parsed = parseInbox(next);
    expect(parsed.rows[0]?.status).toBe('open');
    expect(parsed.rows[0]?.error?.code).toBe('fetch_failed');
    expect(parsed.rows[0]?.error?.msg).toBe('dns');
  });

  it('does not flip checkbox state on done rows either', () => {
    const next = annotateErrorOnRef(SAMPLE_INBOX, 'vault/note.md', 'extract_invalid', 'bad json');
    const parsed = parseInbox(next);
    expect(parsed.rows[1]?.status).toBe('done');
    expect(parsed.rows[1]?.error?.code).toBe('extract_invalid');
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

  it('appends one well-formed line to wiki-inbox.md', async () => {
    const vault = new FakeVault();
    const tool = createInboxAddTool({ vault });
    const r = await tool.invoke({ ref: 'https://x', note: 'priority' }, ctx(vault));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.added).toBe(true);
    expect(vault.files.get(WIKI_INBOX_PATH)).toBe('- [ ] https://x  <!-- priority -->\n');
  });

  it('preserves existing inbox content when appending', async () => {
    const vault = new FakeVault();
    vault.files.set(WIKI_INBOX_PATH, '# inbox\n\n- [ ] earlier\n');
    const tool = createInboxAddTool({ vault });
    await tool.invoke({ ref: 'later' }, ctx(vault));
    const next = vault.files.get(WIKI_INBOX_PATH)!;
    expect(next).toContain('earlier');
    expect(next).toContain('later');
  });
});
