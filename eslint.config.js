import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const javaScriptFiles = ["**/*.{js,mjs,cjs}"];
const typeScriptFiles = ["**/*.{ts,tsx}"];
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
      "@typescript-eslint/no-unused-vars": "warn",
      "prefer-const": "warn",
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
    plugins: reactHooks.configs.flat.recommended.plugins,
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/use-memo": "warn",
    },
  },
);
