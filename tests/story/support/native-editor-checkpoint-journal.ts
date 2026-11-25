import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { bounded } from "./native-desktop-application.js";
import type { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

export interface NativeJournalEntry {
  id: string;
  owner: string;
  filePath: string;
  kind: "draft" | "history";
  content: string;
}

/** Independently read the real journal; never manufacture recovery entries. */
export class NativeEditorCheckpointJournal {
  constructor(private readonly lease: NativeScenarioEnvironmentLease) {}
  async path(): Promise<string> {
    const root = await realpath(this.lease.paths.workspace);
    const key = createHash("sha256").update(root).digest("hex");
    return path.join(this.lease.paths.ideHome, "editor-recovery", key, "journal.json");
  }
  async holdLock(): Promise<() => Promise<void>> {
    const lockPath = path.join(path.dirname(await this.path()), "journal.lock");
    const child = spawn("/usr/bin/python3", ["-c", `
import fcntl, os, sys
with os.fdopen(os.open(sys.argv[1], os.O_RDONLY | os.O_NOFOLLOW)) as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    print('locked', flush=True)
    sys.stdin.read()
`, lockPath], { stdio: ["pipe", "pipe", "ignore"] });
    child.stdin.on("error", () => { /* process completion reports a failed lock */ });
    const closed = once(child, "close");
    const release = async () => {
      child.stdin.end();
      try {
        const [code] = await bounded(closed, 2_000, "fixture journal lock release");
        assert.equal(code, 0);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    };
    try {
      const [ready] = await bounded(Promise.race([once(child.stdout, "data"), closed]), 2_000, "fixture journal lock");
      assert.equal(String(ready).trim(), "locked");
      return release;
    } catch (error) {
      await release().catch(() => undefined);
      throw error;
    }
  }
  async bytes(): Promise<Buffer> {
    const file = await this.path();
    const meta = await lstat(file);
    assert.ok(meta.isFile() && !meta.isSymbolicLink() && meta.nlink === 1);
    assert.ok(meta.size > 0 && meta.size <= 128 * 1024, "fixture journal exceeded its bound");
    assert.equal(meta.mode & 0o777, 0o600);
    assert.equal((await lstat(path.dirname(file))).mode & 0o777, 0o700);
    const bytes = await readFile(file);
    assert.ok(bytes.length > 0 && bytes.length <= 128 * 1024, "fixture journal exceeded its bound");
    return bytes;
  }
  async entries(): Promise<NativeJournalEntry[]> {
    const journal = JSON.parse((await this.bytes()).toString("utf8"));
    assert.equal(journal.version, 1);
    assert.equal(journal.workspaceKey, path.basename(path.dirname(await this.path())));
    assert.ok(Array.isArray(journal.entries));
    for (const entry of journal.entries) {
      assert.match(entry.id, /^[0-9a-f]{32}$/);
      assert.match(entry.owner, /^[0-9a-f]{32}$/);
      assert.ok(["draft", "history"].includes(entry.kind));
      assert.equal(typeof entry.filePath, "string");
      assert.equal(typeof entry.content, "string");
    }
    return journal.entries;
  }
}
