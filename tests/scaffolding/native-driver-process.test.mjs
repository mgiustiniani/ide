import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { signalDriverProcessGroup } = await tsImport(
  "../story/support/native-driver-process.ts", import.meta.url,
);
const bounded = async (promise, label) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not complete`)), 3000);
    })]);
  } finally { clearTimeout(timer); }
};

test("native driver cleanup closes descendant pipes after the parent exits without signaling another group", {
  skip: process.platform === "win32", timeout: 10_000,
}, async () => {
  const descendant = `process.on('SIGTERM', () => {}); console.log('READY'); setInterval(() => {}, 1000);`;
  const parent = `const {spawn}=require('node:child_process'); spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:['ignore','inherit','inherit']}); setInterval(() => {}, 1000);`;
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const driver = spawn(process.execPath, ["--input-type=commonjs", "-e", parent], { env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const other = spawn(process.execPath, ["--input-type=commonjs", "-e", "setInterval(() => {}, 1000)"], { env: environment, detached: true, stdio: "ignore" });
  const exit = once(driver, "exit"), close = once(driver, "close"), otherExit = once(other, "exit");
  let diagnostics = "";
  driver.stderr.on("data", (data) => { diagnostics = (diagnostics + data).slice(-2048); });
  let closed = false;
  void close.then(() => { closed = true; });
  try {
    const [ready] = await bounded(once(driver.stdout, "data"), "descendant readiness").catch((error) => {
      throw new Error(`${error.message}: ${diagnostics}`, { cause: error });
    });
    assert.equal(ready.toString().trim(), "READY");
    signalDriverProcessGroup(driver, "SIGTERM");
    const [, signal] = await bounded(exit, "driver exit");
    assert.equal(signal, "SIGTERM");
    assert.equal(closed, false, "the descendant intentionally holds the output pipe open");
    signalDriverProcessGroup(driver, "SIGKILL");
    await bounded(close, "descendant pipe closure");
    assert.equal(closed, true);
    assert.equal(other.exitCode, null);
    assert.equal(other.signalCode, null);
    assert.doesNotThrow(() => process.kill(other.pid, 0));
    assert.doesNotThrow(() => signalDriverProcessGroup(driver, "SIGKILL"));
  } finally {
    signalDriverProcessGroup(driver, "SIGKILL");
    signalDriverProcessGroup(other, "SIGKILL");
    await Promise.all([bounded(close, "driver cleanup"), bounded(otherExit, "unrelated process cleanup")]);
  }
});
