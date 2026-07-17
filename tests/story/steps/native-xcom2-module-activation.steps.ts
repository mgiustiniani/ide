import { Given, Then, When, type DataTable } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

function activationSession(world: StoryWorld) {
  return world.nativeXcom2ActivationSession();
}

function column(dataTable: DataTable, name: string): string[] {
  return dataTable.hashes().map((row) => {
    const value = row[name];
    if (value === undefined) throw new Error(`Missing data-table column ${name}`);
    return value;
  });
}

Given<StoryWorld>(
  "one scenario sandbox owns all desktop user state and an actual workspace registry with exactly these authorized workspaces:",
  async function (dataTable: DataTable) {
    const rows = dataTable.hashes().map((row) => ({
      workspace: row.workspace ?? "",
      "initial role": row["initial role"] ?? "",
    }));
    const session = rows.some(
      ({ "initial role": initialRole }) => initialRole === "explicitly configured module",
    )
      ? this.createNativeXcom2ModuleConfigurationActivationSession()
      : this.createNativeXcom2ModuleActivationSession();
    await session.allocateScenario(rows);
  },
);

Given<StoryWorld>(
  "the actual {string} workspace contains only these ordinary regular files:",
  async function (workspace: string, dataTable: DataTable) {
    await activationSession(this).createWorkspaceFixtures(
      workspace,
      column(dataTable, "relative path"),
    );
  },
);

Given<StoryWorld>(
  "the actual {string} workspace contains only this exact regular file:",
  async function (workspace: string, dataTable: DataTable) {
    await this.nativeXcom2ModuleActivationSession().createWorkspaceFixtures(
      workspace,
      column(dataTable, "relative path"),
    );
  },
);

Given<StoryWorld>(
  "the actual {string} workspace contains exactly these regular files:",
  async function (workspace: string, dataTable: DataTable) {
    await this.nativeXcom2ModuleActivationSession().createWorkspaceFixtures(
      workspace,
      column(dataTable, "relative path"),
    );
  },
);

Given<StoryWorld>(
  "every listed path and containing directory has that exact Linux case and no workspace path is a symlink",
  async function () {
    const session = this.nativeXcom2ModuleActivationSession();
    await session.verifyExactCaseNoSymlinks();
    await this.attach(JSON.stringify(session.fixtureManifest()), "application/json");
    session.markFixtureManifestAttached();
  },
);

When<StoryWorld>(
  /^a freshly built production release\/no-bundle Tauri executable is launched directly on Linux X11 for "([^"]+)"$/,
  { timeout: 35_000 },
  async function (workspace: string) {
    await activationSession(this).launch(workspace);
  },
);

When<StoryWorld>("its WebKit DOM viewport is exactly 1440x900", async function () {
  const session = activationSession(this);
  await session.assertViewport();
  await this.attach(JSON.stringify(session.evidence()), "application/json");
});

Then<StoryWorld>(
  "within {int} seconds the generic workspace is ready",
  { timeout: 20_000 },
  async function (seconds: number) {
    if (this.hasNativeXcom2ModuleConfigurationActivationSession()) {
      await this.nativeXcom2ModuleConfigurationActivationSession().waitForWorkspaceReady(
        seconds,
        "plain-notes",
      );
      return;
    }
    await this.nativeXcom2ModuleActivationSession().waitForWorkspaceReady(
      seconds,
      "xcom-reference-notes",
    );
  },
);

Then<StoryWorld>(
  "it has no {string} activity entry or XCOM bottom contribution",
  async function (activityName: string) {
    const session = this.nativeXcom2ModuleActivationSession();
    const phase = session.evidence().readyWorkspaces.at(-1) ?? "workspace";
    await session.assertNoXcomContributions(activityName, phase);
  },
);

When<StoryWorld>(
  "the person uses the real Settings workspace controls to switch to {string}",
  { timeout: 10_000 },
  async function (workspace: string) {
    await activationSession(this).switchWorkspace(workspace);
  },
);

Then<StoryWorld>(
  "within {int} seconds the ambiguous workspace is ready",
  { timeout: 20_000 },
  async function (seconds: number) {
    await this.nativeXcom2ModuleActivationSession().waitForWorkspaceReady(
      seconds,
      "ambiguous-wotc",
    );
  },
);

Then<StoryWorld>(
  "machine setup evidence visible in Settings remains machine-scoped and does not activate the workspace",
  { timeout: 15_000 },
  async function () {
    await this.nativeXcom2ModuleActivationSession().assertMachineSetupRemainsMachineScoped();
  },
);

Then<StoryWorld>(
  "within {int} seconds exactly one accessible activity entry named {string} appears",
  { timeout: 20_000 },
  async function (seconds: number, activityName: string) {
    await activationSession(this).assertExactlyOneActivityWithin(seconds, activityName);
  },
);

Then<StoryWorld>(
  "that activity entry has a keyboard-focusable control with the accessible name {string}",
  async function (activityName: string) {
    await activationSession(this).assertActivityKeyboardFocusable(activityName);
  },
);

When<StoryWorld>(
  "the person opens {string} with the keyboard",
  async function (activityName: string) {
    await activationSession(this).openActivityWithKeyboard(activityName);
  },
);

Then<StoryWorld>("its recognition panel shows exactly:", async function (dataTable: DataTable) {
  await activationSession(this).assertRecognitionFields(
    dataTable.hashes().map((row) => ({ field: row.field ?? "", value: row.value ?? "" })),
  );
});

Then<StoryWorld>("its ordered evidence list is exactly:", async function (dataTable: DataTable) {
  await this.nativeXcom2ModuleActivationSession().assertOrderedEvidence(
    dataTable.hashes().map((row) => ({
      kind: row.kind ?? "",
      "workspace-relative path": row["workspace-relative path"] ?? "",
    })),
  );
});

Then<StoryWorld>("no scan issue is shown", async function () {
  await this.nativeXcom2ModuleActivationSession().assertNoScanIssue();
});

Then<StoryWorld>(
  "the active module contributes no XCOM Build, Problems, Logs, language support, project action, or bottom contribution",
  async function () {
    await this.nativeXcom2ModuleActivationSession().assertRecognitionOnlyExclusions();
  },
);

When<StoryWorld>(
  "the person uses the real Settings workspace controls to switch back to {string}",
  { timeout: 20_000 },
  async function (workspace: string) {
    await activationSession(this).switchBackToGeneric(workspace);
  },
);

Then<StoryWorld>(
  "the {string} activity entry and recognition panel are removed synchronously with the committed workspace change before generic content is presented",
  async function (activityName: string) {
    if (activityName !== "XCOM 2 Project") {
      throw new Error(`Unexpected activity removal assertion: ${activityName}`);
    }
    if (!activationSession(this).evidence().synchronousRemovalObserved) {
      throw new Error("Synchronous XCOM contribution removal was not observed");
    }
  },
);

Then<StoryWorld>("the generic workspace has no XCOM bottom contribution", async function () {
  await activationSession(this).assertNoGenericBottomContribution();
});

Then<StoryWorld>(
  "no late {string} activity entry, recognition panel, or XCOM bottom contribution reappears during the five seconds after the generic workspace is ready",
  { timeout: 10_000 },
  async function (activityName: string) {
    const session = this.nativeXcom2ModuleActivationSession();
    await session.assertNoLateReappearance(activityName);
    await this.attachNativeXcom2ModuleActivationEvidence();
  },
);
