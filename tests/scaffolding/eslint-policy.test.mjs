import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";

const require = createRequire(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lintDependencies = {
  "@eslint/js": "9.39.4",
  "eslint-plugin-react-hooks": "7.1.1",
  globals: "17.7.0",
  "typescript-eslint": "8.64.0",
};
const packageManifestPaths = [
  "package.json",
  "apps/desktop/package.json",
  "apps/web/package.json",
  "packages/browser-adapters/package.json",
  "packages/contracts/package.json",
  "packages/tauri-adapters/package.json",
  "packages/ui/package.json",
  "packages/web-core/package.json",
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(workspaceRoot, relativePath), "utf8"));
}

function ruleIds(result) {
  return result.messages.map(({ ruleId }) => ruleId);
}

function configuredSeverity(ruleConfig) {
  return Array.isArray(ruleConfig) ? ruleConfig[0] : ruleConfig;
}

test("ESLint uses real JavaScript and TypeScript analysis with recommended rules", async () => {
  const configSource = await readFile(path.join(workspaceRoot, "eslint.config.js"), "utf8");
  assert.doesNotMatch(configSource, /empty[-A-Za-z]*typescript[-A-Za-z]*parser/i);
  assert.doesNotMatch(configSource, /parseForESLint/);

  const eslint = new ESLint({ cwd: workspaceRoot });
  const javaScriptConfig = await eslint.calculateConfigForFile("scripts/eslint-policy-probe.mjs");
  const typeScriptConfig = await eslint.calculateConfigForFile(
    "packages/web-core/src/eslint-policy-probe.ts",
  );
  const tsxConfig = await eslint.calculateConfigForFile("packages/ui/src/eslint-policy-probe.tsx");

  assert.ok(Object.keys(javaScriptConfig.rules).length > 0);
  assert.ok(Object.keys(typeScriptConfig.rules).length > 0);
  assert.equal(typeScriptConfig.languageOptions.parser.meta.name, "typescript-eslint/parser");
  assert.deepEqual(typeScriptConfig.rules["@typescript-eslint/no-explicit-any"], [1]);
  assert.deepEqual(tsxConfig.rules["react-hooks/rules-of-hooks"], [1]);

  const [javaScriptProbe] = await eslint.lintText("missingWorkspaceGlobal();", {
    filePath: "scripts/eslint-policy-probe.mjs",
  });
  assert.ok(ruleIds(javaScriptProbe).includes("no-undef"));

  const [typeScriptProbe] = await eslint.lintText("const value: any = 1;", {
    filePath: "packages/web-core/src/eslint-policy-probe.ts",
  });
  assert.ok(ruleIds(typeScriptProbe).includes("@typescript-eslint/no-explicit-any"));

  const [hooksProbe] = await eslint.lintText(
    [
      'import { useEffect } from "react";',
      "function Probe({ active }: { active: boolean }) {",
      "  if (active) useEffect(() => {});",
      "  return null;",
      "}",
    ].join("\n"),
    { filePath: "packages/ui/src/eslint-policy-probe.tsx" },
  );
  assert.ok(ruleIds(hooksProbe).includes("react-hooks/rules-of-hooks"));
});

test("ESLint limits React Hooks linting to canonical runtime correctness rules", async () => {
  const canonicalHookRules = ["react-hooks/exhaustive-deps", "react-hooks/rules-of-hooks"];
  const explicitlyExcludedCompilerRules = [
    "react-hooks/preserve-manual-memoization",
    "react-hooks/refs",
    "react-hooks/set-state-in-effect",
    "react-hooks/static-components",
    "react-hooks/use-memo",
  ];
  const eslint = new ESLint({ cwd: workspaceRoot });
  const tsxPath = "packages/ui/src/eslint-react-hooks-policy-probe.tsx";
  const tsxConfig = await eslint.calculateConfigForFile(tsxPath);

  assert.ok(tsxConfig.plugins["react-hooks"], "the React Hooks plugin must remain installed");
  for (const ruleId of canonicalHookRules) {
    assert.equal(configuredSeverity(tsxConfig.rules[ruleId]), 1, `${ruleId} must be a warning`);
  }

  const enabledHookRules = Object.entries(tsxConfig.rules)
    .filter(
      ([ruleId, ruleConfig]) =>
        ruleId.startsWith("react-hooks/") && configuredSeverity(ruleConfig) !== 0,
    )
    .map(([ruleId]) => ruleId)
    .sort();
  assert.deepEqual(enabledHookRules, canonicalHookRules);

  for (const ruleId of explicitlyExcludedCompilerRules) {
    const severity = configuredSeverity(tsxConfig.rules[ruleId]);
    assert.ok(severity === undefined || severity === 0, `${ruleId} must be absent or off`);
  }

  const [conditionalHookProbe] = await eslint.lintText(
    [
      'import { useEffect } from "react";',
      "function Probe({ active }: { active: boolean }) {",
      "  if (active) useEffect(() => {});",
      "  return null;",
      "}",
    ].join("\n"),
    { filePath: tsxPath },
  );
  assert.ok(
    conditionalHookProbe.messages.some(
      ({ ruleId, severity }) => ruleId === "react-hooks/rules-of-hooks" && severity === 1,
    ),
    "a conditional Hook must produce a rules-of-hooks warning",
  );

  const [missingDependencyProbe] = await eslint.lintText(
    [
      'import { useEffect } from "react";',
      "function Probe({ value }: { value: string }) {",
      "  useEffect(() => { document.title = value; }, []);",
      "  return null;",
      "}",
    ].join("\n"),
    { filePath: tsxPath },
  );
  assert.ok(
    missingDependencyProbe.messages.some(
      ({ ruleId, severity }) => ruleId === "react-hooks/exhaustive-deps" && severity === 1,
    ),
    "a missing effect dependency must produce an exhaustive-deps warning",
  );
});

