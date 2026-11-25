import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const javaScriptFiles = ["**/*.{js,mjs,cjs}"];
const typeScriptFiles = ["**/*.{ts,tsx}"];
const typeScriptFixtureFiles = [
  "**/*.{test,spec,fixture,stories}.{ts,tsx}",
  "**/__tests__/**/*.{ts,tsx}",
  "tests/**/*.{ts,tsx}",
];
const nodeFiles = [
  "**/*.{js,mjs,cjs}",
  "**/*.config.{ts,tsx}",
  "scripts/**/*.{ts,tsx}",
  "tests/**/*.{ts,tsx}",
  "vitest*.{ts,tsx}",
];
const browserFiles = [
  "apps/*/src/**/*.{ts,tsx}",
  "packages/*/src/**/*.{ts,tsx}",
  "tests/story/support/**/*.{ts,tsx}",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/test-output/**",
      "**/test-results/**",
      "**/target/**",
      "**/*.d.ts",
      "**/*.d.ts.map",
      "**/src/**/*.js",
      "**/tsconfig.tsbuildinfo",
    ],
  },
  {
    ...js.configs.recommended,
    files: javaScriptFiles,
    languageOptions: {
      ecmaVersion: "latest",
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: typeScriptFiles,
  })),
  {
    files: javaScriptFiles,
    rules: {
      "no-unsafe-finally": "warn",
    },
  },
  {
    files: typeScriptFiles,
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "prefer-const": "warn",
    },
  },
  {
    files: typeScriptFixtureFiles,
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: nodeFiles,
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: browserFiles,
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["**/*.tsx"],
    plugins: {
      "react-hooks": reactHooks,
    },
    // React Compiler-specific rules require a separate adoption decision and supporting evidence; this compatibility scope keeps runtime Hook rules without disabling the plugin.
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "warn",
    },
  },
);
