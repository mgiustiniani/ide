import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import libCoverage from "istanbul-lib-coverage";

const execFileAsync = promisify(execFile);
const moduleWorkspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRESHNESS_TOLERANCE_MS = 5_000;

export const REQUIREMENT_ID = "REQ-XCOM2-PROJECT-BUILD-RECIPE-001";
export const CANONICAL_METRIC_SYSTEM = "istanbul-lib-coverage@3.2.2";
export const PROVIDER_NATIVE_METRIC_SYSTEM = "provider-native-v8";
export const REPRODUCTION_COMMAND = "pnpm test:coverage:req-xcom2-project-build-recipe-001";
export const VALIDATION_COMMAND =
  "node scripts/validate-req-xcom2-project-build-recipe-coverage.mjs";
export const MAX_BUNDLE_AGE_MS = 30 * 60 * 1_000;
export const TRACKED_CHANGES_POLICY =
  "The run requires the index and tracked worktree to match HEAD. Untracked and ignored telemetry or coverage output is not source dirtiness.";
export const SPEC_FILES = [
  "tests/spec/xcom2-project-build-recipe.spec.ts",
  "tests/spec/xcom2-native-activation-evidence.spec.ts",
];
export const STORY_PROFILE = "xcom2ProjectBuildRecipeTauriHarness";
export const BUNDLE_RELATIVE_PATH = "coverage/req-xcom2-project-build-recipe-001";

export const SPEC_ARGUMENTS = [
  "exec",
  "vitest",
  "run",
  "--config",
  "vitest.req-xcom2-project-build-recipe.coverage.config.ts",
  "--coverage.enabled=true",
];
export const STORY_ARGUMENTS = [
  "exec",
  "c8",
  "--clean=true",
  `--temp-directory=${BUNDLE_RELATIVE_PATH}/raw/story/v8`,
  `--reports-dir=${BUNDLE_RELATIVE_PATH}/raw/story`,
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
  STORY_PROFILE,
];

export const CONFIGURATION_FILES = {
  common: [
    "package.json",
    "pnpm-lock.yaml",
    "scripts/run-req-xcom2-project-build-recipe-coverage.mjs",
    "scripts/validate-req-xcom2-project-build-recipe-coverage.mjs",
  ],
  spec: ["vitest.req-xcom2-project-build-recipe.coverage.config.ts"],
  story: ["cucumber.js", "tsconfig.story.json"],
};

