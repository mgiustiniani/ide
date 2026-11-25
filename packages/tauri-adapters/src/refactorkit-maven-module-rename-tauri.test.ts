import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriRefactorKitAdapter } from "./refactorkit-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const request = {
  oldModuleDir: "catalog-model",
  newModuleDir: "catalog-domain",
  expectedSnapshotHash: "a".repeat(64),
  expectedContextHash: "b".repeat(64),
  newArtifactId: "catalog-domain",
  workspaceId: "workspace:authorized",
  workspaceGeneration: 7,
  selectionGeneration: 9,
  requestId: "module-rename-r1",
};
const preview = {
  planId: "module-plan-1",
  operation: "java.renameMavenModule",
  status: "preview",
  summary: "Rename catalog-model to catalog-domain",
  snapshotHash: "a".repeat(64),
  affectedFiles: ["pom.xml", "catalog-model/pom.xml"],
  renderedDiff: "--- a/pom.xml\n+++ b/pom.xml\n",
  diffTruncated: false,
  diffTruncationReasons: [],
  provider: "refactorkit-java",
  providerVersion: "0.8.0-SNAPSHOT",
  workspaceId: request.workspaceId,
  workspaceGeneration: request.workspaceGeneration,
  selectionGeneration: request.selectionGeneration,
  requestId: request.requestId,
};

function engineCapabilities() {
  return {
    engineDiscovered: true,
    operations: ["rename-class"],
    operationalSurface: [],
    rollbackAdvertised: true,
    previewReadOnly: true,
    path: "/usr/local/bin/refactorkit",
    version: "0.8.0-SNAPSHOT",
    workspaceId: "workspace:authorized",
    reason: null,
  };
}

function baseCapabilities(methods: unknown[]) {
  return {
    api: "refactorkit",
    apiVersion: "0.2",
    provider: "refactorkit-daemon",
    providerVersion: "0.8.0-SNAPSHOT",
    javaImportExternalClass: {
      supported: false,
      targetDirectory: false,
      preview: false,
      apply: false,
      rollback: false,
      stability: "experimental",
    },
    methods,
  };
}

const method = {
  name: "java.renameMavenModule",
  stability: "experimental",
  requiresProject: true,
  writesWorkspace: false,
  features: { preview: true, renderedDiff: true, apply: true, rollback: true },
};

