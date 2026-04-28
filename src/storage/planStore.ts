import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from './vaultAdapter';

export const DEFAULT_PLANS_DIR = '.leo/plans';
const MAX_SLUG_RETRIES = 10;

const ADJECTIVES = [
  'quiet',
  'brave',
  'sharp',
  'calm',
  'eager',
  'steady',
  'swift',
  'gentle',
  'humble',
  'keen',
  'warm',
  'clear',
  'solid',
  'fresh',
  'nimble',
  'steady',
  'bold',
  'loyal',
];

const NOUNS = [
  'otter',
  'heron',
  'cedar',
  'island',
  'ember',
  'cobble',
  'harbor',
  'lantern',
  'ripple',
  'meadow',
  'compass',
  'ridge',
  'current',
  'willow',
  'hollow',
  'anchor',
  'cobble',
  'beacon',
];

export class PlanSlugExhausted extends Error {
  override readonly name = 'PlanSlugExhausted';
}
export class PlanPathEscape extends Error {
  override readonly name = 'PlanPathEscape';
}

export interface PlanStoreOptions {
  readonly vault: VaultAdapter;
  readonly logger?: Logger;
  readonly configuredDir?: string;
  readonly random?: () => number;
}

export class PlanStore {
  private readonly vault: VaultAdapter;
  private readonly logger: Logger | undefined;
  private readonly dir: string;
  private readonly random: () => number;
  // TODO: persist slug in ChatMessageRecord for filename continuity across reload
  private readonly slugBySession = new Map<string, string>();

  constructor(opts: PlanStoreOptions) {
    this.vault = opts.vault;
    this.logger = opts.logger;
    this.random = opts.random ?? Math.random;
    const configured = opts.configuredDir;
    if (configured === undefined || configured.length === 0) {
      this.dir = DEFAULT_PLANS_DIR;
    } else if (!isSafeRelative(configured)) {
      this.logger?.warn('plan.dir.fallback', { configured });
      this.dir = DEFAULT_PLANS_DIR;
    } else {
      this.dir = normalizeSlashes(configured);
    }
  }

  async currentSlug(sessionId: string): Promise<string> {
    const cached = this.slugBySession.get(sessionId);
    if (cached !== undefined) return cached;
    for (let i = 0; i < MAX_SLUG_RETRIES + 1; i += 1) {
      const candidate = this.randomSlug();
      const path = this.planPath(candidate);
      const exists = await this.vault.exists(path).catch(() => false);
      if (!exists) {
        this.slugBySession.set(sessionId, candidate);
        this.logger?.debug('plan.slug.generated', { sessionId, slug: candidate, retries: i });
        return candidate;
      }
      this.logger?.debug('plan.slug.collision', { sessionId, slug: candidate, retries: i });
    }
    this.logger?.error('plan.slug.collision-exhausted', { sessionId, retries: MAX_SLUG_RETRIES });
    throw new PlanSlugExhausted(
      `could not generate a unique plan slug after ${MAX_SLUG_RETRIES} retries`,
    );
  }

  setSlug(sessionId: string, slug: string): void {
    if (!/^[a-z]+-[a-z]+$/.test(slug)) {
      throw new PlanPathEscape(`invalid plan slug: ${slug}`);
    }
    this.slugBySession.set(sessionId, slug);
  }

  resetSlug(sessionId: string): void {
    this.slugBySession.delete(sessionId);
  }

  async writePlan(sessionId: string, content: string): Promise<string> {
    const slug = await this.currentSlug(sessionId);
    const path = this.planPath(slug);
    await this.vault.mkdir(this.dir);
    await this.vault.write(path, content);
    this.logger?.info('plan.write', { sessionId, slug, bytes: content.length });
    return path;
  }

  async readPlan(sessionId: string): Promise<string | null> {
    const slug = await this.currentSlug(sessionId);
    const path = this.planPath(slug);
    if (!(await this.vault.exists(path))) return null;
    const content = await this.vault.read(path);
    this.logger?.info('plan.read', { sessionId, slug, bytes: content.length });
    return content;
  }

  planPath(slug: string): string {
    if (!/^[a-z]+-[a-z]+$/.test(slug)) {
      this.logger?.error('plan.path.traversal-rejected', { slug, reason: 'bad slug shape' });
      throw new PlanPathEscape(`invalid plan slug: ${slug}`);
    }
    const path = `${this.dir}/${slug}.md`;
    const normalized = normalizeSlashes(path);
    if (!normalized.startsWith(`${this.dir}/`)) {
      this.logger?.error('plan.path.traversal-rejected', { slug, path });
      throw new PlanPathEscape(`plan path escapes dir: ${path}`);
    }
    return normalized;
  }

  currentDir(): string {
    return this.dir;
  }

  private randomSlug(): string {
    const a = ADJECTIVES[Math.floor(this.random() * ADJECTIVES.length)] ?? 'quiet';
    const n = NOUNS[Math.floor(this.random() * NOUNS.length)] ?? 'otter';
    return `${a}-${n}`;
  }
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function isSafeRelative(p: string): boolean {
  if (p.length === 0) return false;
  if (p.startsWith('/')) return false;
  if (/^[a-z]:[\\/]/i.test(p)) return false;
  const parts = p.replace(/\\/g, '/').split('/');
  let depth = 0;
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      depth -= 1;
      if (depth < 0) return false;
    } else depth += 1;
  }
  return true;
}
