#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = path.join(repositoryRoot, "tests/legacy-test-baseline.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const failures = [];

if (manifest.files.length !== 60) {
  failures.push(`manifest must contain exactly 60 baseline paths, found ${manifest.files.length}`);
}
if (new Set(manifest.files).size !== manifest.files.length) {
  failures.push("manifest contains duplicate baseline paths");
}

const missingFiles = manifest.files.filter(
  (relativePath) => !existsSync(path.join(repositoryRoot, relativePath)),
);
for (const relativePath of missingFiles) {
  failures.push(`baseline test file is missing: ${relativePath}`);
}

const vitestEntry = path.join(repositoryRoot, "node_modules/vitest/vitest.mjs");
const collectionDirectory = mkdtempSync(path.join(tmpdir(), "legacy-test-baseline-"));
const collectionPath = path.join(collectionDirectory, "tests.json");
const collection = spawnSync(
  process.execPath,
  [vitestEntry, "list", "--config", "vitest.config.ts", "--json", collectionPath],
  { cwd: repositoryRoot, encoding: "utf8" },
);

try {
  if (collection.status !== 0) {
    process.stderr.write(collection.stdout);
    process.stderr.write(collection.stderr);
    failures.push(`Vitest collection failed with exit code ${collection.status ?? "unknown"}`);
  } else {
    try {
      const parsed = JSON.parse(readFileSync(collectionPath, "utf8"));
      const collected = Array.isArray(parsed) ? parsed : parsed.tests;
      if (!Array.isArray(collected)) {
        throw new TypeError("Vitest JSON did not contain a test array");
      }
      if (collected.length < manifest.collectedTests) {
        failures.push(
          `collected test count fell below the ${manifest.collectedTests}-test baseline: ${collected.length}`,
        );
      } else {
        console.log(
          `Legacy collection: ${collected.length} tests (baseline ${manifest.collectedTests}; additions allowed).`,
        );
      }
    } catch (error) {
      failures.push(`could not parse Vitest collection JSON: ${error.message}`);
    }
  }
} finally {
  rmSync(collectionDirectory, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("Legacy test baseline: FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Legacy files: ${manifest.files.length}/60 baseline paths present.`);
console.log("Legacy test baseline: PASS");
