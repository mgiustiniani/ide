import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriFileTreeAdapter } from "./file-tree-tauri";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("TauriFileTreeAdapter", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("derives relative node paths from absolute entry.path values", async () => {
    const adapter = new TauriFileTreeAdapter();

    invokeMock
      .mockResolvedValueOnce({
        name: "project",
        path: "/workspace/project",
        type: "directory",
        children: [
          {
            name: "invented-root-name",
            path: "/workspace/project/src",
            type: "directory",
            children: [],
          },
          {
            name: "wrong-root-file.ts",
            path: "/workspace/project/package.json",
            type: "file",
          },
        ],
      })
      .mockResolvedValueOnce({
        name: "invented-root-name",
        path: "/workspace/project/src",
        type: "directory",
        children: [
          {
            name: "invented-child-name.ts",
            path: "/workspace/project/src/actual-child.ts",
            type: "file",
          },
        ],
      });

    const root = await adapter.getRoot();

    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_directory", {
      path: ".",
    });
    expect(root[0]).toMatchObject({
      name: "invented-root-name",
      path: "src",
      type: "folder",
    });
    expect(root[1]).toMatchObject({
      name: "wrong-root-file.ts",
      path: "package.json",
      type: "file",
    });
    expect(root[0].path).not.toBe("invented-root-name");
    expect(root[1].path).not.toBe("wrong-root-file.ts");

    const children = await adapter.getChildren(root[0].path);

    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_directory", {
      path: "src",
    });
    expect(children[0]).toMatchObject({
      name: "invented-child-name.ts",
      path: "src/actual-child.ts",
      type: "file",
    });
    expect(children[0].path).not.toBe("src/invented-child-name.ts");
  });

  it("binds file search to the active workspace generation and validates relative results", async () => {
    const adapter = new TauriFileTreeAdapter();
    invokeMock
      .mockResolvedValueOnce({
        name: "project",
        path: "/workspace/project",
        type: "directory",
        workspaceGeneration: 12,
        children: [],
      })
      .mockResolvedValueOnce({
        workspaceGeneration: 12,
        files: [{ name: "Main.java", path: "src/main/java/example/Main.java" }],
        truncated: false,
        partial: false,
      });
    await adapter.getRoot();

    await expect(adapter.searchFiles("main")).resolves.toEqual({
      files: [{ name: "Main.java", path: "src/main/java/example/Main.java" }],
      truncated: false,
      partial: false,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "search_workspace_files", {
      query: "main",
      expectedWorkspaceRoot: "/workspace/project",
      expectedWorkspaceGeneration: 12,
    });
  });

  it("refuses stale search responses and paths that escape the workspace", async () => {
    const adapter = new TauriFileTreeAdapter();
    invokeMock
      .mockResolvedValueOnce({
        name: "project",
        path: "/workspace/project",
        type: "directory",
        workspaceGeneration: 4,
        children: [],
      })
      .mockResolvedValueOnce({
        workspaceGeneration: 5,
        files: [{ name: "Secret.java", path: "src/Secret.java" }],
        truncated: false,
        partial: false,
      })
      .mockResolvedValueOnce({
        workspaceGeneration: 4,
        files: [{ name: "Secret.java", path: "../outside/Secret.java" }],
        truncated: false,
        partial: false,
      });
    await adapter.getRoot();

    await expect(adapter.searchFiles("secret")).rejects.toThrow(/stale workspace file search/i);
    await expect(adapter.searchFiles("secret")).rejects.toThrow(/invalid workspace file search/i);
  });

  it("binds nested creation to workspace authority and reloads the existing source root", async () => {
    const adapter = new TauriFileTreeAdapter();
    invokeMock.mockResolvedValueOnce({ name: "project", path: "/workspace/project", type: "directory", children: [], workspaceGeneration: 7 })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ name: "src", path: "/workspace/project/src", type: "directory", children: [] });
    await adapter.getRoot();
    await adapter.createFile("src/example/orders/Created.java", "src");
    expect(invokeMock).toHaveBeenCalledWith("create_file", {
      path: "src/example/orders/Created.java", createParentDirectoriesUnder: "src",
      expectedWorkspaceRoot: "/workspace/project", expectedWorkspaceGeneration: 7,
    });
    expect(invokeMock).toHaveBeenLastCalledWith("list_directory", { path: "src" });
  });

  it.each(["create_file", "create_directory", "delete_path", "rename_path"] as const)(
    "binds %s to the root returned by the authorized tree load",
    async (command) => {
      const adapter = new TauriFileTreeAdapter();
      const workspaceRoot = "/workspace/project";
      const workspaceGeneration = 7;
      invokeMock
        .mockResolvedValueOnce({
          name: "project",
          path: workspaceRoot,
          type: "directory",
          children: [],
          workspaceGeneration,
        })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({
          name: "src",
          path: `${workspaceRoot}/src`,
          type: "directory",
          children: [],
        });

      await adapter.getRoot();
      if (command === "create_file") await adapter.createFile("src/New.java");
      else if (command === "create_directory") await adapter.createFolder("src/new-package");
      else if (command === "delete_path") await adapter.delete("src/Old.java");
      else await adapter.rename("src/Old.java", "New.java");

      const expectedPayload =
        command === "rename_path"
          ? {
              path: "src/Old.java",
              newName: "New.java",
              expectedWorkspaceRoot: workspaceRoot,
              expectedWorkspaceGeneration: workspaceGeneration,
            }
          : {
              path:
                command === "create_file"
                  ? "src/New.java"
                  : command === "create_directory"
                    ? "src/new-package"
                    : "src/Old.java",
              expectedWorkspaceRoot: workspaceRoot,
              expectedWorkspaceGeneration: workspaceGeneration,
            };
      expect(invokeMock).toHaveBeenNthCalledWith(2, command, expectedPayload);
      expect(invokeMock).toHaveBeenNthCalledWith(3, "list_directory", { path: "src" });
    },
  );

  it("refuses file mutations before an authorized workspace root has been loaded", async () => {
    const adapter = new TauriFileTreeAdapter();

    await expect(adapter.createFolder("src/new-package")).rejects.toThrow(
      "The file tree must load its workspace before changing files.",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("refuses mutations when the root listing lacks a native generation", async () => {
    const adapter = new TauriFileTreeAdapter();
    invokeMock.mockResolvedValueOnce({
      name: "project",
      path: "/workspace/project",
      type: "directory",
      children: [],
    });
    await adapter.getRoot();

    await expect(adapter.createFolder("src/new-package")).rejects.toThrow(
      "The file tree must load its workspace before changing files.",
    );
    expect(invokeMock).toHaveBeenCalledOnce();
  });
});
