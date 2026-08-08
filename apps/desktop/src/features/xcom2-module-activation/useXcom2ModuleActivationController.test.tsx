import {
  XCOM2_MODULE_SCAN_LIMITS,
  type WorkspaceInfo,
  type Xcom2ModuleConfigurationReadRequest,
  type Xcom2ModuleConfigurationReadResult,
  type Xcom2ModuleEvidenceObservation,
  type Xcom2ModuleScanRequest,
  type Xcom2ModuleScanSnapshot,
  type Xcom2NativeActivationCandidate,
  type Xcom2NativeActivationEvidenceHandle,
} from "@ide/contracts";
import type { Xcom2ModuleConfigurationPort, Xcom2ModuleScannerPort } from "@ide/web-core/ports";
import { act, renderHook, waitFor } from "@testing-library/react";
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

function configurationResult(
  request: Readonly<Xcom2ModuleConfigurationReadRequest>,
  overrides: Partial<Readonly<Xcom2ModuleConfigurationReadResult>> = {},
): Readonly<Xcom2ModuleConfigurationReadResult> {
  return { ...request, kind: "absent", ...overrides } as Xcom2ModuleConfigurationReadResult;
}

function createHarness(
  implementation: Xcom2ModuleScannerPort["scan"] = async (request) => scanSnapshot(request),
  configurationImplementation: Xcom2ModuleConfigurationPort["read"] = async (request) =>
    configurationResult(request),
) {
  const scan = vi.fn(implementation);
  const read = vi.fn(configurationImplementation);
  let activationGeneration = 0;
  let latestCandidate: Readonly<Xcom2NativeActivationCandidate> | null = null;
  const begin = vi.fn(async (request: any): Promise<Readonly<Xcom2NativeActivationCandidate>> => {
    activationGeneration += 1;
    const configurationRequest = Object.freeze({
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      activationGeneration,
      configurationReadId: request.configurationReadId,
    });
    const scanRequest = Object.freeze({
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      scanId: request.scanId,
      scanGeneration: request.scanGeneration,
      limits: request.limits,
    });
    const [scanned, configured] = await Promise.all([
      scan(scanRequest),
      read(configurationRequest),
    ]);
    const receipt = `activation-attempt:${activationGeneration}`;
    const handleByRoot = new Map<string, string>();
    for (const root of [
      ...scanned.observations.map(({ moduleRoot }) => moduleRoot),
      ...(configured.kind === "ready" ? configured.configuration.moduleRoots : []),
    ]) {
      if (!handleByRoot.has(root)) handleByRoot.set(root, `evidence:${root}`);
    }
    const handles = (roots: readonly string[]): readonly Xcom2NativeActivationEvidenceHandle[] =>
      Object.freeze(
        [...new Set(roots)].map((moduleRoot) =>
          Object.freeze({ moduleRoot, evidenceHandle: handleByRoot.get(moduleRoot)! }),
        ),
      );
    latestCandidate = Object.freeze({
      scan: Object.freeze({
        ...scanned,
        activationGeneration,
        activationAttemptReceipt: receipt,
        evidenceHandles: handles(scanned.observations.map(({ moduleRoot }) => moduleRoot)),
      }),
      configuration: Object.freeze({
        ...configured,
        activationAttemptReceipt: receipt,
        evidenceHandles: handles(
          configured.kind === "ready" ? configured.configuration.moduleRoots : [],
        ),
      }),
    });
    return latestCandidate;
  });
  const acknowledge = vi.fn(async (acknowledgment: any) => {
    if (!latestCandidate) throw new Error("No activation candidate");
    const selectedByHandle = new Map(
      [
        ...latestCandidate.scan.evidenceHandles,
        ...latestCandidate.configuration.evidenceHandles,
      ].map((entry) => [entry.evidenceHandle, entry] as const),
    );
    const selectedModules = acknowledgment.evidenceHandles.map((evidenceHandle: string) =>
      selectedByHandle.get(evidenceHandle)!,
    );
    const correlation = latestCandidate.scan;
    const state = Object.freeze({
      kind: "acknowledged" as const,
      workspaceId: correlation.workspaceId,
      workspaceGeneration: correlation.workspaceGeneration,
      activationGeneration: correlation.activationGeneration,
      activationAttemptReceipt: correlation.activationAttemptReceipt,
      acknowledgment,
      selectedModules: Object.freeze(selectedModules),
    });
    return Object.freeze({ kind: "acknowledged" as const, acknowledgment, state });
  });
  const revoke = vi.fn(async (event: any) =>
    Object.freeze({
      kind: "revoked" as const,
      state: Object.freeze({ kind: "revoked" as const, code: event.kind }),
    }),
  );
  const nativeEvidence = { begin, acknowledge, revoke };
  const controller = renderHook(() => useXcom2ModuleActivationController({ nativeEvidence }));
  return { controller, scan, read, begin, acknowledge, revoke };
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

  it("sends one exact scanner and configuration request per activation with monotonic correlation", async () => {
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
    await act(() => harness.controller.result.current.refreshWorkspace(2, workspaceTwo.id));

    expect(harness.scan).toHaveBeenCalledTimes(3);
    expect(harness.read).toHaveBeenCalledTimes(3);
    const first = harness.scan.mock.calls[0]![0];
    const second = harness.scan.mock.calls[1]![0];
    const third = harness.scan.mock.calls[2]![0];
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
    expect(third).toEqual({
      workspaceId: workspaceTwo.id,
      workspaceGeneration: 2,
      scanId: "xcom2-module-scan:3",
      scanGeneration: 3,
      limits: XCOM2_MODULE_SCAN_LIMITS,
    });
    expect(harness.read.mock.calls.map(([request]) => request)).toEqual([
      {
        workspaceId: workspaceOne.id,
        workspaceGeneration: 1,
        activationGeneration: 1,
        configurationReadId: "xcom2-configuration-read:1",
      },
      {
        workspaceId: workspaceTwo.id,
        workspaceGeneration: 2,
        activationGeneration: 2,
        configurationReadId: "xcom2-configuration-read:2",
      },
      {
        workspaceId: workspaceTwo.id,
        workspaceGeneration: 2,
        activationGeneration: 3,
        configurationReadId: "xcom2-configuration-read:3",
      },
    ]);
    expect(first.scanId).not.toBe(second.scanId);
    expect(second.scanId).not.toBe(third.scanId);
    expect(new TextEncoder().encode(first.scanId).length).toBeLessThanOrEqual(256);
    expect(new TextEncoder().encode(second.scanId).length).toBeLessThanOrEqual(256);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.limits)).toBe(true);
    expect(Object.isFrozen(harness.read.mock.calls[0]![0])).toBe(true);
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
    await waitFor(() => expect(harness.scan).toHaveBeenCalledTimes(2));
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
    const priorProjectSnapshot = harness.controller.result.current.projectSnapshot;
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
    await waitFor(() => expect(harness.scan).toHaveBeenCalledTimes(2));
    const failedRequest = harness.scan.mock.calls[1]![0];

    act(() => collaborator.restoreWorkspace(failedToken));
    expect(harness.controller.result.current.snapshot).toBe(priorSnapshot);
    expect(harness.controller.result.current.projectSnapshot).toBe(priorProjectSnapshot);
    expect(harness.controller.result.current.activeModules).toHaveLength(1);
    expect(harness.controller.result.current.activeProjectDecisions).toHaveLength(1);
    expect(harness.controller.result.current.isScanning).toBe(false);

    failedScan.resolve(scanSnapshot(failedRequest));
    await act(async () => failedLoad);
    expect(harness.controller.result.current.snapshot).toBe(priorSnapshot);
    expect(harness.controller.result.current.projectSnapshot).toBe(priorProjectSnapshot);
    expect(harness.controller.result.current.activeModules).toHaveLength(1);
    expect(harness.controller.result.current.activeProjectDecisions).toHaveLength(1);
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

  it.each([
    ["configuration only", [], ["ConfiguredMod"], "configured", "none"],
    [
      "combined configuration and recognition",
      activeEvidence,
      ["MyMod"],
      "configured-and-recognized",
      "high",
    ],
  ] as const)(
    "creates active project decisions for %s without changing legacy recognition authority",
    async (_label, observations, roots, source, recognitionConfidence) => {
      const harness = createHarness(
        async (request) => scanSnapshot(request, observations),
        async (request) => ({
          ...request,
          kind: "ready",
          configuration: { version: 1, target: "wotc", moduleRoots: roots },
        }),
      );

      await activate(harness, workspaceOne, 1);

      expect(harness.controller.result.current.projectSnapshot).toMatchObject({
        workspaceId: workspaceOne.id,
        workspaceGeneration: 1,
        activationGeneration: 1,
        configurationReadId: "xcom2-configuration-read:1",
        state: "active",
      });
      expect(harness.controller.result.current.activeProjectDecisions).toEqual([
        expect.objectContaining({
          moduleRoot: roots[0],
          state: "active",
          source,
          activationConfidence: "explicit",
          recognitionConfidence,
        }),
      ]);
      expect(harness.controller.result.current.activeModules).toHaveLength(
        observations.length > 0 ? 1 : 0,
      );
    },
  );

  it("preserves independent recognition activation when configuration is stopped", async () => {
    const harness = createHarness(
      async (request) => scanSnapshot(request, activeEvidence),
      async (request) => ({
        ...request,
        kind: "stopped",
        code: "configuration-invalid-json",
      }),
    );

    await activate(harness, workspaceOne, 1);

    expect(harness.controller.result.current.snapshot?.state).toBe("active");
    expect(harness.controller.result.current.activeModules).toHaveLength(1);
    expect(harness.controller.result.current.projectSnapshot).toMatchObject({
      state: "active",
      diagnostic: { code: "configuration-invalid-json" },
    });
    expect(harness.controller.result.current.activeProjectDecisions).toEqual([
      expect.objectContaining({ moduleRoot: "MyMod", source: "recognized" }),
    ]);
  });

  it("rejects mismatched configuration correlation without revoking valid legacy recognition", async () => {
    const harness = createHarness(
      async (request) => scanSnapshot(request, activeEvidence),
      async (request) => ({
        ...request,
        configurationReadId: `${request.configurationReadId}-stale`,
        kind: "absent",
      }),
    );

    await activate(harness, workspaceOne, 1);

    expect(harness.controller.result.current.snapshot).toBeNull();
    expect(harness.controller.result.current.projectSnapshot).toBeNull();
    expect(harness.controller.result.current.activeProjectDecisions).toEqual([]);
  });

  it("revokes recognition and project snapshots synchronously on explicit refresh and rejects overlap", async () => {
    const staleScan = deferred<Readonly<Xcom2ModuleScanSnapshot>>();
    const staleConfiguration = deferred<Readonly<Xcom2ModuleConfigurationReadResult>>();
    const scan = vi
      .fn<Xcom2ModuleScannerPort["scan"]>()
      .mockImplementationOnce(async (request) => scanSnapshot(request, activeEvidence))
      .mockImplementationOnce(() => staleScan.promise)
      .mockImplementationOnce(async (request) => scanSnapshot(request));
    const read = vi
      .fn<Xcom2ModuleConfigurationPort["read"]>()
      .mockImplementationOnce(async (request) => configurationResult(request))
      .mockImplementationOnce(() => staleConfiguration.promise)
      .mockImplementationOnce(async (request) => configurationResult(request));
    const harness = createHarness(scan, read);
    await activate(harness, workspaceOne, 1);
    expect(harness.controller.result.current.projectSnapshot?.state).toBe("active");

    let staleRefresh!: Promise<void>;
    act(() => {
      staleRefresh = harness.controller.result.current.refreshWorkspace(1, workspaceOne.id);
    });
    expect(harness.controller.result.current.snapshot).toBeNull();
    expect(harness.controller.result.current.projectSnapshot).toBeNull();
    await waitFor(() => expect(harness.scan).toHaveBeenCalledTimes(2));
    const staleScanRequest = harness.scan.mock.calls[1]![0];
    const staleReadRequest = harness.read.mock.calls[1]![0];

    await act(() => harness.controller.result.current.refreshWorkspace(1, workspaceOne.id));
    expect(harness.controller.result.current.projectSnapshot?.state).toBe("inactive");

    staleScan.resolve(scanSnapshot(staleScanRequest, activeEvidence));
    staleConfiguration.resolve(
      configurationResult(staleReadRequest, {
        kind: "ready",
        configuration: { version: 1, target: "wotc", moduleRoots: ["StaleMod"] },
      }),
    );
    await act(async () => staleRefresh);

    expect(harness.controller.result.current.projectSnapshot).toMatchObject({
      activationGeneration: 3,
      scanGeneration: 3,
      state: "inactive",
    });
    expect(harness.controller.result.current.activeProjectDecisions).toEqual([]);
  });

  it("acknowledges only the opaque receipt and selected handles after trusted policy evaluation", async () => {
    const harness = createHarness(
      async (request) => scanSnapshot(request, activeEvidence),
      async (request) => ({
        ...request,
        kind: "ready",
        configuration: { version: 1, target: "wotc", moduleRoots: ["MyMod"] },
      }),
    );

    await activate(harness, workspaceOne, 1);

    expect(harness.begin).toHaveBeenCalledExactlyOnceWith({
      workspaceId: workspaceOne.id,
      workspaceGeneration: 1,
      scanId: "xcom2-module-scan:1",
      scanGeneration: 1,
      configurationReadId: "xcom2-configuration-read:1",
      limits: XCOM2_MODULE_SCAN_LIMITS,
    });
    expect(harness.acknowledge).toHaveBeenCalledOnce();
    const acknowledgment = harness.acknowledge.mock.calls[0]![0];
    expect(Object.keys(acknowledgment)).toEqual(["activationAttemptReceipt", "evidenceHandles"]);
    expect(acknowledgment).toEqual({
      activationAttemptReceipt: "activation-attempt:1",
      evidenceHandles: ["evidence:MyMod"],
    });
    expect(JSON.stringify(acknowledgment)).not.toMatch(/root|path|workspace|generation/iu);
    expect(
      harness.controller.result.current.authorizeBuildRecipeInspection({
        workspaceId: workspaceOne.id,
        generation: 1,
        moduleRoot: "MyMod",
      }),
    ).toEqual({
      kind: "authorized",
      workspaceId: workspaceOne.id,
      generation: 1,
      activationGeneration: 1,
      moduleRoot: "MyMod",
    });
  });

  it("revokes native authority on switch start and cached restoration without restoring it", async () => {
    const harness = createHarness(async (request) => scanSnapshot(request, activeEvidence));
    await activate(harness, workspaceOne, 1);
    const collaborator = harness.controller.result.current.workspaceCollaborator;
    let token!: ReturnType<typeof collaborator.beginWorkspaceSwitch>;

    act(() => {
      token = collaborator.beginWorkspaceSwitch(2);
    });
    expect(
      harness.controller.result.current.authorizeBuildRecipeInspection({
        workspaceId: workspaceOne.id,
        generation: 1,
        moduleRoot: "MyMod",
      }),
    ).toEqual({ kind: "refused", code: "authority-unavailable" });

    act(() => collaborator.restoreWorkspace(token));
    expect(harness.controller.result.current.snapshot?.workspaceId).toBe(workspaceOne.id);
    expect(
      harness.controller.result.current.authorizeBuildRecipeInspection({
        workspaceId: workspaceOne.id,
        generation: 1,
        moduleRoot: "MyMod",
      }),
    ).toEqual({ kind: "refused", code: "authority-unavailable" });
    expect(harness.revoke.mock.calls.map(([event]) => event.kind)).toEqual(
      expect.arrayContaining([
        "workspace-switch-started",
        "workspace-activation-started",
        "newer-activation-generation",
        "workspace-activation-failed",
        "cached-react-restoration",
      ]),
    );
  });

  it("revokes synchronously when an enclosing explicit refresh fails", async () => {
    const harness = createHarness(async (request) => scanSnapshot(request, activeEvidence));
    await activate(harness, workspaceOne, 1);

    act(() =>
      harness.controller.result.current.workspaceCollaborator.settleFailedWorkspaceRefresh(
        1,
        workspaceOne.id,
      ),
    );

    expect(harness.controller.result.current.snapshot).toBeNull();
    expect(
      harness.controller.result.current.authorizeBuildRecipeInspection({
        workspaceId: workspaceOne.id,
        generation: 1,
        moduleRoot: "MyMod",
      }),
    ).toEqual({ kind: "refused", code: "authority-unavailable" });
    expect(harness.revoke).toHaveBeenCalledWith({ kind: "workspace-activation-failed" });
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
    await waitFor(() => expect(harness.scan).toHaveBeenCalledOnce());
    const request = harness.scan.mock.calls[0]![0];

    harness.controller.unmount();
    pending.resolve(scanSnapshot(request, activeEvidence));
    await expect(load).resolves.toBeUndefined();
  });
});
