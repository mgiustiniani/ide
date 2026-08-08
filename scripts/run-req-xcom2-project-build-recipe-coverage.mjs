import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";

import {
  BUNDLE_RELATIVE_PATH,
  CANONICAL_METRIC_SYSTEM,
  PROVIDER_NATIVE_METRIC_SYSTEM,
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
} from "./validate-req-xcom2-project-build-recipe-coverage.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = path.join(workspaceRoot, BUNDLE_RELATIVE_PATH);
const specRawRoot = path.join(bundleRoot, "raw/spec");
const storyRawRoot = path.join(bundleRoot, "raw/story");
const mergedRoot = path.join(bundleRoot, "merged");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const commands = {
  spec: commandReceipt(commandText(SPEC_ARGUMENTS)),
  story: commandReceipt(`IDE_STORY_TARGET=desktop/tauri-harness ${commandText(STORY_ARGUMENTS)}`),
  validator: commandReceipt(VALIDATION_COMMAND),
};

function commandReceipt(text) {
  return { text, sha256: sha256(text) };
}

function contributorConfiguration(configuration, contributor) {
  return {
    common: configuration.common,
    [contributor]: configuration[contributor],
  };
}

function run(arguments_, extraEnvironment = {}) {
  const rendered = commandText(arguments_);
  console.log(`\n> ${rendered}`);
  return new Promise((resolve, reject) => {
    const child = spawn(pnpmCommand, arguments_, {
      cwd: workspaceRoot,
      env: { ...process.env, NO_COLOR: "1", ...extraEnvironment },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (status, signal) => {
      if (status === 0) resolve({ status: "success", exitCode: 0, signal: null });
      else reject(new Error(`${rendered} failed with status ${status ?? `signal ${signal}`}`));
    });
  });
}

async function readCoverageMap(file) {
  return libCoverage.createCoverageMap(JSON.parse(await readFile(file, "utf8")));
}

function sourceMetrics(coverageMap) {
  const summary = coverageMap.getCoverageSummary().toJSON();
  return {
    files: coverageMap.files().length,
    statements: summary.statements,
    branches: summary.branches,
    functions: summary.functions,
    lines: summary.lines,
  };
}

function assertSourceOnly(coverageMap, sourceClass) {
  for (const file of coverageMap.files()) {
    const relative = path.relative(workspaceRoot, file).replaceAll(path.sep, "/");
    if (
      !/^(?:apps|packages)\/[^/]+\/src\//u.test(relative) ||
      /(?:^|\/)(?:__tests__|fixtures?|generated|gen)(?:\/|$)/u.test(relative) ||
      /\.(?:test|spec|fixture|generated)\.[cm]?[jt]sx?$/u.test(relative)
    ) {
      throw new Error(`${sourceClass} contains excluded coverage source: ${relative}`);
    }
  }
}

function writeIstanbulReports(coverageMap) {
  const context = libReport.createContext({ coverageMap, dir: mergedRoot });
  for (const reporter of ["json", "json-summary", "lcovonly", "html"]) {
    reports.create(reporter).execute(context);
  }
}

async function canonicalizeContributorSummary(contributor) {
  const contributorRoot = path.join(bundleRoot, `raw/${contributor}`);
  const providerNativeSummary = path.join(contributorRoot, "provider-native-summary.json");
  await rename(path.join(contributorRoot, "coverage-summary.json"), providerNativeSummary);

  const coverageMap = await readCoverageMap(path.join(contributorRoot, "coverage-final.json"));
  const context = libReport.createContext({ coverageMap, dir: contributorRoot });
  reports.create("json-summary").execute(context);
  return coverageMap;
}

function printMetrics(label, metrics) {
  const values = ["statements", "branches", "functions", "lines"]
    .map(
      (metric) =>
        `${metric} ${metrics[metric].covered}/${metrics[metric].total} (${metrics[metric].pct}%)`,
    )
    .join(", ");
  console.log(`${label}: files ${metrics.files}; ${values}`);
}

async function contributorReceipt({
  contributor,
  repository,
  run,
  configuration,
  commandResult,
  rawCoveragePath,
  canonicalSummaryPath,
  providerNativeSummaryPath,
}) {
  const rawCoverageSha256 = await hashFile(path.join(bundleRoot, rawCoveragePath));
  const receipt = {
    schemaVersion: 3,
    requirementId: REQUIREMENT_ID,
    contributor,
    repository,
    runNonce: run.nonce,
    runStartedAt: run.startedAt,
    command: { ...commands[contributor], ...commandResult },
    configurationHashes: contributorConfiguration(configuration, contributor),
    rawCoverage: {
      path: rawCoveragePath,
      sha256: rawCoverageSha256,
      metricSystem: CANONICAL_METRIC_SYSTEM,
    },
    canonicalSummary: {
      path: canonicalSummaryPath,
      sha256: await hashFile(path.join(bundleRoot, canonicalSummaryPath)),
      metricSystem: CANONICAL_METRIC_SYSTEM,
      derivedFromRawCoverageSha256: rawCoverageSha256,
    },
    providerNativeSummary: {
      path: providerNativeSummaryPath,
      sha256: await hashFile(path.join(bundleRoot, providerNativeSummaryPath)),
      metricSystem: PROVIDER_NATIVE_METRIC_SYSTEM,
      purpose: "informational-only",
    },
  };
  const metadataPath = `raw/${contributor}/contributor.json`;
  await writeFile(
    path.join(bundleRoot, metadataPath),
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8",
  );
  return { metadataPath, receipt };
}

// The bounded output is the only path removed. Other coverage and telemetry remain untouched.
await rm(bundleRoot, { recursive: true, force: true });
await mkdir(bundleRoot, { recursive: true });

const repository = await resolveRepositoryState(workspaceRoot);
assert.equal(
  repository.trackedChanges,
  "",
  `coverage execution requires a clean tracked worktree and index; ${TRACKED_CHANGES_POLICY}`,
);
const runIdentity = { nonce: randomUUID(), startedAt: new Date().toISOString() };
const configuration = await configurationHashes(workspaceRoot);
const runMetadata = {
  schemaVersion: 3,
  requirementId: REQUIREMENT_ID,
  repository: { head: repository.head, tree: repository.tree },
  run: runIdentity,
  reproductionCommand: REPRODUCTION_COMMAND,
  trackedChangesPolicy: TRACKED_CHANGES_POLICY,
  commands,
  configurationHashes: configuration,
};
await writeFile(
  path.join(bundleRoot, "run-metadata.json"),
  `${JSON.stringify(runMetadata, null, 2)}\n`,
  "utf8",
);

const specResult = await run(SPEC_ARGUMENTS);
const specMapForSourceCheck = await canonicalizeContributorSummary("spec");
assertSourceOnly(specMapForSourceCheck, "pure-spec");
const specContributor = await contributorReceipt({
  contributor: "spec",
  repository: runMetadata.repository,
  run: runIdentity,
  configuration,
  commandResult: specResult,
  rawCoveragePath: "raw/spec/coverage-final.json",
  canonicalSummaryPath: "raw/spec/coverage-summary.json",
  providerNativeSummaryPath: "raw/spec/provider-native-summary.json",
});

const storyResult = await run(STORY_ARGUMENTS, { IDE_STORY_TARGET: "desktop/tauri-harness" });
const storyMapForSourceCheck = await canonicalizeContributorSummary("story");
assertSourceOnly(storyMapForSourceCheck, "desktop-tauri-harness-story");
const storyContributor = await contributorReceipt({
  contributor: "story",
  repository: runMetadata.repository,
  run: runIdentity,
  configuration,
  commandResult: storyResult,
  rawCoveragePath: "raw/story/coverage-final.json",
  canonicalSummaryPath: "raw/story/coverage-summary.json",
  providerNativeSummaryPath: "raw/story/provider-native-summary.json",
});

const pureSpecMetrics = sourceMetrics(
  await readCoverageMap(path.join(specRawRoot, "coverage-final.json")),
);
const storyMetrics = sourceMetrics(
  await readCoverageMap(path.join(storyRawRoot, "coverage-final.json")),
);
assert.notEqual(
  specContributor.receipt.rawCoverage.sha256,
  storyContributor.receipt.rawCoverage.sha256,
  "Spec and Story coverage inputs must be distinct",
);

const mergedCoverage = libCoverage.createCoverageMap({});
mergedCoverage.merge(await readCoverageMap(path.join(specRawRoot, "coverage-final.json")));
mergedCoverage.merge(await readCoverageMap(path.join(storyRawRoot, "coverage-final.json")));
writeIstanbulReports(mergedCoverage);

const mergedMetrics = sourceMetrics(mergedCoverage);
const rawArtifactInventory = await artifactInventory(bundleRoot, "raw");
const completeArtifactInventory = await artifactInventory(bundleRoot);
const completedAt = new Date().toISOString();
const manifest = {
  schemaVersion: 3,
  requirementId: REQUIREMENT_ID,
  repository: runMetadata.repository,
  run: { ...runIdentity, completedAt },
  reproductionCommand: REPRODUCTION_COMMAND,
  trackedChangesPolicy: TRACKED_CHANGES_POLICY,
  commands,
  configurationHashes: configuration,
  selections: {
    specFiles: SPEC_FILES,
    storyProfile: STORY_PROFILE,
    storyRequirementTag: `@${REQUIREMENT_ID}`,
    storyTarget: "desktop/tauri-harness",
  },
  contributors: {
    spec: {
      metadataPath: specContributor.metadataPath,
      metadataSha256: await hashFile(path.join(bundleRoot, specContributor.metadataPath)),
    },
    story: {
      metadataPath: storyContributor.metadataPath,
      metadataSha256: await hashFile(path.join(bundleRoot, storyContributor.metadataPath)),
    },
  },
  sourceClasses: {
    pureSpec: {
      purpose: "Focused pure TypeScript policy examples refining the requirement",
      rawDirectory: "raw/spec",
      metricSystem: CANONICAL_METRIC_SYSTEM,
      metrics: pureSpecMetrics,
    },
    desktopTauriHarnessStory: {
      purpose:
        "Focused Cucumber Story through production desktop composition and the deterministic Tauri harness",
      rawDirectory: "raw/story",
      metricSystem: CANONICAL_METRIC_SYSTEM,
      metrics: storyMetrics,
    },
  },
  merged: {
    technicallyValid: true,
    reportDirectory: "merged",
    metricSystem: CANONICAL_METRIC_SYSTEM,
    mergeFormat: "Istanbul coverage maps remapped to JS/TS source paths",
    rawInputSha256: {
      spec: specContributor.receipt.rawCoverage.sha256,
      story: storyContributor.receipt.rawCoverage.sha256,
    },
    coverageFinalSha256: await hashFile(path.join(mergedRoot, "coverage-final.json")),
    coverageSummarySha256: await hashFile(path.join(mergedRoot, "coverage-summary.json")),
    metrics: mergedMetrics,
  },
  semanticDistinction: {
    equivalentPurposes: false,
    statement:
      "The pure Specs and desktop/Tauri-harness Story remain separate evidence classes; merging source counters does not make their test purposes equivalent.",
  },
  limitations: {
    rustCoverage: false,
    nativeGuiE2e: false,
    packagedApplication: false,
    statement:
      "This bundle covers executed JS/TS sources only. It is not Rust coverage, native GUI E2E evidence, or packaged-application evidence.",
  },
  rawArtifactInventory,
  artifactInventory: completeArtifactInventory,
};
await writeFile(
  path.join(bundleRoot, "coverage-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

await validateCoverageBundle(bundleRoot);
console.log("\nCoverage contribution by source class (not equivalent test purposes):");
printMetrics("pure-spec", pureSpecMetrics);
printMetrics("desktop-tauri-harness-story", storyMetrics);
printMetrics("merged JS/TS", mergedMetrics);
console.log(`Reports: ${path.relative(workspaceRoot, bundleRoot)}`);
console.log("Rust coverage: not collected or claimed.");
