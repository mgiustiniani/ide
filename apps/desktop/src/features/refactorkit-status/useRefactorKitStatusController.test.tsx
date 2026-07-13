import type { RefactorKitCapabilities, RefactorKitStatus } from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core/ports";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRefactorKitStatusController } from "./useRefactorKitStatusController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const readyStatus: RefactorKitStatus = {
  available: true,
  version: "0.6.0-SNAPSHOT",
  path: "/redacted/refactorkit",
  checkedAt: "2026-07-13T00:00:00.000Z",
};

const availableCapabilities: RefactorKitCapabilities = {
  api: "refactorkit-language-kernel",
  apiVersion: "1",
  provider: "provider-neutral-test-double",
  providerVersion: "future-version-with-no-implied-support",
  javaImportExternalClass: {
    supported: false,
    targetDirectory: false,
    preview: false,
    apply: false,
    rollback: false,
    stability: "experimental",
  },
  languageKernel: {
    available: true,
    schema: {
      schemaVersion: 1,
      adapters: [],
      vocabulary: {
        stability: ["stable", "experimental", "structural", "refused", "not-applicable"],
        evidence: [
          "compiler",
          "language-server",
          "native-ast",
          "structural-parse",
          "lexical",
          "none",
        ],
        mutationAuthority: ["managed-stable", "proposal-only", "none"],
        executionMode: ["in-process", "external-process"],
      },
    },
  },
  safety: {
    previewBeforeApply: false,
    snapshotValidation: false,
    transactionRollback: false,
    workspaceScopedWrites: false,
  },
};

const unavailableReason = "Adapter reports language-kernel metadata unavailable.";
const unavailableCapabilities: RefactorKitCapabilities = {
  api: "refactorkit",
  apiVersion: "9999-ready-looking",
  provider: "provider-neutral-test-double",
  providerVersion: "9999-ready-looking",
  javaImportExternalClass: {
    supported: false,
    targetDirectory: false,
    preview: false,
    apply: false,
    rollback: false,
    stability: "experimental",
  },
  languageKernel: {
    available: false,
    schema: null,
    reason: unavailableReason,
  },
};

function createPort(
  status: RefactorKitStatus = readyStatus,
  capabilities: RefactorKitCapabilities = availableCapabilities,
) {
  const getStatus = vi.fn(async (): Promise<RefactorKitStatus> => status);
  const getCapabilities = vi.fn(async (): Promise<RefactorKitCapabilities> => capabilities);
  const refactorKit = { getStatus, getCapabilities } as unknown as RefactorKitPort;
  return { refactorKit, getStatus, getCapabilities };
}

function renderController(port: ReturnType<typeof createPort>) {
  return renderHook(() => useRefactorKitStatusController({ refactorKit: port.refactorKit }));
}

