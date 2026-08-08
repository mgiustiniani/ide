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
  "complementary focused production Rust filesystem integration evidence is the separate authority for rerendering through the same shared Rust renderer used by Preview, revalidation, stage and journal transaction, fsync durability, and Linux no-replace atomic commit",
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
  "the shared Rust renderer returns the complete plan body and internal file bytes and mints operation grant {string} only after exact rendering and destination-absence validation succeed",
  async function (operationIdentity: string) {
    await session(this).assertRendererMintedInitialGrant(
      operationIdentity,
      "/scenario/foundry-output/FoundryPreviewFixture",
    );
  },
);

Then<StoryWorld>(
  "TypeScript strictly validates that renderer result and shows one still-live complete preview for exact plan digest {string}",
  async function (planDigest: string) {
    await session(this).assertLivePreview(planDigest);
    await session(this).assertRendererResultValidated();
  },
);

Then<StoryWorld>(
  "one still-live complete preview is shown for exact plan digest {string}",
  async function (planDigest: string) {
    await session(this).assertLivePreview(planDigest);
  },
);

Then<StoryWorld>(
  "it binds exact ModId {string}, project GUID {string}, the supplied source and selected-parent grants, the renderer-minted operation grant, the exact source commit and tree, and the absent final project location",
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
  "Rust reopens the pinned blobs and invokes the same shared renderer used by Preview to obtain the complete plan body and internal bytes afresh before any stage or write",
  function () {
    session(this).assertApplyRerenderedThroughSharedRenderer();
  },
);

Then<StoryWorld>(
  "TypeScript, web core, the submitted request, and the retained preview provide no embedded source byte, manifest, rendered byte, or parallel output authority to Apply",
  function () {
    session(this).assertApplyHasNoFrontendOutputAuthority();
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
  "Preview and Apply are specified to use one shared Rust in-process git2 renderer as their sole output authority",
  function () {
    session(this).acknowledgeCorrectedRendererBoundary();
  },
);

Given<StoryWorld>(
  "the renderer returns the complete rendered plan body and internal bytes for every output file to TypeScript",
  function () {
    session(this).assertRendererOwnsCompleteOutput();
  },
);

Given<StoryWorld>(
  "TypeScript strictly validates the complete closed renderer result, verifies internal-byte consistency, computes the plan digest, deep-freezes the plan, and owns approval and presentation custody without repairing, supplementing, or reinterpreting output",
  function () {
    session(this).assertFrontendCustodyOnly();
  },
);

Given<StoryWorld>(
  "web core embeds no EMPT or other template-derived source byte and no fixture-hardcoded path, size, hash, generated preview, output metadata, or parallel rendering authority",
  function () {
    session(this).assertNoSelectorOutputAuthority();
  },
);

Given<StoryWorld>(
  "that composition supplies only these non-persistent selector results:",
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
  if (this.hasXcom2ProjectBuildRecipeSession()) {
    await this.xcom2ProjectBuildRecipeSession().activateApprove(name);
    return;
  }
  await session(this).activateDialogControl(name);
});

When<StoryWorld>("the person activates {string} again", async function (name: string) {
  await session(this).activateDialogControl(name);
});

Then<StoryWorld>(
  "the shared Rust renderer resolves only the pinned commit, tree, and required blobs from the selected local Git object database",
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
  "only after exact rendering succeeds and {string} is confirmed absent, Rust mints operation grant {string} for only that exact destination and its operation-specific same-parent stage and journal names",
  async function (destination: string, operationIdentity: string) {
    await session(this).assertRendererMintedInitialGrant(operationIdentity, destination);
  },
);

