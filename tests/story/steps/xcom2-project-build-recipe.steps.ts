import { Given, Then, When, type DataTable } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

function recipe(world: StoryWorld) {
  return world.xcom2ProjectBuildRecipeSession();
}

Given<StoryWorld>(
  "the current authorized workspace has exactly one current active XCOM 2 module",
  { timeout: 25_000 },
  async function () {
    await this.createXcom2ProjectBuildRecipeSession();
    recipe(this).assertExactlyOneActiveModule();
  },
);

Given<StoryWorld>(
  "the module and every file eligible for recipe inspection are regular, non-symlink entries contained by that authorized workspace",
  async function () {
    await recipe(this).assertContainedRegularFixture();
  },
);

Given<StoryWorld>(
  "the module contains the conventional untrusted X2ModBuildCommon entry point at exact module-relative path {string}",
  async function (path: string) {
    await recipe(this).assertConventionalEntryPoint(path);
  },
);

Given<StoryWorld>(
  "the bounded inspection fixture is sanitized, hand-authored, and derived only from MIT X2ModBuildCommon concepts with its required attribution notice",
  async function () {
    await recipe(this).assertSanitizedProvenanceFixture();
  },
);

Given<StoryWorld>(
  "no source file, asset, log, proprietary game byte, proprietary SDK byte, or machine-local proprietary path has been copied into the fixture",
  async function () {
    await recipe(this).assertNoCopiedOrProprietaryMaterial();
  },
);

Given<StoryWorld>(
  "inspection reads only this closed allowlist of conventional metadata categories from contained regular files:",
  function (table: DataTable) {
    recipe(this).assertInspectionAllowlist(table.hashes());
  },
);

Given<StoryWorld>(
  "inspection never follows a symlink or enters a directory whose path contains one of these excluded segments:",
  function (table: DataTable) {
    recipe(this).assertExcludedSegments(table.hashes());
  },
);

Given<StoryWorld>(
  "inspection neither extends the activation-only {string} schema nor requires or creates a build manifest",
  async function (path: string) {
    await recipe(this).assertActivationSchemaAndNoManifest(path);
  },
);

Given<StoryWorld>(
  "the browser reports project build recipe review unavailable without simulating inspection, approval, or success",
  async function () {
    await recipe(this).assertBrowserUnavailable();
  },
);

When<StoryWorld>(
  "the person opens the active module's accessible {string} review with the keyboard",
  async function (name: string) {
    if (name !== "Default Build recipe") throw new Error(`Unexpected recipe review ${name}`);
    await recipe(this).openDefaultBuildRecipeWithKeyboard();
  },
);

Then<StoryWorld>(
  "the review identifies the action by exact enum value {string}",
  function (action: string) {
    recipe(this).assertAction(action);
  },
);

Then<StoryWorld>(
  "it labels {string} as untrusted project input that will not be executed by this review",
  function (path: string) {
    recipe(this).assertUntrustedScriptLabel(path);
  },
);

Then<StoryWorld>(
  "it presents the script's exact module-relative path, lowercase SHA-256, and byte size as separate review fields",
  function () {
    recipe(this).assertScriptFields();
  },
);

Then<StoryWorld>(
  "it presents X2ModBuildCommon provenance as MIT-licensed with the exact applicable attribution notice available in the review",
  function () {
    recipe(this).assertProvenanceReview();
  },
);

Then<StoryWorld>(
  "it presents each invocation input as a structured role and value state rather than a raw command, shell fragment, or interpolated command line:",
  function (table: DataTable) {
    recipe(this).assertStructuredRoles(table.hashes());
  },
);

Then<StoryWorld>(
  "the recipe keeps Build, Deploy, Cook, and Launch as separate actions and approves none of the latter three",
  function () {
    recipe(this).assertSeparateActions();
  },
);

Then<StoryWorld>(
  "the recipe requires project-local Highlander source together with its matching Workshop runtime dependency rather than a global SDK source overlay",
  function () {
    recipe(this).assertHighlanderDependencies();
  },
);

Then<StoryWorld>(
  "every machine-owned SDK, game, pfx_copy, tool, and runtime prerequisite remains explicitly unresolved",
  function () {
    recipe(this).assertMachinePrerequisitesUnresolved();
  },
);

