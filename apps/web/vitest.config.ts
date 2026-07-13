// ---------------------------------------------------------------------------
// apps/web – Vitest Configuration
// ---------------------------------------------------------------------------
// Extends the root vitest config with proper resolution for apps/web.
// Uses absolute paths to avoid vitest relative-alias resolution issues.
// ---------------------------------------------------------------------------

import { defineConfig, mergeConfig } from 'vitest/config';
import rootConfig from '../../vitest.config';

const ROOT = '/home/paperboy/workspace/ide';

export default mergeConfig(rootConfig, defineConfig({
  resolve: {
    alias: {
      '@ide/contracts': `${ROOT}/packages/contracts/src`,
      '@ide/web-core': `${ROOT}/packages/web-core/src`,
      '@ide/ui': `${ROOT}/packages/ui/src`,
      '@ide/browser-adapters': `${ROOT}/packages/browser-adapters/src`,
      // Fix App.tsx import: '../adapters' resolves relative to apps/web/src,
      // so we remap it to the correct absolute path.
      '../adapters': `${ROOT}/apps/web/src/adapters`,
    },
    // Ensure .ts and .tsx extensions are resolved
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  },
}));
