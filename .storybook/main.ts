import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../src/**/*.stories.@(ts|tsx|mdx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  typescript: { reactDocgen: 'react-docgen' },
  async viteFinal(viteConfig) {
    viteConfig.resolve = viteConfig.resolve ?? {};
    viteConfig.resolve.alias = {
      ...(viteConfig.resolve.alias ?? {}),
      '@': path.resolve(projectRoot, 'src'),
      obsidian: path.resolve(here, 'mocks/obsidian.ts'),
    };
    viteConfig.optimizeDeps = viteConfig.optimizeDeps ?? {};
    viteConfig.optimizeDeps.exclude = [
      ...(viteConfig.optimizeDeps.exclude ?? []),
      'obsidian',
      '@langchain/langgraph',
      'langchain',
    ];
    viteConfig.build = viteConfig.build ?? {};
    viteConfig.build.rollupOptions = viteConfig.build.rollupOptions ?? {};
    const existingExternal = viteConfig.build.rollupOptions.external;
    const externals = ['obsidian', '@langchain/langgraph', 'langchain'];
    viteConfig.build.rollupOptions.external = Array.isArray(existingExternal)
      ? [...existingExternal, ...externals]
      : externals;
    return viteConfig;
  },
};

export default config;
