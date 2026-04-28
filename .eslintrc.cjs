/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: false,
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
    'plugin:storybook/recommended',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    'no-console': ['error', { allow: ['debug', 'info', 'warn', 'error'] }],
    '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
  },
  overrides: [
    {
      // External-agent adapter implementations must not import from the
      // plugin's runtime layers (NFR-EXT-02 / Constraint C-05). The base
      // contract file itself is exempt — it only declares the abstract class
      // and types that adapters subclass.
      files: ['src/agent/externalAgent/adapters/**/*.ts'],
      excludedFiles: ['src/agent/externalAgent/adapters/base.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '@/agent/*',
                  '@/chat/*',
                  '@/ui/*',
                  '@/storage/*',
                  '@/editor/*',
                  '@/providers/*',
                  '@/skills/*',
                  '@/tools/*',
                  '@/settings/*',
                  '@/indexer/*',
                  '@/rag/*',
                  '@/mcp/*',
                  '@/platform/*',
                ],
                message:
                  'External-agent adapters must not import from runtime plugin layers (NFR-EXT-02). Allowed: zod, node:* built-ins, fetch, adapter-local helpers.',
              },
            ],
          },
        ],
      },
    },
  ],
  ignorePatterns: ['main.js', 'node_modules/', 'dist/'],
};
