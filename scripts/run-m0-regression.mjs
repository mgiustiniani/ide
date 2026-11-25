#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const NATIVE_PROFILES = [
  "desktopFileOpenNativeGui",
  "desktopStartupResponsivenessNativeGui",
  "editorRecoveryNativeGui",
  "editorCloseGuardsNativeGui",
  "javaExecutionNativeGui",
  "java26PreviewImportNativeGui",
  "javaBuildToolsNativeGui",
  "javaFailsafeReactorNativeGui",
  "javaDebuggerNativeGui",
  "javaJdiDebuggerNativeGui",
  "javaConditionalDebuggerNativeGui",
  "javaTestJvmNativeGui",
  "javaTestDiscoveryNativeGui",
  "javaTestNgDiscoveryNativeGui",
  "editorDiskComparisonNativeGui",
  "editorRecoveryHistoryNativeGui",
  "editorRecoveryFailuresNativeGui",
  "editorRecoveryCapacityCorruptionNativeGui",
  "editorStorageFullNativeGui",
  "editorExternalChangesNativeGui",
];
export function regressionPlan(suite = "core") {
  if (!["core", "native", "all"].includes(suite))
    throw new Error("Expected --suite core, native or all");
  const pnpm = (name, script, timeoutMs) => ({
    name,
    command: "pnpm",
    arguments: [script],
    timeoutMs,
  });
  const core = [
    pnpm("docs", "validate:docs", 60_000),
    pnpm("boundaries", "check:boundaries", 60_000),
    pnpm("bdd-types", "typecheck:bdd", 120_000),
    pnpm("lint", "lint", 120_000),
    pnpm("unit", "test", 300_000),
    pnpm("spec", "test:spec", 300_000),
    pnpm("scaffolding", "test:story:scaffolding", 300_000),
    {
      name: "rust",
      command: "cargo",
      arguments: [
        "test",
        "--manifest-path",
        "apps/desktop/src-tauri/Cargo.toml",
        "--locked",
        "--lib",
      ],
      timeoutMs: 600_000,
    },
    pnpm("web-build", "build:web", 300_000),
  ];
  const native = NATIVE_PROFILES.map((profile) => ({
    name: profile,
    profile,
    command: process.execPath,
    arguments: ["scripts/run-native-desktop-story.mjs", "--profile", profile],
    timeoutMs: 720_000,
  }));
  return suite === "core" ? core : suite === "native" ? native : [...core, ...native];
}

/** Runtime exit evidence, never a substituted success or a shell command string. */
export async function runRegressionCommand(
  step,
  { cwd, artifactPath, signal, environment = process.env, stopTimeoutMs = 2_000 },
) {
  const startedAt = new Date().toISOString();
  const base = {
    name: step.name,
    command: step.command,
    arguments: step.arguments,
    timeoutMs: step.timeoutMs,
    startedAt,
  };
  if (signal?.aborted)
    return {
      ...base,
      exitCode: null,
      signal: null,
      timedOut: false,
      aborted: true,
      launchError: false,
      passed: false,
      endedAt: new Date().toISOString(),
    };
  const stdout = await open(path.join(artifactPath, `${step.name}.stdout.log`), "wx", 0o600);
  let stderr;
  try {
    stderr = await open(path.join(artifactPath, `${step.name}.stderr.log`), "wx", 0o600);
    const child = spawn(step.command, step.arguments, {
      cwd,
      env: environment,
      detached: process.platform !== "win32",
      stdio: ["ignore", stdout.fd, stderr.fd],
    });
    let timedOut = false,
      aborted = false,
      launchError = false,
      stopping = false,
      escalation;
    const signalOwned = (value) => {
      if (!child.pid) return;
      try {
        process.kill(process.platform === "win32" ? child.pid : -child.pid, value);
      } catch (error) {
        if (error.code !== "ESRCH") launchError = true;
      }
    };
    const stop = () => {
      if (stopping) return;
      stopping = true;
      signalOwned("SIGTERM");
      escalation = setTimeout(() => signalOwned("SIGKILL"), stopTimeoutMs);
    };
    const abort = () => {
      aborted = true;
      stop();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const deadline = setTimeout(() => {
      timedOut = true;
      stop();
    }, step.timeoutMs);
    const result = await new Promise((resolve) => {
      child.once("error", () => {
        launchError = true;
      });
      child.once("close", (exitCode, exitSignal) => resolve({ exitCode, signal: exitSignal }));
    });
    clearTimeout(deadline);
    signal?.removeEventListener("abort", abort);
    if (stopping) {
      // A parent may exit on TERM while its owned process group still contains children.
      signalOwned("SIGKILL");
    }
    if (escalation !== undefined) clearTimeout(escalation);
    return {
      ...base,
      ...result,
      exitCode: launchError ? null : result.exitCode,
      timedOut,
      aborted,
      launchError,
      passed: result.exitCode === 0 && !timedOut && !aborted && !launchError,
      endedAt: new Date().toISOString(),
    };
  } finally {
    await stdout.close();
    await stderr?.close();
  }
}

export async function runRegression({
  suite = "core",
  artifactRoot = path.join(repositoryRoot, "test-results/m0-regression"),
  steps = regressionPlan(suite),
  execute = runRegressionCommand,
  signal,
  environment = process.env,
  onCheck = () => {},
} = {}) {
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const artifactPath = await mkdtemp(path.join(artifactRoot, "run-"));
  await chmod(artifactPath, 0o700);
  const result = {
    suite,
    artifactPath,
    artifactKind: "source-regression",
    packagedApplication: false,
    startedAt: new Date().toISOString(),
    passed: false,
    checks: [],
    notRun: steps.map((s) => s.name),
  };
  const publish = () =>
    writeFile(path.join(artifactPath, "result.json"), JSON.stringify(result, null, 2) + "\n", {
      mode: 0o600,
    });
  await publish();
  for (const step of steps) {
    if (signal?.aborted) break;
    onCheck(`START ${step.name}`);
    const check = await execute(step, { cwd: repositoryRoot, artifactPath, signal, environment });
    result.checks.push(check);
    result.notRun.shift();
    await publish();
    onCheck(`${check.passed ? "PASS" : "FAIL"} ${step.name}`);
    if (!check.passed) break;
  }
  result.passed =
    result.notRun.length === 0 &&
    result.checks.length === steps.length &&
    result.checks.every((s) => s.passed) &&
    !signal?.aborted;
  result.endedAt = new Date().toISOString();
  await publish();
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  let suite = "core",
    plan = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--suite") suite = args[++index];
    else if (args[index] === "--plan") plan = true;
    else throw new Error("Usage: run-m0-regression.mjs [--suite core|native|all] [--plan]");
  }
  if (!suite) throw new Error("Missing --suite value");
  const steps = regressionPlan(suite);
  if (plan) {
    console.log(JSON.stringify({ suite, steps }, null, 2));
    return;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  const deadline = setTimeout(abort, 90 * 60 * 1_000);
  try {
    const result = await runRegression({
      suite,
      steps,
      signal: controller.signal,
      onCheck: console.log,
    });
    console.log(`${result.passed ? "PASS" : "FAIL"} M0 ${suite}: ${result.artifactPath}`);
    if (!result.passed) process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
