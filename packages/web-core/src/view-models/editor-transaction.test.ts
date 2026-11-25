import { describe, expect, it, vi } from "vitest";
import type { JavaEditorWorkspaceEdit } from "@ide/contracts";
import type { EditorPort } from "../ports/editor-port";
import { createEditorStore } from "../state/editor-store";
import { EditorViewModel } from "./editor-view-model";
import { stageEditorTransaction } from "./editor-transaction";

const replacement = (
  path: string,
  version: number,
  newText: string,
  end = 1,
): JavaEditorWorkspaceEdit => ({
  documentChanges: [
    {
      kind: "edit",
      path,
      version,
      edits: [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: end } }, newText },
      ],
    },
  ],
});
async function harness() {
  const store = createEditorStore();
  const port: EditorPort = {
    loadContent: vi.fn(async (filePath) => ({ filePath, content: "A", language: "java" as const })),
    saveContent: vi.fn(async () => []),
    closeFile: vi.fn(() => []),
    getOpenFiles: vi.fn(async () => []),
    adoptRenamedFile: vi.fn(async () => {}),
  };
  const editor = new EditorViewModel(store.getState, port);
  await editor.openFile("A.java");
  await editor.openFile("Companion.java");
  editor.updateContent("A.java", "D");
  return { store, port, editor };
}

