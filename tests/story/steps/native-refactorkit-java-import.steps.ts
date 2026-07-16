import assert from "node:assert/strict";

import { Given, Then, When, type DataTable } from "@cucumber/cucumber";

import {
  NATIVE_JAVA_IMPORT_FIXTURE,
  NATIVE_JAVA_IMPORT_PRIMARY_FILE,
  NATIVE_JAVA_IMPORT_TARGET_DIRECTORY,
} from "../fixtures/native-refactorkit-java-import-fixtures.js";
import type { StoryWorld } from "../support/world.js";

Given<StoryWorld>(
  "one scenario sandbox contains the authorized Maven-like workspace and isolated HOME and XDG state",
  async function () {
    await this.createNativeRefactorKitJavaImportSession().allocateScenarioSandbox();
  },
);

Given<StoryWorld>(
  "the workspace contains the existing package directory {string}",
  async function (packageDirectory: string) {
    await this.nativeRefactorKitJavaImportSession().createWorkspace(packageDirectory);
  },
);

Given<StoryWorld>(
  "a sandbox-owned Linux X11 clipboard owner holds exactly:",
  { timeout: 10_000 },
  async function (source: string) {
    assert.equal(source, NATIVE_JAVA_IMPORT_FIXTURE);
    await this.nativeRefactorKitJavaImportSession().startClipboardOwner(source);
  },
);

Given<StoryWorld>(
  "a sandboxed deterministic daemon advertises all of these RefactorKit capabilities:",
  async function (table: DataTable) {
    const session = this.nativeRefactorKitJavaImportSession();
    session.assertCapabilities(
      table.hashes().map((row) => ({
        declaration: row.declaration ?? "",
        conformantContract: row["conformant contract"] ?? "",
      })),
    );
    await session.createDaemonFixture();
  },
);

Given<StoryWorld>(
  "its absolute executable is selected only through {string} and the guarded production {string} override",
  function (allowName: string, daemonName: string) {
    this.nativeRefactorKitJavaImportSession().assertGuardedDaemonOverride(allowName, daemonName);
  },
);

Given<StoryWorld>(
  "the process environment cannot discover a global RefactorKit command or daemon",
  async function () {
    await this.nativeRefactorKitJavaImportSession().assertNoGlobalDaemonDiscovery();
  },
);

When<StoryWorld>(
  /^a freshly built production release\/no-bundle Tauri executable is launched directly on Linux X11 with the scenario HOME, XDG, workspace, daemon, and clipboard state$/,
  { timeout: 35_000 },
  async function () {
    await this.nativeRefactorKitJavaImportSession().launch();
  },
);

When<StoryWorld>(
  "the developer expands the actual File Explorer to {string}",
  { timeout: 20_000 },
  async function (directory: string) {
    assert.equal(directory, NATIVE_JAVA_IMPORT_TARGET_DIRECTORY);
    await this.nativeRefactorKitJavaImportSession().expandToDirectory(directory);
  },
);

When<StoryWorld>(
  "opens that directory's actual context menu and chooses {string}",
  { timeout: 25_000 },
  async function (label: string) {
    await this.nativeRefactorKitJavaImportSession().openContextMenuAndChoose(label);
  },
);

Then<StoryWorld>(
  "the first actual directory context-menu action produces exactly one corresponding native preview carrying the exact fixture from the sandbox-owned Linux X11 clipboard owner through the production native clipboard command, with no duplicate preview",
  async function () {
    await this.nativeRefactorKitJavaImportSession().assertNativePreviewAfterAction(1);
  },
);

Then<StoryWorld>(
  "the deterministic daemon accepts that exact fixture and selected directory for the first preview",
  async function () {
    await this.nativeRefactorKitJavaImportSession().assertExactPreview(1);
  },
);

Then<StoryWorld>(
  "the actual review dialog binds the first plan to all of this evidence:",
  async function (table: DataTable) {
    await this.nativeRefactorKitJavaImportSession().assertFirstReview(
      table.hashes().map((row) => ({
        evidence: row.evidence ?? "",
        reviewedValue: row["reviewed value"] ?? "",
      })),
    );
  },
);

Then<StoryWorld>("{string} is still absent", async function (relativePath: string) {
  await this.nativeRefactorKitJavaImportSession().assertPathAbsent(relativePath);
});

When<StoryWorld>(
  "the developer chooses {string} in the actual review dialog",
  async function (label: string) {
    await this.nativeRefactorKitJavaImportSession().cancelReview(label);
  },
);

