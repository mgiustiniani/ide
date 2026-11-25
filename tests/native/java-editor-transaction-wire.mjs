import fs from "node:fs";
import assert from "node:assert/strict";
import { normalizeRefactorPreview } from "../../packages/tauri-adapters/src/refactorkit-tauri.ts";
import { verifyJavaEditorPreview } from "../../packages/tauri-adapters/src/java-editor-refactoring-tauri.ts";
import {
  javaEditorTransactionWire,
  normalizeJavaEditorTransaction,
} from "../../packages/tauri-adapters/src/java-editor-transaction-tauri.ts";
import { stageEditorTransaction } from "../../packages/web-core/src/view-models/editor-transaction.ts";

const wire = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let result;
if (wire.kind === "preview") {
  result = normalizeRefactorPreview("native-editor-transaction-preview", wire.result);
  await verifyJavaEditorPreview(result, wire.request);
  assert.equal(result.editorPreview.mutationMode, "durable-editor-owned");
  assert.equal(result.applyEligibility.eligible, true);
} else {
  const request = javaEditorTransactionWire(wire.request);
  result = await normalizeJavaEditorTransaction(wire.result, request);
  if (result.kind === "transaction" && result.transaction.workspaceEdit) {
    result = {
      ...result,
      staged: stageEditorTransaction(
        request.documents.map((d) => ({ ...d, isDirty: true })),
        result.transaction.workspaceEdit,
      ),
    };
  }
}
process.stdout.write(JSON.stringify(result));
