import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  REPRODUCTION_COMMAND,
  REQUIREMENT_ID,
  TARGET_REVISION,
  validateCoverageBundle,
} from "../../scripts/validate-req-xcom2-project-build-recipe-coverage.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function fixtureBundle(root) {
  await Promise.all([
    mkdir(path.join(root, "raw/spec"), { recursive: true }),
    mkdir(path.join(root, "raw/story"), { recursive: true }),
    mkdir(path.join(root, "merged"), { recursive: true }),
  ]);
  const raw = {
    "/workspace/packages/contracts/src/domain/example.ts": {
      s: { 0: 1 },
      f: { 0: 1 },
      b: { 0: [1, 0] },
    },
  };
  const metrics = {
    files: 1,
    branches: { total: 2, covered: 1, skipped: 0, pct: 50 },
    functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
    lines: { total: 1, covered: 1, skipped: 0, pct: 100 },
  };
  const manifest = {
    requirementId: REQUIREMENT_ID,
    targetRevision: TARGET_REVISION,
    observedRevision: TARGET_REVISION,
    reproductionCommand: REPRODUCTION_COMMAND,
    commands: {
      spec: "pnpm exec vitest run --config vitest.req-xcom2-project-build-recipe.coverage.config.ts --coverage.enabled=true",
      story: "pnpm exec c8 node cucumber --profile xcom2ProjectBuildRecipeTauriHarness",
    },
    selections: {
      specFiles: [
        "tests/spec/xcom2-project-build-recipe.spec.ts",
        "tests/spec/xcom2-native-activation-evidence.spec.ts",
      ],
      storyProfile: "xcom2ProjectBuildRecipeTauriHarness",
    },
    sourceClasses: {
      pureSpec: metrics,
      desktopTauriHarnessStory: metrics,
    },
    merged: { ...metrics, technicallyValid: true },
    limitations: { rustCoverage: false },
    semanticDistinction: { equivalentPurposes: false },
  };
  await Promise.all([
    writeFile(path.join(root, "raw/spec/coverage-final.json"), JSON.stringify(raw)),
    writeFile(path.join(root, "raw/story/coverage-final.json"), JSON.stringify(raw)),
    writeFile(path.join(root, "merged/coverage-summary.json"), JSON.stringify({ total: metrics })),
    writeFile(path.join(root, "coverage-manifest.json"), JSON.stringify(manifest)),
  ]);
}

test("the bounded command records both distinct coverage runners and ignores its artifacts", async () => {
  const [manifest, cucumber, vitestConfig, ignore] = await Promise.all([
    readFile(path.join(workspaceRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(workspaceRoot, "cucumber.js"), "utf8"),
    readFile(
      path.join(workspaceRoot, "vitest.req-xcom2-project-build-recipe.coverage.config.ts"),
      "utf8",
    ),
    readFile(path.join(workspaceRoot, ".gitignore"), "utf8"),
  ]);

  assert.equal(
    manifest.scripts["test:coverage:req-xcom2-project-build-recipe-001"],
    "node scripts/run-req-xcom2-project-build-recipe-coverage.mjs",
  );
  assert.match(cucumber, /xcom2ProjectBuildRecipeTauriHarness/u);
  assert.match(cucumber, /@REQ-XCOM2-PROJECT-BUILD-RECIPE-001/u);
  assert.match(vitestConfig, /tests\/spec\/xcom2-project-build-recipe\.spec\.ts/u);
  assert.match(vitestConfig, /tests\/spec\/xcom2-native-activation-evidence\.spec\.ts/u);
  assert.match(ignore, /^coverage\/$/mu);
});

test("the validator requires non-empty Spec and Story contributions plus revision-bound metadata", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "req-xcom2-coverage-"));
  try {
    await fixtureBundle(fixtureRoot);
    await validateCoverageBundle(fixtureRoot);

    await writeFile(path.join(fixtureRoot, "raw/story/coverage-final.json"), "{}\n");
    await assert.rejects(
      validateCoverageBundle(fixtureRoot),
      /desktop-tauri-harness-story raw coverage contains no source files/u,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