Then<StoryWorld>(
  "TypeScript accepts only the strictly valid renderer result and computes the displayed plan digest as lowercase SHA-256 over the RFC 8785 canonical JSON plan body",
  async function () {
    await session(this).assertRendererResultValidated();
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

When<StoryWorld>(
  "the person changes the exact ModId from {string} to {string}",
  async function (from: string, to: string) {
    await session(this).changeExactModId(from, to);
  },
);

Then<StoryWorld>(
  "before any further asynchronous work the displayed preview, digest, approval state, and Apply authority are cleared",
  async function () {
    await session(this).assertReplacementInvalidatedSynchronously();
  },
);

Then<StoryWorld>(
  "operation grant {string} is synchronously revoked and cannot authorize {string}",
  function (operationIdentity: string, replacementModId: string) {
    session(this).assertInitialOperationRevoked(operationIdentity, replacementModId);
  },
);

Then<StoryWorld>(
  "the source grant and selected-parent grant remain live without granting authority for {string}",
  function (destination: string) {
    session(this).assertSelectionGrantsRemainForReplacement(destination);
  },
);

Then<StoryWorld>(
  "the same shared Rust renderer reopens the pinned blobs and dynamically renders exact ModId {string}",
  async function (modId: string) {
    await session(this).assertReplacementRendererRead(modId);
  },
);

Then<StoryWorld>(
  "only after the exact render succeeds and {string} is confirmed absent, Rust mints replacement operation grant {string}",
  function (destination: string, operationIdentity: string) {
    if (destination !== "/scenario/foundry-output/Mod_1") {
      throw new Error(`Unexpected replacement destination ${destination}`);
    }
    session(this).assertReplacementGrant(operationIdentity);
  },
);

Then<StoryWorld>(
  /^TypeScript strictly validates the returned complete plan body and internal bytes, computes a new lowercase RFC 8785\/SHA-256 plan digest, and deep-freezes the replacement preview$/u,
  async function () {
    await session(this).assertReplacementValidated();
  },
);

Then<StoryWorld>(
  "the replacement preview shows exactly these changed bound identities:",
  async function (dataTable: DataTable) {
    await session(this).assertReplacementFacts(dataTable.hashes());
  },
);

Then<StoryWorld>(
  "the replacement preview shows this complete directory topology relative to {string}, with no symlink:",
  async function (destination: string, dataTable: DataTable) {
    await session(this).assertReplacementDirectories(destination, dataTable.raw().slice(1));
  },
);

Then<StoryWorld>(
  "the replacement preview shows exactly these {int} regular files relative to {string}:",
  async function (count: number, destination: string, dataTable: DataTable) {
    await session(this).assertReplacementFiles(count, destination, dataTable.raw().slice(1));
  },
);

Then<StoryWorld>(
  "the replacement preview declares exactly these absent outputs and capabilities:",
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
  "the replacement preview shows the same six exact warnings as the initial golden preview",
  async function () {
    await session(this).assertReplacementWarnings();
  },
);

Then<StoryWorld>(
  "every ModId-sensitive derived destination, directory path, file path, transformed or generated internal byte sequence, generated preview, and explicit absence contains zero stale {string} value",
  function (stale: string) {
    session(this).assertNoStaleFixtureLiteral(stale);
  },
);

Then<StoryWorld>(
  "every replacement identity, path, mode, size, hash, classification, generated preview, absence, warning, option, and canonical-schema version is bound by the new displayed plan digest",
  async function () {
    await session(this).assertReplacementDigestBinding();
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
  "{string} and {string} remain absent",
  async function (initial: string, replacement: string) {
    if (
      initial !== "/scenario/foundry-output/FoundryPreviewFixture" ||
      replacement !== "/scenario/foundry-output/Mod_1"
    ) {
      throw new Error("Unexpected Project Foundry destination pair");
    }
    await session(this).assertBothDestinationsAbsent();
  },
);

Then<StoryWorld>(
  "no Foundry stage, journal, output, filesystem write, remembered path, retained plan, digest, approval state, Apply authority, or project state remains",
  async function () {
    await session(this).assertNoResidue();
  },
);

Then<StoryWorld>(
  "every supplied source and destination-parent grant and every renderer-minted operation grant is revoked with no authority residue",
  function () {
    session(this).assertGrantsRevoked();
  },
);

Given<StoryWorld>(
  "complementary focused production Rust filesystem tests are the separate authority for consuming the native operation grant, refusing a destination created after Preview but before transaction writes, preserving filesystem state, and refusing exact request reuse",
  function () {
    session(this).configureDestinationConflictScenario();
    session(this).acknowledgeSeparateRustAuthority();
  },
);

Given<StoryWorld>(
  "the selected source repository is {string} under source grant {string}",
  function (repository: string, grantIdentity: string) {
    session(this).configureConflictSource(repository, grantIdentity);
  },
);

Given<StoryWorld>(
  "it resolves exact commit {string} and exact tree {string} from committed local objects only",
  async function (commit: string, tree: string) {
    await session(this).createPinnedObjectDatabase(commit, tree);
  },
);

Given<StoryWorld>(
  "the source working tree's exact topology, modes, bytes, and canary identities are recorded before the dialog opens",
  async function () {
    await session(this).recordSourceIdentity();
  },
);

Given<StoryWorld>(
  "the selected destination parent is {string} under destination-parent grant {string}",
  function (parent: string, grantIdentity: string) {
    session(this).assertConflictDestinationSelection(parent, grantIdentity);
  },
);

Given<StoryWorld>(
  "the temporary destination parent's exact topology, modes, bytes, and entry identities are recorded before the dialog opens",
  async function () {
    await session(this).createDestinationParentAndRecord();
  },
);

When<StoryWorld>(
  "the person opens {string}, accepts the supplied selections, enters exact ModId {string}, and activates {string}",
  async function (dialogName: string, modId: string, controlName: string) {
    await session(this).openConflictPreview(dialogName, modId, controlName);
  },
);

Then<StoryWorld>(
  "the shared Rust renderer supplies the complete fixture plan and mints operation grant {string} only after confirming the final project location is absent",
  async function (operationIdentity: string) {
    await session(this).assertRendererMintedInitialGrant(
      operationIdentity,
      "/scenario/foundry-output/FoundryPreviewFixture",
    );
  },
);

Then<StoryWorld>(
  "TypeScript shows the ready fixture Preview for exact plan digest {string}",
  async function (planDigest: string) {
    await session(this).assertLivePreview(planDigest);
    await session(this).assertRendererResultValidated();
  },
);

Then<StoryWorld>(
  "the Preview binds exact project GUID {string}, the supplied grants, the exact source commit and tree, {int} directories, {int} regular files, and absent final project location {string}",
  async function (
    projectGuid: string,
    directoryCount: number,
    fileCount: number,
    destination: string,
  ) {
    await session(this).assertConflictPreviewBindings(
      projectGuid,
      directoryCount,
      fileCount,
      destination,
    );
  },
);

Then<StoryWorld>(
  "exactly one accessible {string} control can approve that still-live Preview",
  async function (name: string) {
    await session(this).assertSingleApplyControl(name);
  },
);

When<StoryWorld>(
  "the scenario owner externally creates one item at {string} before the person activates {string}",
  async function (path: string, controlName: string) {
    await session(this).createExternalConflict(path, controlName);
  },
);

Then<StoryWorld>(
  "that conflict has exactly these recorded properties:",
  function (dataTable: DataTable) {
    session(this).assertConflictProperties(dataTable.hashes());
  },
);

Then<StoryWorld>(
  "the destination parent's exact topology, modes, bytes, and entry identities are recorded after that external creation",
  async function () {
    await session(this).recordPostConflictDestination();
  },
);

Then<StoryWorld>(
  "the frontend synchronously consumes creation authority before it calls Apply",
  async function () {
    await session(this).assertConflictCreationAuthorityConsumed();
  },
);

Then<StoryWorld>(
  "{string} is disabled before the Apply call starts and remains disabled for this Preview",
  async function (name: string) {
    await session(this).assertConflictApplyControlDisabled(name);
  },
);

Then<StoryWorld>(
  "the deterministic backend receives exactly one Apply call with only this production request:",
  function (dataTable: DataTable) {
    session(this).assertExactConflictApplyRequest(dataTable.hashes());
  },
);

Then<StoryWorld>(
  "Rust consumes operation grant {string} before validating the destination",
  function (operationIdentity: string) {
    session(this).assertNativeOperationConsumedBeforeDestinationValidation(operationIdentity);
  },
);

Then<StoryWorld>(
  "Apply returns exactly this production-shaped refusal:",
  function (dataTable: DataTable) {
    session(this).assertExactConflictRefusal(dataTable.hashes());
  },
);

Then<StoryWorld>("repeated Create activation invokes no second Apply call", async function () {
  await session(this).assertRepeatedConflictActivationIsOneShot();
});

Then<StoryWorld>(
  "complementary production Rust evidence repeats the exact native request once and receives reason {string} as `ApplyAuthorityConsumed`",
  async function (reason: string) {
    await session(this).repeatExactNativeRequest(reason);
  },
);

Then<StoryWorld>(
  "the repeated native refusal leaves the already preserved state unchanged and leaves no stage or journal residue",
  async function () {
    await session(this).assertNativeReusePreservedState();
  },
);

Then<StoryWorld>(
  "exactly one atomic accessible alert with `role={string}` appears without a nested alert or color-only meaning",
  async function (role: string) {
    await session(this).assertAtomicConflictAlert(role);
  },
);

Then<StoryWorld>("its title is structurally identified", async function () {
  await session(this).assertConflictTitleIdentified();
});

Then<StoryWorld>(
  "that same alert contains exactly these four fixed fields:",
  async function (dataTable: DataTable) {
    await session(this).assertExactConflictAlertFields(dataTable.hashes());
  },
);

Then<StoryWorld>(
  "the refusal introduces none of these disclosures:",
  async function (dataTable: DataTable) {
    await session(this).assertNoConflictDisclosures(dataTable.hashes());
  },
);

Then<StoryWorld>(
  "only already reviewed controlled Preview facts remain visible, only as non-authoritative context that grants no approval or Apply authority",
  async function () {
    await session(this).assertPreviewIsNonAuthoritativeContext();
  },
);

Then<StoryWorld>(
  "source selection, destination selection, ModId, Preview, and Create are disabled for this terminal session",
  async function () {
    await session(this).assertTerminalConflictControlsDisabled();
  },
);

Then<StoryWorld>(
  "only Cancel is enabled, Escape has the same dismissal semantics, and no retry, overwrite, delete, move, open, reveal, or recovery action is offered",
  async function () {
    await session(this).assertOnlyTerminalCancelEnabled();
  },
);

Then<StoryWorld>(
  "the modal focus trap remains active and Cancel remains keyboard accessible",
  async function () {
    await session(this).assertTerminalFocusTrap();
  },
);

Then<StoryWorld>(
  "the controller discards every source, destination-parent, and operation grant and completes `revokeAll`",
  async function () {
    await session(this).assertConflictGrantsDiscarded();
  },
);

Then<StoryWorld>(
  "the conflict retains exactly its recorded regular-file type, non-symlink status, mode, byte sequence, hash, and filesystem object identity",
  async function () {
    await session(this).assertConflictPreserved();
  },
);

Then<StoryWorld>(
  "the source repository retains exactly its recorded topology, modes, bytes, and canary identities",
  async function () {
    await session(this).assertConflictSourcePreserved();
  },
);

Then<StoryWorld>(
  "the destination parent retains exactly its post-conflict recorded topology, modes, bytes, and entry identities",
  async function () {
    await session(this).assertPostConflictDestinationPreserved();
  },
);

Then<StoryWorld>(
  "compared with the pre-Preview destination-parent recording, the only change is the scenario owner's exact conflict file",
  async function () {
    await session(this).assertOnlyExternalConflictChangedDestination();
  },
);

Then<StoryWorld>(
  "Foundry has performed zero destination, source, sibling, stage, journal, receipt, IDE-state, Git-repository, remembered-project, or other filesystem writes",
  async function () {
    await session(this).assertConflictFilesystemWriteIsolation();
  },
);

Then<StoryWorld>(
  "no Foundry output, private stage, journal, receipt file, {string} state, Git repository, remembered project, retained creation authority, or other residue exists",
  async function (configurationName: string) {
    await session(this).assertNoConflictResidue(configurationName);
  },
);

Then<StoryWorld>(
  "the production path has invoked none of these mechanisms:",
  function (dataTable: DataTable) {
    session(this).assertNoConflictMechanisms(dataTable.hashes());
  },
);

Then<StoryWorld>(
  "the dialog closes and clears every controlled value, Preview, refusal, digest, approval state, and authority",
  async function () {
    await session(this).assertConflictDialogClearedAndClosed();
  },
);

Then<StoryWorld>(
  "the exact conflict, source repository, working-tree canaries, destination-parent baseline entries, and siblings remain unchanged",
  async function () {
    await session(this).assertAllConflictStatePreserved();
  },
);

Then<StoryWorld>(
  "no source, destination-parent, operation, creation, or later Apply grant remains",
  function () {
    session(this).assertNoConflictGrantRemains();
  },
);

Then<StoryWorld>(
  "focus returns to the {string} application control",
  async function (name: string) {
    await session(this).assertGlobalControlFocused(name);
  },
);

Then<StoryWorld>(
  "dismissing the same terminal state with Escape has exactly the same clearing, preservation, grant-cleanup, close, and focus-return semantics",
  { timeout: 30_000 },
  async function () {
    await session(this).assertEscapeConflictDismissalEquivalent();
  },
);

Then<StoryWorld>(
  "this Story establishes no other stale source, grant, parent, digest, ModId, destination-type, stage, journal, commit-race, failure, cleanup-residue, interruption, restart, discovery, recovery, removal, or {string} behavior",
  function (createdRecoveryRequired: string) {
    session(this).assertConflictScopeLimit(createdRecoveryRequired);
  },
);

Then<StoryWorld>(
  "it establishes no in-flight Cancel, native chooser, WebKit E2E, real IPC, packaged application, Windows, publication, licensing, build, deployment, cooking, launch, or auto-open evidence",
  function () {
    session(this).assertConflictEvidenceLimits();
  },
);

Given<StoryWorld>(
  "the deterministic backend maps {string} to a scenario-owned temporary destination parent and can return only production-shaped Apply results",
  function (path: string) {
    session(this).assertDestinationMapping(path);
    session(this).configureVerifiedCleanupScenario();
  },
);

Given<StoryWorld>(
  "complementary focused production Rust filesystem tests are the separate authority for the exact injected write ordering, operation-owned stage and journal lifecycle, cleanup verification, parent durability, final filesystem state, and consumed native request reuse",
  function () {
    session(this).acknowledgeSeparateRustAuthority();
  },
);

Given<StoryWorld>(
  "strict adapter and contract tests are the separate authority that every `failed` and `pre-commit` result has mandatory `cleanupStatus` with the complete value set `verified-complete` and `not-verified`",
  function () {
    session(this).acknowledgeStrictCleanupContract();
  },
);

Given<StoryWorld>(
  "those strict tests reject an omitted, null, additional, malformed, incomplete, contradictory, unknown, or legacy cleanup status instead of defaulting, repairing, inferring, or upgrading it",
  function () {
    session(this).acknowledgeStrictCleanupRejection();
  },
);

Given<StoryWorld>(
  "neither `stage-write-failed` alone nor TypeScript filesystem inspection can manufacture `cleanupStatus: verified-complete`",
  function () {
    session(this).acknowledgeCleanupAttestationBoundary();
  },
);

Then<StoryWorld>(
  "TypeScript shows one still-live complete Preview for exact plan digest {string}",
  async function (planDigest: string) {
    await session(this).assertLivePreview(planDigest);
    await session(this).assertRendererResultValidated();
  },
);

Then<StoryWorld>(
  "the Preview binds exact project GUID {string}, the supplied grants, the exact source commit and tree, {int} directories, {int} ordered regular files, and absent final project location {string}",
  async function (
    projectGuid: string,
    directoryCount: number,
    fileCount: number,
    destination: string,
  ) {
    await session(this).assertVerifiedCleanupPreviewBindings(
      projectGuid,
      directoryCount,
      fileCount,
      destination,
    );
  },
);

Then<StoryWorld>(
  "the request contains no source-object claim, destination-state claim, output manifest, rendered byte, receipt, cleanup assertion, or success assertion",
  function () {
    session(this).assertCleanupRequestHasNoClaims();
  },
);

Then<StoryWorld>(
  "Rust consumes operation grant {string} before starting its operation-owned transaction",
  function (operationIdentity: string) {
    session(this).assertOperationConsumedBeforeTransaction(operationIdentity);
  },
);

Then<StoryWorld>(
  "the test-owned Rust fault injector fails exact `before-file-create` occurrence `{int}` with reason `stage-write-failed`",
  function (occurrence: number) {
    session(this).assertExactSecondFileFault(occurrence);
  },
);

Then<StoryWorld>(
  "the fault injector is evidence scaffolding only and adds no production query route, environment switch, hidden command, alternate use case, or user-triggerable fault control",
  function () {
    session(this).assertFaultInjectorIsEvidenceOnly();
  },
);

Then<StoryWorld>(
  "focused production Rust evidence establishes that immediately before that injection all {int} child directories are complete, fsynced, and verified",
  function (count: number) {
    session(this).assertStagedDirectories(count);
  },
);

Then<StoryWorld>(
  "focused production Rust evidence establishes that the first ordered output {string} is complete, fsynced, and verified with exactly these properties inside the operation-owned stage:",
  function (path: string, dataTable: DataTable) {
    session(this).assertFirstStagedOutput(path, dataTable.hashes());
  },
);

Then<StoryWorld>(
  "focused production Rust evidence establishes that the second ordered output {string} has not been created",
  function (path: string) {
    session(this).assertSecondStagedOutputAbsent(path);
  },
);

Then<StoryWorld>(
  "only focused production Rust evidence establishes that cleanup revalidates the operation-owned `OwnedStage` device, inode, type identities, and exact tracked topology before removing tracked entries deepest-first",
  function () {
    session(this).assertOwnedStageCleanupVerified();
  },
);

Then<StoryWorld>(
  "it revalidates and removes the exact operation-owned journal identity",
  function () {
    session(this).assertOwnedJournalCleanupVerified();
  },
);

Then<StoryWorld>(
  "exact no-follow metadata observations report `NotFound` for the digest-bound stage name, digest-bound journal name, and derived destination",
  function () {
    session(this).assertVerifiedCleanupAbsenceObservations();
  },
);

Then<StoryWorld>(
  "the same revalidated selected parent is successfully fsynced after those sibling removals",
  function () {
    session(this).assertVerifiedCleanupParentSync();
  },
);

Then<StoryWorld>(
  "only after every one of those conjunctive checks succeeds Apply returns exactly this production-shaped failure:",
  function (dataTable: DataTable) {
    session(this).assertExactVerifiedCleanupFailure(dataTable.hashes());
  },
);

Then<StoryWorld>(
  "`cleanupStatus: verified-complete` attests only this exact operation-owned transaction outcome and does not turn failure into success, restore consumed authority, permit retry, or claim cleanup of arbitrary or unverified state",
  function () {
    session(this).assertVerifiedCleanupAttestationScope();
  },
);

Then<StoryWorld>(
  "any unreadable, ambiguous, mismatched, replaced, unexpectedly populated, stale, or otherwise unverified item cannot contribute to that positive attestation and is preserved for separate explicit recovery",
  function () {
    session(this).assertUnverifiedCleanupIsPreserved();
  },
);

Then<StoryWorld>(
  "the repeated native refusal leaves the verified final filesystem state unchanged",
  async function () {
    await session(this).assertVerifiedNativeReusePreservedState();
  },
);

Then<StoryWorld>(
  /^only that strictly validated exact `failed` \/ `pre-commit` \/ `stage-write-failed` \/ `verified-complete` tuple is eligible for this bespoke non-interpolating alert$/u,
  function () {
    session(this).assertVerifiedTupleAlertEligibility();
  },
);

Then<StoryWorld>(
  "`cleanupStatus: not-verified`, `cleanup-failed`, every other strict tuple, and every malformed, incomplete, contradictory, unknown, or legacy result receives no verified-cleanup wording or other safety claim",
  function () {
    session(this).assertNoSafetyClaimForOtherResults();
  },
);

Then<StoryWorld>(
  "the failure introduces none of these disclosures:",
  async function (dataTable: DataTable) {
    await session(this).assertNoVerifiedCleanupDisclosures(dataTable.hashes());
  },
);

Then<StoryWorld>(
  "only Cancel is enabled, Escape has the same dismissal semantics, and no retry, cleanup, delete, overwrite, move, open, reveal, or recovery action is offered",
  async function () {
    await session(this).assertOnlyVerifiedCleanupCancelEnabled();
  },
);

Then<StoryWorld>(
  "focused production Rust evidence establishes that the final project location, exact operation-owned stage, and exact operation-owned journal are absent",
  async function () {
    await session(this).assertVerifiedFinalAbsence();
  },
);

Then<StoryWorld>(
  "the destination parent retains exactly its recorded topology, modes, bytes, and entry identities",
  async function () {
    await session(this).assertVerifiedDestinationPreserved();
  },
);

Then<StoryWorld>(
  "no Foundry output, stage, journal, receipt file, {string} state, Git repository, remembered project, retained creation authority, or other residue exists",
  async function (configurationName: string) {
    await session(this).assertNoVerifiedCleanupResidue(configurationName);
  },
);

Then<StoryWorld>(
  "the dialog closes and clears every controlled value, Preview, failure, digest, approval state, and authority",
  async function () {
    await session(this).assertCleanupDialogClearedAndClosed();
  },
);

Then<StoryWorld>(
  "the exact source repository, working-tree canaries, destination-parent baseline entries, and siblings remain unchanged",
  async function () {
    await session(this).assertAllVerifiedStatePreserved();
  },
);

Then<StoryWorld>(
  "this Story establishes no other `before-file-create` occurrence or directory, file, journal, sync, verification, parent, rename, commit, or post-commit fault point",
  function () {
    session(this).assertVerifiedCleanupScopeLimit();
  },
);

Then<StoryWorld>(
  "it establishes no destination conflict, broad pre-commit failure or cleanup matrix, or cleanup of tampered, mismatched, stale, interrupted, orphaned, or otherwise unverified state",
  function () {
    session(this).assertVerifiedCleanupMatrixLimit();
  },
);

Then<StoryWorld>(
  "it establishes no interruption, restart, discovery, recovery, removal, {string}, or in-flight Cancel behavior",
  function (createdRecoveryRequired: string) {
    session(this).assertVerifiedCleanupRecoveryLimit(createdRecoveryRequired);
  },
);

Then<StoryWorld>(
  "it establishes no native chooser, WebKit E2E, real IPC, packaged application, package, bundle, installer, Windows, build, deployment, cooking, launch, auto-open, extraction, licensing, publication, release, or distribution evidence",
  function () {
    session(this).assertVerifiedCleanupEvidenceLimits();
  },
);
