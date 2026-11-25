import { After, Given, Status, Then, When } from "@cucumber/cucumber";
import { NativeJavaFailsafeReactorSession } from "../support/native-java-failsafe-reactor.js";
import type { StoryWorld } from "../support/world.js";

const sessions = new WeakMap<StoryWorld, NativeJavaFailsafeReactorSession>();

function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("native Maven Failsafe reactor scenario not prepared");
  return value;
}

Given<StoryWorld>(
  "the native Maven integration-test GUI has an isolated two-module Failsafe reactor with {word} reports",
  { timeout: 20_000 },
  async function (reports: string) {
    if (reports !== "standard" && reports !== "custom") throw new Error("Unknown Maven report layout");
    const evidence = this.targetEvidence;
    const artifactKind = evidence?.artifactKind;
    if (
      this.targetProfile.name !== "desktop" ||
      this.targetProfile.driver !== "tauri-webdriver" ||
      evidence?.nativeGui !== true ||
      evidence.e2e !== true ||
      (artifactKind !== "release-no-bundle" && artifactKind !== "appimage") ||
      evidence.packagedApplication !== (artifactKind === "appimage")
    )
      throw new Error("Maven reactor qualification requires a real Linux desktop build");
    if (sessions.has(this)) throw new Error("native Maven Failsafe reactor scenario already prepared");
    const value = new NativeJavaFailsafeReactorSession(artifactKind, reports);
    sessions.set(this, value);
    await value.prepare();
  },
);

When<StoryWorld>(
  "the production Maven reactor IDE opens its application and AppIT sources",
  { timeout: 40_000 },
  async function () {
    await session(this).launch();
  },
);

Then<StoryWorld>(
  "the Maven reactor integration actions are untrusted and no module execution artifacts exist",
  async function () {
    await session(this).assertUntrusted();
  },
);

When<StoryWorld>(
  "the developer trusts the Maven reactor workspace and requests Run integration tests",
  { timeout: 30_000 },
  async function () {
    await session(this).trustAndRun();
  },
);

Then<StoryWorld>(
  "fresh results display both module Failsafe reports and omit the Surefire reports",
  { timeout: 30_000 },
  async function () {
    await session(this).assertInitialFailure();
  },
);

When<StoryWorld>(
  "the developer repairs AppIT in the editor and requests Rerun failed tests",
  { timeout: 30_000 },
  async function () {
    await session(this).repairAndRerunFailed();
  },
);

Then<StoryWorld>(
  "Open test source reveals the failing AppIT line in the module that produced its report",
  { timeout: 120_000 },
  async function () {
    await session(this).openReportedFailure();
  },
);

Then<StoryWorld>(
  "the reactor rerun executes only the repaired failed test and leaves the core module unchanged",
  { timeout: 30_000 },
  async function () {
    await session(this).assertRerun();
  },
);

When<StoryWorld>(
  "the developer requests Rerun session for that integration test",
  { timeout: 20_000 },
  async function () {
    await session(this).repeatIntegrationSession();
  },
);

Then<StoryWorld>(
  "the integration test runs again without rerunning the core module",
  { timeout: 30_000 },
  async function () {
    await session(this).assertRerun(3);
  },
);

When<StoryWorld>(
  "the developer closes the clean Maven reactor IDE through the native window protocol",
  async function () {
    await session(this).requestClose();
  },
);

Then<StoryWorld>(
  "the reactor IDE exits with only the explicit AppIT save and unchanged Maven descriptors",
  async function () {
    await session(this).assertClosed();
  },
);

After<StoryWorld>(
  { tags: "@native-java-failsafe-reactor", timeout: 20_000 },
  async function ({ result }) {
    const value = sessions.get(this);
    if (!value) return;
    sessions.delete(this);
    try {
      if (result?.status === Status.FAILED) await value.captureFailure();
      await value.dispose();
    } finally {
      await this.attach(JSON.stringify(value.evidence()), "application/json");
      const diagnostics = value.diagnostics();
      if (diagnostics) await this.attach(diagnostics, "text/plain");
    }
  },
);
