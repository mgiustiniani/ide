import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateDocumentation } from "../../scripts/validate-documentation.mjs";
function check(text) {
  const root = mkdtempSync(join(tmpdir(), "ide-human-docs-"));
  try {
    writeFileSync(join(root, "README.md"), text);
    return validateDocumentation(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("accepts published web references", () =>
  assert.deepEqual(check("[C4](https://c4model.com/)"), []));
test("rejects developer-filesystem document links", () =>
  assert.match(check("[notes](/home/developer/notes.md)").join(), /non-repository/));
test("rejects missing same-repository files", () =>
  assert.match(check("[notes](missing.md)").join(), /missing/));
test("rejects documentation checksum values", () =>
  assert.match(check("checksum: " + "a".repeat(64)).join(), /redundant/));
test("rejects links to individual commits", () =>
  assert.match(check("[revision](https://example.org/commit/abc1234)").join(), /commit link/));
test("validates internal heading links", () =>
  assert.deepEqual(check("# Title\n[section](#title)"), []));
test("rejects missing heading links", () =>
  assert.match(check("# Title\n[section](#other)").join(), /missing heading/));
