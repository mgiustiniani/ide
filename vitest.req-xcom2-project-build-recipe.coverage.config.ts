import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const workspaceRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    root: workspaceRoot,
    include: [
      "tests/spec/xcom2-project-build-recipe.spec.ts",
      "tests/spec/xcom2-native-activation-evidence.spec.ts",
    ],
    environment: "node",
    globals: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/req-xcom2-project-build-recipe-001/raw/spec",
      reporter: ["json", "json-summary"],
      include: [
        "packages/contracts/src/domain/xcom2-project-build-recipe.ts",
        "packages/contracts/src/domain/xcom2-project-build-recipe-policy.ts",
        "packages/contracts/src/domain/xcom2-native-activation-evidence.ts",
        "packages/contracts/src/domain/xcom2-native-activation-evidence-policy.ts",
      ],
      exclude: [
        "**/*.d.ts",
        "**/__tests__/**",
        "**/*.{test,spec,fixture}.{ts,tsx}",
        "**/fixtures/**",
        "**/generated/**",
        "**/gen/**",
        "**/*.generated.{ts,tsx}",
      ],
    },
  },
});
