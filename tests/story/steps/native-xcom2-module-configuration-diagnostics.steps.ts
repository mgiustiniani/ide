import { Given, Then, When, type DataTable } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

function session(world: StoryWorld) {
  return world.nativeXcom2ModuleConfigurationDiagnosticsSession();
}

Given<StoryWorld>(
  "one scenario sandbox owns all desktop user state and an actual authorized workspace named {string}",
  async function (workspaceName: string) {
    await this.createNativeXcom2ModuleConfigurationDiagnosticsSession().allocateScenario(
      workspaceName,
    );
  },
);

Given<StoryWorld>(
  "the isolated desktop user state contains one scenario-owner secret canary that is absent from the workspace",
  async function () {
    await session(this).createSecretCanaryInIsolatedUserState();
  },
);

Given<StoryWorld>("the actual workspace contains no XCOM convention evidence", async function () {
  await session(this).assertWorkspaceContainsNoConventionEvidence();
});

Given<StoryWorld>(
  /^its actual regular file "([^"]+)" has exactly these malformed UTF-(\d+) bytes:$/,
  async function (relativePath: string, encodingBits: string, contents: string) {
    await session(this).createMalformedConfiguration(relativePath, Number(encodingBits), contents);
  },
);

Given<StoryWorld>(
  "every project path and containing directory has that exact Linux case, is non-symlink, and remains contained within the authorized workspace",
  async function () {
    const diagnosticSession = session(this);
    await diagnosticSession.assertProjectPathsConfined();
    await this.attach(JSON.stringify(diagnosticSession.fixtureManifest()), "application/json");
    diagnosticSession.markFixtureManifestAttached();
  },
);

Then<StoryWorld>(
  "within {int} seconds the workspace is ready",
  { timeout: 20_000 },
  async function (seconds: number) {
    await session(this).waitForWorkspaceReady(seconds);
  },
);

When<StoryWorld>(
  "the person opens the real Settings and selects {string}",
  async function (sectionName: string) {
    await session(this).openWorkspaceSettings(sectionName);
  },
);

Then<StoryWorld>(
  "{string} shows exactly one atomic accessible warning with role {string} and title {string}",
  async function (currentWorkspace: string, role: string, title: string) {
    await session(this).assertCurrentWorkspaceWarning(currentWorkspace, role, title);
  },
);

Then<StoryWorld>("that warning shows exactly:", async function (dataTable: DataTable) {
  await session(this).assertWarningFields(
    dataTable.hashes().map((row) => ({ field: row.field ?? "", value: row.value ?? "" })),
  );
});

Then<StoryWorld>(
  "the warning is perceivable without color alone and offers no edit, open, or write action",
  async function () {
    await session(this).assertWarningNonColorAndReadOnly();
  },
);

Then<StoryWorld>(
  "that diagnostic warning and its mirrored project warning contain none of these prohibited disclosures:",
  async function (dataTable: DataTable) {
    await session(this).assertNoProhibitedWarningDisclosures(
      dataTable.hashes().map((row) => row["prohibited disclosure"] ?? ""),
    );
  },
);

Then<StoryWorld>(
  "no {string} activity entry, recognition panel, or XCOM bottom contribution appears",
  async function (activityName: string) {
    await session(this).assertNoConfiguredContributions(activityName);
  },
);

When<StoryWorld>(
  /^the scenario owner externally replaces the actual regular "([^"]+)" file without using the application with exactly these valid v1 UTF-(\d+) bytes:$/,
  async function (relativePath: string, encodingBits: string, contents: string) {
    await session(this).replaceConfigurationExternally(
      relativePath,
      Number(encodingBits),
      contents,
      "valid",
    );
  },
);

Then<StoryWorld>(
  "throughout the next one second the exact invalid-JSON warning remains unchanged",
  { timeout: 5_000 },
  async function () {
    await session(this).assertInvalidWarningRetainedForOneSecond();
  },
);

Then<StoryWorld>(
  "the invalid-JSON warning is synchronously cleared and the neutral state {string} appears before Workspace Refresh reports completion",
  function (checkingText: string) {
    session(this).assertFirstRefreshTransition(checkingText);
  },
);

Then<StoryWorld>(
  "within {int} seconds the neutral checking state clears and no configuration or scan warning is shown",
  { timeout: 20_000 },
  async function (seconds: number) {
    await session(this).assertCheckingClearedWithoutWarnings(seconds);
  },
);

Then<StoryWorld>(
  "exactly one accessible activity entry named {string} appears with a keyboard-focusable control of the same accessible name",
  { timeout: 20_000 },
  async function (activityName: string) {
    const diagnosticSession = session(this);
    await diagnosticSession.assertExactlyOneActivityWithin(15, activityName);
    await diagnosticSession.assertActivityKeyboardFocusable(activityName);
  },
);