export function commandText(arguments_) {
  return ["pnpm", ...arguments_].join(" ");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashFile(file) {
  return sha256(await readFile(file));
}

async function git(workspaceRoot, arguments_) {
  const { stdout } = await execFileAsync("git", arguments_, {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  return stdout.trim();
}

export async function resolveRepositoryState(workspaceRoot = moduleWorkspaceRoot) {
  const [head, tree, trackedChanges] = await Promise.all([
    git(workspaceRoot, ["rev-parse", "HEAD"]),
    git(workspaceRoot, ["rev-parse", "HEAD^{tree}"]),
    git(workspaceRoot, ["status", "--porcelain=v1", "--untracked-files=no"]),
  ]);
  return { head, tree, trackedChanges };
}

export async function configurationHashes(workspaceRoot = moduleWorkspaceRoot) {
  const result = {};
  for (const sourceClass of Object.keys(CONFIGURATION_FILES)) {
    result[sourceClass] = {};
    for (const relative of CONFIGURATION_FILES[sourceClass]) {
      result[sourceClass][relative] = await hashFile(path.join(workspaceRoot, relative));
    }
  }
  return result;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function parseTimestamp(value, label) {
  assert.equal(typeof value, "string", `${label} must be an ISO timestamp`);
  const parsed = Date.parse(value);
  assert.ok(Number.isFinite(parsed), `${label} must be an ISO timestamp`);
  assert.equal(new Date(parsed).toISOString(), value, `${label} must be canonical ISO-8601`);
  return parsed;
}

function assertRepository(repository, currentRepository, label) {
  assert.equal(
    repository?.head,
    currentRepository.head,
    `${label} HEAD does not match current Git HEAD`,
  );
  assert.equal(
    repository?.tree,
    currentRepository.tree,
    `${label} tree does not match current HEAD tree`,
  );
}

function assertRawContribution(rawCoverage, sourceClass) {
  const files = Object.entries(rawCoverage);
  assert.ok(files.length > 0, `${sourceClass} raw coverage contains no source files`);

  const executed = files.some(([, coverage]) =>
    [coverage.s, coverage.f, coverage.b].some(
      (counts) =>
        counts &&
        Object.values(counts)
          .flat()
          .some((count) => Number(count) > 0),
    ),
  );
  assert.ok(executed, `${sourceClass} raw coverage contains no executed source range`);
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

function assertMetrics(metrics, sourceClass) {
  assert.ok(
    Number.isInteger(metrics.files) && metrics.files > 0,
    `${sourceClass} files must be > 0`,
  );
  for (const metric of ["statements", "branches", "functions", "lines"]) {
    assert.ok(metrics[metric], `${sourceClass} is missing ${metric} metrics`);
    assert.ok(
      Number.isFinite(metrics[metric].total) && metrics[metric].total > 0,
      `${sourceClass} ${metric}.total must be > 0`,
    );
    assert.ok(
      Number.isFinite(metrics[metric].covered) && metrics[metric].covered > 0,
      `${sourceClass} ${metric}.covered must be > 0`,
    );
    assert.ok(Number.isFinite(metrics[metric].pct), `${sourceClass} ${metric}.pct must be numeric`);
  }
}

function assertSummary(summary, expectedMetrics, sourceClass) {
  assert.ok(summary.total, `${sourceClass} coverage summary is missing its total`);
  for (const metric of ["statements", "branches", "functions", "lines"]) {
    assert.deepEqual(
      summary.total[metric],
      expectedMetrics[metric],
      `${sourceClass} ${metric} differs`,
    );
  }
}

async function regularFile(file, label) {
  const stats = await lstat(file);
  assert.ok(stats.isFile(), `${label} must be a regular file`);
  assert.ok(!stats.isSymbolicLink(), `${label} must not be a symbolic link`);
  return stats;
}

async function directory(directoryPath, label) {
  const stats = await lstat(directoryPath);
  assert.ok(stats.isDirectory(), `${label} must be a directory`);
  assert.ok(!stats.isSymbolicLink(), `${label} must not be a symbolic link`);
}

async function assertExactEntries(directoryPath, expected, label) {
  assert.deepEqual(
    (await readdir(directoryPath)).sort(),
    [...expected].sort(),
    `${label} entries differ`,
  );
}

export async function artifactInventory(root, relative = "") {
  const directoryPath = path.join(root, relative);
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const inventory = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryRelative = path.posix.join(relative.replaceAll(path.sep, "/"), entry.name);
    if (entryRelative === "coverage-manifest.json") continue;
    const entryPath = path.join(root, entryRelative);
    assert.ok(!entry.isSymbolicLink(), `${entryRelative} must not be a symbolic link`);
    if (entry.isDirectory()) inventory.push(...(await artifactInventory(root, entryRelative)));
    else {
      assert.ok(entry.isFile(), `${entryRelative} must be a regular file`);
      const stats = await regularFile(entryPath, entryRelative);
      inventory.push({ path: entryRelative, bytes: stats.size, sha256: await hashFile(entryPath) });
    }
  }
  return inventory;
}

async function assertFreshFile(file, startedAt, completedAt, label) {
  const stats = await regularFile(file, label);
  for (const [kind, observed] of [
    ["mtime", stats.mtimeMs],
    ["ctime", stats.ctimeMs],
  ]) {
    assert.ok(
      observed >= startedAt - FRESHNESS_TOLERANCE_MS,
      `${label} ${kind} predates this coverage run`,
    );
    assert.ok(
      observed <= completedAt + FRESHNESS_TOLERANCE_MS,
      `${label} ${kind} postdates this coverage run`,
    );
  }
}

function expectedCommands() {
  const spec = commandText(SPEC_ARGUMENTS);
  const story = `IDE_STORY_TARGET=desktop/tauri-harness ${commandText(STORY_ARGUMENTS)}`;
  return {
    spec: { text: spec, sha256: sha256(spec) },
    story: { text: story, sha256: sha256(story) },
    validator: { text: VALIDATION_COMMAND, sha256: sha256(VALIDATION_COMMAND) },
  };
}

function contributorConfiguration(configuration, contributor) {
  return {
    common: configuration.common,
    [contributor]: configuration[contributor],
  };
}

async function validateContributor({
  bundleRoot,
  contributor,
  metadataPath,
  sourceClass,
  expectedRawPath,
  expectedCanonicalSummaryPath,
  expectedProviderNativeSummaryPath,
  run,
  repository,
  commands,
  configuration,
}) {
  const receiptFile = path.join(bundleRoot, metadataPath);
  const receipt = await readJson(receiptFile);
  assert.equal(receipt.schemaVersion, 3);
  assert.equal(receipt.requirementId, REQUIREMENT_ID);
  assert.equal(receipt.contributor, contributor);
  assertRepository(receipt.repository, repository, `${sourceClass} contributor`);
  assert.equal(receipt.runNonce, run.nonce, `${sourceClass} contributor run nonce differs`);
  assert.equal(
    receipt.runStartedAt,
    run.startedAt,
    `${sourceClass} contributor run timestamp differs`,
  );
  assert.deepEqual(receipt.command, {
    ...commands[contributor],
    status: "success",
    exitCode: 0,
    signal: null,
  });
  assert.deepEqual(
    receipt.configurationHashes,
    contributorConfiguration(configuration, contributor),
    `${sourceClass} configuration hashes differ`,
  );
  assert.equal(receipt.rawCoverage.path, expectedRawPath);
  assert.equal(receipt.rawCoverage.metricSystem, CANONICAL_METRIC_SYSTEM);
  assert.equal(
    receipt.rawCoverage.sha256,
    await hashFile(path.join(bundleRoot, expectedRawPath)),
    `${sourceClass} raw coverage hash differs`,
  );
  assert.equal(receipt.canonicalSummary.path, expectedCanonicalSummaryPath);
  assert.equal(receipt.canonicalSummary.metricSystem, CANONICAL_METRIC_SYSTEM);
  assert.equal(
    receipt.canonicalSummary.derivedFromRawCoverageSha256,
    receipt.rawCoverage.sha256,
    `${sourceClass} canonical summary raw input hash differs`,
  );
  assert.equal(
    receipt.canonicalSummary.sha256,
    await hashFile(path.join(bundleRoot, expectedCanonicalSummaryPath)),
    `${sourceClass} canonical coverage summary hash differs`,
  );
  assert.equal(receipt.providerNativeSummary.path, expectedProviderNativeSummaryPath);
  assert.equal(receipt.providerNativeSummary.metricSystem, PROVIDER_NATIVE_METRIC_SYSTEM);
  assert.equal(receipt.providerNativeSummary.purpose, "informational-only");
  assert.equal(
    receipt.providerNativeSummary.sha256,
    await hashFile(path.join(bundleRoot, expectedProviderNativeSummaryPath)),
    `${sourceClass} informational provider-native summary hash differs`,
  );
  return { receipt, receiptFile };
}

export async function validateCoverageBundle(
  bundleRoot,
  {
    workspaceRoot = moduleWorkspaceRoot,
    now = Date.now(),
    maxBundleAgeMs = MAX_BUNDLE_AGE_MS,
  } = {},
) {
  const currentRepository = await resolveRepositoryState(workspaceRoot);
  assert.equal(
    currentRepository.trackedChanges,
    "",
    `coverage validation requires a clean tracked worktree and index; ${TRACKED_CHANGES_POLICY}`,
  );

  await directory(bundleRoot, "coverage bundle root");
  await assertExactEntries(
    bundleRoot,
    ["coverage-manifest.json", "merged", "raw", "run-metadata.json"],
    "coverage bundle root",
  );
  await directory(path.join(bundleRoot, "raw"), "raw coverage root");
  await assertExactEntries(path.join(bundleRoot, "raw"), ["spec", "story"], "raw coverage root");
  await directory(path.join(bundleRoot, "raw/spec"), "Spec raw coverage directory");
  await assertExactEntries(
    path.join(bundleRoot, "raw/spec"),
    [
      "contributor.json",
      "coverage-final.json",
      "coverage-summary.json",
      "provider-native-summary.json",
    ],
    "Spec raw coverage directory",
  );
  await directory(path.join(bundleRoot, "raw/story"), "Story raw coverage directory");
  await assertExactEntries(
    path.join(bundleRoot, "raw/story"),
    [
      "contributor.json",
      "coverage-final.json",
      "coverage-summary.json",
      "provider-native-summary.json",
      "v8",
    ],
    "Story raw coverage directory",
  );
  await directory(path.join(bundleRoot, "raw/story/v8"), "Story V8 coverage directory");
  assert.ok(
    (await readdir(path.join(bundleRoot, "raw/story/v8"))).length > 0,
    "Story V8 coverage is empty",
  );
  await directory(path.join(bundleRoot, "merged"), "merged coverage directory");
  for (const required of [
    "coverage-final.json",
    "coverage-summary.json",
    "lcov.info",
    "index.html",
  ]) {
    await regularFile(path.join(bundleRoot, "merged", required), `merged/${required}`);
  }

  const manifestFile = path.join(bundleRoot, "coverage-manifest.json");
  const manifest = await readJson(manifestFile);
  const runMetadata = await readJson(path.join(bundleRoot, "run-metadata.json"));
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(runMetadata.schemaVersion, 3);
  assert.equal(manifest.requirementId, REQUIREMENT_ID);
  assert.equal(runMetadata.requirementId, REQUIREMENT_ID);
  assert.equal(manifest.reproductionCommand, REPRODUCTION_COMMAND);
  assert.equal(runMetadata.reproductionCommand, REPRODUCTION_COMMAND);
  assert.equal(manifest.trackedChangesPolicy, TRACKED_CHANGES_POLICY);
  assert.equal(runMetadata.trackedChangesPolicy, TRACKED_CHANGES_POLICY);
  assertRepository(manifest.repository, currentRepository, "coverage manifest");
  assertRepository(runMetadata.repository, currentRepository, "run metadata");

  assert.match(manifest.run?.nonce ?? "", /^[0-9a-f]{8}-[0-9a-f-]{27}$/u, "invalid run nonce");
  assert.equal(runMetadata.run?.nonce, manifest.run.nonce, "run metadata nonce differs");
  assert.equal(
    runMetadata.run?.startedAt,
    manifest.run.startedAt,
    "run metadata timestamp differs",
  );
  const startedAt = parseTimestamp(manifest.run.startedAt, "run.startedAt");
  const completedAt = parseTimestamp(manifest.run.completedAt, "run.completedAt");
  assert.ok(completedAt >= startedAt, "coverage run completed before it started");
  assert.ok(
    completedAt <= now + FRESHNESS_TOLERANCE_MS,
    "coverage run completion is in the future",
  );
  assert.ok(
    now - completedAt <= maxBundleAgeMs,
    "coverage bundle is stale and must be regenerated",
  );

  const commands = expectedCommands();
  const currentConfiguration = await configurationHashes(workspaceRoot);
  assert.deepEqual(manifest.commands, commands, "coverage commands differ from canonical commands");
  assert.deepEqual(runMetadata.commands, commands, "run commands differ from canonical commands");
  assert.deepEqual(
    manifest.configurationHashes,
    currentConfiguration,
    "manifest configuration hashes differ from the current committed configuration",
  );
  assert.deepEqual(
    runMetadata.configurationHashes,
    currentConfiguration,
    "run configuration hashes differ from the current committed configuration",
  );

  const packageManifest = await readJson(path.join(workspaceRoot, "package.json"));
  assert.equal(
    packageManifest.scripts?.["test:coverage:req-xcom2-project-build-recipe-001"],
    "node scripts/run-req-xcom2-project-build-recipe-coverage.mjs",
  );
  assert.equal(
    packageManifest.scripts?.["validate:coverage:req-xcom2-project-build-recipe-001"],
    VALIDATION_COMMAND,
  );
  assert.deepEqual(manifest.selections.specFiles, SPEC_FILES);
  assert.equal(manifest.selections.storyProfile, STORY_PROFILE);
  assert.equal(manifest.selections.storyRequirementTag, `@${REQUIREMENT_ID}`);
  assert.equal(manifest.selections.storyTarget, "desktop/tauri-harness");

  const spec = await validateContributor({
    bundleRoot,
    contributor: "spec",
    metadataPath: "raw/spec/contributor.json",
    sourceClass: "pure-spec",
    expectedRawPath: "raw/spec/coverage-final.json",
    expectedCanonicalSummaryPath: "raw/spec/coverage-summary.json",
    expectedProviderNativeSummaryPath: "raw/spec/provider-native-summary.json",
    run: manifest.run,
    repository: currentRepository,
    commands,
    configuration: currentConfiguration,
  });
  const story = await validateContributor({
    bundleRoot,
    contributor: "story",
    metadataPath: "raw/story/contributor.json",
    sourceClass: "desktop-tauri-harness-story",
    expectedRawPath: "raw/story/coverage-final.json",
    expectedCanonicalSummaryPath: "raw/story/coverage-summary.json",
    expectedProviderNativeSummaryPath: "raw/story/provider-native-summary.json",
    run: manifest.run,
    repository: currentRepository,
    commands,
    configuration: currentConfiguration,
  });
  assert.notEqual(
    spec.receipt.rawCoverage.sha256,
    story.receipt.rawCoverage.sha256,
    "Spec and Story contributions must be distinct raw inputs",
  );
  assert.equal(
    manifest.contributors.spec.metadataSha256,
    await hashFile(spec.receiptFile),
    "Spec contributor metadata hash differs",
  );
  assert.equal(
    manifest.contributors.story.metadataSha256,
    await hashFile(story.receiptFile),
    "Story contributor metadata hash differs",
  );

  const specRaw = await readJson(path.join(bundleRoot, "raw/spec/coverage-final.json"));
  const storyRaw = await readJson(path.join(bundleRoot, "raw/story/coverage-final.json"));
  assertRawContribution(specRaw, "pure-spec");
  assertRawContribution(storyRaw, "desktop-tauri-harness-story");
  const specMap = libCoverage.createCoverageMap(specRaw);
  const storyMap = libCoverage.createCoverageMap(storyRaw);
  const specMetrics = sourceMetrics(specMap);
  const storyMetrics = sourceMetrics(storyMap);
  assertMetrics(specMetrics, "pure-spec");
  assertMetrics(storyMetrics, "desktop-tauri-harness-story");
  assert.equal(manifest.sourceClasses.pureSpec.metricSystem, CANONICAL_METRIC_SYSTEM);
  assert.equal(
    manifest.sourceClasses.desktopTauriHarnessStory.metricSystem,
    CANONICAL_METRIC_SYSTEM,
  );
  assert.deepEqual(manifest.sourceClasses.pureSpec.metrics, specMetrics);
  assert.deepEqual(manifest.sourceClasses.desktopTauriHarnessStory.metrics, storyMetrics);
  assertSummary(
    await readJson(path.join(bundleRoot, "raw/spec/coverage-summary.json")),
    specMetrics,
    "pure-spec",
  );
  assertSummary(
    await readJson(path.join(bundleRoot, "raw/story/coverage-summary.json")),
    storyMetrics,
    "desktop-tauri-harness-story",
  );

  const expectedMerged = libCoverage.createCoverageMap({});
  expectedMerged.merge(libCoverage.createCoverageMap(specRaw));
  expectedMerged.merge(libCoverage.createCoverageMap(storyRaw));
  const mergedRawPath = path.join(bundleRoot, "merged/coverage-final.json");
  const mergedRaw = await readJson(mergedRawPath);
  assert.deepEqual(
    mergedRaw,
    JSON.parse(JSON.stringify(expectedMerged.toJSON())),
    "merged coverage is not derived from the exact Spec and Story raw inputs",
  );
  const mergedMetrics = sourceMetrics(expectedMerged);
  assertMetrics(mergedMetrics, "merged");
  assert.deepEqual(manifest.merged.metrics, mergedMetrics);
  assert.equal(manifest.merged.technicallyValid, true);
  assert.equal(manifest.merged.metricSystem, CANONICAL_METRIC_SYSTEM);
  assert.deepEqual(manifest.merged.rawInputSha256, {
    spec: spec.receipt.rawCoverage.sha256,
    story: story.receipt.rawCoverage.sha256,
  });
  assert.equal(manifest.merged.coverageFinalSha256, await hashFile(mergedRawPath));
  assert.equal(
    manifest.merged.coverageSummarySha256,
    await hashFile(path.join(bundleRoot, "merged/coverage-summary.json")),
  );
  assertSummary(
    await readJson(path.join(bundleRoot, "merged/coverage-summary.json")),
    mergedMetrics,
    "merged",
  );
  assert.equal(manifest.limitations.rustCoverage, false);
  assert.equal(manifest.semanticDistinction.equivalentPurposes, false);

  const observedRawInventory = await artifactInventory(bundleRoot, "raw");
  assert.deepEqual(
    manifest.rawArtifactInventory,
    observedRawInventory,
    "raw coverage artifact inventory differs; raw evidence is missing, mixed, stale, or edited",
  );
  const observedInventory = await artifactInventory(bundleRoot);
  assert.deepEqual(
    manifest.artifactInventory,
    observedInventory,
    "coverage artifact inventory differs; the bundle is missing, mixed, stale, or edited",
  );
  for (const artifact of observedInventory) {
    await assertFreshFile(
      path.join(bundleRoot, artifact.path),
      startedAt,
      completedAt,
      artifact.path,
    );
  }
  await assertFreshFile(manifestFile, startedAt, completedAt, "coverage-manifest.json");

  return manifest;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const bundleRoot = path.resolve(
    process.argv[2] ?? path.join(moduleWorkspaceRoot, BUNDLE_RELATIVE_PATH),
  );
  await validateCoverageBundle(bundleRoot);
  console.log(`Validated ${REQUIREMENT_ID} coverage bundle at ${bundleRoot}`);
}
