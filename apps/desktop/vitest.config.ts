import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@ide/contracts": path.resolve(ROOT, "packages/contracts/src"),
      "@ide/web-core": path.resolve(ROOT, "packages/web-core/src"),
      "@ide/ui": path.resolve(ROOT, "packages/ui/src"),
      "@ide/tauri-adapters": path.resolve(ROOT, "packages/tauri-adapters/src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [path.resolve(ROOT, "vitest.setup.ts")],
  },
});
