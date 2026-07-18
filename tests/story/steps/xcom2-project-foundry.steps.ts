import { Given, Then, When, type DataTable } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

function session(world: StoryWorld) {
  return world.xcom2ProjectFoundrySession();
}

Given<StoryWorld>(
  "the production desktop App, its {string} controller, and its production preview and discard use cases use a separate deterministic Tauri-harness composition",
  { timeout: 25_000 },
  async function (controllerName: string) {
    if (controllerName !== "New XCOM 2 Project")
      throw new Error(`Unexpected controller ${controllerName}`);
    await this.createXcom2ProjectFoundrySession();
    session(this).assertProductionComposition();
  },
);

Given<StoryWorld>(
  "that composition supplies only these non-persistent selector and source-adapter results:",
  function (dataTable: DataTable) {
    session(this).configureSelections(dataTable.hashes());
  },
);

Given<StoryWorld>(
  "the selected source repository's local object database contains exact commit {string} with exact tree {string}",
  async function (commit: string, tree: string) {
    await session(this).createPinnedObjectDatabase(commit, tree);
  },
);

Given<StoryWorld>(
  "its working tree has one modified tracked canary and one untracked canary that disagree with the committed tree",
  async function () {
    await session(this).createDirtyCanaries();
  },
);

Given<StoryWorld>(
  "the source working tree's exact topology, modes, and bytes are recorded before the dialog opens",
  async function () {
    await session(this).recordSourceIdentity();
  },
);

Given<StoryWorld>(
  "the selected destination parent exists with an exact recorded topology, modes, and bytes",
  async function () {
    await session(this).createDestinationParentAndRecord();
  },
);

Given<StoryWorld>("{string} is absent", async function (path: string) {
  await session(this).assertDerivedDestinationAbsent(path);
});

When<StoryWorld>(
  "the person activates the globally available {string} application control without relying on XCOM project recognition",
  async function (name: string) {
    await session(this).activateGlobalControl(name);
  },
);

Then<StoryWorld>(
  "it contains one accessible form named {string} with labeled {string}, {string}, and {string} fields and accessible {string} and {string} controls",
  async function (
    formName: string,
    sourceField: string,
    destinationField: string,
    modIdField: string,
    previewControl: string,
    cancelControl: string,
  ) {
    await session(this).assertAccessibleForm(
      formName,
      [sourceField, destinationField, modIdField],
      [previewControl, cancelControl],
    );
  },
);

When<StoryWorld>(
  "the deterministic selectors answer the form's source and destination requests with the supplied results",
  async function () {
    await session(this).answerSelectors();
  },
);

When<StoryWorld>("the person enters exact ModId {string}", async function (modId: string) {
  await session(this).enterModId(modId);
});

When<StoryWorld>("the person activates {string}", async function (name: string) {
  await session(this).activateDialogControl(name);
});

Then<StoryWorld>(
  "the source adapter resolves only the pinned commit and tree from the selected local Git object database",
  function () {
    session(this).assertPinnedObjectRead();
  },
);

Then<StoryWorld>(
  "the modified tracked canary and untracked canary are ignored and do not affect the plan",
  function () {
    session(this).assertDirtyCanariesIgnored();
  },
);

Then<StoryWorld>(
  "the complete preview shows exactly these bound identities and source facts:",
  async function (dataTable: DataTable) {
    await session(this).assertFacts(dataTable.raw().slice(1));
  },
);

Then<StoryWorld>(
  "the preview shows this complete directory topology relative to the derived destination, with no symlink:",
  async function (dataTable: DataTable) {
    await session(this).assertDirectories(dataTable.raw().slice(1));
  },
);

Then<StoryWorld>(
  "the preview shows exactly these {int} regular files relative to the derived destination:",
  async function (count: number, dataTable: DataTable) {
    await session(this).assertFiles(count, dataTable.raw().slice(1));
  },
);

Then<StoryWorld>(
  "the transformed {string} is UTF-{int} with a leading BOM and LF line endings and has this exact escaped byte preview, where {string} is one tab and {string} is one space:",
  async function (
    path: string,
    utfBits: number,
    tabEscape: string,
    spaceEscape: string,
    preview: string,
  ) {
    if (utfBits !== 8 || tabEscape !== "\\t" || spaceEscape !== "\\u0020") {
      throw new Error("Unexpected transformed-preview encoding declaration");
    }
    await session(this).assertGeneratedPreview(path, "present", preview);
  },
);

Then<StoryWorld>(
  "that transformed project preview contains no recognized template token and no folder or content entry for {string}, {string}, {string}, or {string}",
  async function (first: string, second: string, third: string, fourth: string) {
    await session(this).assertProjectPreviewExcludes([first, second, third, fourth]);
  },
);

Then<StoryWorld>(
  "the generated {string} is UTF-{int} without a BOM and with LF line endings and has this exact escaped byte preview, where {string} is one tab:",
  async function (path: string, utfBits: number, tabEscape: string, preview: string) {
    if (utfBits !== 8 || tabEscape !== "\\t") {
      throw new Error("Unexpected generated-preview encoding declaration");
    }
    await session(this).assertGeneratedPreview(path, "absent", preview);
  },
);

Then<StoryWorld>(
  "the preview declares exactly these absent outputs and capabilities:",
  async function (dataTable: DataTable) {
    await session(this).assertExactList(
      "Project Foundry absent outputs and capabilities",
      dataTable
        .raw()
        .slice(1)
        .map(([value]) => value ?? ""),
    );
  },
);

Then<StoryWorld>(
  "the preview shows exactly these warnings:",
  async function (dataTable: DataTable) {
    await session(this).assertExactList(
      "Project Foundry warnings",
      dataTable
        .raw()
        .slice(1)
        .map(([value]) => value ?? ""),
    );
  },
);

Then<StoryWorld>(
  "every displayed identity, fingerprint, grant, topology path, mode, size, content hash, classification, exact generated preview, absence, warning, option, and canonical-schema version is bound by the displayed plan digest",
  async function () {
    await session(this).assertDigestBinding();
  },
);

Then<StoryWorld>(
  "changing any bound value produces a different plan digest or refuses preview",
  async function () {
    await session(this).assertDigestSensitivity();
  },
);

Then<StoryWorld>(
  "no source, destination-parent, derived-destination, sibling, journal, staging, or IDE project-state write has occurred",
  async function () {
    await session(this).assertNoFilesystemWrites();
  },
);

Then<StoryWorld>(
  "the production path has invoked none of these executable mechanisms:",
  function (dataTable: DataTable) {
    session(this).assertNoExecutableMechanisms(dataTable.hashes());
  },
);

Then<StoryWorld>(
  "the preview plan is discarded and the {string} dialog closes",
  async function (name: string) {
    await session(this).assertDiscardedAndClosed(name);
  },
);

Then<StoryWorld>(
  "the source working tree has exactly its recorded topology, modes, and bytes, including both dirty canaries",
  async function () {
    await session(this).assertSourceIdentity();
  },
);

Then<StoryWorld>(
  "the destination parent has exactly its recorded topology, modes, and bytes",
  async function () {
    await session(this).assertDestinationIdentity();
  },
);

Then<StoryWorld>(
  "no Foundry stage, journal, output, filesystem write, remembered path, retained plan, or project state remains",
  async function () {
    await session(this).assertNoResidue();
  },
);

Then<StoryWorld>(
  "every supplied source, destination-parent, and operation grant is revoked with no authority residue",
  function () {
    session(this).assertGrantsRevoked();
  },
);
