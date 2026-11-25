import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorDiskComparisonDialog } from "./EditorDiskComparisonDialog";

const comparison = {
  filePath: "Main.java",
  bufferContent: "local edits <script>unsafe()</script>",
  diskSnapshot: {
    filePath: "Main.java",
    content: "external edits",
    language: "java",
    revision: "b".repeat(64),
    changedSinceRead: true,
  },
};

describe("EditorDiskComparisonDialog", () => {
  it("presents both versions read-only and requires an explicit discard choice", () => {
    const onCancel = vi.fn();
    const onUseDiskVersion = vi.fn();
    render(
      <EditorDiskComparisonDialog
        comparison={comparison}
        busy={false}
        onCancel={onCancel}
        onUseDiskVersion={onUseDiskVersion}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Compare with disk" });
    expect(
      within(dialog).getByRole("region", { name: "Current editor buffer" }).textContent,
    ).toContain(comparison.bufferContent);
    expect(
      within(dialog).getByRole("region", { name: "Inspected disk version" }).textContent,
    ).toContain("external edits");
    expect(dialog.querySelector("script")).toBeNull();
    expect(onUseDiskVersion).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Discard buffer edits and use disk version" }),
    );
    expect(onUseDiskVersion).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Keep editor buffer" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("keeps keyboard focus in the dialog, supports Escape and restores focus", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const onCancel = vi.fn();
    const view = render(
      <EditorDiskComparisonDialog
        comparison={comparison}
        busy={false}
        onCancel={onCancel}
        onUseDiskVersion={vi.fn()}
      />,
    );
    const keep = screen.getByRole("button", { name: "Keep editor buffer" });
    const discard = screen.getByRole("button", {
      name: "Discard buffer edits and use disk version",
    });
    expect(document.activeElement).toBe(keep);
    discard.focus();
    fireEvent.keyDown(discard, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("region", { name: "Current editor buffer" }).querySelector("pre"),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("disables repeated discard while an operation is pending", () => {
    render(
      <EditorDiskComparisonDialog
        comparison={comparison}
        busy
        onCancel={vi.fn()}
        onUseDiskVersion={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Discard buffer edits and use disk version" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Keep editor buffer" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});
