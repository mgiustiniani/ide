// ---------------------------------------------------------------------------
// apps/web – minimal Vitest e2e configuration
// ---------------------------------------------------------------------------
// Keeps `pnpm test:e2e` executable even before browser-level e2e specs exist.
// ---------------------------------------------------------------------------

import { defineConfig } from 'vitest/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const reactPlugin = require('@vitejs/plugin-react').default;
const ROOT = '/home/paperboy/workspace/ide';

export default defineConfig({
  plugins: [reactPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    passWithNoTests: true,
    include: [
      'src/**/*.e2e.test.ts',
      'src/**/*.e2e.test.tsx',
      'src/**/*.e2e.spec.ts',
      'src/**/*.e2e.spec.tsx',
      'e2e/**/*.test.ts',
      'e2e/**/*.test.tsx',
      'e2e/**/*.spec.ts',
      'e2e/**/*.spec.tsx',
    ],
    setupFiles: [`${ROOT}/vitest.setup.ts`],
  },
  resolve: {
    alias: {
      '@ide/contracts': `${ROOT}/packages/contracts/src`,
      '@ide/web-core': `${ROOT}/packages/web-core/src`,
      '@ide/ui': `${ROOT}/packages/ui/src`,
      '@ide/browser-adapters': `${ROOT}/packages/browser-adapters/src`,
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  },
});
