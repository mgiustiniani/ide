import { describe, expect, it, vi } from "vitest";
import type {
  JavaEditorTransaction,
  JavaEditorTransactionRequest,
  JavaEditorTransactionResult,
} from "@ide/contracts";
import type { EditorPort } from "../ports/editor-port";
import { createEditorStore } from "../state/editor-store";
import { EditorViewModel } from "../view-models/editor-view-model";
import {
  executeJavaEditorRefactoring,
  JavaEditorTransactionError,
} from "./java-editor-refactoring";

async function harness() {
  const store = createEditorStore();
  const editorPort: EditorPort = {
    loadContent: vi.fn(async (filePath) => ({
      filePath,
      content: "saved",
      language: "java" as const,
    })),
    saveContent: vi.fn(async () => []),
    closeFile: vi.fn(() => []),
    getOpenFiles: vi.fn(async () => []),
    adoptRenamedFile: vi.fn(async () => {}),
  };
  const editor = new EditorViewModel(store.getState, editorPort);
  await editor.openFile("A.java");
  editor.updateContent("A.java", "draft");
  const authority = {
    workspaceId: "workspace",
    generation: 1,
    planId: "reviewed",
    approvedPlanHash: "d".repeat(64),
    projectContext: {
      projectPath: "",
      sdkHome: "/jdk",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
      snapshotHash: "a".repeat(64),
      contextHash: "b".repeat(64),
      platformIdentities: ["c".repeat(64)],
    },
  };
  const transaction: JavaEditorTransaction = {
    transactionId: "12345678-1234-1234-1234-123456789abc",
    planId: authority.planId,
    approvedPlanHash: authority.approvedPlanHash,
    baseSnapshotHash: authority.projectContext.snapshotHash,
    contextHash: authority.projectContext.contextHash,
    platformIdentities: authority.projectContext.platformIdentities,
    durableRecoveryAvailable: true,
    status: "prepared",
  };
  const invoke = vi.fn(
    async (request: JavaEditorTransactionRequest): Promise<JavaEditorTransactionResult> => {
      const inverse = request.phase === "undo.prepare" || request.phase === "recover";
      if (["prepare", "undo.prepare", "recover"].includes(request.phase))
        return {
          kind: "transaction",
          transaction: {
            ...transaction,
            status: inverse ? "undo-prepared" : "prepared",
            workspaceEdit: {
              documentChanges: [
                {
                  kind: "edit",
                  path: inverse ? "B.java" : "A.java",
                  version: request.documents[0].version,
                  edits: [
                    {
                      range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: request.documents[0].text.length },
                      },
                      newText: inverse ? "draft" : "transformed",
                    },
                  ],
                },
                {
                  kind: "rename",
                  oldPath: inverse ? "B.java" : "A.java",
                  path: inverse ? "A.java" : "B.java",
                },
              ],
            },
          },
        };
      if (request.phase === "apply-files")
        return {
          kind: "files-applied",
          transactionId: transaction.transactionId,
          diskSources: [
            {
              oldPath: request.documents[0].path,
              path: request.documents[0].path === "A.java" ? "B.java" : "A.java",
              revision: "e".repeat(64),
            },
          ],
        };
      return {
        kind: "transaction",
        transaction: { ...transaction, status: request.phase === "confirm" ? "applied" : "undone" },
      };
    },
  );
  const run = (
    action: "apply" | "undo" | "recover",
    documentLineage?: { originalPath: string; finalPath: string }[],
  ) =>
    executeJavaEditorRefactoring({
      action,
      authority: {
        ...authority,
        ...(action !== "apply" ? { transactionId: transaction.transactionId } : {}),
      },
      port: { editorTransaction: invoke },
      beginBuffers: () => editor.beginEditorTransaction(),
      assertCurrent: vi.fn(),
      documentLineage,
    });
  return { store, editor, editorPort, authority, transaction, invoke, run };
}

