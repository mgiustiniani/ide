import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const validatorPath = path.join(workspaceRoot, "scripts/validate-bdd-documentation.py");

function runValidator(root, extraArguments = []) {
  return spawnSync("python3", [validatorPath, "--root", root, ...extraArguments], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
}

async function temporaryProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "bdd-documentation-validator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("strict documentation validation passes when legacy PLAN.md is absent", async (t) => {
  const root = await temporaryProject(t);

  const result = runValidator(root);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /validate-bdd-documentation: PASS/);
  assert.doesNotMatch(result.stdout, /WARNING:/);
});

test("strict documentation validation rejects a reintroduced legacy PLAN.md", async (t) => {
  const root = await temporaryProject(t);
  await writeFile(path.join(root, "PLAN.md"), "# Reintroduced legacy plan\n", "utf8");

  const result = runValidator(root);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /validate-bdd-documentation: FAIL/);
  assert.match(
    result.stdout,
    /legacy PLAN\.md remains; classify its content and remove it before bdd-ts admission/,
  );

  const removedEscape = runValidator(root, ["--allow-legacy-plan"]);
  assert.equal(removedEscape.status, 2, removedEscape.stderr || removedEscape.stdout);
  assert.match(removedEscape.stderr, /unrecognized arguments: --allow-legacy-plan/);
});

test("canonical migration validation routes through strict documentation validation", async () => {
  const packageJson = JSON.parse(await readFile(path.join(workspaceRoot, "package.json"), "utf8"));
  const validatorSource = await readFile(validatorPath, "utf8");

  assert.equal(
    packageJson.scripts["validate:bdd:docs"],
    "python3 scripts/validate-bdd-documentation.py --root .",
  );
  assert.equal(packageJson.scripts["validate:bdd:docs:migration"], undefined);
  assert.deepEqual(packageJson.scripts["validate:bdd:migration"].split(" && "), [
    "pnpm test:legacy-baseline",
    "pnpm validate:bdd:docs",
    "pnpm typecheck:bdd",
    "pnpm test:story:declared",
    "pnpm test:spec",
  ]);
  assert.doesNotMatch(validatorSource, /allow-legacy-plan/);
});
