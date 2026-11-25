import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorBackgroundDiskChanges } from "./EditorBackgroundDiskChanges";

describe("background disk notices", () => {
  it("lists background changes and missing files and selects a file only when requested", () => {
    const onSelect = vi.fn();
    render(<EditorBackgroundDiskChanges activeFilePath="Main.java" onSelect={onSelect} issues={[
      { filePath: "Main.java", status: "changed" },
      { filePath: "pkg/Other.java", status: "missing" },
      { filePath: "Third.java", status: "unavailable" },
    ]} />);
    expect(screen.getByRole("status", { name: "Other open files changed on disk" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Main.java" })).toBeNull();
    expect(screen.getByText(/missing on disk/)).toBeTruthy();
    expect(screen.getByText(/disk check unavailable/)).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "pkg/Other.java" }));
    expect(onSelect).toHaveBeenCalledWith("pkg/Other.java");
  });
  it("shows no background warning when only the active file has an issue", () => {
    const { container } = render(<EditorBackgroundDiskChanges activeFilePath="Main.java"
      onSelect={vi.fn()} issues={[{ filePath: "Main.java", status: "changed" }]} />);
    expect(container.textContent).toBe("");
  });
});
