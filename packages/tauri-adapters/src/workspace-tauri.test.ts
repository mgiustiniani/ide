import { WORKSPACE_MARKER_FOLDER, WORKSPACE_REGISTRY_VERSION } from "@ide/contracts";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriAdapterError } from "./errors";
import { TauriWorkspaceAdapter } from "./workspace-tauri";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("TauriWorkspaceAdapter", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes ensure_current_workspace and returns normalized workspace info", async () => {
    const adapter = new TauriWorkspaceAdapter();

    invokeMock.mockResolvedValueOnce({
      id: "workspace-1",
      name: "Project",
      rootPath: "/workspace/project",
      markerFolder: WORKSPACE_MARKER_FOLDER,
      createdAt: "2026-07-10T12:00:00.000Z",
      lastOpenedAt: "2026-07-11T12:00:00.000Z",
      extraBackendField: true,
    });

    await expect(adapter.ensureCurrentWorkspace()).resolves.toEqual({
      id: "workspace-1",
      name: "Project",
      rootPath: "/workspace/project",
      markerFolder: WORKSPACE_MARKER_FOLDER,
      createdAt: "2026-07-10T12:00:00.000Z",
      lastOpenedAt: "2026-07-11T12:00:00.000Z",
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("ensure_current_workspace", undefined);
  });

  it("invokes list_workspaces and returns a normalized registry", async () => {
    const adapter = new TauriWorkspaceAdapter();

    invokeMock.mockResolvedValueOnce({
      version: WORKSPACE_REGISTRY_VERSION,
      currentWorkspaceId: "workspace-2",
      ignored: "backend-only",
      workspaces: [
        {
          id: "workspace-1",
          name: "First Project",
          rootPath: "/workspace/first",
          markerFolder: WORKSPACE_MARKER_FOLDER,
          backendOnly: "ignored",
        },
        {
          id: "workspace-2",
          name: "Second Project",
          rootPath: "/workspace/second",
          createdAt: "2026-07-10T12:00:00.000Z",
          lastOpenedAt: "2026-07-11T12:00:00.000Z",
        },
      ],
    });

    await expect(adapter.listWorkspaces()).resolves.toEqual({
      version: WORKSPACE_REGISTRY_VERSION,
      currentWorkspaceId: "workspace-2",
      workspaces: [
        {
          id: "workspace-1",
          name: "First Project",
          rootPath: "/workspace/first",
          markerFolder: WORKSPACE_MARKER_FOLDER,
        },
        {
          id: "workspace-2",
          name: "Second Project",
          rootPath: "/workspace/second",
          createdAt: "2026-07-10T12:00:00.000Z",
          lastOpenedAt: "2026-07-11T12:00:00.000Z",
        },
      ],
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("list_workspaces", undefined);
  });

  it("invokes switch_workspace with workspaceId and returns normalized workspace info", async () => {
    const adapter = new TauriWorkspaceAdapter();

    invokeMock.mockResolvedValueOnce({
      id: "workspace-2",
      name: "Switched Project",
      rootPath: "/workspace/switched",
      markerFolder: WORKSPACE_MARKER_FOLDER,
      createdAt: "2026-07-10T12:00:00.000Z",
      lastOpenedAt: "2026-07-11T12:00:00.000Z",
      extraBackendField: "ignored",
    });

    await expect(adapter.switchWorkspace("workspace-2")).resolves.toEqual({
      id: "workspace-2",
      name: "Switched Project",
      rootPath: "/workspace/switched",
      markerFolder: WORKSPACE_MARKER_FOLDER,
      createdAt: "2026-07-10T12:00:00.000Z",
      lastOpenedAt: "2026-07-11T12:00:00.000Z",
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("switch_workspace", {
      workspaceId: "workspace-2",
    });
  });

  it("shares one root-activation queue across adapters so ensure completes before switch", async () => {
    const authorization = deferred<unknown>();
    const ensuringAdapter = new TauriWorkspaceAdapter();
    const switchingAdapter = new TauriWorkspaceAdapter();
    invokeMock.mockReturnValueOnce(authorization.promise).mockResolvedValueOnce({
      id: "workspace-2",
      name: "Switched Project",
      rootPath: "/workspace/switched",
    });

    const ensure = ensuringAdapter.ensureCurrentWorkspace();
    const switched = switchingAdapter.switchWorkspace("workspace-2");

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenLastCalledWith("ensure_current_workspace", undefined);

    authorization.resolve({
      id: "workspace-1",
      name: "Persisted Project",
      rootPath: "/workspace/persisted",
    });

    await expect(ensure).resolves.toMatchObject({ id: "workspace-1" });
    await expect(switched).resolves.toMatchObject({ id: "workspace-2" });
    expect(invokeMock.mock.calls).toEqual([
      ["ensure_current_workspace", undefined],
      ["switch_workspace", { workspaceId: "workspace-2" }],
    ]);
  });

  it("recovers the shared root-activation queue after initial ensure fails", async () => {
    const ensuringAdapter = new TauriWorkspaceAdapter();
    const switchingAdapter = new TauriWorkspaceAdapter();
    invokeMock
      .mockRejectedValueOnce(new Error("initial authorization denied"))
      .mockResolvedValueOnce({
        id: "workspace-2",
        name: "Recovered Project",
        rootPath: "/workspace/recovered",
      });

    const failedEnsure = ensuringAdapter.ensureCurrentWorkspace();
    const recoveredSwitch = switchingAdapter.switchWorkspace("workspace-2");

    await expect(failedEnsure).rejects.toThrow("initial authorization denied");
    await expect(recoveredSwitch).resolves.toMatchObject({ id: "workspace-2" });
    expect(invokeMock.mock.calls).toEqual([
      ["ensure_current_workspace", undefined],
      ["switch_workspace", { workspaceId: "workspace-2" }],
    ]);
  });

  it("serializes overlapping native switches so the newest request owns the final root", async () => {
    const adapter = new TauriWorkspaceAdapter();
    let resolveFirst!: (value: unknown) => void;
    const firstResponse = new Promise<unknown>((resolve) => {
      resolveFirst = resolve;
    });
    invokeMock.mockReturnValueOnce(firstResponse).mockResolvedValueOnce({
      id: "workspace-3",
      name: "Newest Project",
      rootPath: "/workspace/newest",
    });

    const first = adapter.switchWorkspace("workspace-2");
    const newest = adapter.switchWorkspace("workspace-3");

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenLastCalledWith("switch_workspace", {
      workspaceId: "workspace-2",
    });

    resolveFirst({
      id: "workspace-2",
      name: "Slow Project",
      rootPath: "/workspace/slow",
    });

    await expect(first).resolves.toMatchObject({ id: "workspace-2" });
    await expect(newest).resolves.toMatchObject({ id: "workspace-3" });
    expect(invokeMock.mock.calls).toEqual([
      ["switch_workspace", { workspaceId: "workspace-2" }],
      ["switch_workspace", { workspaceId: "workspace-3" }],
    ]);
  });

  it("continues the serialized switch queue after a native switch failure", async () => {
    const adapter = new TauriWorkspaceAdapter();
    invokeMock.mockRejectedValueOnce(new Error("switch denied")).mockResolvedValueOnce({
      id: "workspace-3",
      name: "Recovered Project",
      rootPath: "/workspace/recovered",
    });

    const failed = adapter.switchWorkspace("workspace-2");
    const recovered = adapter.switchWorkspace("workspace-3");

    await expect(failed).rejects.toThrow("switch denied");
    await expect(recovered).resolves.toMatchObject({ id: "workspace-3" });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid switch_workspace shapes", async () => {
    const adapter = new TauriWorkspaceAdapter();

    invokeMock.mockResolvedValueOnce({
      id: "workspace-2",
      name: "Project",
      rootPath: 42,
    });

    const promise = adapter.switchWorkspace("workspace-2");

    await expect(promise).rejects.toThrow(TauriAdapterError);
    await expect(promise).rejects.toThrow("Invalid switch_workspace response");
  });

  it("rejects invalid ensure_current_workspace shapes", async () => {
    const adapter = new TauriWorkspaceAdapter();

    invokeMock.mockResolvedValueOnce({
      name: "Project",
      rootPath: "/workspace/project",
    });

    const promise = adapter.ensureCurrentWorkspace();

    await expect(promise).rejects.toThrow(TauriAdapterError);
    await expect(promise).rejects.toThrow("Invalid ensure_current_workspace response");
  });

  it("rejects invalid list_workspaces shapes", async () => {
    const adapter = new TauriWorkspaceAdapter();

    invokeMock.mockResolvedValueOnce({
      version: WORKSPACE_REGISTRY_VERSION,
      workspaces: [
        {
          id: "workspace-1",
          name: "Project",
          rootPath: 42,
        },
      ],
    });

    const promise = adapter.listWorkspaces();

    await expect(promise).rejects.toThrow(TauriAdapterError);
    await expect(promise).rejects.toThrow("Invalid list_workspaces response");
  });
});
