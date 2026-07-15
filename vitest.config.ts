// ---------------------------------------------------------------------------
// Root Vitest Configuration
// ---------------------------------------------------------------------------
// Centralised Vitest config for all packages in the IDE monorepo.
// Uses jsdom environment for component tests, enables globals for convenience.
// ---------------------------------------------------------------------------

import { defineConfig } from "vitest/config";
import { createRequire } from "module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const reactPlugin = require("@vitejs/plugin-react").default;
const workspaceRoot = fileURLToPath(new URL(".", import.meta.url));
const fromWorkspace = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [reactPlugin()],
  test: {
    // Set root to the workspace root
    root: workspaceRoot,
    // Use jsdom for React component rendering
    environment: "jsdom",
    // Enable globals (describe, it, expect, vi) without imports
    globals: true,
    // Keep jsdom/Monaco-heavy suites below the host's contention threshold.
    // Unbounded file workers make otherwise fast cleanup hooks time out.
    maxWorkers: 4,
    // Include all test files across the monorepo
    include: [
      "packages/contracts/src/**/__tests__/**/*.test.ts",
      "packages/contracts/src/**/*.test.ts",
      "packages/contracts/src/**/*.spec.ts",
      "packages/web-core/src/**/__tests__/**/*.test.ts",
      "packages/web-core/src/**/*.test.ts",
      "packages/web-core/src/**/*.spec.ts",
      "packages/ui/src/**/__tests__/**/*.test.ts",
      "packages/ui/src/**/*.test.ts",
      "packages/ui/src/**/*.spec.ts",
      "packages/ui/src/**/__tests__/**/*.test.tsx",
      "packages/ui/src/**/*.test.tsx",
      "packages/ui/src/**/*.spec.tsx",
      "packages/browser-adapters/src/**/__tests__/**/*.test.ts",
      "packages/browser-adapters/src/**/*.test.ts",
      "packages/browser-adapters/src/**/*.spec.ts",
      "packages/tauri-adapters/src/**/__tests__/**/*.test.ts",
      "packages/tauri-adapters/src/**/*.test.ts",
      "packages/tauri-adapters/src/**/*.spec.ts",
      "apps/web/src/**/__tests__/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "apps/web/src/**/*.spec.ts",
      "apps/web/src/**/*.test.tsx",
      "apps/web/src/**/*.spec.tsx",
      "apps/desktop/src/**/__tests__/**/*.test.ts",
      "apps/desktop/src/**/*.test.ts",
      "apps/desktop/src/**/*.spec.ts",
      "apps/desktop/src/**/*.test.tsx",
      "apps/desktop/src/**/*.spec.tsx",
    ],
    // Exclude node_modules and build outputs
    exclude: ["node_modules/**", "dist/**", ".turbo/**", "**/node_modules/**"],
    // Setup files for global mocks
    setupFiles: ["./vitest.setup.ts"],
    // Coverage configuration
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "text-summary", "json-summary", "html", "lcov"],
      include: [
        "packages/contracts/src/**/*.{ts,tsx}",
        "packages/web-core/src/**/*.{ts,tsx}",
        "packages/ui/src/**/*.{ts,tsx}",
        "packages/browser-adapters/src/**/*.{ts,tsx}",
        "packages/tauri-adapters/src/**/*.{ts,tsx}",
        "apps/web/src/**/*.{ts,tsx}",
        "apps/desktop/src/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.d.ts",
        "**/__tests__/**",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/generated/**",
        "**/gen/**",
        "**/*.generated.{ts,tsx}",
      ],
    },
  },
  // Resolve workspace aliases so imports like @ide/contracts work
  resolve: {
    alias: {
      "@ide/contracts": fromWorkspace("packages/contracts/src"),
      "@ide/web-core": fromWorkspace("packages/web-core/src"),
      "@ide/ui": fromWorkspace("packages/ui/src"),
      "@ide/browser-adapters": fromWorkspace("packages/browser-adapters/src"),
      "@ide/tauri-adapters": fromWorkspace("packages/tauri-adapters/src"),
      // Compatibility alias for apps/web's legacy parent-relative adapter import.
      "../adapters": fromWorkspace("apps/web/src/adapters"),
    },
    // Ensure .ts and .tsx extensions are resolved
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  },
});
