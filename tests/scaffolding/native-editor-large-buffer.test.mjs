import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const {
  NativeEditorLargeBuffer,
  NATIVE_RECOVERY_CAPACITY_SOURCE,
  NATIVE_RECOVERY_OVERSIZED_BUFFER,
} = await tsImport("../story/support/native-editor-large-buffer.ts", import.meta.url);

test("recovery GUI capacity fixtures exercise UTF-8 byte bounds, not UTF-16 character counts", () => {
  assert.equal(Buffer.byteLength(NATIVE_RECOVERY_CAPACITY_SOURCE), 1024 * 1024);
  assert.equal(Buffer.byteLength(NATIVE_RECOVERY_OVERSIZED_BUFFER), 1024 * 1024 + 1);
  assert.ok(NATIVE_RECOVERY_OVERSIZED_BUFFER.length < 1024 * 1024);
  assert.equal(NATIVE_RECOVERY_OVERSIZED_BUFFER, NATIVE_RECOVERY_CAPACITY_SOURCE + "!");
});
test("native large-buffer observation refuses an unbounded clipboard fixture before accessing a driver", async () => {
  const fixture = new NativeEditorLargeBuffer({
    browser() {
      throw new Error("driver must not be accessed");
    },
  });
  await assert.rejects(fixture.assertCopied("capacity-proof.txt", "x".repeat(1024 * 1024 + 2)), {
    name: "AssertionError",
  });
});
