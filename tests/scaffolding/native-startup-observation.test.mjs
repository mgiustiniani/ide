import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const { nativeStartupDomObservation, recordNativeStartupObservation } = await tsImport(
  "../story/support/native-startup-observation.ts",
  import.meta.url,
);

test("native WebView startup probe persists its host without URL query data", async () => {
  await fixture(async ({ sandbox }) => {
    const keys = ["document", "window", "location", "innerWidth", "innerHeight", "performance"];
    const original = new Map(
      keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
    );
    const install = (key, value) =>
      Object.defineProperty(globalThis, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    try {
      install("document", {
        body: { innerText: "Could not connect to localhost: Connection refused" },
        documentElement: { dataset: { ideBootstrap: null } },
        getElementById: () => null,
        readyState: "complete",
        querySelector: () => null,
        scripts: [],
        visibilityState: "visible",
      });
      install("window", {});
      install("location", {
        host: "localhost:1420",
        href: "http://localhost:1420/?token=do-not-record",
        protocol: "http:",
      });
      install("innerWidth", 1280);
      install("innerHeight", 720);
      install("performance", { getEntriesByType: () => [] });
      const result = await recordNativeStartupObservation({
        sandbox,
        outcome: "timeout",
        capture: async () => nativeStartupDomObservation(),
      });
      assert.equal(result.persisted, true);
      assert.equal(result.observation.locationHost, "localhost:1420");
      assert.equal(JSON.stringify(result.observation).includes("do-not-record"), false);
      const [name] = await readdir(path.join(sandbox, "artifacts"));
      const stored = await readFile(path.join(sandbox, "artifacts", name), "utf8");
      assert.ok(stored.includes('"locationHost":"localhost:1420"'));
      assert.ok(!stored.includes("do-not-record"));
    } finally {
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  });
});

async function fixture(run) {
  const sandbox = await mkdtemp(path.join(tmpdir(), "native-startup-observation-"));
  await chmod(sandbox, 0o700);
  await mkdir(path.join(sandbox, "artifacts"));
  await mkdir(path.join(sandbox, "scenarios"));
  const source = path.join(sandbox, "scenarios", "proof.txt");
  await writeFile(source, "unchanged source");
  try {
    await run({ sandbox, source });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}
test("startup snapshots remain private, bounded and persistent outside scenario cleanup", async () => {
  await fixture(async ({ sandbox, source }) => {
    const result = await recordNativeStartupObservation({
      sandbox,
      outcome: "timeout",
      applicationPid: 123,
      capture: async () => ({
        readyState: "complete",
        rootChildren: 0,
        nativeBridgePresent: true,
        visibleText: `token=unsafe ${source} ` + "x".repeat(3000),
      }),
    });
    assert.equal(result.persisted, true);
    await rm(path.join(sandbox, "scenarios"), { recursive: true });
    const files = await readdir(path.join(sandbox, "artifacts"));
    assert.equal(files.length, 1);
    const file = path.join(sandbox, "artifacts", files[0]);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const bytes = await readFile(file, "utf8");
    assert.ok(bytes.length < 16 * 1024);
    assert.ok(!bytes.includes("token=unsafe") && !bytes.includes(source));
    const report = JSON.parse(bytes);
    assert.equal(report.outcome, "timeout");
    assert.equal(report.applicationPid, 123);
    assert.equal(report.observation.rootChildren, 0);
    assert.equal(report.observation.visibleText.length <= 2048, true);
  });
});
test("DOM inspection has a bounded deadline even when the read-only request never resolves", async () => {
  await fixture(async ({ sandbox }) => {
    const result = await recordNativeStartupObservation({
      sandbox,
      outcome: "timeout",
      capture: () => new Promise(() => {}),
    });
    assert.equal(result.inspection, "unavailable");
    assert.equal(result.observation, null);
    assert.equal(result.persisted, true);
  });
});

test("a native close timeout preserves the surviving window observation separately", async () => {
  await fixture(async ({ sandbox }) => {
    const visibleText = "Save modified files before closing the IDE.";
    const result = await recordNativeStartupObservation({
      sandbox,
      outcome: "close-timeout",
      applicationPid: 123,
      capture: async () => ({ visibleText }),
    });
    assert.equal(result.persisted, true);
    const [name] = await readdir(path.join(sandbox, "artifacts"));
    assert.match(name, /^close-timeout-.*\.json$/);
    const report = JSON.parse(await readFile(path.join(sandbox, "artifacts", name), "utf8"));
    assert.deepEqual(report, {
      outcome: "close-timeout",
      applicationPid: 123,
      inspection: "available",
      observation: { visibleText },
    });
  });
});

test("unavailable DOM inspection is recorded without inventing readiness or masking the primary result", async () => {
  await fixture(async ({ sandbox, source }) => {
    const before = await readFile(source);
    const result = await recordNativeStartupObservation({
      sandbox,
      outcome: "timeout",
      capture: async () => {
        throw new Error("secret=unsafe");
      },
    });
    assert.equal(result.persisted, true);
    const [name] = await readdir(path.join(sandbox, "artifacts"));
    const report = JSON.parse(await readFile(path.join(sandbox, "artifacts", name), "utf8"));
    assert.equal(report.observation, null);
    assert.equal(report.inspection, "unavailable");
    assert.deepEqual(await readFile(source), before);
    const unsafe = path.join(sandbox, "unsafe");
    await mkdir(unsafe);
    await rm(path.join(sandbox, "artifacts"), { recursive: true });
    await symlink(unsafe, path.join(sandbox, "artifacts"));
    const refused = await recordNativeStartupObservation({
      sandbox,
      outcome: "timeout",
      capture: async () => ({}),
    });
    assert.equal(refused.persisted, false);
    assert.deepEqual(await readdir(unsafe), []);
  });
});