Then<StoryWorld>(
  "configured activation grants no XCOM Build, Problems, Logs, language support, project action, process execution, external-root authority, or bottom contribution",
  async function () {
    await session(this).assertConfiguredRecognitionOnlyExclusions();
  },
);

When<StoryWorld>(
  /^the scenario owner externally replaces the actual regular "([^"]+)" file without using the application with exactly these unsupported-target UTF-(\d+) bytes:$/,
  async function (relativePath: string, encodingBits: string, contents: string) {
    await session(this).replaceConfigurationExternally(
      relativePath,
      Number(encodingBits),
      contents,
      "unsupported",
    );
  },
);

When<StoryWorld>(
  "the scenario owner externally creates exactly these empty regular Option A descriptor files without using the application:",
  async function (dataTable: DataTable) {
    await session(this).createDescriptorsExternally(
      dataTable.hashes().map((row) => ({
        "workspace-relative path": row["workspace-relative path"] ?? "",
        "exact byte length": row["exact byte length"] ?? "",
      })),
    );
  },
);

Then<StoryWorld>(
  "throughout the next one second the exact configured activity and open recognition panel remain unchanged",
  { timeout: 5_000 },
  async function () {
    await session(this).assertConfiguredPanelRetainedForOneSecond();
  },
);

Then<StoryWorld>("no configuration or scan warning appears", async function () {
  await session(this).assertNoConfigurationOrScanWarning();
});

Then<StoryWorld>(
  "the application performs no configuration or evidence watch or poll refresh",
  function () {
    session(this).assertNoConfigurationOrEvidenceWatchOrPollRefresh();
  },
);

When<StoryWorld>(
  "the person returns to the real Settings > Workspace and invokes the actual {string} control",
  { timeout: 20_000 },
  async function (controlName: string) {
    await session(this).returnToWorkspaceSettingsAndRefresh(controlName);
  },
);

Then<StoryWorld>(
  "the configured decision and its explicit-configuration reason are synchronously revoked and the neutral state {string} appears before Workspace Refresh reports completion",
  function (checkingText: string) {
    session(this).assertSecondRefreshTransition(checkingText);
  },
);

Then<StoryWorld>(
  "within {int} seconds {string} shows exactly one atomic accessible warning with role {string} and title {string}",
  { timeout: 20_000 },
  async function (seconds: number, currentWorkspace: string, role: string, title: string) {
    await session(this).assertCurrentWorkspaceWarning(currentWorkspace, role, title, seconds);
  },
);

Then<StoryWorld>("the neutral checking state has cleared", async function () {
  await session(this).assertCheckingCleared();
});

Then<StoryWorld>(
  "exactly one keyboard-accessible {string} activity entry remains solely from recognized high-confidence Option A evidence",
  async function (activityName: string) {
    await session(this).assertRecognizedActivityOnly(activityName);
  },
);

Then<StoryWorld>(
  "its warning mirrors the exact unsupported-target title, project file label, summary, remediation, and support identifier as one atomic accessible role {string}",
  async function (role: string) {
    await session(this).assertMirroredUnsupportedWarning(role);
  },
);

Then<StoryWorld>(
  "no configured, explicit, or explicit-configuration reason or authority remains",
  async function () {
    await session(this).assertNoConfiguredAuthority();
  },
);

Then<StoryWorld>(
  "no XCOM Build, Problems, Logs, language support, project action, process execution, external-root authority, or bottom contribution exists",
  async function () {
    await session(this).assertRecognizedRecognitionOnlyExclusions();
  },
);

Then<StoryWorld>(
  "throughout the next five seconds the exact unsupported-target warning, recognized high-confidence activity, open panel, and ordered evidence remain unchanged",
  { timeout: 12_000 },
  async function () {
    await session(this).assertFiveSecondStability();
  },
);

Then<StoryWorld>(
  "no late stale configured decision, explicit authority, explicit-configuration reason, second activity entry, or XCOM bottom contribution appears",
  async function () {
    await session(this).assertNoLateStaleConfiguredState();
  },
);

Then<StoryWorld>(
  "the actual {string} bytes remain exactly the unsupported-target bytes specified above",
  async function (relativePath: string) {
    await session(this).assertUnsupportedConfigurationBytes(relativePath);
  },
);

Then<StoryWorld>(
  "both Option A descriptor files remain exact empty regular files",
  async function () {
    await session(this).assertDescriptorFilesRemainExact();
  },
);

Then<StoryWorld>(
  "after application launch the only workspace filesystem mutations are the scenario owner's two exact external configuration replacements and exact external creation of those two descriptor files",
  async function () {
    await session(this).assertOwnerOnlyMutationAccounting();
  },
);

Then<StoryWorld>(
  "throughout the scenario the application never creates, writes, reformats, or deletes the project configuration or Option A evidence files",
  async function () {
    await session(this).assertApplicationNeverMutatedProjectFiles();
  },
);
