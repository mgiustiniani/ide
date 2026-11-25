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

describe("FileTreeViewModel guarded refresh", () => {
  it("reveals a generated source root beyond a lazy output folder without changing the selected file", async () => {
    const store = createFileTreeStore();
    const port = createPort();
    const viewModel = new FileTreeViewModel(store.getState, port);
    store.getState().setRootNodes([folder("app", [folder("app/target")])]);
    store.getState().setSelectedFilePath("app/src/Main.java");
    const root = "app/target/generated-sources/annotations";
    vi.mocked(port.getChildren)
      .mockResolvedValueOnce([folder("app/target/generated-sources", [folder(root)])])
      .mockResolvedValueOnce([folder(`${root}/generated`, [file(`${root}/generated/Greeting.java`)])]);
    expect((await viewModel.revealFolder(root, () => true))?.path).toBe(root);
    expect(vi.mocked(port.getChildren).mock.calls).toEqual([["app/target"], [root]]);
    expect(store.getState().expandedPaths).toEqual(
      new Set(["app", "app/target", "app/target/generated-sources", root]),
    );
    expect(store.getState().selectedFilePath).toBe("app/src/Main.java");
  });

  it("refuses invalid paths and discards a directory listing from an earlier workspace", async () => {
    const store = createFileTreeStore();
    const port = createPort();
    const viewModel = new FileTreeViewModel(store.getState, port);
    store.getState().setRootNodes([folder("target")]);
    for (const path of ["../target", "/target", "C:/target", "target//generated"]) {
      expect(await viewModel.revealFolder(path, () => true)).toBeNull();
    }
    expect(port.getRoot).not.toHaveBeenCalled();
    expect(port.getChildren).not.toHaveBeenCalled();
    let finish!: (nodes: FileNode[]) => void;
    vi.mocked(port.getChildren).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let current = true;
    const pending = viewModel.revealFolder("target/generated", () => current);
    current = false;
    finish([folder("target/generated")]);
    expect(await pending).toBeNull();
    expect(store.getState().expandedPaths.size).toBe(0);
    expect(store.getState().rootNodes).toEqual([folder("target")]);
  });

  it.each(["root", "directory"] as const)(
    "retains visible children of an expanded branch after a bounded %s refresh",
    async (scope) => {
      const store = createFileTreeStore();
      const port = createPort();
      const viewModel = new FileTreeViewModel(store.getState, port);
      store
        .getState()
        .setRootNodes([
          folder("maven", [
            folder("maven/app", [folder("maven/app/java", [file("maven/app/java/Runner.java")])]),
            folder("maven/library", [file("maven/library/Base.java")]),
          ]),
        ]);
      for (const path of ["maven", "maven/app", "maven/app/java"])
        store.getState().toggleExpand(path);
      const bounded = [
        folder("maven/app", [folder("maven/app/java", [])]),
        folder("maven/library", [file("maven/library/Base.java")]),
      ];
      vi.mocked(port.getRoot).mockResolvedValue([folder("maven", bounded)]);
      vi.mocked(port.getChildren).mockImplementation(async (path) =>
        path === "maven" ? bounded : [file("maven/app/java/Runner.java")],
      );
      if (scope === "root") await viewModel.loadRoot();
      else await viewModel.refreshDirectory("maven");
      expect(store.getState().rootNodes[0].children?.[0].children?.[0].children).toEqual([
        file("maven/app/java/Runner.java"),
      ]);
      expect(port.getChildren).toHaveBeenCalledWith("maven/app/java");
      expect(store.getState().expandedPaths).toEqual(
        new Set(["maven", "maven/app", "maven/app/java"]),
      );
    },
  );

  it("does not publish expanded-folder children read after the workspace changes", async () => {
    const store = createFileTreeStore();
    const port = createPort();
    const viewModel = new FileTreeViewModel(store.getState, port);
    store.getState().setRootNodes([folder("src", [file("src/Old.java")])]);
    store.getState().toggleExpand("src");
    vi.mocked(port.getRoot).mockResolvedValue([folder("src", [])]);
    let resolve!: (nodes: FileNode[]) => void;
    vi.mocked(port.getChildren).mockImplementation(
      () =>
        new Promise<FileNode[]>((complete) => {
          resolve = complete;
        }),
    );
    let current = true;
    const pending = viewModel.loadRoot(() => current);
    await vi.waitFor(() => expect(port.getChildren).toHaveBeenCalledWith("src"));
    current = false;
    store.getState().setRootNodes([file("New.java")]);
    resolve([file("src/Old.java")]);
    await pending;
    expect(store.getState().rootNodes).toEqual([file("New.java")]);
  });
  it.each(["root", "directory"] as const)(
    "does not publish a late %s refresh into another workspace",
    async (scope) => {
      const store = createFileTreeStore();
      const port = createPort();
      const viewModel = new FileTreeViewModel(store.getState, port);
      let resolve!: (nodes: FileNode[]) => void;
      const pending = new Promise<FileNode[]>((complete) => {
        resolve = complete;
      });
      if (scope === "root") vi.mocked(port.getRoot).mockReturnValueOnce(pending);
      else vi.mocked(port.getChildren).mockReturnValueOnce(pending);
      let current = true;
      const refreshing =
        scope === "root"
          ? viewModel.loadRoot(() => current)
          : viewModel.refreshDirectory("src", () => current);
      current = false;
      const newNodes = [folder("src", [file("src/New.java")])];
      store.getState().setRootNodes(newNodes);
      store.getState().setLoading(true);
      resolve([file("src/Old.java")]);
      await refreshing;
      expect(store.getState().rootNodes).toEqual(newNodes);
      expect(store.getState().isLoading).toBe(true);
    },
  );
});

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

  it("creates package directories below an existing anchor and refreshes that anchor", async () => {
    store.getState().setRootNodes([folder("src", [])]);
    const children = [folder("src/example", [folder("src/example/orders", [file("src/example/orders/Created.java")])])];
    vi.mocked(port.createFile).mockResolvedValue(children);
    await expect(viewModel.createFile("src", "Created.java", () => true, "example/orders")).resolves.toBe("src/example/orders/Created.java");
    expect(port.createFile).toHaveBeenCalledWith("src/example/orders/Created.java", "src");
    expect(store.getState().rootNodes[0].children).toEqual(children);
    for (const invalid of ["../other", "/absolute", "example//orders", "example/./orders", "example\\orders", "C:other", "example\0orders"]) {
      await expect(viewModel.createFile("src", "Created.java", () => true, invalid)).rejects.toThrow("relative directory");
    }
    expect(port.createFile).toHaveBeenCalledOnce();
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

  it("does not publish created file rows after workspace authority changes", async () => {
    store.getState().setRootNodes([folder("src", [file("src/Existing.java")])]);
    const rootNodesBefore = store.getState().rootNodes;
    let current = true;
    let resolve!: (nodes: FileNode[]) => void;
    vi.mocked(port.createFile).mockReturnValueOnce(
      new Promise<FileNode[]>((done) => {
        resolve = done;
      }),
    );

    const creating = viewModel.createFile("src", "Created.java", () => current);
    current = false;
    resolve([file("src/Existing.java"), file("src/Created.java")]);
    await expect(creating).resolves.toBe("src/Created.java");

    expect(store.getState().rootNodes).toBe(rootNodesBefore);
  });
});

