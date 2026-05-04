#!/usr/bin/env node
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');
const releaseDir = join(root, 'release');
const artifacts = ['main.js', 'manifest.json', 'styles.css'];

await mkdir(releaseDir, { recursive: true });

const fmtKB = (n) => `${(n / 1024).toFixed(1)} KB`;

for (const name of artifacts) {
  const src = join(root, name);
  let info;
  try {
    info = await stat(src);
  } catch {
    console.error(`bundleRelease: missing ${src} — run \`pnpm build\` first.`);
    process.exit(1);
  }
  await copyFile(src, join(releaseDir, name));
  console.log(`bundleRelease: copied ${name} (${fmtKB(info.size)})`);
}

const mainSize = (await stat(join(releaseDir, 'main.js'))).size;
console.log(`bundleRelease: release/ ready — main.js = ${fmtKB(mainSize)}`);
