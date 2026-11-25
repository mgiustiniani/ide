import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorRecoveryPanel } from "./EditorRecoveryPanel";
import type { EditorRecoveryController } from "./useEditorRecoveryController";

function controller(): EditorRecoveryController {
  return {
    status: "ready",
    error: null,
    entries: [
      {
        id: "a".repeat(32),
        filePath: "Main.java",
        language: "java",
        kind: "draft",
        capturedAt: 1,
        byteLength: 4,
        currentSession: false,
      },
    ],
    review: null,
    flush: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    prepareReview: vi.fn(async () => undefined),
    cancelReview: vi.fn(),
    restore: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
}
describe("recovery panel", () => {
  it("requires separate review and explicit confirmation before permanent removal", () => {
    const c = controller();
    render(<EditorRecoveryPanel controller={c} activeFilePath={null} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Review Main.java" }));
    expect(c.prepareReview).toHaveBeenCalledWith(c.entries[0]);
    expect(c.restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove checkpoint" }));
    expect(c.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm permanent removal" }));
    expect(c.remove).toHaveBeenCalledWith(c.entries[0]);
  });
  it("keeps checkpoint identity observable when visible history metadata is identical", () => {
    const c = controller();
    c.entries = [
      { ...c.entries[0], kind: "history", currentSession: true },
      { ...c.entries[0], id: "b".repeat(32), kind: "history", currentSession: true },
    ];
    render(<EditorRecoveryPanel controller={c} activeFilePath="Main.java" onClose={vi.fn()} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-checkpoint-id"))).toEqual(
      c.entries.map((entry) => entry.id),
    );
    fireEvent.click(rows[1].querySelector("button")!);
    expect(c.prepareReview).toHaveBeenCalledWith(c.entries[1]);
  });
  it("retains missing-file text for copying and never offers source recreation", () => {
    const c = controller();
    c.review = {
      snapshot: { ...c.entries[0], content: "<script>checkpoint</script>" },
      replacement: null,
    };
    render(<EditorRecoveryPanel controller={c} activeFilePath={null} onClose={vi.fn()} />);
    expect(
      screen.getByRole("dialog", { name: "Review recovered buffer" }).querySelector("script"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Replace reviewed buffer with recovered version" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByText("<script>checkpoint</script>")).toBeDefined();
  });
  it("does not permit deletion of the active session's current dirty checkpoint", () => {
    const c = controller();
    c.entries = [{ ...c.entries[0], currentSession: true }];
    render(<EditorRecoveryPanel controller={c} activeFilePath="Main.java" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Remove checkpoint" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
