import { describe, expect, it } from "vitest";
import { recoveryHarness } from "../../../../tests/unit/fixtures/java-editor-recovery";

describe("Java durable recovery review and restoration", () => {
  it("reopens original clean companions after restart and restores the original draft only after explicit approval", async () => {
    const h = await recoveryHarness(),
      review = await h.review();
    expect("alreadyRestored" in review).toBe(false);
    if ("alreadyRestored" in review) return;
    expect(h.store.getState().contents["B.java"]).toBe(h.saved);
    expect(h.files.get("B.java")).toBe(h.saved);
    expect(h.invoke.mock.calls[0][0]).toMatchObject({
      projectContext: { contextHash: h.entry.contextHash, snapshotHash: h.entry.baseSnapshotHash },
      documents: [{ path: "B.java" }, { path: "Companion.java" }],
    });
    expect(review.changes[0]).toMatchObject({
      before: h.saved,
      after: h.original,
      path: "A.java",
      isDirty: true,
    });
    expect((await h.restore(review)).transaction.status).toBe("undone");
    expect(h.store.getState().contents["A.java"]).toBe(h.original);
    expect(h.store.getState().tabs.find((t) => t.filePath === "Companion.java")?.isDirty).toBe(
      false,
    );
    expect(h.files.get("A.java")).toBe(h.saved);
    expect(h.editorPort.saveContent).not.toHaveBeenCalled();
    await expect(h.restore(review)).rejects.toThrow("Review");
  });

  it("reviews partial file application without moving the retained tab until explicit restoration", async () => {
    const h = await recoveryHarness();
    h.files.set("A.java", h.saved);
    h.files.delete("B.java");
    await h.editor.openFile("A.java");
    h.editor.updateContent("A.java", h.original);
    h.files.set("B.java", h.saved);
    h.files.delete("A.java");
    const review = await h.review();
    if ("alreadyRestored" in review) throw Error("unexpected terminal");
    expect(review.alignments).toMatchObject([{ oldPath: "A.java", path: "B.java" }]);
    expect(h.store.getState().contents["A.java"]).toBe(h.original);
    expect(h.editorPort.adoptRenamedFile).not.toHaveBeenCalled();
    await h.restore(review);
    expect(h.store.getState().contents["A.java"]).toBe(h.original);
    expect(h.files.get("A.java")).toBe(h.saved);
    expect(h.editorPort.adoptRenamedFile).toHaveBeenCalledTimes(2);
    expect(h.editorPort.saveContent).not.toHaveBeenCalled();
  });

  it("refuses ambiguous saved paths before calling recovery or replacing any existing draft", async () => {
    const h = await recoveryHarness();
    h.files.set("A.java", h.saved);
    await expect(h.review()).rejects.toThrow("ambiguous");
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.store.getState().tabs).toHaveLength(0);
  });

  it("retains unknown existing content when the provider refuses its image", async () => {
    const h = await recoveryHarness();
    await h.editor.openFile("B.java");
    h.editor.updateContent("B.java", "independent draft");
    await expect(h.review()).rejects.toThrow("unknown state");
    expect(h.store.getState().contents["B.java"]).toBe("independent draft");
    expect(h.invoke.mock.calls.map(([q]) => q.phase)).toEqual(["recover"]);
  });

  it("revokes approval after editing and restoring the reviewed text", async () => {
    const h = await recoveryHarness(),
      review = await h.review();
    if ("alreadyRestored" in review) throw Error("unexpected terminal");
    h.editor.updateContent("B.java", "changed");
    h.editor.updateContent("B.java", h.saved);
    await expect(h.restore(review)).rejects.toThrow("changed after");
    expect(h.invoke).toHaveBeenCalledOnce();
    expect(h.files.has("B.java")).toBe(true);
  });

  it("rejects a different inverse on revalidation before moving files or committing buffers", async () => {
    const h = await recoveryHarness(),
      review = await h.review();
    if ("alreadyRestored" in review) throw Error("unexpected terminal");
    const originalInvoke = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (q) => {
      const r = await originalInvoke(q);
      if (q.phase === "recover" && r.kind === "transaction") {
        const edit = r.transaction.workspaceEdit?.documentChanges[0];
        if (edit?.kind === "edit") edit.edits[0].newText = "unreviewed";
      }
      return r;
    });
    await expect(h.restore(review)).rejects.toThrow("proposal changed");
    expect(h.files.has("B.java")).toBe(true);
    expect(h.store.getState().contents["B.java"]).toBe(h.saved);
  });

  it("keeps restored drafts when confirmation is lost and reports the unconfirmed outcome", async () => {
    const h = await recoveryHarness(),
      review = await h.review();
    if ("alreadyRestored" in review) throw Error("unexpected terminal");
    const originalInvoke = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (q) => {
      if (q.phase === "undo.confirm") throw Error("lost confirmation");
      return originalInvoke(q);
    });
    await expect(h.restore(review)).rejects.toMatchObject({
      buffersCommitted: true,
      phase: "undo.confirm",
      transaction: { transactionId: h.entry.transactionId },
    });
    expect(h.store.getState().contents["A.java"]).toBe(h.original);
    expect(h.files.get("A.java")).toBe(h.saved);
    expect(h.editorPort.saveContent).not.toHaveBeenCalled();
  });
});
