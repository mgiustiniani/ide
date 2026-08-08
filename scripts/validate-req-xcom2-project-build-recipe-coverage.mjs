import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIREMENT_ID = "REQ-XCOM2-PROJECT-BUILD-RECIPE-001";
export const TARGET_REVISION = "1275fc9bf0b140b09dfafdd22e87d05341561035";
export const REPRODUCTION_COMMAND = "pnpm test:coverage:req-xcom2-project-build-recipe-001";

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
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

function assertMetrics(metrics, sourceClass) {
  assert.ok(
    Number.isInteger(metrics.files) && metrics.files > 0,
    `${sourceClass} files must be > 0`,
  );
  for (const metric of ["branches", "functions", "lines"]) {
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

export async function validateCoverageBundle(bundleRoot) {
  const manifest = await readJson(path.join(bundleRoot, "coverage-manifest.json"));
  assert.equal(manifest.requirementId, REQUIREMENT_ID);
  assert.equal(manifest.targetRevision, TARGET_REVISION);
  assert.equal(manifest.observedRevision, TARGET_REVISION);
  assert.equal(manifest.reproductionCommand, REPRODUCTION_COMMAND);
  assert.deepEqual(manifest.selections.specFiles, [
    "tests/spec/xcom2-project-build-recipe.spec.ts",
    "tests/spec/xcom2-native-activation-evidence.spec.ts",
  ]);
  assert.equal(manifest.selections.storyProfile, "xcom2ProjectBuildRecipeTauriHarness");
  assert.match(
    manifest.commands.spec,
    /vitest.*vitest\.req-xcom2-project-build-recipe\.coverage\.config\.ts/u,
  );
  assert.match(manifest.commands.story, /c8.*xcom2ProjectBuildRecipeTauriHarness/u);
  assert.equal(manifest.limitations.rustCoverage, false);
  assert.equal(manifest.semanticDistinction.equivalentPurposes, false);

  const specRaw = await readJson(path.join(bundleRoot, "raw/spec/coverage-final.json"));
  const storyRaw = await readJson(path.join(bundleRoot, "raw/story/coverage-final.json"));
  assertRawContribution(specRaw, "pure-spec");
  assertRawContribution(storyRaw, "desktop-tauri-harness-story");

  assertMetrics(manifest.sourceClasses.pureSpec, "pure-spec");
  assertMetrics(manifest.sourceClasses.desktopTauriHarnessStory, "desktop-tauri-harness-story");
  assertMetrics(manifest.merged, "merged");
  assert.equal(manifest.merged.technicallyValid, true);

  const mergedSummary = await readJson(path.join(bundleRoot, "merged/coverage-summary.json"));
  assert.ok(mergedSummary.total, "merged coverage summary is missing its total");
  for (const metric of ["branches", "functions", "lines"]) {
    assert.equal(mergedSummary.total[metric].total, manifest.merged[metric].total);
    assert.equal(mergedSummary.total[metric].covered, manifest.merged[metric].covered);
  }

  return manifest;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const bundleRoot = path.resolve(
    process.argv[2] ?? path.join(workspaceRoot, "coverage/req-xcom2-project-build-recipe-001"),
  );
  await validateCoverageBundle(bundleRoot);
  console.log(`Validated ${REQUIREMENT_ID} coverage bundle at ${bundleRoot}`);
}
