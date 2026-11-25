import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { captureOwnedApplication, signalOwnedApplication } = await tsImport(
  "../story/support/native-application-process-identity.ts",
  import.meta.url,
);

async function ownedWorker(run) {
  const root = await mkdtemp(path.join(tmpdir(), "native-process-identity-"));
  const expected = {
    executable: await realpath(process.execPath),
    sandbox: root,
    workspace: path.join(root, "workspace"),
    ideHome: path.join(root, "ide-home"),
  };
  const child = spawn(
    process.execPath,
    ["-e", "process.stdout.write('ready'); setInterval(() => {}, 1000)"],
    {
      env: {
        ...process.env,
        IDE_STORY_NATIVE_GUI_SANDBOX_PATH: expected.sandbox,
        IDE_WORKSPACE_ROOT: expected.workspace,
        IDE_HOME: expected.ideHome,
      },
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const exit = new Promise((resolve, reject) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", reject);
  });
  try {
    await new Promise((resolve) => child.stdout.once("data", resolve));
    await run(child, expected, exit);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exit;
    await rm(root, { recursive: true, force: true });
  }
}

test(
  "native forced termination refuses a foreign sandbox",
  { skip: process.platform !== "linux" },
  async () => {
    await ownedWorker(async (child, expected) => {
      await assert.rejects(
        captureOwnedApplication(child.pid, { ...expected, sandbox: `${expected.sandbox}-foreign` }),
        /owned application/,
      );
      assert.equal(child.signalCode, null);
    });
  },
);

test(
  "native termination refuses a reused PID identity and a different executable",
  { skip: process.platform !== "linux" },
  async () => {
    await ownedWorker(async (child, expected) => {
      const identity = await captureOwnedApplication(child.pid, expected);
      await assert.rejects(
        signalOwnedApplication(
          { ...identity, startTime: `${identity.startTime}-stale` },
          "SIGKILL",
        ),
        /identity changed/,
      );
      await assert.rejects(
        captureOwnedApplication(child.pid, { ...expected, executable: "/bin/false" }),
        /owned application/,
      );
      assert.equal(child.signalCode, null);
    });
  },
);

test(
  "native termination kills only the still-owned executable process",
  { skip: process.platform !== "linux" },
  async () => {
    await ownedWorker(async (child, expected, exit) => {
      const identity = await captureOwnedApplication(child.pid, expected);
      await signalOwnedApplication(identity, "SIGKILL");
      assert.deepEqual(await exit, { code: null, signal: "SIGKILL" });
    });
  },
);
