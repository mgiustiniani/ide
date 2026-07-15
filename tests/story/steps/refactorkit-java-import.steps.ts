import assert from "node:assert/strict";

import { Given, Then, When, type DataTable } from "@cucumber/cucumber";

import {
  JAVA_IMPORT_FIXTURE,
  JAVA_IMPORT_PRIMARY_FILE,
  JAVA_IMPORT_TARGET_DIRECTORY,
  toCapabilityExpectations,
  toReviewExpectations,
} from "../support/refactorkit-java-import.js";
import type { StoryWorld } from "../support/world.js";

Given(
  "the authorized Maven-like workspace {string} contains the existing package directory {string}",
  async function (this: StoryWorld, workspaceName: string, packageDirectory: string) {
    assert.equal(packageDirectory, JAVA_IMPORT_TARGET_DIRECTORY);
    await this.createRefactorKitJavaImportSession(workspaceName);
  },
);

Given("{string} does not exist", async function (this: StoryWorld, path: string) {
  if (this.targetProfile.driver === "tauri-webdriver") {
    await this.nativeRefactorKitJavaImportSession().assertPathAbsent(path);
    return;
  }
  assert.equal(path, JAVA_IMPORT_PRIMARY_FILE);
  await this.refactorKitJavaImportSession().primary().assertPathAbsent(path);
});

Given("the clipboard contains exactly:", function (this: StoryWorld, source: string) {
  assert.equal(source, JAVA_IMPORT_FIXTURE);
  this.refactorKitJavaImportSession().primary().setClipboardFixture(source);
});

When(
  "the developer opens the actual File Explorer context menu for {string}",
  async function (this: StoryWorld, path: string) {
    await this.refactorKitJavaImportSession().primary().openContextMenu(path);
  },
);

When("chooses {string}", async function (this: StoryWorld, label: string) {
  await this.refactorKitJavaImportSession().primary().choosePasteAction(label);
});

Then(
  "before clipboard access the deterministic desktop and Tauri composition accepts all of these RefactorKit declarations:",
  function (this: StoryWorld, table: DataTable) {
    this.refactorKitJavaImportSession()
      .primary()
      .assertCapabilities(toCapabilityExpectations(table.hashes()));
  },
);

Then("the clipboard is read exactly once", function (this: StoryWorld) {
  this.refactorKitJavaImportSession().primary().assertClipboardReadExactlyOnce();
});

Then(
  "RefactorKit receives the exact clipboard fixture and selected directory for preview",
  function (this: StoryWorld) {
    this.refactorKitJavaImportSession().primary().assertExactPreviewRequest();
  },
);

Then(
  "the provider-produced review shows all of this evidence:",
  function (this: StoryWorld, table: DataTable) {
    this.refactorKitJavaImportSession()
      .primary()
      .assertReview(toReviewExpectations(table.hashes()));
  },
);

Then("{string} still does not exist", async function (this: StoryWorld, path: string) {
  assert.equal(path, JAVA_IMPORT_PRIMARY_FILE);
  await this.refactorKitJavaImportSession().primary().assertPathAbsent(path);
});

Then(
  "Apply remains disabled until the developer acknowledges the unknown-license and high-risk evidence for this exact plan",
  function (this: StoryWorld) {
    this.refactorKitJavaImportSession().primary().assertApplyRequiresAcknowledgement();
  },
);

When(
  "the developer gives that acknowledgement and chooses {string}",
  async function (this: StoryWorld, label: string) {
    if (this.targetProfile.driver === "tauri-webdriver") {
      await this.nativeRefactorKitJavaImportSession().acknowledgeAndApply(label);
      return;
    }
    await this.refactorKitJavaImportSession().primary().acknowledgeAndApply(label);
  },
);

Then(
  "the Apply request contains only the exact reviewed plan and authority identity fields:",
  function (this: StoryWorld, table: DataTable) {
    this.refactorKitJavaImportSession()
      .primary()
      .assertExactApplyEnvelope(
        table
          .raw()
          .slice(1)
          .map(([field]) => field ?? ""),
      );
  },
);

Then(
  "the Apply request contains no clipboard source, code, patch, target directory, or targetPackage",
  function (this: StoryWorld) {
    this.refactorKitJavaImportSession().primary().assertApplyExcludesSourceAndTargets();
  },
);

When(
  "RefactorKit reports a successful transaction whose only changed and primary file is {string}",
  async function (this: StoryWorld, path: string) {
    await this.refactorKitJavaImportSession().primary().reportSuccessfulTransaction(path);
  },
);

Then(
  "File Explorer refreshes only the backend-reported parent {string}",
  function (this: StoryWorld, path: string) {
    this.refactorKitJavaImportSession().primary().assertBackendParentRefresh(path);
  },
);

Then(
  "only the backend-reported primary file is routed to the desktop editor",
  function (this: StoryWorld) {
    this.refactorKitJavaImportSession().primary().assertPrimaryRoutedToDesktopEditor();
  },
);

Then(
  "the editor composition receives the exact logical clipboard content intended for Monaco",
  function (this: StoryWorld) {
    this.refactorKitJavaImportSession().primary().assertEditorCompositionLogicalContent();
  },
);

Then(
  "the observable composition trace contains no direct IDE filesystem mutation, Pi or AI request, or clipboard-source-bearing log event",
  async function (this: StoryWorld) {
    const harness = this.refactorKitJavaImportSession().primary();
    harness.assertSafeCompositionTrace();
    await this.attach(JSON.stringify(harness.trace()), "application/json");
  },
);

Then(
  "cancellation or a stale workspace, selection, request, or plan generation prevents Apply, clears retained review state, and requests discard cleanup for each correlated retained or late plan",
  async function (this: StoryWorld) {
    await this.refactorKitJavaImportSession().verifyInvalidationVariants();
  },
);

Then(
  "after cleanup failure the bounded observable trace contains no Apply request, imported target, restored review authority, or clipboard source",
  async function (this: StoryWorld) {
    await this.refactorKitJavaImportSession().verifyCleanupFailureIsolation();
  },
);
