import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, symlink, link, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { NativeSourceFileLease } = await tsImport(
  "../story/support/native-source-file-lease.ts",
  import.meta.url,
);
const options = { skip: process.platform !== "linux" };
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ide-source-lease-")));
  const source = path.join(root, "source.txt");
  await writeFile(source, "untouched lease café source", { mode: 0o600 });
  return { root, source };
}

test(
  "a genuine Linux file lease blocks another source reader until explicit release, without writing",
  options,
  async () => {
    const { root, source } = await fixture();
    let lease;
    try {
      lease = await NativeSourceFileLease.acquire(root, "source.txt");
      const reader = spawn(process.execPath, [
        "-e",
        "require('fs').readFileSync(process.argv[1])",
        source,
      ]);
      let exited = false;
      const exit = new Promise((resolve, reject) => {
        reader.once("error", reject);
        reader.once("close", (code, signal) => {
          exited = true;
          resolve({ code, signal });
        });
      });
      await lease.waitForBreak();
      assert.equal(exited, false);
      await lease.release();
      assert.deepEqual(await exit, { code: 0, signal: null });
      assert.equal(await readFile(source, "utf8"), "untouched lease café source");
      assert.deepEqual(lease.evidence(), {
        acquired: true,
        realLeaseBreakObserved: true,
        released: true,
        originalSha256: createHash("sha256").update("untouched lease café source").digest("hex"),
      });
    } finally {
      await lease?.release();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "source lease admission refuses symlinks, hard links and traversal without modifying bytes",
  options,
  async () => {
    const { root, source } = await fixture();
    try {
      await symlink(source, path.join(root, "alias.txt"));
      await assert.rejects(NativeSourceFileLease.acquire(root, "alias.txt"), /refused|failed/);
      await link(source, path.join(root, "linked.txt"));
      await assert.rejects(NativeSourceFileLease.acquire(root, "source.txt"), /refused|failed/);
      await assert.rejects(NativeSourceFileLease.acquire(root, "../source.txt"), /refused|failed/);
      assert.equal(await readFile(source, "utf8"), "untouched lease café source");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("a source lease can be explicitly released without a break request", options, async () => {
  const { root, source } = await fixture();
  let lease;
  try {
    lease = await NativeSourceFileLease.acquire(root, "source.txt");
    await lease.release();
    await lease.release();
    assert.equal(lease.evidence().realLeaseBreakObserved, false);
    assert.equal(await readFile(source, "utf8"), "untouched lease café source");
  } finally {
    await lease?.release();
    await rm(root, { recursive: true, force: true });
  }
});
