import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const fixturePrefix = ".panel-layout-browser-";
const packages = [
  { name: "@ide/ui", directory: "packages/ui" },
  { name: "@ide/tauri-adapters", directory: "packages/tauri-adapters" },
];

async function collectTestFiles(directory) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectTestFiles(entryPath)));
    else if (/\.(?:test|spec)\.tsx?$/.test(entry.name)) files.push(entryPath);
  }

  return files;
}

function run(command, arguments_, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      ...options,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (process.platform === "win32") child.kill("SIGKILL");
      else if (child.pid) process.kill(-child.pid, "SIGKILL");
    }, 120_000);

    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

async function markedProcesses(marker) {
  if (process.platform !== "linux") return [];

  const processIds = (await readdir("/proc")).filter((entry) => /^\d+$/.test(entry));
  const matches = [];
  await Promise.all(
    processIds.map(async (processId) => {
      try {
        const environment = await readFile(`/proc/${processId}/environ`, "utf8");
        if (environment.includes(`IDE_PACKAGE_TEST_RUN=${marker}\0`)) matches.push(processId);
      } catch {
        // Processes may exit between listing and inspection, or belong to another user.
      }
    }),
  );
  return matches.sort((left, right) => Number(left) - Number(right));
}

async function assertNoMarkedProcesses(marker) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const matches = await markedProcesses(marker);
    if (matches.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.deepEqual(await markedProcesses(marker), [], `processes leaked for marker ${marker}`);
}

async function runPackageTest({ cwd, arguments_, marker }) {
  const result = await run(pnpmCommand, arguments_, {
    cwd,
    env: { ...process.env, IDE_PACKAGE_TEST_RUN: marker, NO_COLOR: "1" },
  });
  await assertNoMarkedProcesses(marker);
  return result;
}

async function fixtureDirectories() {
  return (await readdir(path.join(workspaceRoot, "packages/ui")))
    .filter((entry) => entry.startsWith(fixturePrefix))
    .sort();
}

function resultFiles(report) {
  return report.testResults.map(({ name }) => path.resolve(name)).sort();
}

test("package test scripts are cwd-independent, exact, and leak-free", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "ide-package-tests-"));
  const fixturesBefore = await fixtureDirectories();
  let failure;

  try {
    for (const package_ of packages) {
      const packageRoot = path.join(workspaceRoot, package_.directory);
      const expectedFiles = (await collectTestFiles(path.join(packageRoot, "src")))
        .map((file) => path.resolve(file))
        .sort();
      const invocations = [
        {
          label: "repository root",
          cwd: workspaceRoot,
          prefix: ["--filter", package_.name, "test"],
        },
        {
          label: "package cwd",
          cwd: packageRoot,
          prefix: ["--filter", package_.name, "test"],
        },
      ];
      let expectedTestCount;

      for (const [index, invocation] of invocations.entries()) {
        const reportPath = path.join(
          temporaryRoot,
          `${package_.name.replaceAll(/[^a-z]/gi, "-")}-${index}.json`,
        );
        const marker = `${process.pid}-${Date.now()}-${package_.name}-${index}`;
        const result = await runPackageTest({
          cwd: invocation.cwd,
          marker,
          arguments_: [...invocation.prefix, "--reporter=json", `--outputFile=${reportPath}`],
        });
        assert.equal(
          result.status,
          0,
          `${package_.name} failed from ${invocation.label}\n${result.stdout}\n${result.stderr}`,
        );

        const report = JSON.parse(await readFile(reportPath, "utf8"));
        assert.deepEqual(resultFiles(report), expectedFiles);
        assert.equal(report.numFailedTests, 0);
        assert.equal(report.numPassedTests, report.numTotalTests);
        expectedTestCount ??= report.numTotalTests;
        assert.equal(report.numTotalTests, expectedTestCount);

        const rejected = await runPackageTest({
          cwd: invocation.cwd,
          marker: `${marker}-failure`,
          arguments_: [
            ...invocation.prefix,
            `--config=${path.join(temporaryRoot, "missing-vitest.config.ts")}`,
          ],
        });
        assert.notEqual(
          rejected.status,
          0,
          `${package_.name} swallowed a Vitest configuration failure from ${invocation.label}`,
        );
        assert.equal(rejected.signal, null);
        assert.deepEqual(await fixtureDirectories(), fixturesBefore);
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  await assert.rejects(access(temporaryRoot), { code: "ENOENT" });
  if (failure) throw failure;
});