Then<StoryWorld>("exactly one discard is correlated to the first reviewed plan", async function () {
  await this.nativeRefactorKitJavaImportSession().assertFirstDiscard();
});

Then<StoryWorld>(
  "no Apply request or project-content write occurs for that plan",
  async function () {
    await this.nativeRefactorKitJavaImportSession().assertFirstPlanDidNotApply();
  },
);

Then<StoryWorld>("{string} remains absent", async function (relativePath: string) {
  await this.nativeRefactorKitJavaImportSession().assertPathAbsent(relativePath);
});

When<StoryWorld>(
  "the developer repeats the actual directory context-menu action",
  { timeout: 25_000 },
  async function () {
    await this.nativeRefactorKitJavaImportSession().repeatContextMenuAction();
  },
);

Then<StoryWorld>(
  "the repeated actual directory context-menu action produces exactly one corresponding native preview carrying the exact fixture from the sandbox-owned Linux X11 clipboard owner through the production native clipboard command, with no duplicate preview",
  async function () {
    await this.nativeRefactorKitJavaImportSession().assertNativePreviewAfterAction(2);
  },
);

Then<StoryWorld>(
  "the daemon returns a distinct fresh plan for the same exact fixture and selected directory",
  async function () {
    await this.nativeRefactorKitJavaImportSession().assertFreshSecondPlan();
  },
);

Then<StoryWorld>(
  "the actual review dialog requires acknowledgement of the fresh plan's unknown-license and high-risk evidence before Apply is enabled",
  async function () {
    await this.nativeRefactorKitJavaImportSession().assertAcknowledgementGate();
  },
);

Then<StoryWorld>(
  "the production native path applies only the distinct fresh reviewed plan",
  async function () {
    await this.nativeRefactorKitJavaImportSession().assertDistinctFreshReviewedPlanApplied();
  },
);

Then<StoryWorld>(
  "the deterministic daemon receives only that exact planId, with no clipboard source, code, patch, target directory, or target package",
  async function () {
    await this.nativeRefactorKitJavaImportSession().assertExactApplyPlanIdParams();
  },
);

Then<StoryWorld>(
  "after Apply the deterministic fixture daemon records exactly one target creation and reports it as the primary project file, {string}",
  async function (relativePath: string) {
    assert.equal(relativePath, NATIVE_JAVA_IMPORT_PRIMARY_FILE);
    await this.nativeRefactorKitJavaImportSession().assertSingleReportedTargetCreation(
      relativePath,
    );
  },
);

Then<StoryWorld>(
  "the exact workspace tree gains only that one reported primary project file",
  async function () {
    await this.nativeRefactorKitJavaImportSession().assertWorkspaceTreeGainedOnlyReportedTarget();
  },
);

Then<StoryWorld>(
  "the refreshed actual File Explorer shows {string}",
  async function (relativePath: string) {
    await this.nativeRefactorKitJavaImportSession().assertRefreshedFileExplorer(relativePath);
  },
);

Then<StoryWorld>("the selected editor tab is exactly {string}", async function (fileName: string) {
  await this.nativeRefactorKitJavaImportSession().assertSelectedTab(fileName);
});

Then<StoryWorld>("real Monaco shows the exact logical clipboard fixture", async function () {
  await this.nativeRefactorKitJavaImportSession().assertRealMonacoContent();
});

Then<StoryWorld>(
  "the source-free retained daemon transcript proves exact preview, correlated discard, fresh-plan Apply, and the one reported target without containing clipboard source text",
  async function () {
    await this.nativeRefactorKitJavaImportSession().assertSourceFreeTranscript();
  },
);

When<StoryWorld>(
  "the native window is closed and scenario cleanup releases the X11 clipboard owner",
  { timeout: 20_000 },
  async function () {
    await this.nativeRefactorKitJavaImportSession().closeWindowAndReleaseClipboard();
  },
);

Then<StoryWorld>(
  "the application, deterministic daemon, and clipboard-owner processes exit cleanly",
  async function () {
    await this.nativeRefactorKitJavaImportSession().assertProcessesExited();
  },
);

Then<StoryWorld>(
  "the configured HOME, XDG, workspace, daemon, transcript, and clipboard paths and sandbox-marked process artifacts remain confined to the scenario sandbox",
  async function () {
    await this.nativeRefactorKitJavaImportSession().assertConfiguredPathAndProcessConfinement();
    await this.attachNativeRefactorKitJavaImportEvidence();
  },
);

Then<StoryWorld>("the workspace contains no {string}", async function (relativePath: string) {
  await this.nativeRefactorKitJavaImportSession().assertNoRefactorKitState(relativePath);
});
