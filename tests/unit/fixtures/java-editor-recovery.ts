import { createHash } from "node:crypto";
import { expect, vi } from "vitest";
import type {
  JavaEditorTransaction,
  JavaEditorTransactionRequest,
  JavaEditorTransactionResult,
  JavaEditorWorkspaceEdit,
} from "../../../packages/contracts/src";
import type { EditorPort } from "../../../packages/web-core/src/ports/editor-port";
import { createEditorStore } from "../../../packages/web-core/src/state/editor-store";
import { EditorViewModel } from "../../../packages/web-core/src/view-models/editor-view-model";
import {
  reviewJavaEditorRecovery,
  restoreJavaEditorRecovery,
  type JavaEditorRecoveryReview,
} from "../../../packages/web-core/src/services/java-editor-recovery";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export async function recoveryHarness() {
  const saved = "class A {}",
    original = "class A {}\n// original draft",
    transformed = "class B {}\n// original draft";
  const files = new Map([
    ["B.java", saved],
    ["Companion.java", "class Companion {}"],
  ]);
  const store = createEditorStore();
  const baselines = new Map<string, string>();
  const editorPort: EditorPort = {
    loadContent: vi.fn(async (filePath) => {
      const content = files.get(filePath);
      if (content === undefined) throw Error("missing");
      baselines.set(filePath, sha(content));
      return { filePath, content, language: "java" };
    }),
    inspectSourceRevision: vi.fn<NonNullable<EditorPort["inspectSourceRevision"]>>(
      async (_, filePath, revision) => ({
        filePath,
        status: !files.has(filePath)
          ? "missing"
          : sha(files.get(filePath)!) === revision
            ? "unchanged"
            : "changed",
      }),
    ),
    saveContent: vi.fn(async () => []),
    closeFile: vi.fn(() => []),
    getOpenFiles: vi.fn(async () => []),
    adoptRenamedFile: vi.fn(async (oldPath, path, revision) => {
      if (baselines.get(oldPath) !== revision || sha(files.get(path) ?? "missing") !== revision)
        throw Error("changed baseline");
      baselines.delete(oldPath);
      baselines.set(path, revision);
    }),
  };
  const editor = new EditorViewModel(store.getState, editorPort);
  const entry: JavaEditorTransaction = {
    transactionId: "12345678-1234-1234-1234-123456789abc",
    planId: "reviewed",
    approvedPlanHash: "d".repeat(64),
    baseSnapshotHash: "a".repeat(64),
    contextHash: "b".repeat(64),
    sdkHome: "/jdk",
    durableRecoveryAvailable: true,
    status: "applied",
    documents: [
      { originalPath: "A.java", finalPath: "B.java", originalSavedContentSha256: sha(saved) },
      {
        originalPath: "Companion.java",
        finalPath: "Companion.java",
        originalSavedContentSha256: sha(files.get("Companion.java")!),
      },
    ],
  };
  const projectContext = {
    projectPath: "",
    sdkHome: "/jdk",
    mavenRepository: "",
    activeMavenProfiles: [],
    inactiveMavenProfiles: [],
    snapshotHash: "e".repeat(64),
    contextHash: "f".repeat(64),
    platformIdentities: ["c".repeat(64)],
  };
  let proposal: JavaEditorWorkspaceEdit = { documentChanges: [] };
  const invoke = vi.fn(
    async (q: JavaEditorTransactionRequest): Promise<JavaEditorTransactionResult> => {
      if (q.phase === "recover") {
        const current = q.documents.find((d) => d.path === "B.java");
        if (
          !current ||
          ![saved, original, transformed].includes(current.text) ||
          files.get("B.java") !== saved
        )
          return {
            kind: "transaction",
            transaction: { ...entry, status: "recovery-required", refusalCode: "unknown state" },
          };
        proposal = {
          documentChanges: [
            ...(current.text === original
              ? []
              : [
                  {
                    kind: "edit" as const,
                    path: "B.java",
                    version: current.version,
                    edits: [
                      {
                        range: {
                          start: { line: 0, character: 0 },
                          end: {
                            line: current.text.split("\n").length - 1,
                            character: current.text.split("\n").at(-1)!.length,
                          },
                        },
                        newText: original,
                      },
                    ],
                  },
                ]),
            { kind: "rename", oldPath: "B.java", path: "A.java" },
          ],
        };
        return {
          kind: "transaction",
          transaction: { ...entry, status: "undo-prepared", workspaceEdit: proposal },
        };
      }
      if (q.phase === "apply-files") {
        expect(files.has("A.java")).toBe(false);
        files.set("A.java", files.get("B.java")!);
        files.delete("B.java");
        return {
          kind: "files-applied",
          transactionId: entry.transactionId,
          diskSources: [{ oldPath: "B.java", path: "A.java", revision: sha(saved) }],
        };
      }
      return { kind: "transaction", transaction: { ...entry, status: "undone" } };
    },
  );
  const assertCurrent = vi.fn();
  const review = () =>
    reviewJavaEditorRecovery({
      transaction: entry,
      projectContext,
      workspaceId: "workspace",
      generation: 1,
      editor,
      port: { editorTransaction: invoke },
      assertCurrent,
    });
  const restore = (review: JavaEditorRecoveryReview) =>
    restoreJavaEditorRecovery({
      review,
      editor,
      port: { editorTransaction: invoke },
      assertCurrent,
    });
  return {
    files,
    store,
    editor,
    editorPort,
    entry,
    projectContext,
    saved,
    original,
    transformed,
    invoke,
    assertCurrent,
    review,
    restore,
  };
}
