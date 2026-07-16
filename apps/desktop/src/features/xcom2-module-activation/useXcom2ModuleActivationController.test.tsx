import {
  XCOM2_MODULE_SCAN_LIMITS,
  type WorkspaceInfo,
  type Xcom2ModuleEvidenceObservation,
  type Xcom2ModuleScanRequest,
  type Xcom2ModuleScanSnapshot,
} from "@ide/contracts";
import type { Xcom2ModuleScannerPort } from "@ide/web-core/ports";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useXcom2ModuleActivationController } from "./useXcom2ModuleActivationController";

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

const weakEvidence: readonly Xcom2ModuleEvidenceObservation[] = [
  {
    evidenceKind: "x2proj",
    moduleRoot: "MyMod",
    relativePath: "MyMod/MyMod.x2proj",
  },
];
const activeEvidence: readonly Xcom2ModuleEvidenceObservation[] = [
  ...weakEvidence,
  {
    evidenceKind: "xcommod",
    moduleRoot: "MyMod",
    relativePath: "MyMod/MyMod.xcommod",
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function scanSnapshot(
  request: Readonly<Xcom2ModuleScanRequest>,
  observations: readonly Xcom2ModuleEvidenceObservation[] = [],
): Readonly<Xcom2ModuleScanSnapshot> {
  return {
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    scanId: request.scanId,
    scanGeneration: request.scanGeneration,
    completeness: "complete",
    issues: [],
    limits: request.limits,
    observations,
  };
}

function createHarness(
  implementation: Xcom2ModuleScannerPort["scan"] = async (request) => scanSnapshot(request),
) {
  const scan = vi.fn(implementation);
  const controller = renderHook(() => useXcom2ModuleActivationController({ scanner: { scan } }));
  return { controller, scan };
}

async function activate(
  harness: ReturnType<typeof createHarness>,
  workspace: WorkspaceInfo,
  generation: number,
) {
  const collaborator = harness.controller.result.current.workspaceCollaborator;
  let token!: ReturnType<typeof collaborator.beginWorkspaceSwitch>;
  act(() => {
    token = collaborator.beginWorkspaceSwitch(generation);
    collaborator.activateWorkspace(workspace);
  });
  await act(() => collaborator.loadWorkspace(token, workspace.id));
  return token;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useXcom2ModuleActivationController", () => {
  it.each([
    ["generic workspace", [], "inactive", "none", 0],
    ["one weak convention", weakEvidence, "needs-confirmation", "medium", 0],
    ["corroborated module", activeEvidence, "active", "high", 1],
  ] as const)(
    "evaluates a %s with the pure activation policy",
    async (_label, observations, state, confidence, activeCount) => {
      const harness = createHarness(async (request) => scanSnapshot(request, observations));

      await activate(harness, workspaceOne, 1);

      expect(harness.controller.result.current.snapshot).toMatchObject({
        workspaceId: workspaceOne.id,
        workspaceGeneration: 1,
        state,
        confidence,
      });
      expect(harness.controller.result.current.activeModules).toHaveLength(activeCount);
      expect(harness.controller.result.current.isScanning).toBe(false);
      expect(harness.controller.result.current.error).toBeNull();
    },
  );

  it("sends one exact fixed-bound request per workspace generation with monotonic unique correlation", async () => {
    const harness = createHarness();
    const collaborator = harness.controller.result.current.workspaceCollaborator;
    let firstToken!: ReturnType<typeof collaborator.beginWorkspaceSwitch>;
    act(() => {
      firstToken = collaborator.beginWorkspaceSwitch(1);
      collaborator.activateWorkspace(workspaceOne);
    });

    await act(() =>
      Promise.all([
        collaborator.loadWorkspace(firstToken, workspaceOne.id),
        collaborator.loadWorkspace(firstToken, workspaceOne.id),
      ]),
    );
    await activate(harness, workspaceTwo, 2);

    expect(harness.scan).toHaveBeenCalledTimes(2);
    const first = harness.scan.mock.calls[0]![0];
    const second = harness.scan.mock.calls[1]![0];
    expect(first).toEqual({
      workspaceId: workspaceOne.id,
      workspaceGeneration: 1,
      scanId: "xcom2-module-scan:1",
      scanGeneration: 1,
      limits: XCOM2_MODULE_SCAN_LIMITS,
    });
    expect(second).toEqual({
      workspaceId: workspaceTwo.id,
      workspaceGeneration: 2,
      scanId: "xcom2-module-scan:2",
      scanGeneration: 2,
      limits: XCOM2_MODULE_SCAN_LIMITS,
    });
    expect(first.scanId).not.toBe(second.scanId);
    expect(new TextEncoder().encode(first.scanId).length).toBeLessThanOrEqual(256);
    expect(new TextEncoder().encode(second.scanId).length).toBeLessThanOrEqual(256);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.limits)).toBe(true);
  });

  it("clears old activation synchronously and rejects stale overlapping scan correlation", async () => {
    const staleScan = deferred<Readonly<Xcom2ModuleScanSnapshot>>();
    const scan = vi
      .fn<Xcom2ModuleScannerPort["scan"]>()
      .mockImplementationOnce(async (request) => scanSnapshot(request, activeEvidence))
      .mockImplementationOnce(() => staleScan.promise)
      .mockImplementationOnce(async (request) => scanSnapshot(request));
    const harness = createHarness(scan);
    await activate(harness, workspaceOne, 1);
    expect(harness.controller.result.current.activeModules).toHaveLength(1);

    const collaborator = harness.controller.result.current.workspaceCollaborator;
    let staleToken!: ReturnType<typeof collaborator.beginWorkspaceSwitch>;
    act(() => {
      staleToken = collaborator.beginWorkspaceSwitch(2);
    });
    expect(harness.controller.result.current.snapshot).toBeNull();
    expect(harness.controller.result.current.activeModules).toEqual([]);

    act(() => collaborator.activateWorkspace(workspaceTwo));
    let staleLoad!: Promise<void>;
    act(() => {
      staleLoad = collaborator.loadWorkspace(staleToken, workspaceTwo.id);
    });
    const staleRequest = harness.scan.mock.calls[1]![0];

    await activate(harness, workspaceThree, 3);
    expect(harness.controller.result.current.snapshot).toMatchObject({
      workspaceId: workspaceThree.id,
      workspaceGeneration: 3,
      state: "inactive",
    });

    staleScan.resolve(scanSnapshot(staleRequest, activeEvidence));
    await act(async () => staleLoad);
    expect(harness.controller.result.current.snapshot).toMatchObject({
      workspaceId: workspaceThree.id,
      workspaceGeneration: 3,
      scanGeneration: 3,
      state: "inactive",
    });
    expect(harness.controller.result.current.activeModules).toEqual([]);
  });

  it("ignores a current call whose returned correlation is not exact", async () => {
    const harness = createHarness(async (request) => ({
      ...scanSnapshot(request, activeEvidence),
      scanId: `${request.scanId}-wrong`,
    }));

    await activate(harness, workspaceOne, 1);

    expect(harness.controller.result.current.snapshot).toBeNull();
    expect(harness.controller.result.current.activeModules).toEqual([]);
    expect(harness.controller.result.current.error).toBeNull();
    expect(harness.controller.result.current.isScanning).toBe(false);
  });

  it("restores only the prior workspace snapshot after a failed switch and rejects its late scan", async () => {
    const failedScan = deferred<Readonly<Xcom2ModuleScanSnapshot>>();
    const harness = createHarness(
      vi
        .fn<Xcom2ModuleScannerPort["scan"]>()
        .mockImplementationOnce(async (request) => scanSnapshot(request, activeEvidence))
        .mockImplementationOnce(() => failedScan.promise),
    );
    await activate(harness, workspaceOne, 1);
    const priorSnapshot = harness.controller.result.current.snapshot;
    const collaborator = harness.controller.result.current.workspaceCollaborator;
    let failedToken!: ReturnType<typeof collaborator.beginWorkspaceSwitch>;
    act(() => {
      failedToken = collaborator.beginWorkspaceSwitch(2);
      collaborator.activateWorkspace(workspaceTwo);
    });
    let failedLoad!: Promise<void>;
    act(() => {
      failedLoad = collaborator.loadWorkspace(failedToken, workspaceTwo.id);
    });
    const failedRequest = harness.scan.mock.calls[1]![0];

    act(() => collaborator.restoreWorkspace(failedToken));
    expect(harness.controller.result.current.snapshot).toBe(priorSnapshot);
    expect(harness.controller.result.current.activeModules).toHaveLength(1);
    expect(harness.controller.result.current.isScanning).toBe(false);

    failedScan.resolve(scanSnapshot(failedRequest));
    await act(async () => failedLoad);
    expect(harness.controller.result.current.snapshot).toBe(priorSnapshot);
    expect(harness.controller.result.current.activeModules).toHaveLength(1);
  });

  it("restores the prior snapshot when another activation collaborator fails after scanning", async () => {
    const harness = createHarness(
      vi
        .fn<Xcom2ModuleScannerPort["scan"]>()
        .mockImplementationOnce(async (request) => scanSnapshot(request, activeEvidence))
        .mockImplementationOnce(async (request) => scanSnapshot(request)),
    );
    await activate(harness, workspaceOne, 1);
    const priorSnapshot = harness.controller.result.current.snapshot;
    const collaborator = harness.controller.result.current.workspaceCollaborator;
    let failedToken!: ReturnType<typeof collaborator.beginWorkspaceSwitch>;
    act(() => {
      failedToken = collaborator.beginWorkspaceSwitch(2);
      collaborator.activateWorkspace(workspaceTwo);
    });
    await act(() => collaborator.loadWorkspace(failedToken, workspaceTwo.id));
    expect(harness.controller.result.current.snapshot).toMatchObject({
      workspaceId: workspaceTwo.id,
      state: "inactive",
    });

    act(() => collaborator.restoreWorkspace(failedToken));

    expect(harness.controller.result.current.snapshot).toBe(priorSnapshot);
    expect(harness.controller.result.current.activeModules).toHaveLength(1);
  });

  it("surfaces a safe scanner error without failing workspace activation", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = createHarness(async () => {
      throw new Error("permission denied at /private/workspace/MyMod");
    });

    await expect(activate(harness, workspaceOne, 1)).resolves.toBeDefined();

    expect(harness.controller.result.current.snapshot).toBeNull();
    expect(harness.controller.result.current.activeModules).toEqual([]);
    expect(harness.controller.result.current.isScanning).toBe(false);
    expect(harness.controller.result.current.error).toBe(
      "Unable to recognize XCOM 2 modules in the current workspace.",
    );
    expect(harness.controller.result.current.error).not.toContain("/private");
    consoleError.mockRestore();
  });

  it("does not accept a late result after unmount", async () => {
    const pending = deferred<Readonly<Xcom2ModuleScanSnapshot>>();
    const harness = createHarness(() => pending.promise);
    const collaborator = harness.controller.result.current.workspaceCollaborator;
    let token!: ReturnType<typeof collaborator.beginWorkspaceSwitch>;
    act(() => {
      token = collaborator.beginWorkspaceSwitch(1);
      collaborator.activateWorkspace(workspaceOne);
    });
    let load!: Promise<void>;
    act(() => {
      load = collaborator.loadWorkspace(token, workspaceOne.id);
    });
    const request = harness.scan.mock.calls[0]![0];

    harness.controller.unmount();
    pending.resolve(scanSnapshot(request, activeEvidence));
    await expect(load).resolves.toBeUndefined();
  });
});
