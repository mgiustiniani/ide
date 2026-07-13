import type { FileNode } from "@ide/contracts";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFileExplorerController } from "./useFileExplorerController";

const folder: FileNode = {
  id: "src",
  name: "src",
  path: "src",
  type: "folder",
};
const file: FileNode = {
  id: "src/main.ts",
  name: "main.ts",
  path: "src/main.ts",
  type: "file",
};

function createHarness(selectedDirectoryPath: string | null = null) {
  let selectedPath = selectedDirectoryPath;
  const fileTree = {
    toggleFolder: vi.fn(async () => undefined),
  };
  const editor = {
    createFile: vi.fn(async (parentPath: string, name: string) =>
      parentPath ? `${parentPath}/${name}` : name,
    ),
  };
  const getSelectedDirectoryPath = vi.fn(() => selectedPath);
  const hook = renderHook(() =>
    useFileExplorerController({ fileTree, editor, getSelectedDirectoryPath }),
  );

  return {
    hook,
    fileTree,
    editor,
    getSelectedDirectoryPath,
    setSelectedPath(path: string | null) {
      selectedPath = path;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useFileExplorerController", () => {
  it("toggles folders by path and ignores file nodes", async () => {
    const harness = createHarness();

    await act(() => harness.hook.result.current.toggleFolder(folder));
    await act(() => harness.hook.result.current.toggleFolder(file));

    expect(harness.fileTree.toggleFolder).toHaveBeenCalledOnce();
    expect(harness.fileTree.toggleFolder).toHaveBeenCalledWith("src");
  });

  it("propagates folder toggle errors to the caller", async () => {
    const harness = createHarness();
    const failure = new Error("folder unavailable");
    harness.fileTree.toggleFolder.mockRejectedValueOnce(failure);

    await expect(harness.hook.result.current.toggleFolder(folder)).rejects.toBe(failure);
  });

  it("creates files in the selected directory and re-reads the target for each request", async () => {
    const harness = createHarness("src/features");

    await act(() => harness.hook.result.current.createFile("one.ts"));
    expect(harness.editor.createFile).toHaveBeenNthCalledWith(1, "src/features", "one.ts");

    harness.setSelectedPath("tests");
    await act(() => harness.hook.result.current.createFile("two.test.ts"));
    expect(harness.editor.createFile).toHaveBeenNthCalledWith(2, "tests", "two.test.ts");
    expect(harness.getSelectedDirectoryPath).toHaveBeenCalledTimes(2);
  });

  it("uses the workspace root when no directory is selected", async () => {
    const harness = createHarness(null);

    await act(() => harness.hook.result.current.createFile("root.ts"));

    expect(harness.editor.createFile).toHaveBeenCalledWith("", "root.ts");
  });

  it("rethrows creation errors and logs only a sanitized target category and error type", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = createHarness("private/project/secrets");
    const failure = new Error("cannot create Password.java: secret source");
    harness.editor.createFile.mockRejectedValueOnce(failure);

    await expect(harness.hook.result.current.createFile("Password.java")).rejects.toBe(failure);

    expect(consoleError).toHaveBeenCalledWith("[App] Empty-editor file creation failed", {
      target: "<selected-directory>",
      errorType: "Error",
    });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("private/project");
    expect(logged).not.toContain("Password.java");
    expect(logged).not.toContain("secret source");
  });
});
