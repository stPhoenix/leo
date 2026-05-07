// Doc §8 dynamic skill-dir discovery. Leo deviations:
//   - No `git check-ignore`; instead walks up from touched paths but stops at
//     a hardcoded ignore list (node_modules, .git, .obsidian) and at the cwd.

const IGNORED_DIR_NAMES: ReadonlySet<string> = new Set(['node_modules', '.git', '.obsidian']);

export interface DynamicDiscoveryOptions {
  readonly cwd: string;
  readonly skillsSubdir: string;
  readonly exists: (path: string) => Promise<boolean> | boolean;
}

export interface DynamicDiscoveryResult {
  readonly newRoots: readonly string[];
}

export class DynamicDiscovery {
  private readonly cwd: string;
  private readonly skillsSubdir: string;
  private readonly exists: (path: string) => Promise<boolean> | boolean;
  private readonly checked = new Map<string, boolean>();

  constructor(opts: DynamicDiscoveryOptions) {
    this.cwd = normalize(opts.cwd);
    this.skillsSubdir = opts.skillsSubdir.replace(/^\/+|\/+$/g, ''); // NOSONAR(typescript:S5852): anchored slash trim, linear.
    this.exists = opts.exists;
  }

  async observeFileTouch(relativePath: string): Promise<DynamicDiscoveryResult> {
    const cleaned = normalize(relativePath).replace(/^\/+/, '');
    if (cleaned.length === 0) return { newRoots: [] };
    const segments = cleaned.split('/');
    segments.pop();
    const newRoots: string[] = [];
    while (segments.length > 0) {
      const last = segments[segments.length - 1];
      if (last !== undefined && IGNORED_DIR_NAMES.has(last)) return { newRoots };
      const dirRelative = segments.join('/');
      if (dirRelative.length === 0) break;
      const candidate = `${dirRelative}/${this.skillsSubdir}`;
      if (!this.checked.has(candidate)) {
        const result = await Promise.resolve(this.exists(candidate));
        this.checked.set(candidate, result);
        if (result) newRoots.push(candidate);
      } else if (this.checked.get(candidate) === true) {
        newRoots.push(candidate);
      }
      segments.pop();
    }
    newRoots.sort((a, b) => b.length - a.length);
    return { newRoots };
  }

  clearCache(): void {
    this.checked.clear();
  }
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/');
}
