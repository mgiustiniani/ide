#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const cucumberEntry = path.join(repositoryRoot, "node_modules/@cucumber/cucumber/bin/cucumber.js");
const PROCESS_STOP_TIMEOUT_MS = 2_000;

function commandLabel(command, args) {
  return [command, ...args].map((value) => JSON.stringify(value)).join(" ");
}

function signalProcessTree(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

export async function runProfileCommand(
  command,
  args,
  { cwd = repositoryRoot, signal, stdio = "inherit", stopTimeoutMs = PROCESS_STOP_TIMEOUT_MS } = {},
) {
  if (signal?.aborted) {
    throw new Error(`Story profile command aborted before start: ${commandLabel(command, args)}`);
  }

  const child = spawn(command, args, {
    cwd,
    detached: process.platform !== "win32",
    env: process.env,
    stdio,
  });
  const exit = waitForExit(child);
  let aborted = false;
  let forcedStop;
  const abort = () => {
    aborted = true;
    signalProcessTree(child, "SIGTERM");
    forcedStop = setTimeout(() => signalProcessTree(child, "SIGKILL"), stopTimeoutMs);
    forcedStop.unref();
  };
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const result = await exit;
    if (aborted) {
      throw new Error(`Story profile command aborted: ${commandLabel(command, args)}`);
    }
    if (result.code !== 0) {
      const outcome = result.signal ? `signal ${result.signal}` : `exit code ${result.code}`;
      throw new Error(
        `Story profile command failed with ${outcome}: ${commandLabel(command, args)}`,
      );
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    if (forcedStop) clearTimeout(forcedStop);
    if (child.exitCode === null && child.signalCode === null) {
      signalProcessTree(child, "SIGKILL");
      await exit.catch(() => undefined);
    }
  }
}

function cucumberArguments(profile) {
  return ["--import", "tsx", cucumberEntry, "--config", "cucumber.js", "--profile", profile];
}

export async function runImplementedStoryAggregate({ signal, run = runProfileCommand } = {}) {
  await run(process.execPath, ["scripts/assert-implemented-story-profiles.mjs"], { signal });
  await run(process.execPath, cucumberArguments("implementedWeb"), { signal });
  await run(process.execPath, cucumberArguments("implementedDesktopTauriHarness"), { signal });
  await run(
    process.execPath,
    ["scripts/run-native-desktop-story.mjs", "--profile", "implementedDesktopTauriWebdriver"],
    { signal },
  );
  await run(process.execPath, cucumberArguments("idePackagingTauriHarness"), { signal });
}

async function main() {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  try {
    await runImplementedStoryAggregate({ signal: controller.signal });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
