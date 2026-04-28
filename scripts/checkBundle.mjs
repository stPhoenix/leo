#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');
const bundlePath = join(root, 'main.js');
const baselinePath = join(root, '.agent', 'budgets', 'bundle-baseline.json');

let actualBytes;
try {
  actualBytes = statSync(bundlePath).size;
} catch (err) {
  console.error(`check:bundle: cannot read ${bundlePath} — run \`pnpm build\` first.`);
  process.exit(2);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch (err) {
  console.error(`check:bundle: cannot read baseline ${baselinePath}:`, err.message);
  process.exit(2);
}

const baselineBytes = Number(baseline.baselineBytes);
const maxDeltaBytes = Number(baseline.maxDeltaBytes);
if (!Number.isFinite(baselineBytes) || !Number.isFinite(maxDeltaBytes)) {
  console.error('check:bundle: malformed baseline (baselineBytes / maxDeltaBytes must be numbers).');
  process.exit(2);
}

const delta = actualBytes - baselineBytes;
const fmt = (n) => `${n} bytes (${(n / 1024).toFixed(1)} KB)`;
console.log(`check:bundle: main.js = ${fmt(actualBytes)}; baseline = ${fmt(baselineBytes)}; delta = ${fmt(delta)} (cap ${fmt(maxDeltaBytes)}).`);

if (delta > maxDeltaBytes) {
  console.error(
    `check:bundle: FAIL — bundle grew by ${delta} bytes; cap is ${maxDeltaBytes} bytes. ` +
      `Either reduce bundle weight, lazy-load the addition, or update .agent/budgets/bundle-baseline.json with a justification.`,
  );
  process.exit(1);
}
console.log('check:bundle: OK');
