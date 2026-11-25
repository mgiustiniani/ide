import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

export class NativeSourceFileLease {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  #messages: Record<string, unknown>[] = [];
  #failure = false;
  #ended = false;
  #closing = false;

  private constructor(root: string, fixture: string) {
    this.#child = spawn(
      "/usr/bin/python3",
      [fileURLToPath(new URL("./native-source-file-lease.py", import.meta.url)), root, fixture],
      {
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let pending = "",
      bytes = 0;
    this.#child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 8192) {
        this.#failure = true;
        return;
      }
      pending += chunk.toString("utf8");
      while (pending.includes("\n")) {
        const offset = pending.indexOf("\n");
        try {
          const value = JSON.parse(pending.slice(0, offset));
          if (!value || !["acquired", "break-requested", "released", "failed"].includes(value.kind))
            throw new Error("invalid fixture event");
          this.#messages.push(value);
          if (value.kind === "failed") this.#failure = true;
        } catch {
          this.#failure = true;
        }
        pending = pending.slice(offset + 1);
      }
    });
    this.#child.stderr.on("data", () => {
      this.#failure = true;
    });
    this.#child.stdin.on("error", () => {
      this.#failure = true;
    });
    this.#exit = new Promise((resolve) => {
      this.#child.once("error", () => {
        this.#failure = true;
        this.#ended = true;
        resolve({ code: null, signal: null });
      });
      this.#child.once("close", (code, signal) => {
        this.#ended = true;
        resolve({ code, signal });
      });
    });
  }

  static async acquire(root: string, fixture: string): Promise<NativeSourceFileLease> {
    const lease = new NativeSourceFileLease(root, fixture);
    try {
      const event = await lease.waitFor("acquired", 2000);
      assert.equal(typeof event.originalSha256, "string");
      assert.match(event.originalSha256 as string, /^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(event.inode) && Number.isSafeInteger(event.device));
      return lease;
    } catch (error) {
      try {
        await lease.release();
      } catch {
        /* Preserve admission refusal. */
      }
      throw error;
    }
  }
  evidence() {
    return {
      acquired: this.#messages.some((value) => value.kind === "acquired"),
      realLeaseBreakObserved: this.#messages.some((value) => value.kind === "break-requested"),
      released: this.#messages.some((value) => value.kind === "released"),
      originalSha256: this.#messages.find((value) => value.kind === "acquired")?.originalSha256,
    };
  }
  async waitForBreak(): Promise<void> {
    await this.waitFor("break-requested", 5000);
  }
  private async waitFor(kind: string, milliseconds: number): Promise<Record<string, unknown>> {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      if (this.#failure) throw new Error("Linux source file lease fixture refused or failed");
      const event = this.#messages.find((value) => value.kind === kind);
      if (event) return event;
      if (this.#ended) throw new Error("Linux source file lease fixture exited before observation");
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error("Linux source file lease observation deadline");
  }
  async release(): Promise<void> {
    if (!this.#closing) {
      this.#closing = true;
      if (!this.#ended) this.#child.stdin.end("release\n");
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const exit = await Promise.race([
        this.#exit,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Linux source lease release deadline")), 3000);
        }),
      ]);
      assert.equal(exit.signal, null);
      assert.equal(exit.code, 0, "Linux source lease fixture did not exit cleanly");
      assert.equal(this.evidence().released, true);
    } finally {
      clearTimeout(timer);
    }
  }
}
