import { Given, Then, When, type DataTable } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

function session(world: StoryWorld) {
  return world.xcom2ProjectFoundrySession();
}

Given<StoryWorld>(
  "the production desktop App, its {string} controller, and its production preview and Apply use cases use a separate deterministic Tauri-harness composition",
  { timeout: 25_000 },
  async function (controllerName: string) {
    if (controllerName !== "New XCOM 2 Project") {
      throw new Error(`Unexpected controller ${controllerName}`);
    }
    await this.createXcom2ProjectFoundrySession();
    session(this).configureApplyScenario();
    session(this).assertProductionComposition();
  },
);

Given<StoryWorld>(
  "the deterministic backend maps {string} to a scenario-owned temporary destination parent",
  function (path: string) {
    session(this).assertDestinationMapping(path);
  },
);

Given<StoryWorld>(
  "complementary focused production Rust filesystem integration evidence is the separate authority for the real independent renderer, revalidation, stage and journal transaction, fsync durability, and Linux no-replace atomic commit",
  function () {
    session(this).acknowledgeSeparateRustAuthority();
  },
);

Given<StoryWorld>(
  "the source repository resolves exact commit {string} and exact tree {string} from committed local objects only",
  async function (commit: string, tree: string) {
    await session(this).createPinnedObjectDatabase(commit, tree);
  },
);

Given<StoryWorld>(
  "the temporary destination parent's exact topology, modes, and bytes are recorded",
  async function () {
    await session(this).createDestinationParentAndRecord();
  },
);

When<StoryWorld>(
  "the person opens {string}, accepts the supplied selections, and enters exact ModId {string}",
  async function (dialogName: string, modId: string) {
    await session(this).openWithSelectionsAndModId(dialogName, modId);
  },
);

Then<StoryWorld>(
  "the form exposes these exact accessible fields, values, and plain-language descriptions:",
  async function (dataTable: DataTable) {
    await session(this).assertAccessibleFields(dataTable.hashes());
  },
);

Then<StoryWorld>(
  "one still-live complete preview is shown for exact plan digest {string}",
  async function (planDigest: string) {
    await session(this).assertLivePreview(planDigest);
  },
);

Then<StoryWorld>(
  "it binds exact ModId {string}, project GUID {string}, all supplied grants, the exact source commit and tree, and the absent final project location",
  async function (modId: string, projectGuid: string) {
    await session(this).assertApplyPreviewBindings(modId, projectGuid);
  },
);

Then<StoryWorld>(
  "it shows exactly these {int} destination directories relative to the final project location, with no symlink:",
  async function (count: number, dataTable: DataTable) {
    await session(this).assertApplyDirectories(count, dataTable.hashes());
  },
);

Then<StoryWorld>(
  "it shows exactly these {int} destination files relative to the final project location:",
  async function (count: number, dataTable: DataTable) {
    await session(this).assertApplyFiles(count, dataTable.hashes());
  },
);

Then<StoryWorld>(
  "changing the EMPT repository, Destination parent, or ModId immediately invalidates the preview and disables exact-plan approval until a new preview succeeds",
  async function () {
    await session(this).assertPreviewInvalidation();
  },
);

Then<StoryWorld>(
  "exactly one accessible {string} control approves only this displayed exact plan",
  async function (name: string) {
    await session(this).assertSingleApplyControl(name);
  },
);

Then<StoryWorld>(
  "the controller enters its applying state and announces accessible status {string}",
  async function (status: string) {
    await session(this).assertApplyingStatus(status);
  },
);

Then<StoryWorld>(
  "{string} is disabled before the Apply call starts and remains disabled for this preview",
  async function (name: string) {
    await session(this).assertApplyControlDisabled(name);
  },
);

Then<StoryWorld>(
  "the deterministic backend receives exactly one Apply call with only this request schema:",
  function (dataTable: DataTable) {
    session(this).assertExactApplyRequest(dataTable.hashes());
  },
);

Then<StoryWorld>(
  "the request contains no source-object claim, destination-state claim, output manifest, rendered byte, receipt, or success assertion",
  function () {
    session(this).assertApplyRequestHasNoClaims();
  },
);

Then<StoryWorld>(
  "the approvedPlanDigest is treated as a full lowercase SHA-{int} approval, not as authoritative output or proof of success",
  function (bits: number) {
    session(this).assertApprovalDigest(bits);
  },
);

Then<StoryWorld>(
  "a repeated activation cannot enqueue or invoke a second Apply call",
  async function () {
    await session(this).assertRepeatedActivationIsOneShot();
  },
);

When<StoryWorld>("the deterministic backend completes the pending Apply call", async function () {
  await session(this).completePendingApply();
});

Then<StoryWorld>(
  "the temporary final project location contains exactly the previewed {int} directories and {int} regular files with their exact modes, byte sizes, and SHA-{int} hashes",
  async function (directoryCount: number, fileCount: number, hashBits: number) {
    await session(this).assertCreatedOutput(directoryCount, fileCount, hashBits);
  },
);

Then<StoryWorld>(
  "the destination parent differs from its recording only by the new {string} root",
  async function (rootName: string) {
    await session(this).assertDestinationHasOnlyCreatedRoot(rootName);
  },
);

Then<StoryWorld>(
  "no Foundry stage, journal, receipt file, other sibling, symlink, Git repository, or {string} configuration exists",
  async function (configurationName: string) {
    await session(this).assertNoCreatedResidue(configurationName);
  },
);

Then<StoryWorld>(
  "the dialog announces {string} and shows this exact immutable in-memory receipt:",
  async function (announcement: string, dataTable: DataTable) {
    await session(this).assertCreatedReceipt(announcement, dataTable.hashes());
  },
);

Then<StoryWorld>(
  "creation does not auto-open the project, switch or alter the workspace, initialize Git, write IDE configuration, or retain any grant or later Apply authority",
  async function () {
    await session(this).assertCreationIsolation();
  },
);

Then<StoryWorld>(
  "creation performs no build, deployment, cooking, launch, SDK or game access or validation, package, bundle, installer, release, publication, or distribution",
  function () {
    session(this).assertNoCreationExecutionOrDistribution();
  },
);

Then<StoryWorld>(
  "it provides no native chooser, native GUI or E2E, extracted-module, licensing-clearance, Windows implementation, support, or parity claim",
  function () {
    session(this).assertEvidenceLimits();
  },
);

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
  'an accessible modal dialog named "New XCOM 2 Project" is visible',
  async function () {
    await session(this).assertModal("New XCOM 2 Project");
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
  { timeout: 20_000 },
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
  async function () {
    await session(this).assertPinnedObjectRead();
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
  /^"\/scenario\/foundry-output\/FoundryPreviewFixture" remains absent$/u,
  async function () {
    await session(this).assertDerivedDestinationAbsent(
      "/scenario/foundry-output/FoundryPreviewFixture",
    );
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
