import type {
  ApplyRefactorKitPlanResult,
  FileNode,
  PreviewExternalJavaImportRequest,
  RefactorKitCapabilities,
  RefactorKitPatchPlan,
} from "@ide/contracts";
import type { ClipboardPort, RefactorKitPort } from "@ide/web-core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REFACTOR_KIT_IMPORT_UNAVAILABLE,
  useRefactorKitImportController,
} from "./useRefactorKitImportController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const folder = (path: string): FileNode => ({
  id: path,
  name: path.split("/").pop() ?? path,
  path,
  type: "folder",
  children: [],
});

const file = (path: string): FileNode => ({
  id: path,
  name: path.split("/").pop() ?? path,
  path,
  type: "file",
});

const capabilities: RefactorKitCapabilities = {
  api: "RefactorKit",
  apiVersion: "0.3",
  provider: "refactorkit",
  providerVersion: "0.3.0",
  javaImportExternalClass: {
    supported: true,
    targetDirectory: true,
    preview: true,
    apply: true,
    rollback: true,
    stability: "preview",
  },
};

function planFor(
  request: PreviewExternalJavaImportRequest,
  overrides: Partial<RefactorKitPatchPlan> = {},
): RefactorKitPatchPlan {
  return {
    planId: `plan-${request.requestId}`,
    status: "ready",
    summary: "Create Imported.java",
    confidence: 0.98,
    riskLevel: "low",
    evidence: [],
    affectedFiles: [
      { change: "create", path: `${request.targetDirectory}/Imported.java`, primary: true },
    ],
    placement: { packageName: null, sourceRoot: null, moduleName: null },
    packageChanges: [],
    renderedDiff: "reviewed diff",
    structuredDiff: [],
    warnings: [],
    diagnosticsAfterPreview: [],
    provenance: {
      sourceKind: "clipboard",
      sourceUrl: null,
      detectedLicense: null,
      licensePolicy: "warn",
      notices: [],
    },
    unresolvedDependencies: [],
    conflicts: [],
    refusalReasons: [],
    applyEligibility: { eligible: true, blockers: [] },
    staleness: { stale: false, reasons: [] },
    provider: "refactorkit",
    providerVersion: "0.3.0",
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    selectionGeneration: request.selectionGeneration,
    requestId: request.requestId,
    ...overrides,
  };
}

function resultFor(
  patchPlan: RefactorKitPatchPlan,
  overrides: Partial<ApplyRefactorKitPlanResult> = {},
): ApplyRefactorKitPlanResult {
  return {
    transactionId: "tx-import-1",
    planId: patchPlan.planId,
    changedFiles: patchPlan.affectedFiles,
    primaryFile: patchPlan.affectedFiles.find((changed) => changed.primary)?.path ?? null,
    diagnostics: [],
    provider: "refactorkit",
    providerVersion: "0.3.0",
    ...overrides,
  };
}

function createHarness(source = "private clipboard Java source") {
  const order: string[] = [];
  const readText = vi.fn(async () => {
    order.push("clipboard");
    return source;
  });
  const getCapabilities = vi.fn(async () => {
    order.push("capability");
    return capabilities;
  });
  const previewExternalJavaImport = vi.fn(async (request: PreviewExternalJavaImportRequest) => {
    order.push("preview");
    return planFor(request);
  });
  const applyPlan = vi.fn(async (request: Parameters<RefactorKitPort["applyPlan"]>[0]) => {
    const previewRequest = previewExternalJavaImport.mock.calls
      .map(([candidate]) => candidate)
      .find((candidate) => `plan-${candidate.requestId}` === request.planId);
    if (!previewRequest) throw new Error("missing preview fixture");
    return resultFor(planFor(previewRequest));
  });
  const discardPlan = vi.fn(async (request: Parameters<RefactorKitPort["discardPlan"]>[0]) => ({
    planId: request.planId,
    discarded: true,
  }));
  const refactorKit = {
    getCapabilities,
    previewExternalJavaImport,
    applyPlan,
    discardPlan,
  } as unknown as RefactorKitPort;
  const clipboard: ClipboardPort = { readText };
  const refreshDirectory = vi.fn(async (_path: string): Promise<void> => undefined);
  const loadRoot = vi.fn(async (): Promise<void> => undefined);
  const openResultFile = vi.fn(async (_node: FileNode): Promise<void> => undefined);

  return {
    source,
    order,
    clipboard,
    refactorKit,
    readText,
    getCapabilities,
    previewExternalJavaImport,
    applyPlan,
    discardPlan,
    refreshDirectory,
    loadRoot,
    openResultFile,
  };
}

