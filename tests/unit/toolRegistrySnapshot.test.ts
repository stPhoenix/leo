// Guards the OpenAI tools payload shape emitted by ToolRegistry.toOpenAITools() so
// migrations of the underlying schema source (hand-rolled → zod → future) cannot
// silently change what the model sees. Focus on structural invariants, not zod-
// internal metadata that may legitimately drift.

import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '@/tools/toolRegistry';
import { createReadNoteTool } from '@/tools/builtin/readNote';
import { createEditNoteTool } from '@/tools/builtin/editNote';
import { createCreateNoteTool } from '@/tools/builtin/createNote';
import { createAppendToNoteTool } from '@/tools/builtin/appendToNote';
import { createCreateFolderTool } from '@/tools/builtin/createFolder';
import { createListNotesTool } from '@/tools/builtin/listNotes';
import { createSearchVaultTool } from '@/tools/builtin/searchVault';
import { createRenameNoteTool } from '@/tools/builtin/renameNote';
import { createMoveNoteTool } from '@/tools/builtin/moveNote';
import { createCopyNoteTool } from '@/tools/builtin/copyNote';
import { createDeleteNoteTool } from '@/tools/builtin/deleteNote';
import { createDeleteFolderTool } from '@/tools/builtin/deleteFolder';
import type { AcceptRejectController } from '@/agent/acceptRejectController';
import type { SearchVaultEngine } from '@/tools/builtin/searchVault';

function fakeAcceptReject(): AcceptRejectController {
  return { present: async () => 'accept' } as unknown as AcceptRejectController;
}

function fakeSearch(): SearchVaultEngine {
  return { query: async () => ({ hits: [] }) };
}

describe('toolRegistry.toOpenAITools — built-in tool snapshot', () => {
  const registry = new ToolRegistry();
  registry.register(createReadNoteTool());
  registry.register(createCreateNoteTool({ acceptReject: fakeAcceptReject() }));
  registry.register(createAppendToNoteTool({ acceptReject: fakeAcceptReject() }));
  registry.register(createCreateFolderTool());
  registry.register(createListNotesTool());
  registry.register(createEditNoteTool({ acceptReject: fakeAcceptReject() }));
  registry.register(createSearchVaultTool(fakeSearch()));
  registry.register(createRenameNoteTool({ acceptReject: fakeAcceptReject() }));
  registry.register(createMoveNoteTool({ acceptReject: fakeAcceptReject() }));
  registry.register(createCopyNoteTool({ acceptReject: fakeAcceptReject() }));
  registry.register(createDeleteNoteTool({ acceptReject: fakeAcceptReject() }));
  registry.register(createDeleteFolderTool({ acceptReject: fakeAcceptReject() }));
  const tools = registry.toOpenAITools('t1');

  it('exposes every registered built-in tool with the stable id + function wrapper', () => {
    const ids = tools.map((t) => t.function.name).sort();
    expect(ids).toEqual([
      'append_to_note',
      'copy_note',
      'create_folder',
      'create_note',
      'delete_folder',
      'delete_note',
      'edit_note',
      'list_notes',
      'move_note',
      'read_note',
      'rename_note',
      'search_vault',
    ]);
    for (const t of tools) expect(t.type).toBe('function');
  });

  it('every tool parameters block is a JSON Schema object with type:"object" and additionalProperties:false', () => {
    for (const t of tools) {
      const p = t.function.parameters as Record<string, unknown>;
      expect(p.type).toBe('object');
      expect(p.additionalProperties).toBe(false);
      expect(typeof p.properties).toBe('object');
    }
  });

  it('path-accepting tools require path and declare it as a string', () => {
    for (const id of [
      'read_note',
      'create_note',
      'append_to_note',
      'create_folder',
      'edit_note',
      'rename_note',
      'move_note',
      'copy_note',
      'delete_note',
      'delete_folder',
    ]) {
      const t = tools.find((x) => x.function.name === id)!;
      const p = t.function.parameters as {
        properties: { path: { type: string } };
        required: readonly string[];
      };
      expect(p.properties.path.type).toBe('string');
      expect(p.required).toContain('path');
    }
  });

  it('rename/move/copy require both path and new_path', () => {
    for (const id of ['rename_note', 'move_note', 'copy_note']) {
      const t = tools.find((x) => x.function.name === id)!;
      const p = t.function.parameters as {
        properties: { path: { type: string }; new_path: { type: string } };
        required: readonly string[];
      };
      expect(p.properties.new_path.type).toBe('string');
      expect(p.required).toContain('path');
      expect(p.required).toContain('new_path');
    }
  });

  it('edit_note requires the four editor args', () => {
    const t = tools.find((x) => x.function.name === 'edit_note')!;
    const p = t.function.parameters as { required: readonly string[] };
    expect([...p.required].sort()).toEqual(
      ['line_end', 'line_start', 'new_content', 'path'].sort(),
    );
  });

  it('search_vault exposes query (required) + tags (optional array of strings)', () => {
    const t = tools.find((x) => x.function.name === 'search_vault')!;
    const p = t.function.parameters as {
      properties: { query: { type: string }; tags?: { type: string; items: { type: string } } };
      required: readonly string[];
    };
    expect(p.properties.query.type).toBe('string');
    expect(p.required).toContain('query');
    expect(p.required).not.toContain('tags');
    expect(p.properties.tags?.type).toBe('array');
    expect(p.properties.tags?.items.type).toBe('string');
  });

  it('descriptions are preserved from the tool spec', () => {
    const read = tools.find((x) => x.function.name === 'read_note')!;
    expect(read.function.description).toContain('Read the contents');
    const edit = tools.find((x) => x.function.name === 'edit_note')!;
    expect(edit.function.description).toContain('Replace a line range');
  });
});
