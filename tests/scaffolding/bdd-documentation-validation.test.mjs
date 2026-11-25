import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
const validator = resolve("scripts/validate-bdd-documentation.py");
const scenario = (name) =>
  `  @REQ-DOC-001 @functional-requirement\n  Scenario: ${name}\n    Given a condition\n`;
function validate(files) {
  const root = mkdtempSync(join(tmpdir(), "ide-doc-validator-"));
  mkdirSync(join(root, "features"));
  try {
    for (const [name, content] of Object.entries(files))
      writeFileSync(join(root, "features", name), content);
    return spawnSync("python3", [validator, "--root", root], { encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("inherits file-level status across narrative headings and multiple acceptance scenarios", () => {
  const result = validate({
    "one.feature":
      "@not-implemented\nBusiness Need: reliable documentation\nAbility: explain behavior\nFeature: documentation\n" +
      scenario("first") +
      scenario("second"),
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test("still rejects a requirement duplicated in another feature", () => {
  const source = "@not-implemented\nFeature: documentation\n" + scenario("first");
  const result = validate({ "one.feature": source, "two.feature": source });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /duplicate @REQ-DOC-001/);
});
test("still rejects conflicting effective statuses", () => {
  const result = validate({
    "one.feature":
      "@not-implemented\nFeature: documentation\n  @implemented-and-validated\n" +
      scenario("first"),
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /expected one effective status/);
});