function renderController(
  harness: ReturnType<typeof createHarness>,
  workspaceId = "workspace-one",
  getWorkspaceGeneration?: () => number,
) {
  return renderHook(
    ({ currentWorkspaceId }) =>
      useRefactorKitImportController({
        clipboard: harness.clipboard,
        refactorKit: harness.refactorKit,
        fileTree: {
          refreshDirectory: harness.refreshDirectory,
          loadRoot: harness.loadRoot,
        },
        workspaceId: currentWorkspaceId,
        getWorkspaceGeneration,
        openResultFile: harness.openResultFile,
      }),
    { initialProps: { currentWorkspaceId: workspaceId as string | null } },
  );
}

async function previewReady(
  controller: ReturnType<typeof renderController>,
  target = folder("src/main/java"),
) {
  let pending!: Promise<void>;
  act(() => {
    pending = controller.result.current.previewFromClipboard(target);
  });
  expect(controller.result.current.dialog).toMatchObject({
    status: "loading",
    targetDirectory: target.path,
  });
  await act(async () => pending);
  expect(controller.result.current.dialog).toMatchObject({ status: "preview" });
  return controller.result.current.dialog!.plan!;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useRefactorKitImportController", () => {
  it("maps capability unavailability before clipboard access at the desktop boundary", async () => {
    const harness = createHarness();
    harness.getCapabilities.mockResolvedValueOnce({
      ...capabilities,
      javaImportExternalClass: { ...capabilities.javaImportExternalClass, preview: false },
    });
    const controller = renderController(harness);

    await act(() => controller.result.current.previewFromClipboard(folder("src")));

    expect(controller.result.current.dialog).toEqual(
      expect.objectContaining({
        status: "unavailable",
        message: REFACTOR_KIT_IMPORT_UNAVAILABLE,
        plan: null,
      }),
    );
    expect(harness.getCapabilities).toHaveBeenCalledOnce();
    expect(harness.readText).not.toHaveBeenCalled();
    expect(harness.previewExternalJavaImport).not.toHaveBeenCalled();
    expect(JSON.stringify(controller.result.current.dialog)).not.toContain(harness.source);
  });

  it("previews and applies only the displayed plan with source-free approval", async () => {
    const harness = createHarness();
    const refresh = deferred<void>();
    harness.refreshDirectory.mockReturnValueOnce(refresh.promise);
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);

    expect(harness.order).toEqual(["capability", "clipboard", "preview"]);
    expect(harness.previewExternalJavaImport).toHaveBeenCalledWith(
      expect.objectContaining({
        code: harness.source,
        targetDirectory: "src/main/java",
        workspaceId: "workspace-one",
        sourceKind: "clipboard",
      }),
    );
    expect(controller.result.current.dialog).not.toHaveProperty("code");

    await act(() =>
      controller.result.current.applyDisplayedPlan({ ...displayedPlan, planId: "stale-plan" }),
    );
    expect(harness.applyPlan).not.toHaveBeenCalled();
    expect(controller.result.current.dialog?.status).toBe("preview");

    let applying!: Promise<void>;
    act(() => {
      applying = controller.result.current.applyDisplayedPlan(displayedPlan);
    });
    expect(controller.result.current.dialog?.status).toBe("applying");
    await waitFor(() => expect(controller.result.current.dialog?.status).toBe("applied"));
    expect(controller.result.current.successMessage).toContain("tx-import-1");

    const applyRequest = harness.applyPlan.mock.calls[0][0];
    expect(applyRequest).toEqual({
      planId: displayedPlan.planId,
      workspaceId: "workspace-one",
      workspaceGeneration: displayedPlan.workspaceGeneration,
      selectionGeneration: 1,
      requestId: displayedPlan.requestId,
      approval: {
        approvalId: `desktop-approval-${displayedPlan.requestId}`,
        approvedPlanId: displayedPlan.planId,
        approvedAt: expect.any(String),
      },
    });
    expect(applyRequest).not.toHaveProperty("code");
    expect(applyRequest).not.toHaveProperty("targetDirectory");
    expect(JSON.stringify(applyRequest)).not.toContain(harness.source);

    refresh.resolve();
    await act(async () => applying);
    expect(harness.openResultFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/main/java/Imported.java", type: "file" }),
    );
    expect(harness.discardPlan).not.toHaveBeenCalled();
  });

  it("cancels synchronously and discards the retained plan with exact source-free tokens", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller, folder("src"));

    act(() => controller.result.current.cancel());
    act(() => controller.result.current.cancel());

    expect(controller.result.current.dialog).toBeNull();
    expect(harness.discardPlan).toHaveBeenCalledOnce();
    const discardRequest = harness.discardPlan.mock.calls[0][0];
    expect(discardRequest).toEqual({
      planId: displayedPlan.planId,
      workspaceId: displayedPlan.workspaceId,
      workspaceGeneration: displayedPlan.workspaceGeneration,
      selectionGeneration: displayedPlan.selectionGeneration,
      requestId: displayedPlan.requestId,
    });
    expect(Object.keys(discardRequest).sort()).toEqual([
      "planId",
      "requestId",
      "selectionGeneration",
      "workspaceGeneration",
      "workspaceId",
    ]);
    expect(JSON.stringify(discardRequest)).not.toContain(harness.source);
    expect(harness.applyPlan).not.toHaveBeenCalled();
  });

  it("ignores a late preview after selection changes and discards its backend plan", async () => {
    const harness = createHarness();
    const backend = deferred<RefactorKitPatchPlan>();
    harness.previewExternalJavaImport.mockImplementationOnce(() => backend.promise);
    const controller = renderController(harness);

    let preview!: Promise<void>;
    act(() => {
      preview = controller.result.current.previewFromClipboard(folder("src"));
    });
    await waitFor(() => expect(harness.previewExternalJavaImport).toHaveBeenCalledOnce());
    const request = harness.previewExternalJavaImport.mock.calls[0][0];

    act(() => controller.result.current.selectDirectory(folder("lib")));
    expect(controller.result.current.selectedDirectoryPath).toBe("lib");
    expect(controller.result.current.dialog).toBeNull();

    backend.resolve(planFor(request));
    await act(async () => preview);

    expect(controller.result.current.dialog).toBeNull();
    expect(harness.discardPlan).toHaveBeenCalledWith({
      planId: `plan-${request.requestId}`,
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
    });
    expect(harness.applyPlan).not.toHaveBeenCalled();
  });

  it("starts native-valid, advances workspace generation monotonically, and suppresses stale completion", async () => {
    const harness = createHarness();
    const oldBackend = deferred<RefactorKitPatchPlan>();
    harness.previewExternalJavaImport.mockImplementationOnce(() => oldBackend.promise);
    const controller = renderController(harness);

    let oldPreview!: Promise<void>;
    act(() => {
      oldPreview = controller.result.current.previewFromClipboard(folder("src"));
    });
    await waitFor(() => expect(harness.previewExternalJavaImport).toHaveBeenCalledOnce());
    const oldRequest = harness.previewExternalJavaImport.mock.calls[0][0];
    expect(Number.isSafeInteger(oldRequest.workspaceGeneration)).toBe(true);
    expect(oldRequest.workspaceGeneration).toBeGreaterThan(0);

    act(() => {
      controller.result.current.resetWorkspace();
      controller.rerender({ currentWorkspaceId: "workspace-two" });
    });
    expect(controller.result.current.selectedDirectoryPath).toBeNull();
    expect(controller.result.current.focusedDirectoryPath).toBeNull();
    expect(controller.result.current.dialog).toBeNull();

    oldBackend.resolve(planFor(oldRequest));
    await act(async () => oldPreview);
    expect(controller.result.current.dialog).toBeNull();
    expect(harness.discardPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: `plan-${oldRequest.requestId}`,
        workspaceGeneration: oldRequest.workspaceGeneration,
        requestId: oldRequest.requestId,
      }),
    );

    await act(() => controller.result.current.previewFromClipboard(folder("next")));
    const nextRequest = harness.previewExternalJavaImport.mock.calls[1][0];
    expect(nextRequest).toMatchObject({
      workspaceId: "workspace-two",
      selectionGeneration: 3,
    });
    expect(nextRequest.workspaceGeneration).toBe(oldRequest.workspaceGeneration + 1);
    expect(nextRequest.requestId).not.toBe(oldRequest.requestId);
    expect(controller.result.current.dialog?.selection).toEqual(
      expect.objectContaining({ requestId: nextRequest.requestId }),
    );
  });

  it("rejects and discards a late preview when the shared workspace generation advances", async () => {
    const harness = createHarness();
    const backend = deferred<RefactorKitPatchPlan>();
    harness.previewExternalJavaImport.mockImplementationOnce(() => backend.promise);
    let workspaceGeneration = 17;
    const controller = renderController(harness, "workspace-one", () => workspaceGeneration);

    let preview!: Promise<void>;
    act(() => {
      preview = controller.result.current.previewFromClipboard(folder("src"));
    });
    await waitFor(() => expect(harness.previewExternalJavaImport).toHaveBeenCalledOnce());
    const request = harness.previewExternalJavaImport.mock.calls[0][0];
    expect(request.workspaceGeneration).toBe(17);

    workspaceGeneration = 18;
    backend.resolve(planFor(request));
    await act(async () => preview);

    expect(controller.result.current.dialog).toBeNull();
    expect(harness.discardPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: `plan-${request.requestId}`,
        workspaceGeneration: 17,
        requestId: request.requestId,
      }),
    );
    expect(harness.applyPlan).not.toHaveBeenCalled();
  });

  it("keeps only the newest operation and request when previews overlap", async () => {
    const harness = createHarness();
    const firstBackend = deferred<RefactorKitPatchPlan>();
    harness.previewExternalJavaImport.mockImplementationOnce(() => firstBackend.promise);
    const controller = renderController(harness);

    let firstPreview!: Promise<void>;
    act(() => {
      firstPreview = controller.result.current.previewFromClipboard(folder("src"));
    });
    await waitFor(() => expect(harness.previewExternalJavaImport).toHaveBeenCalledOnce());
    const firstRequest = harness.previewExternalJavaImport.mock.calls[0][0];

    await act(() => controller.result.current.previewFromClipboard(folder("src")));
    const secondRequest = harness.previewExternalJavaImport.mock.calls[1][0];
    expect(secondRequest.requestId).not.toBe(firstRequest.requestId);
    expect(controller.result.current.dialog).toMatchObject({
      status: "preview",
      plan: { planId: `plan-${secondRequest.requestId}` },
    });

    firstBackend.resolve(planFor(firstRequest));
    await act(async () => firstPreview);

    expect(controller.result.current.dialog).toMatchObject({
      status: "preview",
      selection: { requestId: secondRequest.requestId },
      plan: { planId: `plan-${secondRequest.requestId}` },
    });
    expect(harness.discardPlan).toHaveBeenCalledWith(
      expect.objectContaining({ planId: `plan-${firstRequest.requestId}` }),
    );
  });

  it("maps stale backend request evidence to a non-applicable refusal", async () => {
    const harness = createHarness();
    harness.previewExternalJavaImport.mockImplementationOnce(async (request) =>
      planFor(request, { requestId: "other-request" }),
    );
    const controller = renderController(harness);

    await act(() => controller.result.current.previewFromClipboard(folder("src")));

    expect(controller.result.current.dialog).toMatchObject({
      status: "refused",
      plan: null,
      message: "RefactorKit returned a plan for a stale workspace selection.",
    });
    const stalePlan = planFor(harness.previewExternalJavaImport.mock.calls[0][0]);
    await act(() => controller.result.current.applyDisplayedPlan(stalePlan));
    expect(harness.applyPlan).not.toHaveBeenCalled();
  });

  it("ignores a late apply after cancellation and performs no refresh or open", async () => {
    const harness = createHarness();
    const backendApply = deferred<ApplyRefactorKitPlanResult>();
    harness.applyPlan.mockImplementationOnce(() => backendApply.promise);
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);

    let applying!: Promise<void>;
    act(() => {
      applying = controller.result.current.applyDisplayedPlan(displayedPlan);
    });
    expect(controller.result.current.dialog?.status).toBe("applying");
    act(() => controller.result.current.cancel());
    expect(controller.result.current.dialog).toBeNull();

    backendApply.resolve(resultFor(displayedPlan));
    await act(async () => applying);

    expect(controller.result.current.dialog).toBeNull();
    expect(controller.result.current.successMessage).toBeNull();
    expect(harness.refreshDirectory).not.toHaveBeenCalled();
    expect(harness.loadRoot).not.toHaveBeenCalled();
    expect(harness.openResultFile).not.toHaveBeenCalled();
  });

  it("invalidates on unmount, discards a late plan, and does not continue collaborators", async () => {
    const harness = createHarness();
    const backend = deferred<RefactorKitPatchPlan>();
    harness.previewExternalJavaImport.mockImplementationOnce(() => backend.promise);
    const controller = renderController(harness);

    let preview!: Promise<void>;
    act(() => {
      preview = controller.result.current.previewFromClipboard(folder("src"));
    });
    await waitFor(() => expect(harness.previewExternalJavaImport).toHaveBeenCalledOnce());
    const request = harness.previewExternalJavaImport.mock.calls[0][0];
    controller.unmount();

    backend.resolve(planFor(request));
    await preview;

    expect(harness.discardPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: `plan-${request.requestId}`,
        requestId: request.requestId,
      }),
    );
    expect(harness.applyPlan).not.toHaveBeenCalled();
    expect(harness.refreshDirectory).not.toHaveBeenCalled();
    expect(harness.openResultFile).not.toHaveBeenCalled();
  });

  it("refreshes deduplicated changed parents and root, then opens only the primary result", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);
    harness.applyPlan.mockResolvedValueOnce(
      resultFor(displayedPlan, {
        changedFiles: [
          { change: "create", path: "Root.java", primary: false },
          { change: "edit", path: "src/one/A.java", primary: false },
          { change: "edit", path: "src/one/B.java", primary: true },
          {
            change: "move",
            path: "generated/new/C.java",
            previousPath: "legacy/old/C.java",
            primary: false,
          },
        ],
        primaryFile: null,
      }),
    );

    await act(() => controller.result.current.applyDisplayedPlan(displayedPlan));

    expect(harness.refreshDirectory.mock.calls.map(([path]) => path)).toEqual([
      "src/one",
      "generated/new",
      "legacy/old",
    ]);
    expect(harness.loadRoot).toHaveBeenCalledOnce();
    expect(harness.openResultFile).toHaveBeenCalledOnce();
    expect(harness.openResultFile).toHaveBeenCalledWith({
      id: "src/one/B.java",
      name: "src/one/B.java",
      path: "src/one/B.java",
      type: "file",
    });
  });

  it("falls back to a root refresh when a branch refresh fails", async () => {
    const harness = createHarness();
    harness.refreshDirectory.mockRejectedValueOnce(new Error("tree refresh failed"));
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);

    await act(() => controller.result.current.applyDisplayedPlan(displayedPlan));

    expect(harness.refreshDirectory).toHaveBeenCalledWith("src/main/java");
    expect(harness.loadRoot).toHaveBeenCalledOnce();
    expect(harness.openResultFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/main/java/Imported.java" }),
    );
  });

  it("does not open the primary result when the operation becomes stale during refresh", async () => {
    const harness = createHarness();
    const refresh = deferred<void>();
    harness.refreshDirectory.mockReturnValueOnce(refresh.promise);
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);

    let applying!: Promise<void>;
    act(() => {
      applying = controller.result.current.applyDisplayedPlan(displayedPlan);
    });
    await waitFor(() => expect(harness.refreshDirectory).toHaveBeenCalledOnce());
    expect(controller.result.current.dialog?.status).toBe("applied");

    act(() => controller.result.current.resetWorkspace());
    refresh.resolve();
    await act(async () => applying);

    expect(controller.result.current.dialog).toBeNull();
    expect(controller.result.current.successMessage).toBeNull();
    expect(harness.openResultFile).not.toHaveBeenCalled();
  });

  it("tracks folder selection and focus while ignoring file nodes", () => {
    const harness = createHarness();
    const controller = renderController(harness);

    act(() => {
      controller.result.current.selectDirectory(file("src/Main.java"));
      controller.result.current.focusDirectory(file("src/Main.java"));
    });
    expect(controller.result.current.selectedDirectoryPath).toBeNull();
    expect(controller.result.current.focusedDirectoryPath).toBeNull();

    act(() => {
      controller.result.current.selectDirectory(folder("src"));
      controller.result.current.focusDirectory(folder("lib"));
    });
    expect(controller.result.current.selectedDirectoryPath).toBe("src");
    expect(controller.result.current.getSelectedDirectoryPath()).toBe("src");
    expect(controller.result.current.focusedDirectoryPath).toBe("lib");
  });
});
