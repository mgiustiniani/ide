import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceFileSearchResult } from "@ide/contracts";
import { WorkspaceFileQuickOpenDialog } from "./WorkspaceFileQuickOpenDialog";

const result: WorkspaceFileSearchResult = {
  files: [
    { name: "Main.java", path: "src/main/java/example/Main.java" },
    { name: "MainTest.java", path: "src/test/java/example/MainTest.java" },
  ],
  truncated: false,
  partial: false,
};

describe("WorkspaceFileQuickOpenDialog", () => {
  it("searches by file path and opens the keyboard-selected result for its workspace generation", async () => {
    const search = vi.fn(async () => result);
    const onOpenFile = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(
      <WorkspaceFileQuickOpenDialog
        enabled
        onClose={onClose}
        onOpen={vi.fn()}
        onOpenFile={onOpenFile}
        open
        search={search}
        workspaceGeneration={7}
      />,
    );

    const input = screen.getByRole("combobox", { name: "Search workspace files" });
    fireEvent.change(input, { target: { value: "MainTest" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("MainTest", 7));
    await screen.findByRole("option", { name: /MainTest\.java/ });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: /Main\.java/ }).id,
    );

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: /MainTest\.java/ }).id,
    );
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(onOpenFile).toHaveBeenCalledWith("src/test/java/example/MainTest.java", 7),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not render results from a previous workspace generation", async () => {
    let resolveSearch!: (value: WorkspaceFileSearchResult) => void;
    const search = vi.fn(
      () =>
        new Promise<WorkspaceFileSearchResult>((resolve) => {
          resolveSearch = resolve;
        }),
    );
    const { rerender } = render(
      <WorkspaceFileQuickOpenDialog
        enabled
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onOpenFile={vi.fn(async () => undefined)}
        open
        search={search}
        workspaceGeneration={7}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Search workspace files" }), {
      target: { value: "Main" },
    });
    await waitFor(() => expect(search).toHaveBeenCalledOnce());

    rerender(
      <WorkspaceFileQuickOpenDialog
        enabled
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onOpenFile={vi.fn(async () => undefined)}
        open
        search={search}
        workspaceGeneration={8}
      />,
    );
    resolveSearch(result);

    await waitFor(() => expect(screen.queryByRole("option", { name: /Main\.java/ })).toBeNull());
  });

  it("opens from Ctrl/Cmd+P but leaves ordinary text fields alone", () => {
    const onOpen = vi.fn();
    const { unmount } = render(
      <WorkspaceFileQuickOpenDialog
        enabled
        onClose={vi.fn()}
        onOpen={onOpen}
        onOpenFile={vi.fn(async () => undefined)}
        open={false}
        search={vi.fn(async () => result)}
        workspaceGeneration={7}
      />,
    );

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(onOpen).toHaveBeenCalledOnce();
    unmount();

    const textInput = document.createElement("input");
    document.body.append(textInput);
    render(
      <WorkspaceFileQuickOpenDialog
        enabled
        onClose={vi.fn()}
        onOpen={onOpen}
        onOpenFile={vi.fn(async () => undefined)}
        open={false}
        search={vi.fn(async () => result)}
        workspaceGeneration={7}
      />,
    );
    fireEvent.keyDown(textInput, { key: "p", ctrlKey: true });
    expect(onOpen).toHaveBeenCalledOnce();
    textInput.remove();
  });
});
