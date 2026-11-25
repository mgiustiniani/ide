#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildNativeDesktopApplication,
  createNativeDesktopSandbox,
  runNativeDesktopStory,
} from "./run-native-desktop-story.mjs";
const PROFILES = new Set(["desktopFileOpenNativeGui", "editorExternalChangesNativeGui"]);
const repository = fileURLToPath(new URL("..", import.meta.url));
export function startupProbeOptions(args) {
  const result = { profile: "desktopFileOpenNativeGui", attempts: 10, help: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (seen.has(key)) throw new Error(`Duplicate startup probe option ${key}`);
    seen.add(key);
    if (key === "--help") {
      result.help = true;
      continue;
    }
    if (!["--profile", "--attempts"].includes(key) || !args[index + 1])
      throw new Error("Expected --profile, --attempts or --help");
    const value = args[++index];
    if (key === "--profile") result.profile = value;
    else {
      if (!/^\d+$/.test(value)) throw new Error("Expected an integer startup attempt limit");
      result.attempts = Number(value);
    }
  }
  if (!PROFILES.has(result.profile)) throw new Error("Unsupported startup diagnostic profile");
  if (!Number.isInteger(result.attempts) || result.attempts < 1 || result.attempts > 24)
    throw new Error("Startup attempts must be between 1 and 24");
  return result;
}
/** Diagnostic only: real tools, one fresh build, no retry-until-green or runtime deadline extension. */
export async function runStartupProbe({
  profile = "desktopFileOpenNativeGui",
  attempts = 10,
  artifactRoot = path.join(repository, "test-results/native-startup-probe"),
  signal,
  environment = process.env,
  build = buildNativeDesktopApplication,
  run = runNativeDesktopStory,
} = {}) {
  startupProbeOptions(["--profile", profile, "--attempts", String(attempts)]);
  await mkdir(artifactRoot, { recursive: true });
  const artifactPath = await mkdtemp(path.join(artifactRoot, "run-"));
  await chmod(artifactPath, 0o700);
  const result = {
    kind: "startup-diagnostic",
    packagedApplication: false,
    reusedSingleFreshBuild: true,
    profile,
    limit: attempts,
    artifactPath,
    startedAt: new Date().toISOString(),
    passed: false,
    observations: [],
    notRun: Array.from({ length: attempts }, (_, index) => index + 1),
  };
  try {
    const application = await build({ signal, environment });
    result.applicationSha256 = application.sha256;
    for (let index = 1; index <= attempts && !signal?.aborted; index++) {
      console.log(`Startup diagnostic ${index}/${attempts}: ${profile}`);
      const startedAt = new Date().toISOString();
      let nativeArtifactPath = null;
      result.notRun.shift();
      try {
        const observation = await run(profile, {
          signal,
          environment,
          buildApplication: async () => application,
          createSandbox: async (options) => {
            const sandbox = await createNativeDesktopSandbox({
              ...options,
              artifactRoot: artifactPath,
            });
            nativeArtifactPath = sandbox.root;
            return sandbox;
          },
        });
        if (observation.skipped) throw new Error("Startup probe selected no native scenario");
        result.observations.push({
          attempt: index,
          startedAt,
          endedAt: new Date().toISOString(),
          passed: true,
          artifactPath: observation.sandbox.root,
        });
      } catch (error) {
        result.observations.push({
          attempt: index,
          startedAt,
          endedAt: new Date().toISOString(),
          passed: false,
          artifactPath: nativeArtifactPath,
          errorCode: error.code ?? null,
          reason: error.message,
        });
        break;
      }
      await writeFile(
        path.join(artifactPath, "result.json"),
        JSON.stringify(result, null, 2) + "\n",
        { mode: 0o600 },
      );
    }
    result.passed =
      !signal?.aborted &&
      result.observations.length === attempts &&
      result.observations.every((entry) => entry.passed);
  } catch (error) {
    result.buildFailure = { errorCode: error.code ?? null, reason: error.message };
  }
  result.aborted = Boolean(signal?.aborted);
  result.endedAt = new Date().toISOString();
  await writeFile(path.join(artifactPath, "result.json"), JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
  });
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  const deadline = setTimeout(stop, 45 * 60_000);
  deadline.unref();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const options = startupProbeOptions(process.argv.slice(2));
    if (options.help)
      console.log(
        "Diagnostic native startup probe: [--profile desktopFileOpenNativeGui|editorExternalChangesNativeGui] [--attempts 1..24]. One fresh executable is reused; stops on first failure, not a reliability verdict.",
      );
    else {
      const result = await runStartupProbe({ ...options, signal: controller.signal });
      console.log(`${result.passed ? "PASS" : "FAIL"} startup diagnostic: ${result.artifactPath}`);
      process.exitCode = result.passed ? 0 : 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
