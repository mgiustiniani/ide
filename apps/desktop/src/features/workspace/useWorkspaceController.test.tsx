import type { WorkspaceInfo, WorkspaceRegistry } from "@ide/contracts";
import type { WorkspacePort } from "@ide/web-core/ports";
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useWorkspaceController,
  type WorkspaceControllerCollaborators,
} from "./useWorkspaceController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const workspaceOne: WorkspaceInfo = {
  id: "workspace-one",
  name: "Workspace One",
  rootPath: "/workspace/one",
};
const workspaceTwo: WorkspaceInfo = {
  id: "workspace-two",
  name: "Workspace Two",
  rootPath: "/workspace/two",
};
const workspaceThree: WorkspaceInfo = {
  id: "workspace-three",
  name: "Workspace Three",
  rootPath: "/workspace/three",
};

function registryFor(currentWorkspaceId: string): WorkspaceRegistry {
  return {
    currentWorkspaceId,
    workspaces: [workspaceOne, workspaceTwo, workspaceThree],
  };
}

function createHarness(
  overrides: Partial<Pick<WorkspacePort, "ensureCurrentWorkspace" | "listWorkspaces">> = {},
) {
  const order: string[] = [];
  let currentWorkspace = workspaceOne;
  let registry = registryFor(workspaceOne.id);

  const ensureCurrentWorkspace = vi.fn(
    overrides.ensureCurrentWorkspace ?? (async () => currentWorkspace),
  );
  const listWorkspaces = vi.fn(overrides.listWorkspaces ?? (async () => registry));
  const switchWorkspace = vi.fn(async (workspaceId: string) => {
    order.push(`workspace.switch:${workspaceId}`);
    const nextWorkspace = registry.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!nextWorkspace) throw new Error(`Unknown workspace: ${workspaceId}`);
    currentWorkspace = nextWorkspace;
    registry = registryFor(nextWorkspace.id);
    return nextWorkspace;
  });
  const workspace: WorkspacePort = {
    ensureCurrentWorkspace,
    listWorkspaces,
    switchWorkspace,
  };
  const javaDetach = vi.fn(async (generation: number) => {
    order.push(`java.detach:${generation}`);
  });

  const collaborators: WorkspaceControllerCollaborators = {
    editor: {
      resetWorkspace: vi.fn(() => order.push("editor.reset")),
      restoreWorkspace: vi.fn(async () => {
        order.push("editor.restore");
      }),
    },
    java: {
      detach: javaDetach,
      attach: vi.fn((nextWorkspace, generation) => {
        order.push(`java.attach:${nextWorkspace.id}:${generation}`);
      }),
      load: vi.fn(async (workspaceId, generation) => {
        order.push(`java.load:${workspaceId}:${generation}`);
      }),
    },
    refactorKitImport: {
      resetWorkspace: vi.fn(() => order.push("refactorkit-import.reset")),
    },
    javaRefactoring: {
      resetWorkspace: vi.fn(() => order.push("java-refactoring.reset")),
    },
    javaProjectModel: {
      resetWorkspace: vi.fn(() => order.push("java-project-model.reset")),
    },
    refactorKitStatus: {
      beginWorkspaceSwitch: vi.fn((generation) => {
        order.push(`refactorkit-status.begin:${generation}`);
        return generation + 100;
      }),
      load: vi.fn(async (generation) => {
        order.push(`refactorkit-status.load:${generation}`);
      }),
      settleFailedWorkspaceSwitch: vi.fn((generation) => {
        order.push(`refactorkit-status.settle:${generation}`);
      }),
    },
    xcom2ModuleActivation: {
      beginWorkspaceSwitch: vi.fn((generation) => {
        order.push(`xcom2-module.begin:${generation}`);
        return { generation, previousWorkspaceId: currentWorkspace.id };
      }),
      activateWorkspace: vi.fn((nextWorkspace) => {
        order.push(`xcom2-module.activate:${nextWorkspace.id}`);
      }),
      loadWorkspace: vi.fn(async (token, workspaceId) => {
        order.push(`xcom2-module.load:${workspaceId}:${token.generation}`);
      }),
      refreshWorkspace: vi.fn(async (generation, workspaceId) => {
        order.push(`xcom2-module.refresh:${workspaceId}:${generation}`);
      }),
      restoreWorkspace: vi.fn((token) => {
        order.push(`xcom2-module.restore:${token.previousWorkspaceId}:${token.generation}`);
      }),
      settleFailedWorkspaceActivation: vi.fn((token) => {
        order.push(`xcom2-module.settle:${token.previousWorkspaceId}:${token.generation}`);
      }),
      settleFailedWorkspaceRefresh: vi.fn((generation, workspaceId) => {
        order.push(`xcom2-module.refresh-failed:${workspaceId}:${generation}`);
      }),
    },
    xcom: {
      beginWorkspaceSwitch: vi.fn((generation) => {
        order.push(`xcom.begin:${generation}`);
        return { generation, previousWorkspaceId: currentWorkspace.id };
      }),
      activateWorkspace: vi.fn((nextWorkspace) => {
        order.push(`xcom.activate:${nextWorkspace.id}`);
      }),
      loadWorkspace: vi.fn(async (token, workspaceId) => {
        order.push(`xcom.load:${workspaceId}:${token.generation}`);
      }),
      restoreWorkspace: vi.fn((token) => {
        order.push(`xcom.restore:${token.previousWorkspaceId}:${token.generation}`);
      }),
      settleFailedWorkspaceActivation: vi.fn((token) => {
        order.push(`xcom.settle:${token.previousWorkspaceId}:${token.generation}`);
      }),
    },
    ai: {
      beginWorkspaceSwitch: vi.fn(() => order.push("ai.begin")),
      activateWorkspace: vi.fn((nextWorkspace) => {
        order.push(`ai.activate:${nextWorkspace.id}`);
        return `ai:${nextWorkspace.id}`;
      }),
      loadCommands: vi.fn(async (workspaceKey) => {
        order.push(`ai.load:${workspaceKey}`);
      }),
    },
    shell: {
      clearClosedPreviews: vi.fn(() => order.push("shell.clear-previews")),
      resetTerminal: vi.fn(() => order.push("shell.reset-terminal")),
      loadFileTree: vi.fn(async () => {
        order.push("shell.load-tree");
      }),
    },
  };

  const collaboratorsRef = { current: collaborators };
  const controller = renderHook(() => useWorkspaceController({ workspace, collaboratorsRef }));

  return {
    controller,
    workspace,
    workspaceMocks: { ensureCurrentWorkspace, listWorkspaces, switchWorkspace },
    collaborators,
    collaboratorMocks: { javaDetach },
    order,
    setCurrentWorkspace(nextWorkspace: WorkspaceInfo) {
      currentWorkspace = nextWorkspace;
    },
    setRegistry(nextRegistry: WorkspaceRegistry) {
      registry = nextRegistry;
    },
  };
}

