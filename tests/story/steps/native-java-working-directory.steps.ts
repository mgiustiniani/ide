import { After, Given, Then, When } from "@cucumber/cucumber";
import { matchesNativeArtifactEvidence } from "../support/native-artifact-evidence.js";
import type { StoryWorld } from "../support/world.js";
import { NativeJavaWorkingDirectorySession } from "../support/native-java-working-directory.js";
const sessions = new WeakMap<StoryWorld, NativeJavaWorkingDirectorySession>();
function session(world: StoryWorld) { const value = sessions.get(world); if (!value) throw new Error("working-directory fixture not prepared"); return value; }
Given<StoryWorld>("the native Java IDE has separate project and application directories", async function () {
  const value = new NativeJavaWorkingDirectorySession(); sessions.set(this, value); await value.prepare();
});
When<StoryWorld>("the person configures the application directory and runs the main class", { timeout: 60_000 }, async function () { await session(this).launchAndConfigure(); });
Then<StoryWorld>("rerun retains the captured directory and a missing directory refuses execution while Build remains available", { timeout: 60_000 }, async function () { await session(this).rerunCapturedAndRefuseMissingDirectory(); });
When<StoryWorld>("the person reloads the saved configuration and debugs from its application directory", { timeout: 60_000 }, async function () { await session(this).restoreAndDebug(); });
Then<StoryWorld>("the Java working-directory IDE closes with its source preserved", { timeout: 20_000 }, async function () { await session(this).close(); });
Given<StoryWorld>("the native Java IDE has a real Maven application and a full JDK 8", async function () {
  if (
    this.targetProfile.driver !== "tauri-webdriver" ||
    this.targetEvidence?.nativeGui !== true ||
    this.targetEvidence.e2e !== true ||
    !matchesNativeArtifactEvidence(this.targetEvidence)
  ) throw new Error("Maven Java 8 acceptance requires matching native desktop artifact evidence");
  const value = new NativeJavaWorkingDirectorySession();
  sessions.set(this, value);
  await value.prepare(true);
});
When<StoryWorld>("the person saves the Maven Java 8 application settings and reloads the IDE", { timeout: 40_000 }, async function () {
  await session(this).saveMavenJava8Settings();
});
Then<StoryWorld>("the restored Maven launch preserves its literal values, runtime dependency and working directory", { timeout: 45_000 }, async function () {
  await session(this).verifyMavenJava8Run();
});
Then<StoryWorld>("Maven discovery lists both Java 8 tests and executes only the selected method on request", { timeout: 60_000 }, async function () {
  await session(this).verifyMavenJava8Discovery();
});
After<StoryWorld>({ tags: "@native-java-working-directory or @native-java8-maven-run", timeout: 30_000 }, async function () {
  await sessions.get(this)?.dispose();
});