describe("editor-owned refactoring buffer transactions", () => {
  it("restores a clean companion only when the inverse exactly matches its original text", () => {
    const documents = [{ path: "Companion.java", text: "B", version: 2, isDirty: true }];
    const originals = [{ path: "Companion.java", text: "A", isDirty: false }];
    expect(
      stageEditorTransaction(documents, replacement("Companion.java", 2, "A"), originals).changes[0]
        .isDirty,
    ).toBe(false);
    expect(
      stageEditorTransaction(documents, replacement("Companion.java", 2, "Unknown"), originals)
        .changes[0].isDirty,
    ).toBe(true);
  });

  it("publishes all edited texts, renamed tabs and lifetimes in one update without saving", async () => {
    const h = await harness(),
      lifetime = h.editor.bufferLifetime("A.java");
    const transaction = h.editor.beginEditorTransaction();
    const proposal = transaction.stage({
      documentChanges: [
        ...replacement("A.java", 3, "B").documentChanges,
        { kind: "rename", oldPath: "A.java", path: "B.java" },
        ...replacement("Companion.java", 2, "B").documentChanges,
      ],
    });
    expect(h.store.getState().contents["A.java"]).toBe("D");
    const observed: unknown[] = [];
    const unsubscribe = h.store.subscribe((state) =>
      observed.push({ contents: state.contents, active: state.activeFilePath, tabs: state.tabs }),
    );
    transaction.commit(proposal);
    unsubscribe();
    expect(observed).toHaveLength(1);
    expect(h.store.getState().contents).toEqual({ "B.java": "B", "Companion.java": "B" });
    expect(h.store.getState().tabs.every((t) => t.isDirty)).toBe(true);
    expect(h.editor.bufferLifetime("B.java")).not.toBe(lifetime);
    expect(h.editor.bufferLifetime("A.java")).toBeUndefined();
    expect(() => transaction.commit(proposal)).toThrow();
    await transaction.adoptSavedRenames([
      { oldPath: "A.java", path: "B.java", revision: "a".repeat(64) },
    ]);
    expect(h.port.adoptRenamedFile).toHaveBeenCalledOnce();
    expect(h.port.saveContent).not.toHaveBeenCalled();
    transaction.release();
    expect(h.editor.captureEditorBuffers().documents).toMatchObject([
      { path: "B.java", version: 1 },
      { path: "Companion.java", version: 3 },
    ]);
  });

  it("opens an LSP CreateFile proposal as a dirty editor draft without writing it", async () => {
    const h = await harness();
    const transaction = h.editor.beginEditorTransaction();
    const proposal = transaction.stage({
      documentChanges: [
        ...replacement("A.java", 3, "class A extends Base {}", "A".length).documentChanges,
        { kind: "create", path: "Base.java", text: "class Base {}" },
      ],
    });
    expect(proposal.changes).toContainEqual({
      oldPath: "Base.java",
      path: "Base.java",
      before: "",
      after: "class Base {}",
      isDirty: true,
      created: true,
    });
    transaction.commit(proposal);
    transaction.release();

    expect(h.store.getState().contents).toEqual({
      "A.java": "class A extends Base {}",
      "Companion.java": "A",
      "Base.java": "class Base {}",
    });
    expect(h.store.getState().tabs.find((tab) => tab.filePath === "Base.java")).toMatchObject({
      isDirty: true,
      isActive: true,
    });
    expect(
      h.editor.captureEditorBuffers().documents.find((document) => document.path === "Base.java"),
    ).toMatchObject({ isNew: true, version: 1 });
    expect(h.port.saveContent).not.toHaveBeenCalled();

    await h.editor.saveFile("Base.java");
    expect(h.port.saveContent).toHaveBeenCalledExactlyOnceWith("Base.java", "class Base {}");
    expect(
      h.editor.captureEditorBuffers().documents.find((document) => document.path === "Base.java"),
    ).not.toHaveProperty("isNew");
  });

  it("undo restores the original draft and URI while advancing the current edit versions", async () => {
    const h = await harness();
    const apply = h.editor.beginEditorTransaction();
    apply.commit(
      apply.stage({
        documentChanges: [
          ...replacement("A.java", 3, "Transformed").documentChanges,
          { kind: "rename", oldPath: "A.java", path: "B.java" },
        ],
      }),
    );
    apply.release();
    const undo = h.editor.beginEditorTransaction();
    undo.commit(
      undo.stage({
        documentChanges: [
          ...replacement("B.java", 1, "D", 11).documentChanges,
          { kind: "rename", oldPath: "B.java", path: "A.java" },
        ],
      }),
    );
    undo.release();
    expect(h.store.getState().contents["A.java"]).toBe("D");
    expect(h.store.getState().contents["B.java"]).toBeUndefined();
    expect(h.store.getState().tabs.find((t) => t.filePath === "A.java")?.isDirty).toBe(true);
    expect(h.port.saveContent).not.toHaveBeenCalled();
  });

  it("locks Save, edit, open and close while awaiting the provider and freezes the captured proposal", async () => {
    const h = await harness(),
      transaction = h.editor.beginEditorTransaction();
    const staged = transaction.stage(replacement("A.java", 3, "B"));
    expect(Object.isFrozen(transaction.documents[0])).toBe(true);
    expect(Object.isFrozen(staged.changes[0])).toBe(true);
    expect(() => h.editor.updateContent("A.java", "changed")).toThrow();
    await expect(h.editor.saveFile("A.java")).rejects.toThrow();
    await expect(h.editor.openFile("Other.java")).rejects.toThrow();
    await expect(h.editor.closeFile("A.java")).rejects.toThrow();
    expect(h.store.getState().contents["A.java"]).toBe("D");
    expect(h.port.closeFile).not.toHaveBeenCalled();
    transaction.release();
    expect(() => transaction.commit(staged)).toThrow("retired");
    expect(h.store.getState().contents["A.java"]).toBe("D");
  });

  it("rejects unissued proposals and changed buffer lifetimes before committing anything", async () => {
    const h = await harness(),
      transaction = h.editor.beginEditorTransaction();
    const proposal = transaction.stage(replacement("A.java", 3, "B"));
    expect(() => transaction.commit({ ...proposal })).toThrow("unrecognized");
    h.store.getState().setContent("A.java", "external store change");
    expect(() => transaction.commit(proposal)).toThrow("changed");
    expect(h.store.getState().contents["Companion.java"]).toBe("A");
    transaction.release();
  });

  it("handles CRLF and UTF-16 positions and rejects surrogate splits, overlaps, stale versions and rename collisions", () => {
    const documents = [
      { path: "A.java", text: "😀\r\nxyz", version: 3, isDirty: true },
      { path: "B.java", text: "B", version: 1, isDirty: false },
    ];
    const edit: JavaEditorWorkspaceEdit = {
      documentChanges: [
        {
          kind: "edit",
          path: "A.java",
          version: 3,
          edits: [
            {
              range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } },
              newText: "Q",
            },
          ],
        },
      ],
    };
    expect(stageEditorTransaction(documents, edit).documents[0].text).toBe("😀\r\nxQz");
    expect(() => stageEditorTransaction(documents, replacement("A.java", 3, "x"))).toThrow(
      "UTF-16",
    );
    expect(() => stageEditorTransaction(documents, replacement("A.java", 2, "x", 2))).toThrow(
      "obsolete",
    );
    const duplicated = structuredClone(edit);
    if (duplicated.documentChanges[0].kind === "edit")
      duplicated.documentChanges[0].edits.push(duplicated.documentChanges[0].edits[0]);
    expect(() => stageEditorTransaction(documents, duplicated)).toThrow("overlapping");
    expect(() =>
      stageEditorTransaction(documents, {
        documentChanges: [{ kind: "rename", oldPath: "A.java", path: "B.java" }],
      }),
    ).toThrow("destination");
    expect(() => stageEditorTransaction(documents, replacement("Missing.java", 1, "x"))).toThrow(
      "Open every",
    );
  });
});
