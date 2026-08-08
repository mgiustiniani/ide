import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import libCoverage from "istanbul-lib-coverage";

import {
  CONFIGURATION_FILES,
  MAX_BUNDLE_AGE_MS,
  REPRODUCTION_COMMAND,
  REQUIREMENT_ID,
  SPEC_ARGUMENTS,
  SPEC_FILES,
  STORY_ARGUMENTS,
  STORY_PROFILE,
  TRACKED_CHANGES_POLICY,
  VALIDATION_COMMAND,
  artifactInventory,
  commandText,
  configurationHashes,
  hashFile,
  resolveRepositoryState,
  sha256,
  validateCoverageBundle,
} from "../../scripts/validate-req-xcom2-project-build-recipe-coverage.mjs";

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function commands() {
  const spec = commandText(SPEC_ARGUMENTS);
  const story = `IDE_STORY_TARGET=desktop/tauri-harness ${commandText(STORY_ARGUMENTS)}`;
  return {
    spec: { text: spec, sha256: sha256(spec) },
    story: { text: story, sha256: sha256(story) },
    validator: { text: VALIDATION_COMMAND, sha256: sha256(VALIDATION_COMMAND) },
  };
}

function rawCoverage(file, count) {
  const location = {
    start: { line: 1, column: 0 },
    end: { line: 1, column: 10 },
  };
  return {
    [file]: {
      path: file,
      statementMap: { 0: location },
      fnMap: {
        0: {
          name: "covered",
          decl: location,
          loc: location,
          line: 1,
        },
      },
      branchMap: {
        0: {
          type: "if",
          line: 1,
          loc: location,
          locations: [location, location],
        },
      },
      s: { 0: count },
      f: { 0: count },
      b: { 0: [count, 0] },
    },
  };
}

function metrics(coverageMap) {
  const summary = coverageMap.getCoverageSummary().toJSON();
  return {
    files: coverageMap.files().length,
    statements: summary.statements,
    branches: summary.branches,
    functions: summary.functions,
    lines: summary.lines,
  };
}

function summary(metrics_) {
  return {
    total: {
      statements: metrics_.statements,
      branches: metrics_.branches,
      functions: metrics_.functions,
      lines: metrics_.lines,
    },
  };
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function initializeFixtureRepository(root) {
  const configurationPaths = Object.values(CONFIGURATION_FILES).flat();
  for (const relative of new Set(configurationPaths)) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    if (relative === "package.json") {
      await writeJson(file, {
        type: "module",
        scripts: {
          "test:coverage:req-xcom2-project-build-recipe-001":
            "node scripts/run-req-xcom2-project-build-recipe-coverage.mjs",
          "validate:coverage:req-xcom2-project-build-recipe-001": VALIDATION_COMMAND,
        },
      });
    } else await writeFile(file, `fixture ${relative}\n`, "utf8");
  }
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "coverage@example.invalid"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Coverage Fixture"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
}

