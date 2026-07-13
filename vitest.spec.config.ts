import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const workspaceRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    root: workspaceRoot,
    include: ["tests/spec/**/*.spec.ts", "tests/spec/**/*.spec.tsx"],
    environment: "node",
    globals: true,
    passWithNoTests: true,
  },
});
