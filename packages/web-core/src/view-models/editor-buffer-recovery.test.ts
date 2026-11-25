import { describe, expect, it, vi } from "vitest";
import { createEditorStore } from "../state/editor-store";
import { EditorViewModel } from "./editor-view-model";

async function harness() {
  const store = createEditorStore();
  const file = { filePath: "Main.java", name: "Main.java", language: "java", openedAt: 1 };
  const port = {
    loadContent: vi.fn(async () => ({
      filePath: file.filePath,
      content: "current disk",
      language: "java",
    })),
    saveContent: vi.fn(async () => [file]),
    closeFile: vi.fn(async () => []),
    getOpenFiles: vi.fn(async () => [file]),
  };
  const editor = new EditorViewModel(store.getState, port);
  await editor.openFile(file.filePath);
  return { store, port, editor };
}
describe("reviewed recovery buffer replacement", () => {
  it("prepares without changing content and restores only on explicit confirmation as dirty", async () => {
    const h = await harness();
    const replacement = h.editor.prepareBufferReplacement("Main.java", "recovered");
    expect(h.store.getState().contents["Main.java"]).toBe("current disk");
    h.editor.replaceBuffer(replacement);
    expect(h.store.getState().contents["Main.java"]).toBe("recovered");
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
    expect(h.port.saveContent).not.toHaveBeenCalled();
    expect(() => h.editor.replaceBuffer(replacement)).toThrow();
  });
  it("keeps explicit recovery dirty even when its selected text matches the saved source", async () => {
    const h = await harness();
    h.editor.replaceBuffer(h.editor.prepareBufferReplacement("Main.java", "current disk"));
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
    expect(h.port.saveContent).not.toHaveBeenCalled();
  });
  it("refuses changed or invalidated buffers, including edits changed back", async () => {
    for (const mode of ["edit", "workspace", "close"]) {
      const h = await harness();
      const replacement = h.editor.prepareBufferReplacement("Main.java", "recovered");
      if (mode === "edit") {
        h.editor.updateContent("Main.java", "different");
        h.editor.updateContent("Main.java", "current disk");
      } else if (mode === "workspace") h.editor.invalidateWorkspaceOperations();
      else await h.editor.closeFile("Main.java");
      expect(() => h.editor.replaceBuffer(replacement)).toThrow();
      expect(h.port.saveContent).not.toHaveBeenCalled();
    }
  });
  it("rejects unreviewed tokens and preserves unrelated dirty content", async () => {
    const h = await harness();
    expect(() =>
      h.editor.replaceBuffer({ filePath: "Main.java", before: "current disk", after: "injected" }),
    ).toThrow();
    h.store
      .getState()
      .openFile({ filePath: "Other.java", name: "Other.java", language: "java", openedAt: 2 });
    h.editor.updateContent("Other.java", "keep");
    h.editor.replaceBuffer(h.editor.prepareBufferReplacement("Main.java", "recovered"));
    expect(h.store.getState().contents["Other.java"]).toBe("keep");
    expect(h.store.getState().tabs.find((t) => t.filePath === "Other.java")?.isDirty).toBe(true);
  });
});
