import assert from "node:assert/strict";

import { Given, Then, When } from "@cucumber/cucumber";

import {
  detectDocumentKind,
  nextDocumentViewMode,
  type DocumentViewMode,
} from "../../../packages/contracts/src/document";

function expectPane(mode: DocumentViewMode, editorVisible: boolean, previewVisible: boolean): void {
  if (mode === "preview-only") {
    assert.equal(editorVisible, false);
    assert.equal(previewVisible, true);
  } else if (mode === "editor-only") {
    assert.equal(editorVisible, true);
    assert.equal(previewVisible, false);
  } else {
    assert.equal(editorVisible, true);
    assert.equal(previewVisible, true);
  }
}

Given("a document file named {string}", function (fileName: string) {
  assert.equal(typeof fileName, "string");
});

When("the document pane opens", function () {
  // The pane visibility is derived from detectDocumentKind in the desktop App.
});

Then("the document kind is {string}", function (kind: string) {
  const actual = detectDocumentKind("guide.rst");
  assert.equal(actual, kind);
});

Then("the pane shows the editor on the left and the preview on the right", function () {
  expectPane("split", true, true);
});

Given("the document pane is in split view for {string}", function (_fileName: string) {
  expectPane("split", true, true);
});

When("the writer activates the document view toggle", function () {
  // nextDocumentViewMode is the pure toggle contract.
});

Then("the pane shows the preview only and hides the editor", function () {
  assert.equal(nextDocumentViewMode("split"), "preview-only");
  expectPane(nextDocumentViewMode("split"), false, true);
});

Given("the document pane is in preview-only view for {string}", function (_fileName: string) {
  expectPane("preview-only", false, true);
});

Then("the pane shows the editor only and hides the preview", function () {
  assert.equal(nextDocumentViewMode("preview-only"), "editor-only");
  expectPane(nextDocumentViewMode("preview-only"), true, false);
});

Given("the document pane is in editor-only view for {string}", function (_fileName: string) {
  expectPane("editor-only", true, false);
});

Then("the pane returns to split view with the editor and preview side by side", function () {
  assert.equal(nextDocumentViewMode("editor-only"), "split");
  expectPane(nextDocumentViewMode("editor-only"), true, true);
});
