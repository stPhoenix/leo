import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/llm/**/*.test.ts'],
    reporters: ['default'],
    testTimeout: 240_000,
    hookTimeout: 15_000,
  },
});
