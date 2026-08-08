import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";

import {
  REPRODUCTION_COMMAND,
  REQUIREMENT_ID,
  TARGET_REVISION,
  validateCoverageBundle,
} from "./validate-req-xcom2-project-build-recipe-coverage.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = path.join(workspaceRoot, "coverage/req-xcom2-project-build-recipe-001");
const specRawRoot = path.join(bundleRoot, "raw/spec");
const storyRawRoot = path.join(bundleRoot, "raw/story");
const mergedRoot = path.join(bundleRoot, "merged");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const specArguments = [
  "exec",
  "vitest",
  "run",
  "--config",
  "vitest.req-xcom2-project-build-recipe.coverage.config.ts",
  "--coverage.enabled=true",
];
const storyArguments = [
  "exec",
  "c8",
  "--clean=true",
  `--temp-directory=${path.relative(workspaceRoot, path.join(storyRawRoot, "v8"))}`,
  `--reports-dir=${path.relative(workspaceRoot, storyRawRoot)}`,
  "--reporter=json",
  "--reporter=json-summary",
  "--exclude-after-remap",
  "--include=packages/**/src/**/*.{ts,tsx}",
  "--include=apps/**/src/**/*.{ts,tsx}",
  "--exclude=**/*.d.ts",
  "--exclude=**/__tests__/**",
  "--exclude=**/*.{test,spec,fixture}.{ts,tsx}",
  "--exclude=**/fixtures/**",
  "--exclude=**/generated/**",
  "--exclude=**/gen/**",
  "--exclude=**/*.generated.{ts,tsx}",
  "node",
  "--import",
  "tsx",
  "./node_modules/@cucumber/cucumber/bin/cucumber.js",
  "--config",
  "cucumber.js",
  "--profile",
  "xcom2ProjectBuildRecipeTauriHarness",
];

function commandText(arguments_) {
  return ["pnpm", ...arguments_].join(" ");
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
      if (status === 0) resolve();
      else reject(new Error(`${rendered} failed with status ${status ?? `signal ${signal}`}`));
    });
  });
}

async function gitRevision() {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", ["rev-parse", "HEAD"], {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("close", (status) => {
      if (status === 0) resolve(output.trim());
      else reject(new Error(`git rev-parse HEAD failed with status ${status}`));
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

function printMetrics(label, metrics) {
  const values = ["branches", "functions", "lines"]
    .map(
      (metric) =>
        `${metric} ${metrics[metric].covered}/${metrics[metric].total} (${metrics[metric].pct}%)`,
    )
    .join(", ");
  console.log(`${label}: files ${metrics.files}; ${values}`);
}

const observedRevision = await gitRevision();
if (observedRevision !== TARGET_REVISION) {
  throw new Error(
    `${REQUIREMENT_ID} coverage is revision-bounded to ${TARGET_REVISION}; observed ${observedRevision}`,
  );
}

await rm(bundleRoot, { recursive: true, force: true });
await run(specArguments);
await run(storyArguments, { IDE_STORY_TARGET: "desktop/tauri-harness" });

const pureSpec = await readCoverageMap(path.join(specRawRoot, "coverage-final.json"));
const desktopTauriHarnessStory = await readCoverageMap(
  path.join(storyRawRoot, "coverage-final.json"),
);
assertSourceOnly(pureSpec, "pure-spec");
assertSourceOnly(desktopTauriHarnessStory, "desktop-tauri-harness-story");

const mergedCoverage = libCoverage.createCoverageMap({});
mergedCoverage.merge(pureSpec);
mergedCoverage.merge(desktopTauriHarnessStory);
writeIstanbulReports(mergedCoverage);

const pureSpecMetrics = sourceMetrics(pureSpec);
const storyMetrics = sourceMetrics(desktopTauriHarnessStory);
const mergedMetrics = sourceMetrics(mergedCoverage);
const manifest = {
  schemaVersion: 1,
  requirementId: REQUIREMENT_ID,
  targetRevision: TARGET_REVISION,
  observedRevision,
  reproductionCommand: REPRODUCTION_COMMAND,
  commands: {
    spec: commandText(specArguments),
    story: `IDE_STORY_TARGET=desktop/tauri-harness ${commandText(storyArguments)}`,
    validator: "node scripts/validate-req-xcom2-project-build-recipe-coverage.mjs",
  },
  selections: {
    specFiles: [
      "tests/spec/xcom2-project-build-recipe.spec.ts",
      "tests/spec/xcom2-native-activation-evidence.spec.ts",
    ],
    storyProfile: "xcom2ProjectBuildRecipeTauriHarness",
    storyRequirementTag: `@${REQUIREMENT_ID}`,
    storyTarget: "desktop/tauri-harness",
  },
  sourceClasses: {
    pureSpec: {
      purpose: "Focused pure TypeScript policy examples refining the requirement",
      rawDirectory: "raw/spec",
      ...pureSpecMetrics,
    },
    desktopTauriHarnessStory: {
      purpose:
        "Focused Cucumber Story through production desktop composition and the deterministic Tauri harness",
      rawDirectory: "raw/story",
      ...storyMetrics,
    },
  },
  merged: {
    technicallyValid: true,
    reportDirectory: "merged",
    mergeFormat: "Istanbul coverage maps remapped to JS/TS source paths",
    ...mergedMetrics,
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
