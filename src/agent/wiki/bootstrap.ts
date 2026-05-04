import type { Logger } from '@/platform/Logger';
import type { ExcludeListStore } from '@/settings/excludeListStore';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { INTRODUCTION_MD } from '@/agent/wiki/seed/introduction';
import { SCHEMA_MD } from '@/agent/wiki/seed/schema';
import {
  WIKI_DIR,
  WIKI_DIR_PREFIX,
  WIKI_INBOX_PATH,
  WIKI_INDEX_PATH,
  WIKI_INTRODUCTION_PATH,
  WIKI_LOG_PATH,
  WIKI_PAGES_DIR,
  WIKI_RAW_DIR,
  WIKI_SCHEMA_PATH,
  WIKI_SOURCES_DIR,
} from '@/agent/wiki/paths';

export interface WikiBootstrapOptions {
  readonly vault: VaultAdapter;
  readonly excludeStore: ExcludeListStore;
  readonly logger?: Logger;
}

export interface WikiBootstrapResult {
  readonly created: readonly string[];
  readonly seeded: readonly string[];
  readonly excludeRegistered: boolean;
}

const SEED_INDEX_MD =
  '# Wiki index\n\n_This catalog is regenerated on every ingest. It is empty until the first run._\n';
const SEED_LOG_MD = '# Wiki log\n\n_Append-only chronological record of ingest and lint runs._\n';
const SEED_INBOX_MD =
  '# Wiki inbox\n\n<!-- Append rows to the table below. Run `/wiki-ingest` to drain. -->\n\n| Source | Status | Note |\n| ------ | ------ | ---- |\n';

export async function bootstrapWiki(opts: WikiBootstrapOptions): Promise<WikiBootstrapResult> {
  const { vault, excludeStore, logger } = opts;
  const created: string[] = [];
  const seeded: string[] = [];

  for (const dir of [WIKI_DIR, WIKI_RAW_DIR, WIKI_SOURCES_DIR, WIKI_PAGES_DIR]) {
    const existed = await vault.exists(dir);
    await vault.mkdir(dir);
    if (!existed) created.push(dir);
  }

  const seeds: ReadonlyArray<readonly [string, string]> = [
    [WIKI_INBOX_PATH, SEED_INBOX_MD],
    [WIKI_INTRODUCTION_PATH, INTRODUCTION_MD],
    [WIKI_SCHEMA_PATH, SCHEMA_MD],
    [WIKI_INDEX_PATH, SEED_INDEX_MD],
    [WIKI_LOG_PATH, SEED_LOG_MD],
  ];
  for (const [path, body] of seeds) {
    if (await vault.exists(path)) continue;
    await vault.write(path, body);
    seeded.push(path);
  }

  const dirRegistered = excludeStore.ensureDefaultPrefix(WIKI_DIR_PREFIX);
  const inboxRegistered = excludeStore.ensureDefaultPattern(WIKI_INBOX_PATH);
  const excludeRegistered = dirRegistered || inboxRegistered;

  logger?.info('wiki.bootstrap.done', {
    created: created.length,
    seeded: seeded.length,
    excludeRegistered,
  });

  return { created, seeded, excludeRegistered };
}