async function fixtureBundle(root, { startedAt, completedAt } = {}) {
  await initializeFixtureRepository(root);
  const bundleRoot = path.join(root, "coverage/req-xcom2-project-build-recipe-001");
  const repository = await resolveRepositoryState(root);
  const configuration = await configurationHashes(root);
  const canonicalCommands = commands();
  const run = { nonce: randomUUID(), startedAt: startedAt ?? new Date().toISOString() };
  const repositoryIdentity = { head: repository.head, tree: repository.tree };
  const runMetadata = {
    schemaVersion: 2,
    requirementId: REQUIREMENT_ID,
    repository: repositoryIdentity,
    run,
    reproductionCommand: REPRODUCTION_COMMAND,
    trackedChangesPolicy: TRACKED_CHANGES_POLICY,
    commands: canonicalCommands,
    configurationHashes: configuration,
  };
  await writeJson(path.join(bundleRoot, "run-metadata.json"), runMetadata);

  const specRaw = rawCoverage("/workspace/packages/contracts/src/domain/spec-contribution.ts", 1);
  const storyRaw = rawCoverage("/workspace/packages/web-core/src/story-contribution.ts", 2);
  const specMap = libCoverage.createCoverageMap(specRaw);
  const storyMap = libCoverage.createCoverageMap(storyRaw);
  const specMetrics = metrics(specMap);
  const storyMetrics = metrics(storyMap);
  const mergedMap = libCoverage.createCoverageMap({});
  mergedMap.merge(specMap);
  mergedMap.merge(storyMap);
  const mergedMetrics = metrics(mergedMap);

  await mkdir(path.join(bundleRoot, "merged"), { recursive: true });
  await Promise.all([
    writeJson(path.join(bundleRoot, "raw/spec/coverage-final.json"), specRaw),
    writeJson(path.join(bundleRoot, "raw/spec/coverage-summary.json"), summary(specMetrics)),
    writeJson(path.join(bundleRoot, "raw/story/coverage-final.json"), storyRaw),
    writeJson(path.join(bundleRoot, "raw/story/coverage-summary.json"), summary(storyMetrics)),
    writeJson(path.join(bundleRoot, "raw/story/v8/coverage-fixture.json"), { result: [] }),
    writeJson(path.join(bundleRoot, "merged/coverage-final.json"), mergedMap.toJSON()),
    writeJson(path.join(bundleRoot, "merged/coverage-summary.json"), summary(mergedMetrics)),
    writeFile(path.join(bundleRoot, "merged/lcov.info"), "TN:\n", "utf8"),
    writeFile(path.join(bundleRoot, "merged/index.html"), "<!doctype html>\n", "utf8"),
  ]);

  const contributorConfiguration = (contributor) => ({
    common: configuration.common,
    [contributor]: configuration[contributor],
  });
  const specReceipt = {
    schemaVersion: 2,
    requirementId: REQUIREMENT_ID,
    contributor: "spec",
    repository: repositoryIdentity,
    runNonce: run.nonce,
    runStartedAt: run.startedAt,
    command: { ...canonicalCommands.spec, status: "success", exitCode: 0, signal: null },
    configurationHashes: contributorConfiguration("spec"),
    rawCoverage: {
      path: "raw/spec/coverage-final.json",
      sha256: await hashFile(path.join(bundleRoot, "raw/spec/coverage-final.json")),
    },
    coverageSummary: {
      path: "raw/spec/coverage-summary.json",
      sha256: await hashFile(path.join(bundleRoot, "raw/spec/coverage-summary.json")),
    },
  };
  const storyReceipt = {
    schemaVersion: 2,
    requirementId: REQUIREMENT_ID,
    contributor: "story",
    repository: repositoryIdentity,
    runNonce: run.nonce,
    runStartedAt: run.startedAt,
    command: { ...canonicalCommands.story, status: "success", exitCode: 0, signal: null },
    configurationHashes: contributorConfiguration("story"),
    rawCoverage: {
      path: "raw/story/coverage-final.json",
      sha256: await hashFile(path.join(bundleRoot, "raw/story/coverage-final.json")),
    },
    coverageSummary: {
      path: "raw/story/coverage-summary.json",
      sha256: await hashFile(path.join(bundleRoot, "raw/story/coverage-summary.json")),
    },
  };
  await Promise.all([
    writeJson(path.join(bundleRoot, "raw/spec/contributor.json"), specReceipt),
    writeJson(path.join(bundleRoot, "raw/story/contributor.json"), storyReceipt),
  ]);

  const manifest = {
    schemaVersion: 2,
    requirementId: REQUIREMENT_ID,
    repository: repositoryIdentity,
    run: { ...run, completedAt: completedAt ?? new Date().toISOString() },
    reproductionCommand: REPRODUCTION_COMMAND,
    trackedChangesPolicy: TRACKED_CHANGES_POLICY,
    commands: canonicalCommands,
    configurationHashes: configuration,
    selections: {
      specFiles: SPEC_FILES,
      storyProfile: STORY_PROFILE,
      storyRequirementTag: `@${REQUIREMENT_ID}`,
      storyTarget: "desktop/tauri-harness",
    },
    contributors: {
      spec: {
        metadataPath: "raw/spec/contributor.json",
        metadataSha256: await hashFile(path.join(bundleRoot, "raw/spec/contributor.json")),
      },
      story: {
        metadataPath: "raw/story/contributor.json",
        metadataSha256: await hashFile(path.join(bundleRoot, "raw/story/contributor.json")),
      },
    },
    sourceClasses: {
      pureSpec: { metrics: specMetrics },
      desktopTauriHarnessStory: { metrics: storyMetrics },
    },
    merged: {
      technicallyValid: true,
      metrics: mergedMetrics,
      rawInputSha256: {
        spec: specReceipt.rawCoverage.sha256,
        story: storyReceipt.rawCoverage.sha256,
      },
      coverageFinalSha256: await hashFile(path.join(bundleRoot, "merged/coverage-final.json")),
      coverageSummarySha256: await hashFile(path.join(bundleRoot, "merged/coverage-summary.json")),
    },
    semanticDistinction: { equivalentPurposes: false },
    limitations: { rustCoverage: false },
    artifactInventory: await artifactInventory(bundleRoot),
  };
  await writeJson(path.join(bundleRoot, "coverage-manifest.json"), manifest);
  return { bundleRoot, manifest, root };
}

