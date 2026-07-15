import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileNode } from "@ide/contracts";
import type { FileTreePort } from "../ports/file-tree-port";
import { createFileTreeStore } from "../state/file-tree-store";
import { FileTreeViewModel } from "./file-tree-view-model";

function file(path: string): FileNode {
  return {
    id: path,
    name: path.split("/").pop() ?? path,
    path,
    type: "file",
  };
}

function folder(path: string, children?: FileNode[]): FileNode {
  return {
    id: path,
    name: path.split("/").pop() ?? path,
    path,
    type: "folder",
    ...(children ? { children } : {}),
  };
}

function createPort(): FileTreePort {
  return {
    getRoot: vi.fn(async () => []),
    getChildren: vi.fn(async () => []),
    createFile: vi.fn(async () => []),
    createFolder: vi.fn(async () => []),
    delete: vi.fn(async () => []),
    rename: vi.fn(async () => []),
    onFileSelect: vi.fn(() => () => undefined),
  };
}

describe("FileTreeViewModel createFile", () => {
  let store: ReturnType<typeof createFileTreeStore>;
  let port: FileTreePort;
  let viewModel: FileTreeViewModel;

  beforeEach(() => {
    store = createFileTreeStore();
    port = createPort();
    viewModel = new FileTreeViewModel(store.getState, port);
  });

  it("returns the exact root file path after updating the store", async () => {
    const updatedRoot = [folder("src"), file("README.md")];
    vi.mocked(port.createFile).mockResolvedValue(updatedRoot);

    const createdPath = await viewModel.createFile("", "README.md");

    expect(port.createFile).toHaveBeenCalledOnce();
    expect(port.createFile).toHaveBeenCalledWith("README.md");
    expect(store.getState().rootNodes).toEqual(updatedRoot);
    expect(createdPath).toBe("README.md");
  });

  it("returns the exact selected-directory file path after updating the store", async () => {
    store.getState().setRootNodes([folder("src", [])]);
    const updatedChildren = [file("src/index.ts")];
    vi.mocked(port.createFile).mockResolvedValue(updatedChildren);

    const createdPath = await viewModel.createFile("src", "index.ts");

    expect(port.createFile).toHaveBeenCalledOnce();
    expect(port.createFile).toHaveBeenCalledWith("src/index.ts");
    expect(store.getState().rootNodes[0].children).toEqual(updatedChildren);
    expect(createdPath).toBe("src/index.ts");
  });

  it("rejects without returning a path or mutating the store when creation fails", async () => {
    store.getState().setRootNodes([folder("src", [file("src/existing.ts")])]);
    const rootNodesBefore = store.getState().rootNodes;
    vi.mocked(port.createFile).mockRejectedValue(new Error("create failed"));

    await expect(viewModel.createFile("src", "new.ts")).rejects.toThrow("create failed");

    expect(port.createFile).toHaveBeenCalledWith("src/new.ts");
    expect(store.getState().rootNodes).toBe(rootNodesBefore);
  });
});

describe("FileTreeViewModel refresh", () => {
  let store: ReturnType<typeof createFileTreeStore>;
  let port: FileTreePort;
  let viewModel: FileTreeViewModel;

  beforeEach(() => {
    store = createFileTreeStore();
    port = createPort();
    viewModel = new FileTreeViewModel(store.getState, port);
  });

  it("refreshes only the requested directory while preserving expansion and selection", async () => {
    store
      .getState()
      .setRootNodes([folder("src", [folder("src/main", [file("src/main/Old.java")])])]);
    store.getState().toggleExpand("src");
    store.getState().toggleExpand("src/main");
    store.getState().setSelectedFilePath("src/main/Old.java");
    store.getState().setLoading(false);
    vi.mocked(port.getChildren).mockResolvedValue([file("src/main/Renamed.java")]);

    await viewModel.refreshDirectory("src/main");

    expect(port.getChildren).toHaveBeenCalledOnce();
    expect(port.getChildren).toHaveBeenCalledWith("src/main");
    expect(port.getRoot).not.toHaveBeenCalled();
    expect(store.getState().rootNodes[0].children?.[0].children).toEqual([
      file("src/main/Renamed.java"),
    ]);
    expect(store.getState().expandedPaths).toEqual(new Set(["src", "src/main"]));
    expect(store.getState().selectedFilePath).toBe("src/main/Old.java");
    expect(store.getState().isLoading).toBe(false);
  });

  it("uses loadRoot explicitly for a root refresh", async () => {
    store.getState().setRootNodes([folder("src")]);
    store.getState().toggleExpand("src");
    store.getState().setSelectedFilePath("src/Main.java");
    vi.mocked(port.getRoot).mockResolvedValue([
      folder("src", [file("src/Main.java")]),
      file("README.md"),
    ]);

    await viewModel.loadRoot();

    expect(port.getRoot).toHaveBeenCalledOnce();
    expect(port.getChildren).not.toHaveBeenCalled();
    expect(store.getState().rootNodes).toHaveLength(2);
    expect(store.getState().expandedPaths).toEqual(new Set(["src"]));
    expect(store.getState().selectedFilePath).toBe("src/Main.java");
    expect(store.getState().isLoading).toBe(false);
  });

  it("preserves the existing tree and loading state when branch refresh fails", async () => {
    store.getState().setRootNodes([folder("src", [file("src/Main.java")])]);
    store.getState().toggleExpand("src");
    store.getState().setSelectedFilePath("src/Main.java");
    const stateBefore = store.getState();
    vi.mocked(port.getChildren).mockRejectedValue(new Error("read failed"));

    await expect(viewModel.refreshDirectory("src")).rejects.toThrow("read failed");

    const stateAfter = store.getState();
    expect(stateAfter.rootNodes).toBe(stateBefore.rootNodes);
    expect(stateAfter.expandedPaths).toBe(stateBefore.expandedPaths);
    expect(stateAfter.selectedFilePath).toBe(stateBefore.selectedFilePath);
    expect(stateAfter.isLoading).toBe(stateBefore.isLoading);
  });

  it("does not replace an unrelated branch", async () => {
    const unrelatedBranch = folder("test", [
      folder("test/unit", [file("test/unit/MainTest.java")]),
    ]);
    store.getState().setRootNodes([folder("src", [file("src/Main.java")]), unrelatedBranch]);
    const unrelatedBefore = store.getState().rootNodes[1];
    vi.mocked(port.getChildren).mockResolvedValue([file("src/Renamed.java")]);

    await viewModel.refreshDirectory("src");

    expect(store.getState().rootNodes[1]).toBe(unrelatedBefore);
    expect(store.getState().rootNodes[1].children).toBe(unrelatedBefore.children);
  });
});
