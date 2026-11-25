import { assertAuthoredSelection } from "./cucumber-selection.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import {
  discoverCucumberSelection,
  discoverCucumberSelections,
} from "../../scripts/cucumber-selection.mjs";
const require = createRequire(import.meta.url);
const repositoryRoot = process.cwd();
test("batched Cucumber discovery agrees with fresh CLI for outlines, tags, bindings and changed source coordinates without running hooks", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ide-batch-discovery-test-"));
  try {
    const feature = path.join(directory, "selected.feature"),
      other = path.join(directory, "other.feature"),
      support = path.join(directory, "support.cjs"),
      config = path.relative(repositoryRoot, path.join(directory, "cucumber.cjs")),
      marker = path.join(directory, "executed"),
      imports = path.join(directory, "imports");
    await writeFile(
      feature,
      `Feature: Real discovery\n  @a\n  Scenario Outline: Outline <value>\n    Given an authored value <value>\n    Then discovery keeps it bound\n    Examples:\n      | value |\n      | one |\n      | two |\n  @b\n  Scenario: Other selection\n    Given an authored value three\n    Then discovery keeps it bound\n`,
    );
    await writeFile(
      other,
      "Feature: Other source coordinates\n  Scenario: A distinct source file\n    Given an authored value four\n    Then discovery keeps it bound\n",
    );
    await writeFile(
      support,
      `const {Given,Then,Before}=require(${JSON.stringify(require.resolve("@cucumber/cucumber"))});\nconst fs=require("node:fs");\nfs.appendFileSync(${JSON.stringify(imports)},"loaded\\n");\nBefore(()=>{fs.writeFileSync(${JSON.stringify(marker)},"hook executed");throw Error("Discovery executed a hook");});\nGiven(/^an authored value (.+)$/,()=>{throw Error("Discovery executed a step");});\nThen("discovery keeps it bound",()=>{});\n`,
    );
    const common = { paths: [feature], require: [support], strict: true };
    await writeFile(
      config,
      `module.exports=${JSON.stringify({ a: { ...common, tags: "@a" }, b: { ...common, tags: "@b" }, other: { ...common, paths: [other] } })};`,
    );
    const profiles = ["a", "b", "other"];
    const batch = discoverCucumberSelections({ repositoryRoot, config, profiles });
    assert.equal(await readFile(imports, "utf8"), "loaded\n");
    for (const profile of profiles)
      assert.deepEqual(
        batch.get(profile),
        discoverCucumberSelection({ repositoryRoot, profile, config }),
      );
    assert.equal(batch.get("a").length, 2);
    assert.equal(batch.get("b").length, 1);
    assert.equal(batch.get("other")[0].name, "A distinct source file");
    assert.ok(
      batch.get("a").every((s) => s.authoredStepCount === 2 && s.unmatchedSteps.length === 0),
    );
    await assert.rejects(readFile(marker), { code: "ENOENT" });
    // Changed feature inputs must be discovered anew, never served from a global cache.
    await writeFile(
      other,
      "Feature: Changed source coordinates\n  Scenario: Fresh scenario\n    Given an authored value five\n    Then discovery keeps it bound\n",
    );
    assert.equal(
      discoverCucumberSelections({ repositoryRoot, config, profiles: ["other"] }).get("other")[0]
        .name,
      "Fresh scenario",
    );
    await writeFile(
      other,
      "Feature: Missing binding\n  Scenario: Unbound\n    Given a genuinely missing step definition\n",
    );
    const unbound = discoverCucumberSelections({ repositoryRoot, config, profiles: ["other"] }).get(
      "other",
    );
    assert.deepEqual(
      unbound,
      discoverCucumberSelection({ repositoryRoot, config, profile: "other" }),
    );
    assert.equal(unbound[0].unmatchedSteps.length, 1);
    assert.throws(
      () => assertAuthoredSelection("other", 1, 1, unbound),
      /undefined or ambiguous authored steps/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("batched discovery keeps implicit definitions scoped to their feature directories", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ide-batch-implicit-support-"));
  try {
    const profiles = {};
    for (const name of ["first", "second"]) {
      const featureDirectory = path.join(directory, name, "features");
      await mkdir(featureDirectory, { recursive: true });
      const feature = path.join(featureDirectory, "select.feature");
      await writeFile(feature, `Feature: ${name}\n  Scenario: ${name} scenario\n    Given the ${name} step\n`);
      await writeFile(path.join(featureDirectory, "support.cjs"), [
        `const { Given } = require(${JSON.stringify(require.resolve("@cucumber/cucumber"))});`,
        `Given("the ${name} step", () => { throw new Error("Discovery ran the step"); });`,
      ].join("\n"));
      profiles[name] = { paths: [feature] };
    }
    const config = path.relative(repositoryRoot, path.join(directory, "cucumber.cjs"));
    await writeFile(config, `module.exports = ${JSON.stringify(profiles)};`);
    const selection = discoverCucumberSelections({ repositoryRoot, config, profiles: Object.keys(profiles) });
    for (const name of Object.keys(profiles)) {
      const scenarios = selection.get(name);
      assertAuthoredSelection(name, 1, 1, scenarios);
      assert.equal(scenarios[0].name, `${name} scenario`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