async function withFixture(callback, options) {
  const root = await mkdtemp(path.join(tmpdir(), "req-xcom2-coverage-"));
  try {
    return await callback(await fixtureBundle(root, options));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("the canonical command is dynamic, bounded, and ignores only generated coverage", async () => {
  const [packageManifest, runner, validator, vitestConfig, ignore] = await Promise.all([
    readFile(path.join(workspaceRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(
      path.join(workspaceRoot, "scripts/run-req-xcom2-project-build-recipe-coverage.mjs"),
      "utf8",
    ),
    readFile(
      path.join(workspaceRoot, "scripts/validate-req-xcom2-project-build-recipe-coverage.mjs"),
      "utf8",
    ),
    readFile(
      path.join(workspaceRoot, "vitest.req-xcom2-project-build-recipe.coverage.config.ts"),
      "utf8",
    ),
    readFile(path.join(workspaceRoot, ".gitignore"), "utf8"),
  ]);

  assert.equal(
    packageManifest.scripts["test:coverage:req-xcom2-project-build-recipe-001"],
    "node scripts/run-req-xcom2-project-build-recipe-coverage.mjs",
  );
  assert.doesNotMatch(runner, /1275fc9|TARGET_REVISION/u);
  assert.doesNotMatch(validator, /1275fc9|TARGET_REVISION/u);
  assert.match(runner, /rm\(bundleRoot, \{ recursive: true, force: true \}\)/u);
  assert.match(vitestConfig, /tests\/spec\/xcom2-project-build-recipe\.spec\.ts/u);
  assert.match(vitestConfig, /tests\/spec\/xcom2-native-activation-evidence\.spec\.ts/u);
  assert.match(ignore, /^coverage\/$/mu);
});

test("the standalone validator passes untracked output but refuses tracked or index changes", async () => {
  await withFixture(async ({ bundleRoot, root }) => {
    const manifest = await validateCoverageBundle(bundleRoot, { workspaceRoot: root });
    assert.equal(manifest.requirementId, REQUIREMENT_ID);

    await writeFile(path.join(root, "cucumber.js"), "tracked edit\n", "utf8");
    await assert.rejects(
      validateCoverageBundle(bundleRoot, { workspaceRoot: root }),
      /clean tracked worktree and index/u,
    );
    await execFileAsync("git", ["add", "cucumber.js"], { cwd: root });
    await assert.rejects(
      validateCoverageBundle(bundleRoot, { workspaceRoot: root }),
      /clean tracked worktree and index/u,
    );
  });
});

test("the standalone validator refuses stale or replayed bundle metadata", async () => {
  const staleStartedAt = new Date(Date.now() - MAX_BUNDLE_AGE_MS - 120_000).toISOString();
  const staleCompletedAt = new Date(Date.now() - MAX_BUNDLE_AGE_MS - 60_000).toISOString();
  await withFixture(
    async ({ bundleRoot, root }) => {
      await assert.rejects(
        validateCoverageBundle(bundleRoot, { workspaceRoot: root }),
        /coverage bundle is stale/u,
      );
    },
    { startedAt: staleStartedAt, completedAt: staleCompletedAt },
  );
});

test("the standalone validator refuses mixed Spec and Story run identities", async () => {
  await withFixture(async ({ bundleRoot, root }) => {
    const storyReceiptPath = path.join(bundleRoot, "raw/story/contributor.json");
    const storyReceipt = JSON.parse(await readFile(storyReceiptPath, "utf8"));
    storyReceipt.runNonce = randomUUID();
    await writeJson(storyReceiptPath, storyReceipt);
    await assert.rejects(
      validateCoverageBundle(bundleRoot, { workspaceRoot: root }),
      /contributor run nonce differs/u,
    );
  });
});

test("the standalone validator refuses parent or mismatched HEAD metadata", async () => {
  await withFixture(async ({ bundleRoot, root, manifest }) => {
    manifest.repository.head = "0".repeat(40);
    await writeJson(path.join(bundleRoot, "coverage-manifest.json"), manifest);
    await assert.rejects(
      validateCoverageBundle(bundleRoot, { workspaceRoot: root }),
      /manifest HEAD does not match current Git HEAD/u,
    );
  });
});

test("the standalone validator refuses missing or hand-edited raw artifacts", async () => {
  await withFixture(async ({ bundleRoot, root }) => {
    await writeFile(path.join(bundleRoot, "raw/story/coverage-final.json"), "{}\n", "utf8");
    await assert.rejects(
      validateCoverageBundle(bundleRoot, { workspaceRoot: root }),
      /raw coverage contains no source files|raw coverage hash differs/u,
    );
  });
});