async function waitForInitialCheck(controller: ReturnType<typeof renderController>) {
  await waitFor(() => expect(controller.result.current.isChecking).toBe(false));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useRefactorKitStatusController", () => {
  it("starts the initial status and capability check together and settles successful results", async () => {
    const statusGate = deferred<RefactorKitStatus>();
    const capabilitiesGate = deferred<RefactorKitCapabilities>();
    const port = createPort();
    port.getStatus.mockImplementationOnce(() => statusGate.promise);
    port.getCapabilities.mockImplementationOnce(() => capabilitiesGate.promise);

    const controller = renderController(port);

    expect(controller.result.current).toMatchObject({
      status: null,
      capabilities: null,
      isChecking: true,
      error: null,
    });
    await waitFor(() => expect(port.getStatus).toHaveBeenCalledOnce());
    expect(port.getCapabilities).toHaveBeenCalledOnce();
    expect(controller.result.current.isChecking).toBe(true);

    statusGate.resolve(readyStatus);
    capabilitiesGate.resolve(availableCapabilities);
    await waitForInitialCheck(controller);

    expect(controller.result.current.status).toBe(readyStatus);
    expect(controller.result.current.capabilities).toBe(availableCapabilities);
    expect(controller.result.current.error).toBeNull();
  });

  it("keeps fulfilled capabilities when daemon status rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const port = createPort();
    port.getStatus.mockRejectedValueOnce(new Error("private source: class SecretStatus {}"));

    const controller = renderController(port);
    await waitForInitialCheck(controller);

    expect(controller.result.current.status).toBeNull();
    expect(controller.result.current.capabilities).toBe(availableCapabilities);
    expect(controller.result.current.error).toBe("Unable to check RefactorKit availability.");
    expect(consoleError).toHaveBeenCalledWith("[App] Failed to load RefactorKit status.");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("SecretStatus");
  });

  it("retains fulfilled daemon status when malformed capability discovery rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const updatedStatus = { ...readyStatus, version: "0.6.1" };
    const port = createPort(updatedStatus);
    port.getCapabilities.mockRejectedValueOnce(
      new Error("malformed metadata from /private/workspace/Secret.java: class Secret {}"),
    );

    const controller = renderController(port);
    await waitForInitialCheck(controller);

    expect(controller.result.current.status).toEqual(updatedStatus);
    expect(controller.result.current.capabilities).toBeNull();
    expect(controller.result.current.error).toBe(
      "Unable to load RefactorKit capability discovery.",
    );
    expect(consoleError).toHaveBeenCalledWith("[App] Failed to load RefactorKit capabilities.");
    expect(JSON.stringify(controller.result.current.error)).not.toContain("Secret");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("Secret");
  });

  it("clears static diagnostic errors while a refresh checks again and recovers", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const port = createPort();
    port.getStatus.mockRejectedValueOnce(new Error("status source secret"));
    port.getCapabilities.mockRejectedValueOnce(new Error("capability source secret"));
    const controller = renderController(port);
    await waitForInitialCheck(controller);

    expect(controller.result.current.error).toBe(
      "Unable to check RefactorKit availability. Unable to load RefactorKit capability discovery.",
    );
    expect(consoleError.mock.calls).toEqual([
      ["[App] Failed to load RefactorKit status."],
      ["[App] Failed to load RefactorKit capabilities."],
    ]);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("source secret");

    const statusGate = deferred<RefactorKitStatus>();
    const capabilitiesGate = deferred<RefactorKitCapabilities>();
    port.getStatus.mockImplementationOnce(() => statusGate.promise);
    port.getCapabilities.mockImplementationOnce(() => capabilitiesGate.promise);

    let refresh!: Promise<void>;
    act(() => {
      refresh = controller.result.current.refresh();
    });
    expect(controller.result.current.isChecking).toBe(true);
    expect(controller.result.current.error).toBeNull();

    statusGate.resolve(readyStatus);
    capabilitiesGate.resolve(availableCapabilities);
    await act(async () => refresh);

    expect(controller.result.current).toMatchObject({
      status: readyStatus,
      capabilities: availableCapabilities,
      isChecking: false,
      error: null,
    });
  });

  it("passes through honest adapter-normalized unavailability without inferring readiness", async () => {
    const port = createPort(
      { available: false, lastError: "Adapter reports daemon unavailable." },
      unavailableCapabilities,
    );
    const controller = renderController(port);
    await waitForInitialCheck(controller);

    expect(controller.result.current.capabilities).toBe(unavailableCapabilities);
    expect(controller.result.current.capabilities).toEqual({
      ...unavailableCapabilities,
      javaImportExternalClass: expect.objectContaining({
        supported: false,
        preview: false,
        apply: false,
        rollback: false,
      }),
      languageKernel: {
        available: false,
        schema: null,
        reason: unavailableReason,
      },
    });
    expect(controller.result.current.status?.available).toBe(false);
    expect(controller.result.current.error).toBeNull();
  });

  it("ignores both halves of an older request when same-generation refreshes race", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const port = createPort();
    const controller = renderController(port);
    await waitForInitialCheck(controller);

    const staleStatus = deferred<RefactorKitStatus>();
    const staleCapabilities = deferred<RefactorKitCapabilities>();
    port.getStatus.mockImplementationOnce(() => staleStatus.promise);
    port.getCapabilities.mockImplementationOnce(() => staleCapabilities.promise);

    let staleRefresh!: Promise<void>;
    act(() => {
      staleRefresh = controller.result.current.refresh();
    });
    await waitFor(() => expect(port.getStatus).toHaveBeenCalledTimes(2));

    const currentStatus = { ...readyStatus, version: "current-2.0.0" };
    const currentCapabilities = {
      ...availableCapabilities,
      providerVersion: "current-provider",
    };
    port.getStatus.mockResolvedValueOnce(currentStatus);
    port.getCapabilities.mockResolvedValueOnce(currentCapabilities);
    await act(() => controller.result.current.refresh());

    staleStatus.reject(new Error("stale private status source"));
    staleCapabilities.reject(new Error("stale private capability source"));
    await act(async () => staleRefresh);

    expect(controller.result.current.status).toEqual(currentStatus);
    expect(controller.result.current.capabilities).toEqual(currentCapabilities);
    expect(controller.result.current.error).toBeNull();
    expect(controller.result.current.isChecking).toBe(false);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("invalidates stale workspace responses and loads only the collaborator generation", async () => {
    const port = createPort();
    const controller = renderController(port);
    await waitForInitialCheck(controller);

    const staleStatus = deferred<RefactorKitStatus>();
    const staleCapabilities = deferred<RefactorKitCapabilities>();
    port.getStatus.mockImplementationOnce(() => staleStatus.promise);
    port.getCapabilities.mockImplementationOnce(() => staleCapabilities.promise);
    let staleRefresh!: Promise<void>;
    act(() => {
      staleRefresh = controller.result.current.refresh();
    });

    const workspaceGeneration = 42;
    let collaboratorGeneration!: number;
    act(() => {
      collaboratorGeneration =
        controller.result.current.workspaceCollaborator.beginWorkspaceSwitch(workspaceGeneration);
    });
    expect(collaboratorGeneration).toBe(workspaceGeneration);
    expect(controller.result.current).toMatchObject({
      status: null,
      capabilities: null,
      isChecking: true,
      error: null,
    });

    const currentStatus = { ...readyStatus, version: "workspace-42" };
    const currentCapabilities = {
      ...availableCapabilities,
      providerVersion: "workspace-42-provider",
    };
    port.getStatus.mockResolvedValueOnce(currentStatus);
    port.getCapabilities.mockResolvedValueOnce(currentCapabilities);
    await act(() => controller.result.current.workspaceCollaborator.load(collaboratorGeneration));

    staleStatus.resolve({ ...readyStatus, version: "stale-workspace" });
    staleCapabilities.resolve({ ...availableCapabilities, providerVersion: "stale-workspace" });
    await act(async () => staleRefresh);

    expect(controller.result.current.status).toEqual(currentStatus);
    expect(controller.result.current.capabilities).toEqual(currentCapabilities);
    expect(controller.result.current.isChecking).toBe(false);
    expect(controller.result.current.error).toBeNull();
  });

  it("settles failed workspace loading only for the current collaborator generation", async () => {
    const port = createPort();
    const controller = renderController(port);
    await waitForInitialCheck(controller);

    let currentGeneration!: number;
    act(() => {
      currentGeneration = controller.result.current.workspaceCollaborator.beginWorkspaceSwitch(73);
    });
    expect(controller.result.current.status).toBeNull();
    expect(controller.result.current.capabilities).toBeNull();
    expect(controller.result.current.isChecking).toBe(true);

    act(() => {
      controller.result.current.workspaceCollaborator.settleFailedWorkspaceSwitch(72);
    });
    expect(controller.result.current.isChecking).toBe(true);

    act(() => {
      controller.result.current.workspaceCollaborator.settleFailedWorkspaceSwitch(
        currentGeneration,
      );
    });
    expect(controller.result.current.isChecking).toBe(false);
  });
});
