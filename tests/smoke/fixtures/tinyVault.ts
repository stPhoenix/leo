export const TINY_VAULT_NOTE_COUNT = 10;
export const TARGET_NOTE_PATH = 'notes/target.md';

export interface TinyVaultNote {
  readonly path: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly links: readonly string[];
  readonly isTarget?: boolean;
}

export interface TinyVault {
  readonly notes: readonly TinyVaultNote[];
  readonly target: TinyVaultNote;
}

function note(
  path: string,
  body: string,
  tags: string[],
  links: string[],
  isTarget = false,
): TinyVaultNote {
  return { path, body, tags, links, isTarget };
}

export function makeTinyVault(): TinyVault {
  const target = note(
    TARGET_NOTE_PATH,
    '---\ntags: [target, smoke]\n---\n# Target note\n\nThis note is designated as the smoke-suite edit target.\nSee [[notes/a.md]] and [[notes/b.md]].\n\n## Section one\nParagraph one.\n\n## Section two\nParagraph two.\n',
    ['target', 'smoke'],
    ['notes/a.md', 'notes/b.md'],
    true,
  );
  const others = [
    note(
      'notes/a.md',
      '---\ntags: [smoke, intro]\n---\n# Intro\n\n[[notes/target.md]]',
      ['smoke', 'intro'],
      ['notes/target.md'],
    ),
    note(
      'notes/b.md',
      '---\ntags: [smoke, outline]\n---\n# Outline\n\n[[notes/target.md]]',
      ['smoke', 'outline'],
      ['notes/target.md'],
    ),
    note(
      'notes/c.md',
      '---\ntags: [smoke]\n---\n# C\n\nReferences [[notes/a.md]].',
      ['smoke'],
      ['notes/a.md'],
    ),
    note(
      'notes/d.md',
      '---\ntags: [smoke]\n---\n# D\n\nPointer to [[notes/b.md]].',
      ['smoke'],
      ['notes/b.md'],
    ),
    note(
      'notes/e.md',
      '---\ntags: [smoke, archive]\n---\n# E\n\nNotes about archive.',
      ['smoke', 'archive'],
      [],
    ),
    note(
      'notes/f.md',
      '---\ntags: [smoke]\n---\n# F\n\nSee [[notes/c.md]] and [[notes/d.md]].',
      ['smoke'],
      ['notes/c.md', 'notes/d.md'],
    ),
    note(
      'notes/g.md',
      '---\ntags: [smoke, follow-up]\n---\n# G\n\n[[notes/target.md]]',
      ['smoke', 'follow-up'],
      ['notes/target.md'],
    ),
    note(
      'notes/h.md',
      '---\ntags: [smoke]\n---\n# H\n\nLinks to [[notes/e.md]].',
      ['smoke'],
      ['notes/e.md'],
    ),
    note(
      'notes/i.md',
      '---\ntags: [smoke]\n---\n# I\n\nLinks to [[notes/f.md]].',
      ['smoke'],
      ['notes/f.md'],
    ),
  ];
  return {
    notes: [target, ...others],
    target,
  };
}