describe("FileTreeViewModel createFolder", () => {
  let store: ReturnType<typeof createFileTreeStore>;
  let port: FileTreePort;
  let viewModel: FileTreeViewModel;

  beforeEach(() => {
    store = createFileTreeStore();
    port = createPort();
    viewModel = new FileTreeViewModel(store.getState, port);
  });

  it("creates a folder beneath the selected package and replaces only its children", async () => {
    store.getState().setRootNodes([folder("src", [folder("src/main", [])])]);
    const updatedChildren = [folder("src/main/java", [])];
    vi.mocked(port.createFolder).mockResolvedValue(updatedChildren);

    await viewModel.createFolder("src/main", "java");

    expect(port.createFolder).toHaveBeenCalledOnce();
    expect(port.createFolder).toHaveBeenCalledWith("src/main/java");
    expect(store.getState().rootNodes[0].children?.[0].children).toEqual(updatedChildren);
  });

  it("does not publish a created folder after workspace authority changes", async () => {
    store.getState().setRootNodes([folder("src", [folder("src/main", [])])]);
    const rootNodesBefore = store.getState().rootNodes;
    let current = true;
    let resolve!: (nodes: FileNode[]) => void;
    vi.mocked(port.createFolder).mockReturnValueOnce(
      new Promise<FileNode[]>((done) => {
        resolve = done;
      }),
    );

    const creating = viewModel.createFolder("src", "test", () => current);
    current = false;
    resolve([folder("src", [folder("src/main", []), folder("src/test", [])])]);
    await creating;

    expect(store.getState().rootNodes).toBe(rootNodesBefore);
  });

  it("leaves the store unchanged when folder creation fails", async () => {
    store.getState().setRootNodes([folder("src", [folder("src/main", [])])]);
    const rootNodesBefore = store.getState().rootNodes;
    vi.mocked(port.createFolder).mockRejectedValue(new Error("create failed"));

    await expect(viewModel.createFolder("src", "test")).rejects.toThrow("create failed");

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