async function waitForInitialRefresh(harness: ReturnType<typeof createHarness>) {
  await waitFor(() => expect(harness.controller.result.current.isLoading).toBe(false));
  expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceOne);
  expect(harness.controller.result.current.workspaceRegistry).toEqual(registryFor(workspaceOne.id));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWorkspaceController", () => {
  it("completes initial activation once during StrictMode effect replay", async () => {
    const harness = createHarness();
    harness.controller.unmount();
    const initialCalls = harness.workspaceMocks.ensureCurrentWorkspace.mock.calls.length;
    const collaboratorsRef = { current: harness.collaborators };
    const controller = renderHook(
      () => useWorkspaceController({ workspace: harness.workspace, collaboratorsRef }),
      { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> },
    );

    await waitFor(() => expect(controller.result.current.isLoading).toBe(false));
    expect(controller.result.current.currentWorkspaceId).toBe(workspaceOne.id);
    expect(harness.workspaceMocks.ensureCurrentWorkspace).toHaveBeenCalledTimes(initialCalls + 1);
    controller.unmount();
  });

  it("does not settle an optional startup failure after unmount", async () => {
    const harness = createHarness();
    const moduleLoad = deferred<void>();
    vi.mocked(harness.collaborators.xcom2ModuleActivation.loadWorkspace).mockReturnValueOnce(
      moduleLoad.promise,
    );
    await waitForInitialRefresh(harness);
    harness.controller.unmount();

    await act(async () => {
      moduleLoad.reject(new Error("old provider failed"));
      await Promise.resolve();
    });

    expect(
      harness.collaborators.xcom2ModuleActivation.settleFailedWorkspaceActivation,
    ).not.toHaveBeenCalled();
  });

  it("makes authorized files ready after editor restoration while optional provider checks remain pending", async () => {
    const provider = deferred<void>();
    const editor = deferred<void>();
    const harness = createHarness();
    vi.mocked(harness.collaborators.editor.restoreWorkspace!).mockImplementationOnce(
      () => editor.promise,
    );
    vi.mocked(harness.collaborators.java.load).mockImplementationOnce(() => provider.promise);
    vi.mocked(harness.collaborators.ai.loadCommands).mockImplementationOnce(() => provider.promise);
    vi.mocked(harness.collaborators.refactorKitStatus.load).mockImplementationOnce(
      () => provider.promise,
    );
    vi.mocked(harness.collaborators.xcom2ModuleActivation.loadWorkspace).mockImplementationOnce(
      () => provider.promise,
    );
    vi.mocked(harness.collaborators.xcom.loadWorkspace).mockImplementationOnce(
      () => provider.promise,
    );
    await waitFor(() => expect(harness.collaborators.shell.loadFileTree).toHaveBeenCalled());
    expect(harness.controller.result.current.isLoading).toBe(true);
    await act(async () => editor.resolve());
    await waitFor(() => expect(harness.controller.result.current.isLoading).toBe(false));
    expect(harness.controller.result.current.getContext()).toMatchObject({
      workspaceId: workspaceOne.id,
      isSwitching: false,
    });
    expect(harness.controller.result.current.error).toBeNull();
    await act(async () => provider.resolve());
  });

  it("settles a failed optional project check independently of successful initial file access", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = deferred<void>();
    const harness = createHarness();
    vi.mocked(harness.collaborators.xcom2ModuleActivation.loadWorkspace).mockImplementationOnce(
      () => provider.promise,
    );
    await waitForInitialRefresh(harness);
    await act(async () => provider.reject(new Error("provider failed")));
    await waitFor(() =>
      expect(
        harness.collaborators.xcom2ModuleActivation.settleFailedWorkspaceActivation,
      ).toHaveBeenCalledWith({ generation: 1, previousWorkspaceId: workspaceOne.id }),
    );
    expect(harness.controller.result.current.isLoading).toBe(false);
    expect(harness.controller.result.current.error).toBeNull();
    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceOne);
  });

  it("does not settle a new workspace with an older background provider failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = deferred<void>();
    const harness = createHarness();
    vi.mocked(harness.collaborators.xcom2ModuleActivation.loadWorkspace).mockImplementationOnce(
      () => provider.promise,
    );
    await waitForInitialRefresh(harness);
    await act(() => harness.controller.result.current.switchWorkspace(workspaceTwo.id));
    await act(async () => provider.reject(new Error("retired provider failed")));
    expect(
      harness.collaborators.xcom2ModuleActivation.settleFailedWorkspaceActivation,
    ).not.toHaveBeenCalled();
    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceTwo);
    expect(harness.controller.result.current.error).toBeNull();
  });

  it("refuses a switch before resetting buffers when unsaved changes exist", async () => {
    const harness = createHarness();
    await waitForInitialRefresh(harness);
    const generation = harness.controller.result.current.generation;
    harness.collaborators.editor.hasUnsavedChanges = () => true;
    await act(async () => {
      await expect(
        harness.controller.result.current.switchWorkspace(workspaceTwo.id),
      ).rejects.toThrow("Save modified files before switching workspaces.");
    });
    expect(harness.workspaceMocks.switchWorkspace).not.toHaveBeenCalled();
    expect(harness.collaborators.editor.resetWorkspace).not.toHaveBeenCalled();
    expect(harness.controller.result.current.generation).toBe(generation);
    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceOne);
  });

  it("starts with a positive generation and loads the initial workspace registry", async () => {
    const harness = createHarness();
    const generation = harness.controller.result.current.generation;
    expect(Number.isSafeInteger(generation)).toBe(true);
    expect(generation).toBeGreaterThan(0);

    await waitForInitialRefresh(harness);
    expect(harness.controller.result.current.currentWorkspaceId).toBe(workspaceOne.id);
    expect(harness.controller.result.current.getContext()).toEqual({
      generation,
      workspaceId: workspaceOne.id,
      isSwitching: false,
      isMetadataLoading: false,
    });
  });

  it("authorizes a release-style cold mount before registry and dependent activation, then promotes stale registry data", async () => {
    const authorization = deferred<WorkspaceInfo>();
    const lifecycle: string[] = [];
    const harness = createHarness({
      ensureCurrentWorkspace: async () => {
        lifecycle.push("workspace.ensure:start");
        const ensured = await authorization.promise;
        lifecycle.push("workspace.ensure:authorized");
        return ensured;
      },
      listWorkspaces: async () => {
        lifecycle.push("workspace.list");
        return { currentWorkspaceId: null, workspaces: [] };
      },
    });

    expect(harness.controller.result.current.generation).toBeGreaterThan(0);
    expect(harness.controller.result.current.isLoading).toBe(true);
    expect(harness.controller.result.current.getContext()).toMatchObject({
      generation: harness.controller.result.current.generation,
      workspaceId: null,
      isSwitching: true,
      isMetadataLoading: true,
    });
    expect(lifecycle).toEqual(["workspace.ensure:start"]);
    expect(harness.workspaceMocks.listWorkspaces).not.toHaveBeenCalled();
    expect(harness.collaborators.editor.restoreWorkspace).not.toHaveBeenCalled();
    expect(harness.collaborators.java.attach).not.toHaveBeenCalled();
    expect(harness.collaborators.java.load).not.toHaveBeenCalled();
    expect(harness.collaborators.ai.beginWorkspaceSwitch).not.toHaveBeenCalled();
    expect(harness.collaborators.ai.loadCommands).not.toHaveBeenCalled();
    expect(harness.collaborators.refactorKitStatus.beginWorkspaceSwitch).not.toHaveBeenCalled();
    expect(harness.collaborators.xcom.beginWorkspaceSwitch).not.toHaveBeenCalled();
    expect(harness.collaborators.shell.loadFileTree).not.toHaveBeenCalled();

    authorization.resolve(workspaceOne);
    await waitFor(() => expect(harness.controller.result.current.isLoading).toBe(false));

    expect(lifecycle).toEqual([
      "workspace.ensure:start",
      "workspace.ensure:authorized",
      "workspace.list",
    ]);
    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceOne);
    expect(harness.controller.result.current.workspaceRegistry).toEqual({
      currentWorkspaceId: workspaceOne.id,
      workspaces: [workspaceOne],
    });
    expect(harness.controller.result.current.currentWorkspaceId).toBe(workspaceOne.id);
    expect(harness.order).toEqual([
      "xcom2-module.begin:1",
      "xcom.begin:1",
      "refactorkit-status.begin:1",
      "ai.begin",
      `xcom2-module.activate:${workspaceOne.id}`,
      `xcom.activate:${workspaceOne.id}`,
      `java.attach:${workspaceOne.id}:1`,
      `ai.activate:${workspaceOne.id}`,
      "editor.restore",
      `java.load:${workspaceOne.id}:1`,
      `ai.load:ai:${workspaceOne.id}`,
      "refactorkit-status.load:101",
      `xcom2-module.load:${workspaceOne.id}:1`,
      `xcom.load:${workspaceOne.id}:1`,
      "shell.load-tree",
    ]);
    expect(harness.controller.result.current.generation).toBe(1);
    expect(harness.controller.result.current.error).toBeNull();
  });

  it("settles a failed initial ensure with a safe error and starts no dependent context", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const authorization = deferred<WorkspaceInfo>();
    const harness = createHarness({
      ensureCurrentWorkspace: () => authorization.promise,
    });

    expect(harness.controller.result.current.isLoading).toBe(true);
    authorization.reject(new Error("denied at /private/persisted/.ide/workspace.json"));
    await waitFor(() => expect(harness.controller.result.current.isLoading).toBe(false));

    expect(harness.controller.result.current.error).toBe(
      "Unable to activate the current workspace.",
    );
    expect(harness.controller.result.current.error).not.toContain("/private/persisted");
    expect(harness.controller.result.current.workspaceInfo).toBeNull();
    expect(harness.controller.result.current.workspaceRegistry).toBeNull();
    expect(harness.controller.result.current.generation).toBeGreaterThan(0);
    expect(harness.controller.result.current.getContext()).toMatchObject({
      workspaceId: null,
      isSwitching: false,
      isMetadataLoading: false,
    });
    expect(harness.workspaceMocks.listWorkspaces).not.toHaveBeenCalled();
    expect(harness.collaborators.editor.restoreWorkspace).not.toHaveBeenCalled();
    expect(harness.collaborators.java.attach).not.toHaveBeenCalled();
    expect(harness.collaborators.ai.beginWorkspaceSwitch).not.toHaveBeenCalled();
    expect(harness.collaborators.refactorKitStatus.beginWorkspaceSwitch).not.toHaveBeenCalled();
    expect(harness.collaborators.xcom.beginWorkspaceSwitch).not.toHaveBeenCalled();
    expect(harness.collaborators.shell.loadFileTree).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not let stale initial authorization overwrite a newer generation transition", async () => {
    const staleAuthorization = deferred<WorkspaceInfo>();
    let ensureCall = 0;
    const harness = createHarness({
      ensureCurrentWorkspace: () => {
        ensureCall += 1;
        return ensureCall === 1 ? staleAuthorization.promise : Promise.resolve(workspaceTwo);
      },
    });

    await waitFor(() =>
      expect(harness.workspaceMocks.ensureCurrentWorkspace).toHaveBeenCalledTimes(1),
    );
    await act(() => harness.controller.result.current.switchWorkspace(workspaceTwo.id));
    const winningGeneration = harness.controller.result.current.generation;

    expect(winningGeneration).toBe(2);
    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceTwo);
    expect(harness.controller.result.current.currentWorkspaceId).toBe(workspaceTwo.id);
    expect(harness.collaborators.xcom.activateWorkspace).toHaveBeenCalledWith(workspaceTwo);

    staleAuthorization.resolve(workspaceOne);
    await act(async () => staleAuthorization.promise);

    expect(harness.controller.result.current.generation).toBe(winningGeneration);
    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceTwo);
    expect(harness.controller.result.current.currentWorkspaceId).toBe(workspaceTwo.id);
    expect(harness.collaborators.xcom.activateWorkspace).not.toHaveBeenCalledWith(workspaceOne);
    expect(harness.collaborators.java.attach).not.toHaveBeenCalledWith(workspaceOne, 1);
    expect(harness.controller.result.current.isLoading).toBe(false);
    expect(harness.controller.result.current.getContext().isSwitching).toBe(false);
  });

  it("keeps metadata-only refresh independent from explicit project activation", async () => {
    const harness = createHarness();
    await waitForInitialRefresh(harness);
    const projectRefreshes = vi.mocked(harness.collaborators.xcom2ModuleActivation.refreshWorkspace)
      .mock.calls.length;
    const fileTreeLoads = vi.mocked(harness.collaborators.shell.loadFileTree).mock.calls.length;

    await act(() => harness.controller.result.current.refresh());

    expect(harness.collaborators.xcom2ModuleActivation.refreshWorkspace).toHaveBeenCalledTimes(
      projectRefreshes,
    );
    expect(harness.collaborators.shell.loadFileTree).toHaveBeenCalledTimes(fileTreeLoads);
    expect(harness.workspaceMocks.ensureCurrentWorkspace).toHaveBeenCalledTimes(1);
    expect(harness.workspaceMocks.listWorkspaces).toHaveBeenCalledTimes(2);
  });

  it("revokes project activation synchronously and performs each full-refresh read exactly once", async () => {
    const harness = createHarness();
    await waitForInitialRefresh(harness);
    harness.order.length = 0;
    const activationGate = deferred<void>();
    vi.mocked(harness.collaborators.xcom2ModuleActivation.refreshWorkspace).mockImplementationOnce(
      (generation, workspaceId) => {
        harness.order.push(`xcom2-module.refresh:${workspaceId}:${generation}`);
        return activationGate.promise;
      },
    );
    const ensureCalls = harness.workspaceMocks.ensureCurrentWorkspace.mock.calls.length;
    const listCalls = harness.workspaceMocks.listWorkspaces.mock.calls.length;
    const treeCalls = vi.mocked(harness.collaborators.shell.loadFileTree).mock.calls.length;
    const generation = harness.controller.result.current.generation;

    let fullRefresh!: Promise<void>;
    act(() => {
      fullRefresh = harness.controller.result.current.refreshWorkspace();
    });

    expect(harness.order[0]).toBe(`xcom2-module.refresh:${workspaceOne.id}:${generation}`);
    expect(harness.collaborators.xcom2ModuleActivation.refreshWorkspace).toHaveBeenCalledWith(
      generation,
      workspaceOne.id,
    );
    expect(harness.workspaceMocks.ensureCurrentWorkspace).toHaveBeenCalledTimes(ensureCalls);
    expect(harness.workspaceMocks.listWorkspaces).toHaveBeenCalledTimes(listCalls + 1);
    expect(harness.controller.result.current.isLoading).toBe(true);

    await act(async () => Promise.resolve());
    expect(harness.collaborators.shell.loadFileTree).toHaveBeenCalledTimes(treeCalls + 1);
    expect(harness.controller.result.current.isLoading).toBe(true);
    activationGate.resolve();
    await act(async () => fullRefresh);

    expect(harness.controller.result.current.generation).toBe(generation);
    expect(harness.controller.result.current.isLoading).toBe(false);
  });

  it("preserves the active workspace when listing the registry fails or refers to another workspace", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = createHarness();
    await waitForInitialRefresh(harness);

    harness.workspaceMocks.listWorkspaces.mockRejectedValueOnce(new Error("registry offline"));
    await act(() => harness.controller.result.current.refresh());

    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceOne);
    expect(harness.controller.result.current.workspaceRegistry).toEqual(registryFor(workspaceOne.id));
    expect(harness.controller.result.current.error).toBe("registry offline");

    const updatedRegistry = registryFor(workspaceThree.id);
    harness.workspaceMocks.listWorkspaces.mockResolvedValueOnce(updatedRegistry);
    await act(() => harness.controller.result.current.refresh());

    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceOne);
    expect(harness.controller.result.current.workspaceRegistry).toEqual(registryFor(workspaceOne.id));
    expect(harness.controller.result.current.error).toBeNull();
    expect(harness.controller.result.current.isLoading).toBe(false);
    consoleError.mockRestore();
  });

  it("suppresses stale metadata results when refreshes overlap", async () => {
    const harness = createHarness();
    await waitForInitialRefresh(harness);
    const staleRegistry = deferred<WorkspaceRegistry>();
    harness.workspaceMocks.listWorkspaces.mockImplementationOnce(() => staleRegistry.promise);

    let staleRefresh!: Promise<void>;
    act(() => {
      staleRefresh = harness.controller.result.current.refresh();
    });
    await waitFor(() =>
      expect(harness.workspaceMocks.listWorkspaces).toHaveBeenCalledTimes(2),
    );

    harness.workspaceMocks.listWorkspaces.mockResolvedValueOnce(registryFor(workspaceThree.id));
    await act(() => harness.controller.result.current.refresh());

    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceOne);
    expect(harness.controller.result.current.workspaceRegistry).toEqual(
      registryFor(workspaceOne.id),
    );

    staleRegistry.resolve(registryFor(workspaceTwo.id));
    await act(async () => staleRefresh);

    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceOne);
    expect(harness.controller.result.current.workspaceRegistry).toEqual(
      registryFor(workspaceOne.id),
    );
    expect(harness.controller.result.current.error).toBeNull();
    expect(harness.controller.result.current.isLoading).toBe(false);
  });

  it("invalidates collaborators immediately, propagates one generation, and reloads after activation", async () => {
    const harness = createHarness();
    await waitForInitialRefresh(harness);
    harness.order.length = 0;
    const detachGate = deferred<void>();
    harness.collaboratorMocks.javaDetach.mockImplementationOnce((generation) => {
      harness.order.push(`java.detach:${generation}`);
      return detachGate.promise;
    });
    const initialGeneration = harness.controller.result.current.generation;

    let switching!: Promise<void>;
    act(() => {
      switching = harness.controller.result.current.switchWorkspace(workspaceTwo.id);
    });
    const nextGeneration = initialGeneration + 1;

    expect(harness.controller.result.current.generation).toBe(nextGeneration);
    expect(harness.controller.result.current.getGeneration()).toBe(nextGeneration);
    expect(harness.controller.result.current.getContext()).toMatchObject({
      generation: nextGeneration,
      workspaceId: workspaceOne.id,
      isSwitching: true,
    });
    expect(harness.controller.result.current.switchingWorkspaceId).toBe(workspaceTwo.id);
    expect(harness.controller.result.current.isLoading).toBe(true);
    expect(harness.order).toEqual([
      `xcom2-module.begin:${nextGeneration}`,
      "editor.reset",
      "refactorkit-import.reset",
      "java-refactoring.reset",
      `java.detach:${nextGeneration}`,
      `xcom.begin:${nextGeneration}`,
      `refactorkit-status.begin:${nextGeneration}`,
      "ai.begin",
    ]);
    expect(harness.workspaceMocks.switchWorkspace).not.toHaveBeenCalled();

    detachGate.resolve();
    await act(async () => switching);

    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceTwo);
    expect(harness.controller.result.current.currentWorkspaceId).toBe(workspaceTwo.id);
    expect(harness.collaborators.java.attach).toHaveBeenCalledWith(workspaceTwo, nextGeneration);
    expect(harness.collaborators.java.load).toHaveBeenCalledWith(workspaceTwo.id, nextGeneration);
    expect(harness.collaborators.xcom2ModuleActivation.loadWorkspace).toHaveBeenCalledWith(
      { generation: nextGeneration, previousWorkspaceId: workspaceOne.id },
      workspaceTwo.id,
    );
    expect(harness.collaborators.xcom.loadWorkspace).toHaveBeenCalledWith(
      { generation: nextGeneration, previousWorkspaceId: workspaceOne.id },
      workspaceTwo.id,
    );
    expect(harness.collaborators.refactorKitStatus.load).toHaveBeenCalledWith(nextGeneration + 100);
    expect(harness.order.indexOf(`xcom.activate:${workspaceTwo.id}`)).toBeLessThan(
      harness.order.indexOf(`java.load:${workspaceTwo.id}:${nextGeneration}`),
    );
    expect(harness.controller.result.current.getContext()).toMatchObject({
      generation: nextGeneration,
      workspaceId: workspaceTwo.id,
      isSwitching: false,
    });

    await act(() => harness.controller.result.current.switchWorkspace(workspaceThree.id));
    expect(harness.controller.result.current.generation).toBe(nextGeneration + 1);
    expect(harness.collaborators.java.detach).toHaveBeenLastCalledWith(nextGeneration + 1);
    expect(harness.collaborators.refactorKitStatus.beginWorkspaceSwitch).toHaveBeenLastCalledWith(
      nextGeneration + 1,
    );
    expect(
      harness.collaborators.xcom2ModuleActivation.beginWorkspaceSwitch,
    ).toHaveBeenLastCalledWith(nextGeneration + 1);
    expect(harness.collaborators.xcom.beginWorkspaceSwitch).toHaveBeenLastCalledWith(
      nextGeneration + 1,
    );
  });

  it("restores current collaborators and settles loading when a switch fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = createHarness();
    await waitForInitialRefresh(harness);
    harness.order.length = 0;
    const switchError = new Error("switch denied");
    harness.workspaceMocks.switchWorkspace.mockRejectedValueOnce(switchError);
    const generation = harness.controller.result.current.generation + 1;

    let thrown: unknown;
    await act(async () => {
      try {
        await harness.controller.result.current.switchWorkspace(workspaceTwo.id);
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBe(switchError);
    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceOne);
    expect(harness.controller.result.current.currentWorkspaceId).toBe(workspaceOne.id);
    expect(harness.controller.result.current.generation).toBe(generation);
    expect(harness.controller.result.current.error).toBe("switch denied");
    expect(harness.collaborators.xcom2ModuleActivation.restoreWorkspace).toHaveBeenCalledWith({
      generation,
      previousWorkspaceId: workspaceOne.id,
    });
    expect(harness.collaborators.xcom.restoreWorkspace).toHaveBeenCalledWith({
      generation,
      previousWorkspaceId: workspaceOne.id,
    });
    expect(
      harness.collaborators.refactorKitStatus.settleFailedWorkspaceSwitch,
    ).toHaveBeenCalledWith(generation + 100);
    expect(harness.collaborators.java.attach).toHaveBeenCalledWith(workspaceOne, generation);
    expect(harness.collaborators.java.load).toHaveBeenCalledWith(workspaceOne.id, generation);
    expect(harness.collaborators.shell.loadFileTree).toHaveBeenCalledTimes(1);
    expect(harness.controller.result.current.isLoading).toBe(false);
    expect(harness.controller.result.current.switchingWorkspaceId).toBeNull();
    expect(harness.controller.result.current.getContext().isSwitching).toBe(false);
    consoleError.mockRestore();
  });

  it("restores after Java detachment fails before native workspace activation", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = createHarness();
    await waitForInitialRefresh(harness);
    const detachError = new Error("detach failed");
    harness.collaboratorMocks.javaDetach.mockRejectedValueOnce(detachError);
    const generation = harness.controller.result.current.generation + 1;

    let thrown: unknown;
    await act(async () => {
      try {
        await harness.controller.result.current.switchWorkspace(workspaceTwo.id);
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBe(detachError);
    expect(harness.workspaceMocks.switchWorkspace).not.toHaveBeenCalled();
    expect(harness.collaborators.xcom2ModuleActivation.restoreWorkspace).toHaveBeenCalledWith({
      generation,
      previousWorkspaceId: workspaceOne.id,
    });
    expect(harness.collaborators.xcom.restoreWorkspace).toHaveBeenCalledWith({
      generation,
      previousWorkspaceId: workspaceOne.id,
    });
    expect(
      harness.collaborators.refactorKitStatus.settleFailedWorkspaceSwitch,
    ).toHaveBeenCalledWith(generation + 100);
    expect(harness.collaborators.java.attach).toHaveBeenCalledWith(workspaceOne, generation);
    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceOne);
    expect(harness.controller.result.current.error).toBe("detach failed");
    expect(harness.controller.result.current.getContext().isSwitching).toBe(false);
    consoleError.mockRestore();
  });

  it("lets the newest overlapping switch win and suppresses the older activation result", async () => {
    const harness = createHarness();
    await waitForInitialRefresh(harness);
    harness.order.length = 0;
    const staleSwitch = deferred<WorkspaceInfo>();
    harness.workspaceMocks.switchWorkspace
      .mockImplementationOnce((workspaceId: string) => {
        harness.order.push(`workspace.switch:${workspaceId}`);
        return staleSwitch.promise;
      })
      .mockImplementationOnce(async (workspaceId: string) => {
        harness.order.push(`workspace.switch:${workspaceId}`);
        harness.setCurrentWorkspace(workspaceThree);
        harness.setRegistry(registryFor(workspaceThree.id));
        return workspaceThree;
      });

    let first!: Promise<void>;
    act(() => {
      first = harness.controller.result.current.switchWorkspace(workspaceTwo.id);
    });
    await waitFor(() => expect(harness.workspaceMocks.switchWorkspace).toHaveBeenCalledTimes(1));

    await act(() => harness.controller.result.current.switchWorkspace(workspaceThree.id));
    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceThree);
    const winningGeneration = harness.controller.result.current.generation;

    staleSwitch.resolve(workspaceTwo);
    await act(async () => first);

    expect(harness.controller.result.current.workspaceInfo).toEqual(workspaceThree);
    expect(harness.controller.result.current.currentWorkspaceId).toBe(workspaceThree.id);
    expect(harness.controller.result.current.generation).toBe(winningGeneration);
    expect(harness.collaborators.xcom.activateWorkspace).not.toHaveBeenCalledWith(workspaceTwo);
    expect(harness.collaborators.java.attach).not.toHaveBeenCalledWith(
      workspaceTwo,
      winningGeneration - 1,
    );
    expect(harness.controller.result.current.isLoading).toBe(false);
    expect(harness.controller.result.current.switchingWorkspaceId).toBeNull();
  });
});

it("refuses database-blocked workspace transitions before generation, editor, or native authority changes", async () => {
  const harness = createHarness();
  await waitForInitialRefresh(harness);
  const generation = harness.controller.result.current.generation;
  const reason = "Commit or roll back the database transaction first.";
  harness.collaborators.transitionBlockReason = () => reason;
  harness.order.length = 0;
  await act(async () => {
    await expect(harness.controller.result.current.switchWorkspace(workspaceTwo.id)).rejects.toThrow(reason);
    await expect(harness.controller.result.current.refreshWorkspace()).rejects.toThrow(reason);
  });
  expect(harness.controller.result.current.generation).toBe(generation);
  expect(harness.order).toEqual([]);
  expect(harness.workspaceMocks.switchWorkspace).not.toHaveBeenCalled();
  expect(harness.controller.result.current.error).toBe(reason);
});