Then<StoryWorld>(
  "the accessible status states that native execution is unavailable and blocked for this slice",
  function () {
    recipe(this).assertNativeExecutionBlocked();
  },
);

Then<StoryWorld>(
  "unresolved prerequisites remain visible by text and programmatic state without relying on color alone",
  function () {
    recipe(this).assertProgrammaticBlockers();
  },
);

Then<StoryWorld>(
  "the review exposes exactly one keyboard-focusable {string} control and one {string} control",
  function (approve: string, discard: string) {
    recipe(this).assertReviewControls(approve, discard);
  },
);

Then<StoryWorld>(
  "the exact recipe digest binds all of these reviewed facts:",
  function (table: DataTable) {
    recipe(this).assertDigestBindings(table.hashes());
  },
);

Then<StoryWorld>(
  "changing any bound fact requires a different digest and a new review",
  function () {
    recipe(this).assertDigestSensitivity();
  },
);

Then<StoryWorld>(
  "the approval control is disabled before exactly one approval request starts",
  function () {
    recipe(this).assertOneApprovalRequest();
  },
);

Then<StoryWorld>(
  "the request contains only the exact recipe digest and its current bound identities, generations, fingerprints, provenance, action, structured roles, dependency states, and prerequisite states",
  function () {
    recipe(this).assertExactApprovalRequest();
  },
);

Then<StoryWorld>(
  "the request contains no executable path chosen from project data, raw command, shell text, script bytes, proprietary bytes, proprietary path, output claim, or success claim",
  function () {
    recipe(this).assertApprovalRequestExclusions();
  },
);

Then<StoryWorld>(
  "one volatile one-shot approval is retained only for that exact reviewed recipe",
  function () {
    recipe(this).assertVolatileExactApproval();
  },
);

Then<StoryWorld>(
  "it can authorize at most one future {string} Build request and no Deploy, Cook, or Launch request",
  function (action: string) {
    recipe(this).assertApprovalScope(action);
  },
);

Then<StoryWorld>(
  "this slice exposes no consumer that can execute or consume the approval as a build",
  function () {
    recipe(this).assertNoApprovalConsumer();
  },
);

Then<StoryWorld>("the accessible result states {string}", function (result: string) {
  recipe(this).assertAccessibleResult(result);
});

Then<StoryWorld>(
  "it does not state or imply that Build, Deploy, Cook, Launch, installation, or validation succeeded",
  function () {
    recipe(this).assertNoSuccessClaim();
  },
);

When<StoryWorld>(
  "the person attempts to approve the same displayed recipe again",
  async function () {
    await recipe(this).attemptRepeatedApproval();
  },
);

Then<StoryWorld>("no second approval request occurs", function () {
  recipe(this).assertNoSecondApproval();
});

Then<StoryWorld>(
  "no process, network, SDK, game, or prefix access has occurred:",
  function (table: DataTable) {
    recipe(this).assertZeroAccess(table.hashes());
  },
);

Then<StoryWorld>(
  "no workspace, module, script, configuration, manifest, approval receipt, SDK, game, prefix, deployment, cooked output, launch state, or other filesystem write or mutation has occurred",
  async function () {
    await recipe(this).assertFilesystemUnchanged();
  },
);

Then<StoryWorld>("no Build, Deploy, Cook, or Launch action has occurred", function () {
  recipe(this).assertNoActions();
});

When<StoryWorld>(
  "each of these changes is considered before any future use of the approval:",
  function (table: DataTable) {
    recipe(this).assertRevocationCauses(table.hashes());
  },
);

Then<StoryWorld>(
  "the volatile one-shot approval is synchronously revoked before stale work can use it",
  function () {
    recipe(this).assertSynchronousRevocation();
  },
);

Then<StoryWorld>(
  "a revoked approval cannot be restored or reused without a fresh inspection, review, and approval",
  function () {
    recipe(this).assertFreshReviewRequired();
  },
);

Then<StoryWorld>(
  "browser support and native execution remain honestly unavailable rather than returning a fake successful result",
  function () {
    recipe(this).assertUnavailableWithoutFakeSuccess();
  },
);
