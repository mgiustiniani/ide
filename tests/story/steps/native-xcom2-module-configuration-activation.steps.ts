import { Given, Then, When, type DataTable } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

function session(world: StoryWorld) {
  return world.nativeXcom2ModuleConfigurationActivationSession();
}

Given<StoryWorld>(
  /^"([^"]+)" contains no XCOM convention evidence and no "([^"]+)" configuration$/,
  async function (workspace: string, configurationPath: string) {
    await session(this).assertGenericContainsNoConventionEvidence(workspace, configurationPath);
  },
);

Given<StoryWorld>(
  "the actual {string} workspace contains no XCOM convention evidence",
  async function (workspace: string) {
    await session(this).assertConfiguredContainsNoConventionEvidence(workspace);
  },
);

Given<StoryWorld>(
  "its actual {string} path is an empty regular directory",
  async function (relativePath: string) {
    await session(this).createEmptyModuleRoot(relativePath);
  },
);

Given<StoryWorld>(
  /^its actual regular file "([^"]+)" has exactly these UTF-8 bytes:$/,
  async function (relativePath: string, contents: string) {
    await session(this).createExactConfiguration(relativePath, 8, contents);
  },
);

Given<StoryWorld>(
  "the configured module root and all its containing directories are non-symlink directories contained within the authorized {string} workspace",
  async function (workspace: string) {
    const configuredSession = session(this);
    await configuredSession.assertConfiguredRootConfined(workspace);
    await this.attach(
      JSON.stringify(configuredSession.configurationFixtureManifest()),
      "application/json",
    );
    configuredSession.markFixtureManifestAttached();
  },
);

Then<StoryWorld>(
  "it has no {string} activity entry, recognition panel, or XCOM bottom contribution",
  async function (activityName: string) {
    const configuredSession = session(this);
    const phase = configuredSession.evidence().readyWorkspaces.at(-1) ?? "workspace";
    await configuredSession.assertNoConfiguredContributions(activityName, phase);
  },
);

Then<StoryWorld>(
  "within {int} seconds the configured workspace is ready",
  { timeout: 20_000 },
  async function (seconds: number) {
    await session(this).waitForWorkspaceReady(seconds, "configured-wotc");
  },
);

Then<StoryWorld>(
  "exactly one accessible activity entry named {string} appears",
  { timeout: 20_000 },
  async function (activityName: string) {
    await session(this).assertExactlyOneActivityWithin(15, activityName);
  },
);

Then<StoryWorld>(
  "its ordered activation reasons are exactly:",
  async function (dataTable: DataTable) {
    await session(this).assertOrderedActivationReasons(
      dataTable.hashes().map((row) => ({
        kind: row.kind ?? "",
        "workspace-relative path": row["workspace-relative path"] ?? "",
      })),
    );
  },
);

Then<StoryWorld>("no configuration or scan issue is shown", async function () {
  await session(this).assertNoConfigurationOrScanIssue();
});

Then<StoryWorld>(
  "configuration grants no XCOM Build, Problems, Logs, language support, project action, process execution, external-root authority, or bottom contribution",
  async function () {
    await session(this).assertConfigurationRecognitionOnlyExclusions();
  },
);

When<StoryWorld>(
  "the scenario owner removes the actual {string} file externally without using the application",
  async function (relativePath: string) {
    await session(this).removeConfigurationExternally(relativePath);
  },
);

Then<StoryWorld>(
  "throughout the next one second the activity entry and its exact open recognition panel remain unchanged",
  { timeout: 5_000 },
  async function () {
    await session(this).assertOneSecondRetention();
  },
);

Then<StoryWorld>("the application performs no configuration watch or poll refresh", function () {
  session(this).assertNoConfigurationWatchOrPollRefresh();
});

When<StoryWorld>(
  "the person invokes the actual {string} control",
  { timeout: 20_000 },
  async function (controlName: string) {
    await session(this).invokeWorkspaceRefresh(controlName);
  },
);

Then<StoryWorld>(
  "the activity entry and recognition panel are synchronously revoked before Workspace Refresh reports completion",
  function () {
    session(this).assertSynchronousRefreshRevocation();
  },
);

Then<StoryWorld>(
  "no late stale {string} activity entry, recognition panel, or XCOM bottom contribution reappears during the next five seconds",
  { timeout: 10_000 },
  async function (activityName: string) {
    await session(this).assertNoLateStaleReappearance(activityName);
  },
);

When<StoryWorld>(
  /^the scenario owner externally restores "([^"]+)" with the exact UTF-8 bytes specified above$/,
  async function (relativePath: string) {
    await session(this).restoreConfigurationExternally(relativePath, 8);
  },
);

Then<StoryWorld>(
  "within {int} seconds exactly one keyboard-accessible {string} activity entry and its exact previously specified panel fields and ordered reason are restored",
  { timeout: 20_000 },
  async function (seconds: number, activityName: string) {
    await session(this).assertRestoredActivation(seconds, activityName);
  },
);

Then<StoryWorld>(
  "the restored actual {string} bytes remain exactly unchanged",
  async function (relativePath: string) {
    await session(this).assertConfigurationBytesUnchanged(relativePath);
  },
);

Then<StoryWorld>(
  "throughout the scenario the application never creates, writes, reformats, or deletes {string}; only the scenario owner's external removal and restoration change it",
  async function (relativePath: string) {
    await session(this).assertOwnerOnlyConfigurationMutation(relativePath);
  },
);

Then<StoryWorld>(
  "the configured module root and all its containing directories remain non-symlink directories contained within the authorized {string} workspace",
  async function (workspace: string) {
    const configuredSession = session(this);
    await configuredSession.assertConfiguredDirectoriesRemainConfined(workspace);
    await this.attachNativeXcom2ModuleConfigurationActivationEvidence();
  },
);