test("ESLint enforces the generic TypeScript baseline while allowing test fixtures", async () => {
  const eslint = new ESLint({ cwd: workspaceRoot });
  const productionPath = "packages/web-core/src/eslint-policy-probe.ts";
  const testPath = "packages/web-core/src/eslint-policy-probe.test.ts";
  const storyPath = "tests/story/support/eslint-policy-probe.ts";
  const fixturePath = "packages/ui/src/eslint-policy-probe.fixture.ts";

  const productionConfig = await eslint.calculateConfigForFile(productionPath);
  assert.deepEqual(productionConfig.rules["@typescript-eslint/no-explicit-any"], [1]);
  assert.deepEqual(productionConfig.rules["@typescript-eslint/no-unused-vars"], [
    1,
    {
      args: "all",
      argsIgnorePattern: "^_",
      caughtErrors: "all",
      caughtErrorsIgnorePattern: "^_",
      destructuredArrayIgnorePattern: "^_",
      varsIgnorePattern: "^_",
    },
  ]);

  for (const fixture of [testPath, storyPath, fixturePath]) {
    const config = await eslint.calculateConfigForFile(fixture);
    assert.deepEqual(
      config.rules["@typescript-eslint/no-explicit-any"],
      [0],
      `${fixture} should allow explicit test-double types`,
    );
  }

  const [productionAny] = await eslint.lintText("export const value: any = 1;", {
    filePath: productionPath,
  });
  assert.ok(ruleIds(productionAny).includes("@typescript-eslint/no-explicit-any"));

  const [testAny] = await eslint.lintText("export const value: any = 1;", {
    filePath: testPath,
  });
  assert.ok(!ruleIds(testAny).includes("@typescript-eslint/no-explicit-any"));

  const [ordinaryUnused] = await eslint.lintText("const ordinaryUnused = 1;", {
    filePath: productionPath,
  });
  assert.ok(ruleIds(ordinaryUnused).includes("@typescript-eslint/no-unused-vars"));
  assert.ok(
    ordinaryUnused.messages.some(
      ({ ruleId, severity }) => ruleId === "@typescript-eslint/no-unused-vars" && severity === 1,
    ),
  );

  const [underscorePlaceholders] = await eslint.lintText(
    [
      "export interface Handler {",
      "  handle(_interfaceParameter: string): void;",
      "}",
      "export function handle(_functionParameter: string): void {}",
      "const _unusedVariable = 1;",
      "const [_unusedElement] = [1];",
      "try {",
      '  throw new Error("probe");',
      "} catch (_caughtError) {}",
    ].join("\n"),
    { filePath: productionPath },
  );
  assert.ok(!ruleIds(underscorePlaceholders).includes("@typescript-eslint/no-unused-vars"));

  const [unsafeFinally] = await eslint.lintText(
    "function probe() { try { return 1; } finally { return 2; } }\nprobe();",
    { filePath: "scripts/eslint-policy-probe.mjs" },
  );
  assert.ok(ruleIds(unsafeFinally).includes("no-unsafe-finally"));
});

test("ESLint rejects malformed syntax injected into an actual TypeScript source", async () => {
  const relativeSourcePath = "packages/web-core/src/index.ts";
  const actualSource = await readFile(path.join(workspaceRoot, relativeSourcePath), "utf8");
  const eslint = new ESLint({ cwd: workspaceRoot });
  const [result] = await eslint.lintText(`${actualSource}\nconst lintSyntaxProbe: = 1;\n`, {
    filePath: relativeSourcePath,
  });

  assert.ok(result.messages.some(({ fatal, ruleId }) => fatal === true && ruleId === null));
});

test("lint tooling is exact-pinned, dev-only, and absent from runtime manifests", async () => {
  const rootManifest = await readJson("package.json");
  assert.equal(rootManifest.scripts.lint, "eslint .");
  assert.equal(rootManifest.scripts["lint:strict"], "eslint . --max-warnings=0");
  assert.doesNotMatch(rootManifest.scripts.lint, /pnpm\s+-r/);

  for (const [dependency, version] of Object.entries(lintDependencies)) {
    assert.equal(rootManifest.devDependencies[dependency], version);
  }
  assert.equal(rootManifest.devDependencies["@eslint/js"], require("eslint/package.json").version);

  for (const manifestPath of packageManifestPaths) {
    const manifest = await readJson(manifestPath);
    for (const dependency of Object.keys(lintDependencies)) {
      for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
        assert.equal(
          manifest[section]?.[dependency],
          undefined,
          `${dependency} leaked into ${section} in ${manifestPath}`,
        );
      }
      if (manifestPath !== "package.json") {
        assert.equal(
          manifest.devDependencies?.[dependency],
          undefined,
          `${dependency} should be installed only once at the workspace root`,
        );
      }
    }
  }
});

test("ESLint preserves generated and build output ignores", async () => {
  const eslint = new ESLint({ cwd: workspaceRoot });
  const ignoredPaths = [
    "apps/web/node_modules/probe.js",
    "apps/web/dist/probe.js",
    "apps/web/.turbo/probe.js",
    "coverage/probe.js",
    "test-results/probe.mjs",
    "apps/desktop/src-tauri/target/probe.js",
    "packages/contracts/src/probe.d.ts",
    "apps/web/src/generated.js",
    "apps/web/tsconfig.tsbuildinfo",
  ];

  for (const relativePath of ignoredPaths) {
    assert.equal(
      await eslint.isPathIgnored(relativePath),
      true,
      `${relativePath} must stay ignored`,
    );
  }
});