describe("TauriRefactorKitAdapter Maven module rename preview", () => {
  beforeEach(() => invokeMock.mockReset());

  it("requires the exact provider capability and normalizes a correlated preview", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilities());
    invokeMock.mockResolvedValueOnce(baseCapabilities([method]));
    invokeMock.mockResolvedValueOnce(preview);

    await expect(new TauriRefactorKitAdapter().previewMavenModuleRename(request)).resolves.toEqual(
      preview,
    );
    expect(invokeMock.mock.calls).toEqual([
      ["get_refactorkit_engine_capabilities", undefined],
      ["get_refactorkit_capabilities", undefined],
      ["preview_refactorkit_maven_module_rename", { request }],
    ]);
  });

  it("rejects an unadvertised preview before invoking the operation", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilities());
    invokeMock.mockResolvedValueOnce(baseCapabilities([]));

    await expect(
      new TauriRefactorKitAdapter().previewMavenModuleRename(request),
    ).rejects.toMatchObject({
      command: "preview_refactorkit_maven_module_rename",
      cause: undefined,
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("requires an explicit nested-directory capability before sending a nested path", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilities());
    invokeMock.mockResolvedValueOnce(baseCapabilities([method]));

    await expect(new TauriRefactorKitAdapter().previewMavenModuleRename({
      ...request,
      newModuleDir: "components/catalog-model",
      newArtifactId: undefined,
    })).rejects.toThrow("direct children of the reactor root");
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a preview bound to a different saved-project snapshot", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilities());
    invokeMock.mockResolvedValueOnce(baseCapabilities([method]));
    invokeMock.mockResolvedValueOnce({ ...preview, snapshotHash: "c".repeat(64) });

    await expect(
      new TauriRefactorKitAdapter().previewMavenModuleRename(request),
    ).rejects.toMatchObject({ command: "preview_refactorkit_maven_module_rename" });
  });

  it("reports preview failure as preview failure rather than a rollback failure", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilities());
    invokeMock.mockResolvedValueOnce(baseCapabilities([method]));
    invokeMock.mockRejectedValueOnce("provider error");

    const result = new TauriRefactorKitAdapter().previewMavenModuleRename(request);
    await expect(result).rejects.toThrow("RefactorKit could not preview the Maven module rename.");
    await expect(result).rejects.toMatchObject({
      command: "preview_refactorkit_maven_module_rename",
      code: "REFACTORKIT_PREVIEW_FAILED",
    });
  });

  it.each([
    [
      "destination refusal",
      "RefactorKit refused the Maven module destination or artifact ID.",
      "REFACTORKIT_PREVIEW_REFUSED",
      "RefactorKit refused the Maven module destination or artifact ID. Choose an unused module directory. Leave the artifact ID empty to keep it, or enter an unused ID for a direct-child rename.",
    ],
    [
      "reactor verification refusal",
      "RefactorKit could not verify the Maven reactor model for this rename. The workspace is unchanged.",
      "REFACTORKIT_PREVIEW_REFUSED",
      "RefactorKit could not verify the Maven reactor model for this rename. The workspace is unchanged.",
    ],
    [
      "session failure",
      "The RefactorKit session failed or timed out during Maven module rename preview.",
      "REFACTORKIT_PREVIEW_SESSION_FAILED",
      "The RefactorKit daemon session failed or timed out while previewing the Maven module rename.",
    ],
    [
      "protocol failure",
      "RefactorKit returned an invalid response for Maven module rename preview.",
      "REFACTORKIT_PREVIEW_PROTOCOL_FAILED",
      "RefactorKit returned an invalid response for the Maven module rename preview.",
    ],
    [
      "oversized request",
      "The Maven module rename preview request exceeds the allowed size.",
      "REFACTORKIT_PREVIEW_REQUEST_TOO_LARGE",
      "The Maven module rename preview request exceeds the allowed size.",
    ],
  ])("classifies %s without exposing native error details", async (_name, nativeMessage, code, message) => {
    const secret = "/home/private/secret/source.java";
    invokeMock.mockResolvedValueOnce(engineCapabilities());
    invokeMock.mockResolvedValueOnce(baseCapabilities([method]));
    invokeMock.mockRejectedValueOnce(`${nativeMessage} ${secret}`);

    const error = await new TauriRefactorKitAdapter()
      .previewMavenModuleRename(request)
      .catch((value: unknown) => value);

    expect(error).toMatchObject({
      command: "preview_refactorkit_maven_module_rename",
      code,
      cause: undefined,
    });
    expect(String(error)).toContain(message);
    expect(String(error)).not.toContain(secret);
  });

  it("discards only the plan returned by its correlated module rename preview", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilities());
    invokeMock.mockResolvedValueOnce(baseCapabilities([method]));
    invokeMock.mockResolvedValueOnce(preview);
    const adapter = new TauriRefactorKitAdapter();
    await adapter.previewMavenModuleRename(request);
    invokeMock.mockResolvedValueOnce({ planId: preview.planId, discarded: true });

    await expect(
      adapter.discardMavenModuleRenamePreview({
        planId: preview.planId,
        workspaceId: request.workspaceId,
        workspaceGeneration: request.workspaceGeneration,
        selectionGeneration: request.selectionGeneration,
        requestId: request.requestId,
      }),
    ).resolves.toBe(true);
    expect(invokeMock.mock.calls.at(-1)).toEqual([
      "discard_refactorkit_maven_module_rename_preview",
      {
        request: {
          planId: preview.planId,
          workspaceId: request.workspaceId,
          workspaceGeneration: request.workspaceGeneration,
          selectionGeneration: request.selectionGeneration,
          requestId: request.requestId,
        },
      },
    ]);
  });

  it("reports a failed module-rename discard as a discard failure", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilities());
    invokeMock.mockResolvedValueOnce(baseCapabilities([method]));
    invokeMock.mockResolvedValueOnce(preview);
    const adapter = new TauriRefactorKitAdapter();
    await adapter.previewMavenModuleRename(request);
    invokeMock.mockRejectedValueOnce("provider error");

    const result = adapter.discardMavenModuleRenamePreview({
      planId: preview.planId,
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
    });
    await expect(result).rejects.toThrow(
      "RefactorKit could not discard the Maven module rename preview.",
    );
    await expect(result).rejects.toMatchObject({
      command: "discard_refactorkit_maven_module_rename_preview",
      code: "REFACTORKIT_DISCARD_FAILED",
    });
  });

  it("explains a rollback conflict and retains the same transaction for retry", async () => {
    const adapter = new TauriRefactorKitAdapter();
    const transactionId = "module-rename-transaction";
    invokeMock.mockResolvedValueOnce(engineCapabilities());
    invokeMock.mockResolvedValueOnce(baseCapabilities([method]));
    invokeMock.mockResolvedValueOnce(preview);
    await adapter.previewMavenModuleRename(request);

    invokeMock.mockResolvedValueOnce(engineCapabilities());
    invokeMock.mockResolvedValueOnce(baseCapabilities([method]));
    invokeMock.mockResolvedValueOnce({
      status: "applied",
      planId: preview.planId,
      transactionId,
      snapshotHash: preview.snapshotHash,
      changedFiles: [{ path: "pom.xml", change: "edit", primary: false }],
      provider: preview.provider,
      providerVersion: preview.providerVersion,
    });
    await adapter.applyMavenModuleRename({
      planId: preview.planId,
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
      approval: {
        approvalId: "module-rename-approval",
        approvedPlanId: preview.planId,
        approvedAt: "2026-11-21T12:00:00.000Z",
      },
    });
    const rollback = {
      transactionId,
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      requestId: "restore-module-rename",
    };
    invokeMock.mockRejectedValueOnce(
      "Maven module rename rollback conflicts with the current workspace state.",
    );
    await expect(adapter.rollbackMavenModuleRename(rollback)).rejects.toMatchObject({
      code: "REFACTORKIT_ROLLBACK_CONFLICT",
      message: "The workspace changed after the Maven module rename. Review the changes before retrying rollback.",
    });
    invokeMock.mockResolvedValueOnce({
      transactionId,
      rolledBack: true,
      changedFiles: [{ path: "pom.xml", change: "edit", primary: false }],
    });
    await expect(adapter.rollbackMavenModuleRename(rollback)).resolves.toMatchObject({
      transactionId,
      rolledBack: true,
    });
  });
});