describe("Java editor refactoring orchestration", () => {
  it("undo preserves unrelated Java tabs opened after the original transaction", async () => {
    const h = await harness();
    const lineage = [{ originalPath: "A.java", finalPath: "B.java" }];
    await h.run("apply", lineage);
    await h.editor.openFile("Later.java");
    h.editor.updateContent("Later.java", "independent draft");
    await h.run("undo", lineage);
    expect(h.invoke.mock.calls.slice(3).map(([q]) => q.documents.map((d) => d.path))).toEqual([
      ["B.java"],
      ["B.java"],
      ["A.java"],
    ]);
    expect(h.store.getState().contents).toEqual({
      "A.java": "draft",
      "Later.java": "independent draft",
    });
    expect(h.store.getState().tabs.find((t) => t.filePath === "Later.java")?.isDirty).toBe(true);
    expect(h.editorPort.saveContent).not.toHaveBeenCalled();
  });

  it("rejects provider edits to an unrelated open tab before moving saved files", async () => {
    const h = await harness();
    await h.editor.openFile("Later.java");
    const original = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (q) => {
      const result = await original(q);
      if (q.phase === "prepare" && result.kind === "transaction")
        result.transaction.workspaceEdit!.documentChanges.push({
          kind: "rename",
          oldPath: "Later.java",
          path: "Hijacked.java",
        });
      return result;
    });
    await expect(
      h.run("apply", [{ originalPath: "A.java", finalPath: "B.java" }]),
    ).rejects.toMatchObject({ buffersCommitted: false, phase: "prepare" });
    expect(h.invoke).toHaveBeenCalledOnce();
    expect(h.store.getState().contents).toEqual({ "A.java": "draft", "Later.java": "saved" });
  });
  it("rejects an oversized transformed overlay before moving files or changing buffers", async () => {
    const h = await harness(),
      original = h.invoke.getMockImplementation()!;
    for (let index = 0; index < 9; index++) {
      const path = `Companion${index}.java`;
      await h.editor.openFile(path);
      h.editor.updateContent(path, "x".repeat(900_000));
    }
    h.invoke.mockImplementation(async (q) => {
      const result = await original(q);
      if (q.phase === "prepare" && result.kind === "transaction") {
        const edit = result.transaction.workspaceEdit!.documentChanges[0];
        if (edit.kind === "edit") edit.edits[0].newText = "x".repeat(500_000);
      }
      return result;
    });
    await expect(h.run("apply")).rejects.toMatchObject({
      phase: "prepare",
      buffersCommitted: false,
    });
    expect(h.invoke).toHaveBeenCalledOnce();
    expect(h.store.getState().contents["A.java"]).toBe("draft");
    expect(h.editorPort.adoptRenamedFile).not.toHaveBeenCalled();
  });

  it("applies and undoes through production buffer transactions, acknowledging transformed versions after baseline adoption", async () => {
    const h = await harness();
    expect((await h.run("apply")).transaction.status).toBe("applied");
    expect(h.store.getState().contents["B.java"]).toBe("transformed");
    expect(h.invoke.mock.calls.map(([q]) => q.phase)).toEqual([
      "prepare",
      "apply-files",
      "confirm",
    ]);
    expect(h.invoke.mock.calls[2][0].documents).toEqual([
      { path: "B.java", version: 1, text: "transformed" },
    ]);
    expect(h.editorPort.adoptRenamedFile).toHaveBeenCalledWith("A.java", "B.java", "e".repeat(64));
    expect((await h.run("undo")).transaction.status).toBe("undone");
    expect(h.store.getState().contents["A.java"]).toBe("draft");
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
    expect(h.editorPort.saveContent).not.toHaveBeenCalled();
  });

  it("uses a guarded recovery inverse and refuses unknown state without changing a buffer", async () => {
    const h = await harness();
    await h.run("apply");
    h.invoke.mockResolvedValueOnce({
      kind: "transaction",
      transaction: {
        ...h.transaction,
        status: "recovery-required",
        refusalCode: "unknown editor state",
      },
    });
    await expect(h.run("recover")).rejects.toMatchObject({
      phase: "recover",
      buffersCommitted: false,
      transaction: { status: "recovery-required" },
    });
    expect(h.store.getState().contents["B.java"]).toBe("transformed");
    expect((await h.run("recover")).transaction.status).toBe("undone");
    expect(h.store.getState().contents["A.java"]).toBe("draft");
    expect(h.editorPort.saveContent).not.toHaveBeenCalled();
  });

  it("retains original buffers when file acknowledgement differs from the prepared rename", async () => {
    const h = await harness(),
      original = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (q) =>
      q.phase === "apply-files"
        ? { kind: "files-applied", transactionId: h.transaction.transactionId, diskSources: [] }
        : original(q),
    );
    await expect(h.run("apply")).rejects.toMatchObject({
      buffersCommitted: false,
      phase: "apply-files",
    });
    expect(h.store.getState().contents["A.java"]).toBe("draft");
    expect(h.invoke.mock.calls.map(([q]) => q.phase)).toEqual(["prepare", "apply-files"]);
    h.editor.updateContent("A.java", "still editable");
  });

  it("reports unknown confirmation honestly and keeps transformed drafts for durable recovery", async () => {
    const h = await harness(),
      original = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (q) => {
      if (q.phase === "confirm") throw new Error("lost acknowledgement");
      return original(q);
    });
    let error: unknown;
    try {
      await h.run("apply");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(JavaEditorTransactionError);
    expect(error).toMatchObject({
      buffersCommitted: true,
      phase: "confirm",
      transaction: { transactionId: h.transaction.transactionId },
      changes: [
        { oldPath: "A.java", path: "B.java", before: "draft", after: "transformed", isDirty: true },
      ],
    });
    expect(h.store.getState().contents["B.java"]).toBe("transformed");
    expect(h.editorPort.saveContent).not.toHaveBeenCalled();
  });

  it("rejects a stale workspace after provider preparation before moving files", async () => {
    const h = await harness();
    let calls = 0;
    await expect(
      executeJavaEditorRefactoring({
        action: "apply",
        authority: h.authority,
        port: { editorTransaction: h.invoke },
        beginBuffers: () => h.editor.beginEditorTransaction(),
        assertCurrent: () => {
          if (++calls === 2) throw new Error("workspace changed");
        },
      }),
    ).rejects.toMatchObject({ buffersCommitted: false, phase: "prepare" });
    expect(h.invoke).toHaveBeenCalledOnce();
    expect(h.store.getState().contents["A.java"]).toBe("draft");
  });

  it("never substitutes ordinary source Apply for an unavailable editor provider", async () => {
    const h = await harness();
    await expect(
      executeJavaEditorRefactoring({
        action: "apply",
        authority: h.authority,
        port: {},
        beginBuffers: () => h.editor.beginEditorTransaction(),
        assertCurrent() {},
      }),
    ).rejects.toThrow("unavailable");
    expect(h.store.getState().contents["A.java"]).toBe("draft");
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
