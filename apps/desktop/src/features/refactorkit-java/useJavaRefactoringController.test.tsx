import type {
  RefactorApplyResult,
  RefactorKitCapabilities,
  RefactorKitChangeIntent,
  RefactorPreviewRequest,
  RefactorPreviewResult,
  RefactorRollbackResult,
  RefactoringOperation,
  RefactoringTarget,
  JavaFormatterProfile,
} from "@ide/contracts";
import type { RefactorKitPort, EditorPort } from "@ide/web-core";
import {
  createEditorStore,
  EditorViewModel,
  JavaProjectContextRetiredError,
  RefactorRollbackNotStartedError,
} from "@ide/web-core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { javaProjectContextResponse } from "../../../../../tests/story/fixtures/java-project-context-response";
import {
  JAVA_REFACTORING_CAPABILITIES_UNKNOWN,
  JAVA_REFACTORING_OPERATION_NOT_OFFERED,
  JAVA_REFACTORING_STALE_SELECTION,
  JAVA_REFACTORING_STALE_CONTEXT,
  JAVA_REFACTORING_UNAVAILABLE,
  useJavaRefactoringController,
  type UseJavaRefactoringControllerDependencies,
} from "./useJavaRefactoringController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const target = (overrides: Partial<RefactoringTarget> = {}): RefactoringTarget => ({
  kind: "class",
  path: "src/main/java/example/A.java",
  identity: "example.A",
  ...overrides,
});

function targetForOperation(operation: RefactoringOperation): RefactoringTarget {
  switch (operation) {
    case "create-maven-module":
      return target({ kind: "file", path: "pom.xml", identity: "pom.xml" });
    case "rename-gradle-module":
    case "create-gradle-module":
      return target({ kind: "file", path: "settings.gradle", identity: "settings.gradle" });
    case "rename-class":
    case "move-class":
    case "safe-delete":
      return target();
    case "extract-interface":
    case "extract-superclass":
      return target({ identity: "@cursor", selection: { start: 0, end: 0 } });
    case "pull-up-member":
    case "push-down-member":
    case "move-member":
      return target({ kind: "member", identity: "@cursor", selection: { start: 0, end: 0 } });
    case "inline-variable":
      return target({
        kind: "local-binding",
        identity: "count",
        selection: { start: 10, end: 15 },
      });
    case "inline-constant":
      return target({ kind: "member", identity: "VALUE", selection: { start: 10, end: 15 } });
    case "inline-method":
    case "introduce-parameter-object":
    case "extract-delegate":
      return target({ kind: "member", identity: "@cursor", selection: { start: 0, end: 0 } });
    case "rename-member":
    case "change-method-signature":
    case "change-method-parameter-type":
    case "add-method-parameter":
    case "remove-method-parameter":
    case "reorder-method-parameters":
    case "make-static":
      return target({ kind: "member", identity: "example.A#calculate()" });
    case "change-field-type":
    case "make-public":
      return target({ kind: "member", identity: "@cursor", selection: { start: 0, end: 0 } });
    case "encapsulate-field":
      return target({ kind: "member", identity: "example.A#value" });
    case "move-package":
      return target({ kind: "package", identity: "example", path: "src/main/java/example/A.java" });
    case "rename-local-variable":
      return target({ kind: "local-binding", identity: "count" });
    case "move-source-root":
      return target({ kind: "source-root", identity: "src/main/java" });
    case "format-file":
    case "batch-cleanup":
    case "organize-imports":
      return target({ kind: "file", identity: "src/main/java/example/A.java" });
    case "extract-constant":
    case "extract-variable":
    case "extract-method":
    case "extract-parameter":
    case "extract-field":
      return target({
        kind: "file",
        identity: "src/main/java/example/A.java",
        selection: { start: 0, end: 1 },
      });
  }
}

const javaRuntime = {
  executionMode: "in-process" as const,
  supportsTimeout: false,
  supportsCancellation: false,
  usesWorkspaceOverlay: false,
  recordsProcessProvenance: false,
  limits: {
    requestTimeoutMillis: null,
    maxInputBytes: null,
    maxOutputBytes: null,
    maxProcesses: null,
  },
};

function javaOperation(
  operation: string,
  stability: "stable" | "experimental",
  mutationAuthority: "managed-stable" | "proposal-only",
) {
  return {
    operation,
    stability,
    evidence: "compiler" as const,
    mutationAuthority,
    backend: "java-test-backend",
    runtime: javaRuntime,
    extensions: ["java"],
  };
}

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
  generalRefactoring: {
    supported: true,
    operations: [
      "rename-class",
      "rename-member",
      "rename-local-variable",
      "move-class",
      "change-method-signature",
      "safe-delete",
    ],
    preview: true,
    apply: true,
    rollback: true,
    discard: true,
    stability: "preview",
  },
  safeDeleteReferenceAnalysis: "complete-project",
  languageKernel: {
    available: true,
    schema: {
      schemaVersion: 1,
      adapters: [
        {
          languageId: "java",
          extensions: ["java"],
          backend: "java-test-backend",
          runtime: javaRuntime,
          capabilities: [
            javaOperation("renameClass", "stable", "managed-stable"),
            javaOperation("renameMember", "stable", "managed-stable"),
            javaOperation("renameLocalVariable", "experimental", "proposal-only"),
            javaOperation("moveClass", "stable", "managed-stable"),
            javaOperation("moveSourceRoot", "stable", "managed-stable"),
            javaOperation("changeSignature.renameParameter", "experimental", "proposal-only"),
            javaOperation("safeDelete", "stable", "managed-stable"),
            javaOperation("formatFile", "stable", "managed-stable"),
            javaOperation("organizeImports", "stable", "managed-stable"),
          ],
        },
      ],
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
};

function previewFor(
  request: RefactorPreviewRequest,
  overrides: Partial<RefactorPreviewResult> = {},
): RefactorPreviewResult {
  return {
    planId: `plan-${request.requestId}`,
    operation: request.operation,
    target: request.target,
    status: "ready",
    summary: `Refactor ${request.target.identity}`,
    confidence: 0.97,
    riskLevel: "low",
    risks: [],
    evidence: [],
    affectedFiles: [{ change: "edit", path: request.target.path, primary: true }],
    renderedDiff: "reviewed diff",
    structuredDiff: [],
    warnings: [],
    diagnosticsAfterPreview: [],
    conflicts: [],
    refusalReasons: [],
    applyEligibility: { eligible: true, blockers: [] },
    staleness: { stale: false, reasons: [] },
    grantsApplyAuthority: false,
    authority: {
      workspaceId: request.authority.workspaceId,
      workspaceGeneration: request.authority.workspaceGeneration,
    },
    selectionGeneration: request.selectionGeneration,
    requestId: request.requestId,
    provider: "refactorkit",
    providerVersion: "0.3.0",
    ...overrides,
  };
}

function applyResultFor(
  plan: RefactorPreviewResult,
  overrides: Partial<RefactorApplyResult> = {},
): RefactorApplyResult {
  return {
    planId: plan.planId,
    operation: plan.operation,
    outcome: "applied",
    changedFiles: plan.affectedFiles,
    primaryFile: plan.target.path,
    diagnostics: [],
    transactionId: "tx-java-1",
    provider: "refactorkit",
    providerVersion: "0.3.0",
    ...overrides,
  };
}

function rollbackResultFor(
  transactionId: string,
  overrides: Partial<RefactorRollbackResult> = {},
): RefactorRollbackResult {
  return {
    transactionId,
    rolledBack: true,
    changedFiles: [],
    conflicts: [],
    diagnostics: [],
    ...overrides,
  };
}

function createHarness(caps = capabilities) {
  const order: string[] = [];
  const previewRefactoring = vi.fn(async (request: RefactorPreviewRequest) => {
    order.push("preview");
    return previewFor(request);
  });
  const applyRefactoring = vi.fn(
    async (request: Parameters<RefactorKitPort["applyRefactoring"]>[0]) => {
      order.push("apply");
      const previewRequest = previewRefactoring.mock.calls
        .map(([candidate]) => candidate)
        .find((candidate) => `plan-${candidate.requestId}` === request.planId);
      if (!previewRequest) throw new Error("missing preview fixture");
      return applyResultFor(previewFor(previewRequest));
    },
  );
  const rollbackRefactoring = vi.fn(
    async (request: Parameters<RefactorKitPort["rollbackRefactoring"]>[0]) => {
      order.push("rollback");
      return rollbackResultFor(request.transactionId);
    },
  );
  const discardRefactoring = vi.fn(
    async (request: Parameters<RefactorKitPort["discardRefactoring"]>[0]) => ({
      planId: request.planId,
      discarded: true,
    }),
  );
  const refactorKit = {
    previewRefactoring,
    applyRefactoring,
    rollbackRefactoring,
    discardRefactoring,
  } as unknown as RefactorKitPort;

  return {
    order,
    refactorKit,
    previewRefactoring,
    applyRefactoring,
    rollbackRefactoring,
    discardRefactoring,
    capabilities: caps,
  };
}

function renderController(
  harness: ReturnType<typeof createHarness>,
  workspaceId = "workspace-one",
  getWorkspaceGeneration?: () => number,
  capabilities: RefactorKitCapabilities | null = harness.capabilities,
  editor?: EditorViewModel,
  reconcileChanges?: UseJavaRefactoringControllerDependencies["reconcileChanges"],
  onProjectContextStale?: UseJavaRefactoringControllerDependencies["onProjectContextStale"],
) {
  return renderHook(() =>
    useJavaRefactoringController({
      refactorKit: harness.refactorKit,
      capabilities,
      workspaceId,
      getWorkspaceGeneration,
      reviewSavedBuffers: editor ? () => editor.reviewSavedBuffers() : undefined,
      beginWorkspaceWrite: editor ? () => editor.beginExternalWrite() : undefined,
      reconcileChanges,
      onProjectContextStale,
    }),
  );
}

function openIdle(
  controller: ReturnType<typeof renderController>,
  operation: RefactoringOperation = "rename-class",
  targetValue?: RefactoringTarget,
) {
  const selectedTarget = targetValue ?? targetForOperation(operation);
  act(() => controller.result.current.open(operation, selectedTarget));
  const intent: Partial<Record<RefactoringOperation, RefactorKitChangeIntent>> = {
    "rename-class": { operation: "rename-class", newName: "Renamed" },
    "rename-member": { operation: "rename-member", newName: "calculate" },
    "rename-local-variable": {
      operation: "rename-local-variable",
      fromName: "count",
      newName: "total",
    },
    "move-class": { operation: "move-class", newPackage: "example.services" },
    "move-package": {
      operation: "move-package",
      fromPackage: "example",
      toPackage: "example.services",
    },
    "change-method-signature": {
      operation: "change-method-signature",
      oldParameter: "count",
      newParameter: "total",
    },
    "add-method-parameter": {
      operation: "add-method-parameter",
      parameterType: "int",
      parameterName: "count",
      defaultExpression: "0",
    },
    "push-down-member": { operation: "push-down-member", targetType: "example.Child" },
  };
  act(() => controller.result.current.setChangeIntent(intent[operation]));
  expect(controller.result.current.dialog).toMatchObject({
    status: "idle",
    operation,
    target: selectedTarget,
  });
  return controller.result.current.dialog!;
}

async function previewReady(
  controller: ReturnType<typeof renderController>,
  operation: RefactoringOperation = "rename-class",
  targetValue?: RefactoringTarget,
) {
  openIdle(controller, operation, targetValue);
  let pending!: Promise<void>;
  act(() => {
    pending = controller.result.current.preview();
  });
  expect(controller.result.current.dialog).toMatchObject({ status: "loading" });
  await act(async () => pending);
  expect(controller.result.current.dialog).toMatchObject({ status: "preview" });
  return controller.result.current.dialog!.plan!;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useJavaRefactoringController", () => {
  it.each([false, true])("guards navigation from a typed reference (workspace changes: %s)", async (changesWorkspace) => {
    const harness = createHarness();
    const location = {
      path: "src/UserRepository.java",
      range: { start: { line: 3, character: 51 }, end: { line: 3, character: 62 } },
    };
    harness.previewRefactoring.mockImplementationOnce(async (request) =>
      previewFor(request, {
        applyEligibility: { eligible: false, blockers: ["Incomplete reference analysis"] },
        referenceAnalysis: {
          schemaVersion: "refactorkit-reference-analysis-v1",
          scope: "java-spring-data-jpql-static-property-path-v1",
          completeness: "INCOMPLETE",
          completeProject: false,
          managedWriteAuthority: "none",
          warnings: [],
          references: [{
            languageId: "java",
            kind: "framework.entity-property",
            targetOwner: "example.User",
            targetMember: "displayName",
            location,
            resourceKind: "java.annotation-string",
            provenance: "spring-data.query-jpql",
            completeness: "COMPLETE",
          }],
        },
      }),
    );
    let generation = 1;
    const controller = renderController(harness, "workspace-one", () => generation);
    const plan = await previewReady(controller, "rename-member");
    const navigate = vi.fn(async (_location: typeof location, isCurrent: () => boolean) => {
      expect(isCurrent()).toBe(true);
      if (changesWorkspace) generation++;
      return isCurrent();
    });
    await act(() => controller.result.current.openPreviewReference(plan, { ...location }, navigate));
    expect(navigate).not.toHaveBeenCalled();
    await act(() => controller.result.current.openPreviewReference(plan, location, navigate));
    expect(navigate).toHaveBeenCalledWith(location, expect.any(Function));
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
    if (changesWorkspace) {
      expect(controller.result.current.dialog?.plan).toBe(plan);
      expect(harness.discardRefactoring).not.toHaveBeenCalled();
    } else {
      expect(controller.result.current.dialog).toBeNull();
      expect(harness.discardRefactoring).toHaveBeenCalledWith(expect.objectContaining({ planId: plan.planId }));
    }
  });

  it("requires the user's change and allows correcting incomplete intent before invoking the provider", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    act(() => controller.result.current.open("rename-class", target()));
    await act(() => controller.result.current.preview());
    expect(controller.result.current.dialog).toMatchObject({
      status: "idle",
      message: expect.stringContaining("requires"),
    });
    expect(harness.previewRefactoring).not.toHaveBeenCalled();
    act(() =>
      controller.result.current.setChangeIntent({ operation: "rename-class", newName: " " }),
    );
    await act(() => controller.result.current.preview());
    expect(harness.previewRefactoring).not.toHaveBeenCalled();
    act(() =>
      controller.result.current.setChangeIntent({ operation: "rename-class", newName: "Order" }),
    );
    await act(() => controller.result.current.preview());
    expect(harness.previewRefactoring.mock.calls[0][0].changeIntent).toEqual({
      operation: "rename-class",
      newName: "Order",
    });
  });

  it.each(["rename-class", "rename-member", "move-class", "safe-delete"] as const)(
    "retains the reviewed intent for %s through apply",
    async (operation) => {
      const harness = createHarness();
      const controller = renderController(harness);
      const plan = await previewReady(controller, operation);
      const previewRequest = harness.previewRefactoring.mock.calls[0][0];
      act(() =>
        controller.result.current.setChangeIntent({
          operation: "rename-class",
          newName: "Unreviewed",
        }),
      );
      await act(() => controller.result.current.applyDisplayedPlan(plan));
      expect(harness.applyRefactoring.mock.calls[0][0].changeIntent).toEqual(
        previewRequest.changeIntent,
      );
      if (operation === "safe-delete")
        expect(harness.applyRefactoring.mock.calls[0][0]).not.toHaveProperty("changeIntent");
    },
  );

  it.each(["rename-local-variable", "change-method-signature"] as const)(
    "keeps %s previewable but refuses Apply without stable managed authority",
    async (operation) => {
      const harness = createHarness();
      const controller = renderController(harness);
      const plan = await previewReady(controller, operation);
      await act(() => controller.result.current.applyDisplayedPlan(plan));
      expect(harness.applyRefactoring).not.toHaveBeenCalled();
      expect(controller.result.current.dialog).toMatchObject({ status: "unavailable" });
    },
  );

  it("keeps safe delete preview-only when complete project reference analysis is not advertised", async () => {
    const unqualifiedCapabilities = { ...capabilities };
    delete unqualifiedCapabilities.safeDeleteReferenceAnalysis;
    const harness = createHarness(unqualifiedCapabilities);
    const controller = renderController(harness);
    const plan = await previewReady(controller, "safe-delete");

    expect(plan.applyEligibility).toEqual({ eligible: true, blockers: [] });
    await act(() => controller.result.current.applyDisplayedPlan(plan));

    expect(harness.applyRefactoring).not.toHaveBeenCalled();
    expect(controller.result.current.dialog).toMatchObject({
      status: "unavailable",
      message: expect.stringContaining("complete project-wide reference analysis"),
    });
  });

  it("rejects an altered plan with the same identity and refuses backend blockers", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    const plan = await previewReady(controller);
    await act(() =>
      controller.result.current.applyDisplayedPlan({
        ...plan,
        target: target({ path: "Other.java" }),
      }),
    );
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
    harness.previewRefactoring.mockImplementationOnce(async (request) =>
      previewFor(request, {
        applyEligibility: { eligible: false, blockers: ["unresolved references"] },
      }),
    );
    const blocked = await previewReady(controller);
    await act(() => controller.result.current.applyDisplayedPlan(blocked));
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("reports withdrawn Apply capability without invoking the provider", async () => {
    const currentCapabilities = {
      ...capabilities,
      generalRefactoring: { ...capabilities.generalRefactoring! },
    };
    const harness = createHarness(currentCapabilities);
    const controller = renderController(harness);
    const plan = await previewReady(controller);
    currentCapabilities.generalRefactoring.apply = false;
    controller.rerender();
    await act(() => controller.result.current.applyDisplayedPlan(plan));
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
    expect(controller.result.current.dialog).toMatchObject({
      status: "unavailable",
      message: expect.stringContaining("no longer advertises Apply"),
    });
  });

  it("refuses a preview for another semantic target", async () => {
    const harness = createHarness();
    harness.previewRefactoring.mockImplementationOnce(async (request) =>
      previewFor(request, { target: target({ identity: "example.Other" }) }),
    );
    const controller = renderController(harness);
    openIdle(controller);
    await act(() => controller.result.current.preview());
    expect(controller.result.current.dialog?.status).toBe("refused");
    expect(harness.discardRefactoring).toHaveBeenCalledOnce();
  });

  it("presents an explicit provider preview rejection as refused", async () => {
    const harness = createHarness();
    harness.previewRefactoring.mockRejectedValueOnce(
      new Error(
        "[tauri:preview_refactorkit_engine_refactoring] RefactorKit refused to preview this real-engine Java refactoring.",
      ),
    );
    const controller = renderController(harness);
    openIdle(controller, "safe-delete");
    await act(() => controller.result.current.preview());
    expect(controller.result.current.dialog).toMatchObject({
      status: "refused",
      message: expect.stringContaining("RefactorKit refused"),
    });
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("shows a safe saved-context attestation error without enabling Apply", async () => {
    const harness = createHarness();
    harness.previewRefactoring.mockRejectedValueOnce(
      new Error(
        "[tauri:preview_refactorkit_engine_refactoring] RefactorKit could not verify this preview against the current saved Java project context. Apply is unavailable and no changes were made.",
      ),
    );
    const controller = renderController(harness);
    openIdle(controller, "move-class");
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({
      status: "error",
      message: expect.stringContaining("current saved Java project context"),
      plan: null,
    });
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("shows the actionable stale-project-context message from the adapter", async () => {
    const harness = createHarness();
    const onProjectContextStale = vi.fn();
    harness.previewRefactoring.mockRejectedValueOnce(
      new Error(
        "[tauri:preview_refactorkit_engine_refactoring] The selected Java project context changed. Synchronize the project and preview again.",
      ),
    );
    const controller = renderController(
      harness,
      "workspace-one",
      undefined,
      harness.capabilities,
      undefined,
      undefined,
      onProjectContextStale,
    );
    openIdle(controller);
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({
      status: "error",
      message: expect.stringContaining("Synchronize the project and preview again"),
      plan: null,
    });
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
    expect(onProjectContextStale).not.toHaveBeenCalled();
  });

  it("does not report a successful rollback when the provider returns rolledBack=false", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    const plan = await previewReady(controller);
    await act(() => controller.result.current.applyDisplayedPlan(plan));
    harness.rollbackRefactoring.mockResolvedValueOnce({
      ...rollbackResultFor("tx-java-1"),
      rolledBack: false,
    });
    await act(() => controller.result.current.rollback(controller.result.current.dialog!.result!));
    expect(controller.result.current.dialog?.status).toBe("error");
    expect(controller.result.current.successMessage).not.toContain("rolled back");
  });

  it("preserves the confirmed apply outcome and reports a failed editor refresh", async () => {
    const harness = createHarness();
    const reconcileChanges = vi.fn(async () => {
      throw new Error("disk unavailable");
    });
    const controller = renderController(
      harness,
      "workspace-one",
      undefined,
      harness.capabilities,
      undefined,
      reconcileChanges,
    );
    const plan = await previewReady(controller);
    await act(() => controller.result.current.applyDisplayedPlan(plan));
    expect(reconcileChanges).toHaveBeenCalledWith(plan.affectedFiles, expect.any(Function));
    expect(controller.result.current.dialog).toMatchObject({
      status: "applied",
      message: expect.stringContaining("could not be refreshed"),
    });
    expect(controller.result.current.isWriting).toBe(false);
  });

  it("protects real editor buffers before review, rejects saved edits after review, and holds the write guard after cancel", async () => {
    const store = createEditorStore();
    const port: EditorPort = {
      loadContent: vi.fn(async (filePath) => ({
        filePath,
        content: "class A {}",
        language: "java" as const,
      })),
      saveContent: vi.fn(async () => store.getState().openFiles),
      closeFile: vi.fn(() => []),
      getOpenFiles: vi.fn(async () => []),
      inspectContent: vi.fn(async (filePath) => ({
        filePath,
        content: "provider-written text",
        language: "java" as const,
        revision: "revision",
        changedSinceRead: true,
      })),
      acceptDiskSnapshot: vi.fn(),
    };
    const editor = new EditorViewModel(store.getState, port);
    await editor.openFile(target().path);
    editor.updateContent(target().path, "unsaved");
    const harness = createHarness();
    const reconcileChanges = vi.fn(
      async (
        changes: Parameters<
          NonNullable<UseJavaRefactoringControllerDependencies["reconcileChanges"]>
        >[0],
        isCurrent: () => boolean,
      ) => {
        await editor.refreshCleanBuffers(
          changes.map((file) => file.path),
          isCurrent,
        );
        return undefined;
      },
    );
    const controller = renderController(
      harness,
      "workspace-one",
      undefined,
      harness.capabilities,
      editor,
      reconcileChanges,
    );
    openIdle(controller);
    await act(() => controller.result.current.preview());
    expect(harness.previewRefactoring).not.toHaveBeenCalled();
    expect(store.getState().contents[target().path]).toBe("unsaved");
    await editor.saveFile(target().path);
    const stale = await previewReady(controller);
    editor.updateContent(target().path, "new saved contents");
    await editor.saveFile(target().path);
    await act(() => controller.result.current.applyDisplayedPlan(stale));
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
    const plan = await previewReady(controller);
    const pending = deferred<RefactorApplyResult>();
    harness.applyRefactoring.mockReturnValueOnce(pending.promise);
    let applying!: Promise<void>;
    act(() => {
      applying = controller.result.current.applyDisplayedPlan(plan);
    });
    expect(controller.result.current.isWriting).toBe(true);
    act(() => controller.result.current.cancel());
    expect(() => editor.updateContent(target().path, "racing edit")).toThrow("transformation");
    await expect(editor.saveFile(target().path)).rejects.toThrow("transformation");
    pending.resolve(applyResultFor(plan));
    await act(async () => applying);
    expect(controller.result.current.isWriting).toBe(false);
    expect(controller.result.current.dialog).toBeNull();
    expect(reconcileChanges).toHaveBeenCalledOnce();
    expect(store.getState().contents[target().path]).toBe("provider-written text");
    editor.updateContent(target().path, "after completion");
    expect(store.getState().contents[target().path]).toBe("after completion");
  });

  it("reports general refactoring unavailable before any native call when not advertised", async () => {
    const harness = createHarness({
      ...capabilities,
      generalRefactoring: {
        ...capabilities.generalRefactoring!,
        supported: false,
        preview: false,
      },
    });
    const controller = renderController(harness);

    openIdle(controller);
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({
      status: "unavailable",
      message: JAVA_REFACTORING_UNAVAILABLE,
      plan: null,
    });
    expect(harness.previewRefactoring).not.toHaveBeenCalled();
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("uses the saved-file route for file-local operations while the selected SDK context is unsynchronized", async () => {
    const fileCapabilities: RefactorKitCapabilities = {
      ...capabilities,
      generalRefactoring: {
        ...capabilities.generalRefactoring!,
        operations: ["format-file", "organize-imports"],
        apply: true,
      },
    };
    const harness = createHarness(fileCapabilities);
    const verifySavedBuffers = vi.fn();
    const reviewSavedBuffers = vi.fn(() => verifySavedBuffers);
    const selectedProject = {
      settings: {
        projectPath: "app",
        sdkHome: "/jdk",
        mavenRepository: "",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
      },
      context: null,
    };
    const controller = renderHook(() =>
      useJavaRefactoringController({
        refactorKit: harness.refactorKit,
        capabilities: fileCapabilities,
        workspaceId: "workspace-one",
        getProjectContext: () => selectedProject,
        reviewSavedBuffers,
      }),
    );

    openIdle(controller, "format-file");
    await act(() => controller.result.current.preview());

    const plan = controller.result.current.dialog?.plan;
    expect(controller.result.current.dialog).toMatchObject({ status: "preview" });
    expect(harness.previewRefactoring.mock.calls[0][0].projectContext).toBeUndefined();
    expect(reviewSavedBuffers).toHaveBeenCalledOnce();
    expect(plan).not.toBeNull();
    await act(() => controller.result.current.applyDisplayedPlan(plan!));
    expect(harness.applyRefactoring.mock.calls[0][0].projectContext).toBeUndefined();
    expect(verifySavedBuffers).toHaveBeenCalled();
  });

  it("reports unavailable when preview is not advertised even if the operation set is", async () => {
    const harness = createHarness({
      ...capabilities,
      generalRefactoring: {
        ...capabilities.generalRefactoring!,
        preview: false,
      },
    });
    const controller = renderController(harness);

    openIdle(controller);
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({
      status: "unavailable",
      message: JAVA_REFACTORING_UNAVAILABLE,
    });
    expect(harness.previewRefactoring).not.toHaveBeenCalled();
  });

  it("reports unknown capabilities honestly when discovery has not loaded", async () => {
    const harness = createHarness();
    const controller = renderController(harness, "workspace-one", undefined, null);

    openIdle(controller);
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({
      status: "unavailable",
      message: JAVA_REFACTORING_CAPABILITIES_UNKNOWN,
    });
    expect(harness.previewRefactoring).not.toHaveBeenCalled();
  });

  it("refuses an operation not advertised without invoking the native preview", async () => {
    const harness = createHarness({
      ...capabilities,
      generalRefactoring: {
        ...capabilities.generalRefactoring!,
        operations: ["rename-class"],
      },
    });
    const controller = renderController(harness);

    openIdle(controller, "move-class");
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({
      status: "refused",
      message: JAVA_REFACTORING_OPERATION_NOT_OFFERED,
      plan: null,
    });
    expect(harness.previewRefactoring).not.toHaveBeenCalled();
  });

  it("previews read-only and applies only the exact displayed plan with source-free approval", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);

    expect(harness.order).toEqual(["preview"]);
    expect(harness.previewRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "rename-class",
        target: target(),
        authority: { workspaceId: "workspace-one", workspaceGeneration: expect.any(Number) },
      }),
    );
    expect(displayedPlan.grantsApplyAuthority).toBe(false);
    expect(controller.result.current.dialog?.plan?.status).toBe("ready");

    await act(() =>
      controller.result.current.applyDisplayedPlan({ ...displayedPlan, planId: "stale-plan" }),
    );
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
    expect(controller.result.current.dialog?.status).toBe("preview");

    await act(async () => {
      await controller.result.current.applyDisplayedPlan(displayedPlan);
    });
    expect(controller.result.current.dialog?.status).toBe("applied");
    expect(controller.result.current.successMessage).toContain("tx-java-1");

    const applyRequest = harness.applyRefactoring.mock.calls[0][0];
    expect(applyRequest).toEqual({
      planId: displayedPlan.planId,
      operation: displayedPlan.operation,
      target: displayedPlan.target,
      authority: {
        workspaceId: "workspace-one",
        workspaceGeneration: displayedPlan.authority.workspaceGeneration,
      },
      selectionGeneration: displayedPlan.selectionGeneration,
      requestId: displayedPlan.requestId,
      changeIntent: { operation: "rename-class", newName: "Renamed" },
      approval: {
        approvalId: `desktop-java-refactor-approval-${displayedPlan.requestId}`,
        approvedPlanId: displayedPlan.planId,
        approvedAt: expect.any(String),
      },
    });
    expect(applyRequest).not.toHaveProperty("code");
    expect(applyRequest).not.toHaveProperty("renderedDiff");
    expect(JSON.stringify(applyRequest)).not.toContain(displayedPlan.renderedDiff);
  });

  it("reports refused, stale, failed, and indeterminate apply outcomes honestly", async () => {
    const harness = createHarness();
    const controller = renderController(harness);

    for (const outcome of ["refused", "stale", "failed", "indeterminate"] as const) {
      const displayedPlan = await previewReady(controller);
      harness.applyRefactoring.mockResolvedValueOnce(applyResultFor(displayedPlan, { outcome }));
      await act(() => controller.result.current.applyDisplayedPlan(displayedPlan));
      if (outcome === "refused" || outcome === "stale") {
        expect(controller.result.current.dialog?.status).toBe("refused");
      } else {
        expect(controller.result.current.dialog?.status).toBe("error");
      }
      expect(controller.result.current.successMessage).toBeNull();
      expect(harness.applyRefactoring).toHaveBeenCalledTimes(
        ["refused", "stale", "failed", "indeterminate"].indexOf(outcome) + 1,
      );
    }
  });

  it("rolls back only when advertised and transaction-bound", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);
    harness.applyRefactoring.mockResolvedValueOnce(
      applyResultFor(displayedPlan, { transactionId: undefined }),
    );
    await act(async () => {
      await controller.result.current.applyDisplayedPlan(displayedPlan);
    });
    const appliedResult = controller.result.current.dialog!.result!;

    // No transactionId -> rollback refused without native call.
    await act(() => controller.result.current.rollback(appliedResult));
    expect(harness.rollbackRefactoring).not.toHaveBeenCalled();
    expect(controller.result.current.dialog?.status).toBe("error");

    // Re-open, preview, apply with a transaction-bound result.
    await previewReady(controller);
    await act(async () => {
      await controller.result.current.applyDisplayedPlan(controller.result.current.dialog!.plan!);
    });

    await act(async () => {
      await controller.result.current.rollback(controller.result.current.dialog!.result!);
    });
    expect(controller.result.current.dialog?.status).toBe("rolled-back");
    expect(harness.rollbackRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: "tx-java-1",
        operation: "rename-class",
        authority: { workspaceId: "workspace-one", workspaceGeneration: expect.any(Number) },
      }),
    );
    expect(controller.result.current.successMessage).toContain("tx-java-1");
  });

  it("does not roll back when the provider does not advertise rollback", async () => {
    const harness = createHarness({
      ...capabilities,
      generalRefactoring: { ...capabilities.generalRefactoring!, rollback: false },
    });
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);
    await act(async () => {
      await controller.result.current.applyDisplayedPlan(displayedPlan);
    });

    await act(async () => {
      await controller.result.current.rollback(controller.result.current.dialog!.result!);
    });
    expect(harness.rollbackRefactoring).not.toHaveBeenCalled();
    expect(controller.result.current.dialog?.status).toBe("error");
  });

  it("discards the retained plan on cancel exactly once with source-free tokens", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);

    act(() => controller.result.current.cancel());
    act(() => controller.result.current.cancel());

    expect(controller.result.current.dialog).toBeNull();
    expect(harness.discardRefactoring).toHaveBeenCalledOnce();
    const discardRequest = harness.discardRefactoring.mock.calls[0][0];
    expect(discardRequest).toEqual({
      planId: displayedPlan.planId,
      workspaceId: displayedPlan.authority.workspaceId,
      workspaceGeneration: displayedPlan.authority.workspaceGeneration,
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
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("discardDisplayedPlan discards the retained plan and closes", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);

    act(() => controller.result.current.discardDisplayedPlan());

    expect(controller.result.current.dialog).toBeNull();
    expect(harness.discardRefactoring).toHaveBeenCalledOnce();
    expect(harness.discardRefactoring.mock.calls[0][0].planId).toBe(displayedPlan.planId);
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("rejects and discards a preview plan not correlated to the exact request", async () => {
    const harness = createHarness();
    harness.previewRefactoring.mockImplementationOnce(async (request) =>
      previewFor(request, { requestId: "other-request" }),
    );
    const controller = renderController(harness);

    openIdle(controller);
    await act(() => controller.result.current.preview());
    const request = harness.previewRefactoring.mock.calls[0][0];

    expect(controller.result.current.dialog).toMatchObject({
      status: "refused",
      message: JAVA_REFACTORING_STALE_SELECTION,
      plan: null,
    });
    expect(harness.discardRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({ planId: `plan-${request.requestId}` }),
    );
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("keeps only the newest operation/request when previews overlap", async () => {
    const harness = createHarness();
    const firstBackend = deferred<RefactorPreviewResult>();
    harness.previewRefactoring.mockImplementationOnce(() => firstBackend.promise);
    const controller = renderController(harness);

    openIdle(controller, "rename-class");
    let firstPreview!: Promise<void>;
    act(() => {
      firstPreview = controller.result.current.preview();
    });
    await waitFor(() => expect(harness.previewRefactoring).toHaveBeenCalledOnce());
    const firstRequest = harness.previewRefactoring.mock.calls[0][0];

    openIdle(controller, "move-class");
    await act(() => controller.result.current.preview());
    const secondRequest = harness.previewRefactoring.mock.calls[1][0];
    expect(secondRequest.requestId).not.toBe(firstRequest.requestId);
    expect(controller.result.current.dialog).toMatchObject({
      status: "preview",
      plan: { planId: `plan-${secondRequest.requestId}` },
    });

    firstBackend.resolve(previewFor(firstRequest));
    await act(async () => firstPreview);

    expect(controller.result.current.dialog).toMatchObject({
      status: "preview",
      selection: { requestId: secondRequest.requestId },
      plan: { planId: `plan-${secondRequest.requestId}` },
    });
    expect(harness.discardRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({ planId: `plan-${firstRequest.requestId}` }),
    );
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("ignores a late apply after cancel and discards no applied result", async () => {
    const harness = createHarness();
    const backendApply = deferred<RefactorApplyResult>();
    harness.applyRefactoring.mockImplementationOnce(() => backendApply.promise);
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);

    let applying!: Promise<void>;
    act(() => {
      applying = controller.result.current.applyDisplayedPlan(displayedPlan);
    });
    expect(controller.result.current.dialog?.status).toBe("applying");
    act(() => controller.result.current.cancel());
    expect(controller.result.current.dialog).toBeNull();

    backendApply.resolve(applyResultFor(displayedPlan));
    await act(async () => applying);

    expect(controller.result.current.dialog).toBeNull();
    expect(controller.result.current.successMessage).toBeNull();
  });

  it("resets the workspace, advances the local generation, and suppresses stale completion", async () => {
    const harness = createHarness();
    const oldBackend = deferred<RefactorPreviewResult>();
    harness.previewRefactoring.mockImplementationOnce(() => oldBackend.promise);
    const workspaceGeneration = 5;
    const controller = renderController(harness, "workspace-one", () => workspaceGeneration);

    openIdle(controller);
    let oldPreview!: Promise<void>;
    act(() => {
      oldPreview = controller.result.current.preview();
    });
    await waitFor(() => expect(harness.previewRefactoring).toHaveBeenCalledOnce());
    const oldRequest = harness.previewRefactoring.mock.calls[0][0];
    expect(oldRequest.authority.workspaceGeneration).toBe(5);

    act(() => controller.result.current.resetWorkspace());
    expect(controller.result.current.dialog).toBeNull();

    oldBackend.resolve(previewFor(oldRequest));
    await act(async () => oldPreview);
    expect(controller.result.current.dialog).toBeNull();
    expect(harness.discardRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: `plan-${oldRequest.requestId}`,
        workspaceGeneration: 5,
        requestId: oldRequest.requestId,
      }),
    );
  });

  it("invalidates on unmount and discards a late plan without continuing collaborators", async () => {
    const harness = createHarness();
    const backend = deferred<RefactorPreviewResult>();
    harness.previewRefactoring.mockImplementationOnce(() => backend.promise);
    const controller = renderController(harness);

    openIdle(controller);
    let preview!: Promise<void>;
    act(() => {
      preview = controller.result.current.preview();
    });
    await waitFor(() => expect(harness.previewRefactoring).toHaveBeenCalledOnce());
    const request = harness.previewRefactoring.mock.calls[0][0];
    controller.unmount();

    backend.resolve(previewFor(request));
    await preview;

    expect(harness.discardRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: `plan-${request.requestId}`,
        requestId: request.requestId,
      }),
    );
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("updates operation and target only while the dialog is idle", () => {
    const harness = createHarness();
    const controller = renderController(harness);

    act(() => {
      controller.result.current.setOperation("move-class");
      controller.result.current.setTarget({ ...target(), path: "b.java" });
    });
    expect(controller.result.current.dialog).toBeNull();

    openIdle(controller);
    act(() => {
      controller.result.current.setOperation("safe-delete");
      controller.result.current.setTarget({ ...target(), kind: "local-binding" });
    });
    expect(controller.result.current.dialog).toMatchObject({
      status: "idle",
      operation: "safe-delete",
      target: { kind: "class" },
    });
  });

  it.each([
    ["safe-delete", "member", "class"],
    ["change-method-signature", "class", "member"],
    ["format-file", "class", "file"],
    ["encapsulate-field", "file", "member"],
  ] as const)(
    "refuses %s for a %s target before contacting RefactorKit",
    async (operation, targetKind, requiredKind) => {
      const harness = createHarness();
      const controller = renderController(harness);

      act(() => {
        controller.result.current.open(
          operation,
          target({ kind: targetKind, identity: "example.A#run()" }),
        );
      });
      await act(() => controller.result.current.preview());

      expect(controller.result.current.dialog).toMatchObject({
        status: "refused",
        message: `This refactoring requires a ${requiredKind} target.`,
      });
      expect(harness.previewRefactoring).not.toHaveBeenCalled();
    },
  );

  it("normalizes the target kind when the operation changes", () => {
    const cases: [RefactoringOperation, RefactoringTarget["kind"]][] = [
      ["rename-class", "class"],
      ["rename-member", "member"],
      ["rename-local-variable", "local-binding"],
      ["move-class", "class"],
      ["move-package", "package"],
      ["move-source-root", "source-root"],
      ["encapsulate-field", "member"],
      ["change-method-signature", "member"],
      ["change-method-parameter-type", "member"],
      ["reorder-method-parameters", "member"],
      ["safe-delete", "class"],
      ["format-file", "file"],
      ["organize-imports", "file"],
    ];

    for (const [operation, targetKind] of cases) {
      const harness = createHarness();
      const controller = renderController(harness);
      act(() => controller.result.current.open("rename-class", target()));
      act(() => controller.result.current.setOperation(operation));
      expect(controller.result.current.dialog?.target.kind).toBe(targetKind);
      controller.unmount();
    }
  });
});

describe("saved Java project context in refactoring", () => {
  const settings = {
    projectPath: "",
    sdkHome: "/jdk-21",
    mavenRepository: "/maven-cache",
    activeMavenProfiles: ["alternate"],
    inactiveMavenProfiles: [],
  };
  const sdkCapabilities: RefactorKitCapabilities = {
    ...capabilities,
    languageKernel: {
      available: true,
      schema: {
        schemaVersion: 1,
        adapters: [
          {
            languageId: "java",
            capabilities: [
              {
                operation: "renameClass",
                stability: "stable",
                evidence: "native-ast",
                mutationAuthority: "managed-stable",
              },
            ],
          },
        ],
      },
    } as unknown as RefactorKitCapabilities["languageKernel"],
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["renameClass"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: false,
      renderedDiff: true,
    },
    methods: [
      {
        name: "project.context",
        stability: "experimental",
        requiresProject: true,
        writesWorkspace: false,
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      {
        name: "refactor.preview",
        stability: "experimental",
        requiresProject: true,
        writesWorkspace: false,
      },
      {
        name: "refactor.apply",
        stability: "experimental",
        requiresProject: true,
        writesWorkspace: true,
      },
    ],
  };
  function sdkHarness(caps = sdkCapabilities) {
    const harness = createHarness(caps);
    const context = javaProjectContextResponse({
      ...settings,
      workspaceId: "workspace-one",
      generation: 1,
      requestId: "ctx",
    }).context;
    let selected: NonNullable<
      ReturnType<NonNullable<UseJavaRefactoringControllerDependencies["getProjectContext"]>>
    > = {
      settings: structuredClone(settings),
      context,
    };
    harness.previewRefactoring.mockImplementation(async (request) =>
      previewFor(request, {
        projectContext: {
          projectPath: request.projectContext!.projectPath,
          contextHash: request.projectContext!.contextHash,
          contextSchemaVersion: "java-project-context-v1",
          platformIdentities: request.projectContext!.platformIdentities,
        },
        diffTruncated: false,
        diffTruncationReasons: [],
      }),
    );
    const render = (additional: Partial<UseJavaRefactoringControllerDependencies> = {}) =>
      renderHook(() =>
        useJavaRefactoringController({
          ...harness,
          workspaceId: "workspace-one",
          getProjectContext: () => selected,
          ...additional,
        }),
      );
    return {
      harness,
      context,
      render,
      get selected() {
        return selected;
      },
      set selected(value) {
        selected = value;
      },
    };
  }

  function sdkFormatterHarness() {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.operations.push("formatFile");
    const schema = caps.languageKernel?.available ? caps.languageKernel.schema : undefined;
    if (!schema) throw new Error("Missing Java language-kernel fixture");
    schema.adapters[0]!.capabilities.push(javaOperation("formatFile", "stable", "managed-stable"));
    return sdkHarness(caps);
  }

  it("binds formatting preview and Apply to the selected workspace formatter profile", async () => {
    const fixture = sdkFormatterHarness();
    const profile: JavaFormatterProfile = {
      path: "config/team-formatter.xml",
      profileName: "Team",
    };
    fixture.harness.previewRefactoring.mockImplementation(async (request) =>
      previewFor(request, {
        projectContext: {
          projectPath: request.projectContext!.projectPath,
          contextHash: request.projectContext!.contextHash,
          contextSchemaVersion: "java-project-context-v1",
          platformIdentities: request.projectContext!.platformIdentities,
        },
        diffTruncated: false,
        diffTruncationReasons: [],
        formatterProfilePath: request.formatterProfile?.path,
        formatterProfileName: request.formatterProfile?.profileName,
        formatterProfileSha256: request.formatterProfile ? "a".repeat(64) : undefined,
      }),
    );
    const controller = fixture.render({ getJavaFormatterProfile: () => profile });
    openIdle(controller, "format-file");

    await act(() => controller.result.current.preview());

    expect(fixture.harness.previewRefactoring.mock.calls[0][0].formatterProfile).toEqual(profile);
    const plan = controller.result.current.dialog?.plan;
    expect(plan).toMatchObject({
      formatterProfilePath: profile.path,
      formatterProfileName: profile.profileName,
      formatterProfileSha256: "a".repeat(64),
    });
    await act(() => controller.result.current.applyDisplayedPlan(plan!));

    expect(fixture.harness.applyRefactoring.mock.calls[0][0]).toMatchObject({
      formatterProfile: profile,
      formatterProfileSha256: "a".repeat(64),
    });
  });

  it("discards a formatting preview when the workspace formatter selection changes", async () => {
    const fixture = sdkFormatterHarness();
    let profile: JavaFormatterProfile | undefined = {
      path: "config/team-formatter.xml",
      profileName: "Team",
    };
    const controller = fixture.render({ getJavaFormatterProfile: () => profile });
    openIdle(controller, "format-file");
    await act(() => controller.result.current.preview());
    expect(controller.result.current.dialog?.status).toBe("preview");

    profile = { path: "config/other-formatter.xml", profileName: "Other" };
    controller.rerender();

    await waitFor(() => expect(controller.result.current.dialog).toBeNull());
    expect(fixture.harness.discardRefactoring).toHaveBeenCalledOnce();
    expect(fixture.harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("retires the displayed project context after a stale-context preview refusal", async () => {
    const fixture = sdkHarness();
    const onProjectContextStale = vi.fn();
    fixture.harness.previewRefactoring.mockRejectedValueOnce(
      new Error(
        "[tauri:preview_refactorkit_engine_refactoring] The selected Java project context changed. Synchronize the project and preview again.",
      ),
    );
    const controller = fixture.render({ onProjectContextStale });
    act(() => {
      controller.result.current.open("rename-class", target());
      controller.result.current.setChangeIntent({
        operation: "rename-class",
        newName: "Renamed",
      });
    });

    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({
      status: "error",
      message: expect.stringContaining("Synchronize the project and preview again"),
      plan: null,
    });
    expect(fixture.harness.previewRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({ projectContext: expect.any(Object) }),
    );
    expect(onProjectContextStale).toHaveBeenCalledOnce();
    expect(fixture.harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("retires the displayed context after an explicit preview session retirement", async () => {
    const fixture = sdkHarness();
    const onProjectContextStale = vi.fn();
    fixture.harness.previewRefactoring.mockRejectedValueOnce(
      new JavaProjectContextRetiredError("RefactorKit refused this Java draft preview."),
    );
    const controller = fixture.render({ onProjectContextStale });
    act(() => {
      controller.result.current.open("rename-class", target());
      controller.result.current.setChangeIntent({ operation: "rename-class", newName: "Renamed" });
    });
    await act(() => controller.result.current.preview());
    expect(controller.result.current.dialog).toMatchObject({ status: "refused", plan: null });
    expect(onProjectContextStale).toHaveBeenCalledOnce();
    expect(fixture.harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("does not retire a newer selected context for a late preview refusal", async () => {
    const fixture = sdkHarness();
    const onProjectContextStale = vi.fn();
    let reject!: (error: Error) => void;
    fixture.harness.previewRefactoring.mockImplementationOnce(
      () =>
        new Promise((_resolve, rejectPreview) => {
          reject = rejectPreview;
        }),
    );
    const controller = fixture.render({ onProjectContextStale });
    act(() => {
      controller.result.current.open("rename-class", target());
      controller.result.current.setChangeIntent({ operation: "rename-class", newName: "Renamed" });
    });
    let pending!: Promise<void>;
    act(() => {
      pending = controller.result.current.preview();
    });
    fixture.selected = {
      ...fixture.selected,
      context: { ...fixture.context!, contextHash: "9".repeat(64) },
    };
    controller.rerender();
    await act(async () => {
      reject(new JavaProjectContextRetiredError("RefactorKit refused this Java draft preview."));
      await pending;
    });
    expect(onProjectContextStale).not.toHaveBeenCalled();
    expect(fixture.harness.applyRefactoring).not.toHaveBeenCalled();
  });

  function batchHarness(formatterProfile = false) {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.operations = ["batchCleanup"];
    if (formatterProfile)
      caps.javaContextRefactoring!.operationCapabilities = [
        { operation: "batchCleanup", features: { formatterProfile: true } },
      ];
    caps.languageKernel!.schema!.adapters[0].capabilities = [
      {
        ...javaOperation("batchCleanup", "stable", "managed-stable"),
        evidence: "structural-parse",
      },
    ];
    const fixture = sdkHarness(caps);
    const path = target().path;
    const intent: RefactorKitChangeIntent = {
      operation: "batch-cleanup",
      actions: [
        { operation: "organize-imports", path },
        { operation: "format-file", path: "src/main/java/example/B.java" },
      ],
    };
    return { ...fixture, intent, path };
  }

  it("captures a saved batch and isolates its nested selection from callers and the port", async () => {
    const fixture = batchHarness();
    const capture = vi.fn(() => ({
      documents: [{ path: fixture.path, text: "class A {}", version: 1, isDirty: false }],
      verify: vi.fn(),
    }));
    const controller = fixture.render({ captureEditorBuffers: capture });
    act(() => {
      controller.result.current.open(
        "batch-cleanup",
        target({ kind: "file", identity: fixture.path }),
      );
      controller.result.current.setChangeIntent(fixture.intent);
    });
    const original = structuredClone(fixture.intent);
    fixture.intent.actions[1].path = "outside/Changed.java";
    fixture.harness.previewRefactoring.mockImplementationOnce(async (request) => {
      expect(request.changeIntent).toEqual(original);
      const response = previewFor(request, {
        projectContext: {
          projectPath: "",
          contextHash: request.projectContext!.contextHash,
          contextSchemaVersion:
            request.projectContext!.contextSchemaVersion ?? "java-project-context-v1",
          platformIdentities: request.projectContext!.platformIdentities,
        },
        diffTruncated: false,
        diffTruncationReasons: [],
      });
      if (request.changeIntent?.operation === "batch-cleanup")
        request.changeIntent.actions[0].path = "port/Changed.java";
      return response;
    });
    await act(() => controller.result.current.preview());
    expect(controller.result.current.dialog).toMatchObject({
      status: "preview",
      selection: { changeIntent: original },
    });
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).not.toHaveProperty("editorOverlay");
    expect(fixture.harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("refuses default batch formatting when a workspace Eclipse profile is selected", async () => {
    const fixture = batchHarness();
    const controller = fixture.render({
      captureEditorBuffers: () => ({ documents: [], verify: vi.fn() }),
      getJavaFormatterProfile: () => ({ path: "config/team.xml", profileName: "Team" }),
    });
    act(() => {
      controller.result.current.open(
        "batch-cleanup",
        target({ kind: "file", identity: fixture.path }),
      );
      controller.result.current.setChangeIntent(fixture.intent);
    });
    await act(() => controller.result.current.preview());
    expect(controller.result.current.dialog?.message).toContain(
      "selected Eclipse formatter profile",
    );
    expect(fixture.harness.previewRefactoring).not.toHaveBeenCalled();
  });

  it("binds a mixed Java Cleanup preview and Apply to the provider-qualified formatter profile", async () => {
    const fixture = batchHarness(true);
    const profile = { path: "config/team.xml", profileName: "Team" };
    const profileHash = "a".repeat(64);
    fixture.harness.previewRefactoring.mockImplementation(async (request) => previewFor(request, {
      projectContext: {
        projectPath: request.projectContext!.projectPath,
        contextHash: request.projectContext!.contextHash,
        contextSchemaVersion: request.projectContext!.contextSchemaVersion ?? "java-project-context-v1",
        platformIdentities: request.projectContext!.platformIdentities,
      },
      diffTruncated: false,
      diffTruncationReasons: [],
      formatterProfilePath: profile.path,
      formatterProfileName: profile.profileName,
      formatterProfileSha256: profileHash,
    }));
    const controller = fixture.render({
      captureEditorBuffers: () => ({ documents: [], verify: vi.fn() }),
      getJavaFormatterProfile: () => profile,
    });
    act(() => {
      controller.result.current.open("batch-cleanup", target({ kind: "file", identity: fixture.path }));
      controller.result.current.setChangeIntent(fixture.intent);
    });
    await act(() => controller.result.current.preview());
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).toMatchObject({
      formatterProfile: profile,
      changeIntent: fixture.intent,
    });
    const plan = controller.result.current.dialog?.plan;
    expect(plan?.formatterProfileSha256).toBe(profileHash);
    await act(() => controller.result.current.applyDisplayedPlan(plan!));
    expect(fixture.harness.applyRefactoring.mock.calls[0][0]).toMatchObject({
      formatterProfile: profile,
      formatterProfileSha256: profileHash,
    });
  });

  it("refuses a saved batch when any open draft is dirty", async () => {
    const fixture = batchHarness();
    const controller = fixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path: "notes.txt", text: "unsaved", version: 1, isDirty: true }],
        verify: vi.fn(),
      }),
    });
    act(() => {
      controller.result.current.open(
        "batch-cleanup",
        target({ kind: "file", identity: fixture.path }),
      );
      controller.result.current.setChangeIntent(fixture.intent);
    });
    await act(() => controller.result.current.preview());
    expect(controller.result.current.dialog?.message).toContain("Save or discard");
    expect(fixture.harness.previewRefactoring).not.toHaveBeenCalled();
  });

  it("binds a parameter reorder preview to the selected project context and requested order", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.operations = ["changeSignature.reorderParameters"];
    caps.languageKernel!.schema!.adapters[0].capabilities = [
      javaOperation("changeSignature.reorderParameters", "stable", "managed-stable"),
    ];
    const fixture = sdkHarness(caps);
    const controller = fixture.render();
    const selectedTarget = targetForOperation("reorder-method-parameters");

    act(() => {
      controller.result.current.open("reorder-method-parameters", selectedTarget);
      controller.result.current.setChangeIntent({
        operation: "reorder-method-parameters",
        newOrder: "second,first",
      });
    });
    await act(async () => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({ status: "preview" });
    expect(fixture.harness.previewRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "reorder-method-parameters",
        target: selectedTarget,
        changeIntent: {
          operation: "reorder-method-parameters",
          newOrder: "second,first",
        },
        projectContext: expect.objectContaining({
          projectPath: "",
          contextHash: expect.any(String),
        }),
      }),
    );
    expect(controller.result.current.dialog).toMatchObject({ status: "preview" });
  });

  it("previews Add Module from the synchronized parent POM but refuses Apply with a dirty buffer", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.apiVersion = "0.2";
    caps.methods!.push(
      {
        name: "patch.rollback",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: true,
      },
      {
        name: "java.createMavenModule",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: false,
        features: { preview: true, renderedDiff: true, apply: true, rollback: true },
      },
    );
    const fixture = sdkHarness(caps);
    const verify = vi.fn();
    const controller = fixture.render({
      captureEditorBuffers: () => ({
        documents: [
          {
            path: "src/main/java/example/App.java",
            text: "package example; class App {}",
            version: 2,
            isDirty: true,
          },
        ],
        verify,
      }),
    });
    const parentPom = { kind: "file" as const, path: "pom.xml", identity: "pom.xml" };
    act(() => {
      controller.result.current.open("create-maven-module", parentPom);
      controller.result.current.setChangeIntent({
        operation: "create-maven-module",
        moduleName: "catalog-domain",
      });
    });
    await act(async () => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({ status: "preview" });
    expect(fixture.harness.previewRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "create-maven-module",
        target: parentPom,
        changeIntent: { operation: "create-maven-module", moduleName: "catalog-domain" },
        projectContext: expect.objectContaining({ contextHash: expect.any(String) }),
      }),
    );
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).not.toHaveProperty("editorOverlay");
    expect(controller.result.current.dialog?.selection?.editorDirtyPaths).toEqual([
      "src/main/java/example/App.java",
    ]);
    const plan = controller.result.current.dialog!.plan!;
    expect(verify).toHaveBeenCalledOnce();
    await act(async () => controller.result.current.applyDisplayedPlan(plan));
    expect(fixture.harness.applyRefactoring).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledOnce();
    expect(controller.result.current.dialog).toMatchObject({
      status: "refused",
      message: expect.stringContaining("Save or discard all open editor changes"),
    });
  });

  it("previews Gradle module rename but refuses Apply while an editor buffer is dirty", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.apiVersion = "0.2";
    caps.methods!.push(
      {
        name: "patch.rollback",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: true,
      },
      {
        name: "java.renameGradleModule",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: false,
        features: {
          preview: true,
          renderedDiff: true,
          apply: true,
          rollback: true,
          literalSettingsOnly: true,
          preservePhysicalProjectDirectory: true,
          explicitGradleSyncRequired: true,
          inboundProjectDependenciesRefused: true,
        },
      },
    );
    const fixture = sdkHarness(caps);
    fixture.selected = {
      ...fixture.selected,
      settings: {
        ...fixture.selected.settings,
        gradle: { executable: "/opt/gradle/bin/gradle", userHome: "", projectProperties: {} },
      },
    };
    const verify = vi.fn();
    const controller = fixture.render({
      captureEditorBuffers: () => ({
        documents: [
          {
            path: "src/main/java/example/App.java",
            text: "package example; class App {}",
            version: 2,
            isDirty: true,
          },
        ],
        verify,
      }),
    });
    const parentPom = {
      kind: "file" as const,
      path: "settings.gradle",
      identity: "settings.gradle",
    };
    act(() => {
      controller.result.current.open("rename-gradle-module", parentPom);
      controller.result.current.setChangeIntent({
        operation: "rename-gradle-module",
        buildRoot: ".",
        oldProjectPath: ":app",
        newProjectPath: ":renamed-app",
      });
    });
    await act(async () => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({ status: "preview" });
    expect(fixture.harness.previewRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "rename-gradle-module",
        target: parentPom,
        changeIntent: {
          operation: "rename-gradle-module",
          buildRoot: ".",
          oldProjectPath: ":app",
          newProjectPath: ":renamed-app",
        },
        projectContext: expect.objectContaining({ contextHash: expect.any(String) }),
      }),
    );
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).not.toHaveProperty("editorOverlay");
    expect(controller.result.current.dialog?.selection?.editorDirtyPaths).toEqual([
      "src/main/java/example/App.java",
    ]);
    const plan = controller.result.current.dialog!.plan!;
    expect(verify).toHaveBeenCalledOnce();
    await act(async () => controller.result.current.applyDisplayedPlan(plan));
    expect(fixture.harness.applyRefactoring).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledOnce();
    expect(controller.result.current.dialog).toMatchObject({
      status: "refused",
      message: expect.stringContaining("Save or discard all open editor changes"),
    });
  });

  it("captures partial Maven context only for Add Module preview", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.apiVersion = "0.2";
    caps.methods!.push(
      {
        name: "patch.rollback",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: true,
      },
      {
        name: "java.createMavenModule",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: false,
        features: { preview: true, renderedDiff: true, apply: true, rollback: true },
      },
    );
    const fixture = sdkHarness(caps);
    const partial = structuredClone(fixture.context);
    partial.status = "partial";
    for (const provider of partial.providers) {
      provider.providerId = "maven-effective-v1";
      provider.status = "partial";
    }
    for (const module of partial.modules) module.providerId = "maven-effective-v1";
    fixture.selected = { ...fixture.selected, context: partial };
    const controller = fixture.render({
      captureEditorBuffers: () => ({ documents: [], verify: vi.fn() }),
    });
    const parentPom = { kind: "file" as const, path: "pom.xml", identity: "pom.xml" };
    act(() => {
      controller.result.current.open("create-maven-module", parentPom);
      controller.result.current.setChangeIntent({
        operation: "create-maven-module",
        moduleName: "catalog-domain",
      });
    });
    await act(async () => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({ status: "preview" });
    expect(fixture.harness.previewRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "create-maven-module",
        projectContext: expect.objectContaining({ contextHash: partial.contextHash }),
      }),
    );
  });

  it("captures partial Gradle context and preserves the selected build identity for Add Module", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.apiVersion = "0.2";
    caps.methods!.push(
      {
        name: "patch.rollback",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: true,
      },
      {
        name: "java.createGradleModule",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: false,
        features: {
          preview: true,
          renderedDiff: true,
          apply: true,
          rollback: true,
          workspaceRelativeBuildRoot: true,
          canonicalNestedProjectPath: true,
          settingsInferredDsl: true,
        },
      },
    );
    const fixture = sdkHarness(caps);
    const partial = structuredClone(fixture.context);
    partial.status = "partial";
    partial.providers = partial.providers.map((provider) => ({
      ...provider,
      providerId: "gradle-effective-v1",
      status: "partial",
    }));
    partial.modules = partial.modules.map((module) => ({
      ...module,
      providerId: "gradle-effective-v1",
      buildRoot: "included-build",
      projectPath: ":app",
    }));
    fixture.selected = {
      settings: {
        ...settings,
        gradle: { executable: "/opt/gradle/bin/gradle", userHome: "", projectProperties: {} },
      },
      context: partial,
    };
    const controller = fixture.render({
      captureEditorBuffers: () => ({ documents: [], verify: vi.fn() }),
    });
    const gradleSettings = {
      kind: "file" as const,
      path: "included-build/settings.gradle.kts",
      identity: "included-build/settings.gradle.kts",
    };
    const intent: RefactorKitChangeIntent = {
      operation: "create-gradle-module",
      buildRoot: "included-build",
      projectPath: ":services:catalog",
    };
    act(() => {
      controller.result.current.open("create-gradle-module", gradleSettings, undefined, intent);
    });
    await act(async () => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({ status: "preview" });
    expect(fixture.harness.previewRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "create-gradle-module",
        target: gradleSettings,
        changeIntent: intent,
        projectContext: expect.objectContaining({
          gradle: expect.objectContaining({ executable: "/opt/gradle/bin/gradle" }),
          contextHash: partial.contextHash,
        }),
      }),
    );
  });

  it("applies and rolls back Add Module through the advertised SDK transaction", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.apiVersion = "0.2";
    caps.javaContextRefactoring!.rollbackAuthority = true;
    caps.methods!.push(
      {
        name: "patch.rollback",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: true,
      },
      {
        name: "java.createMavenModule",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: false,
        features: { preview: true, renderedDiff: true, apply: true, rollback: true },
      },
    );
    const fixture = sdkHarness(caps);
    fixture.harness.applyRefactoring.mockImplementation(async (request) =>
      applyResultFor(previewFor(request), {
        appliedContextHash: request.projectContext!.contextHash,
        appliedSnapshotHash: "e".repeat(64),
      }),
    );
    fixture.harness.rollbackRefactoring.mockImplementation(async (request) => ({
      ...rollbackResultFor(request.transactionId),
      rolledBackContextHash: request.projectContext!.contextHash,
      restoredSnapshotHash: request.projectContext!.snapshotHash,
    }));
    const verify = vi.fn();
    const controller = fixture.render({
      captureEditorBuffers: () => ({ documents: [], verify }),
    });
    const parentPom = { kind: "file" as const, path: "pom.xml", identity: "pom.xml" };
    act(() => {
      controller.result.current.open("create-maven-module", parentPom);
      controller.result.current.setChangeIntent({
        operation: "create-maven-module",
        moduleName: "catalog-domain",
      });
    });
    await act(() => controller.result.current.preview());
    const plan = controller.result.current.dialog!.plan!;

    await act(() => controller.result.current.applyDisplayedPlan(plan));
    expect(controller.result.current.dialog?.status).toBe("applied");
    expect(fixture.harness.applyRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "create-maven-module",
        target: parentPom,
        changeIntent: { operation: "create-maven-module", moduleName: "catalog-domain" },
        projectContext: expect.objectContaining({ contextHash: expect.any(String) }),
      }),
    );
    expect(verify).toHaveBeenCalledTimes(2);

    const applied = controller.result.current.dialog!.result!;
    await act(() => controller.result.current.rollback(applied));
    expect(controller.result.current.dialog?.status).toBe("rolled-back");
    expect(fixture.harness.rollbackRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "create-maven-module",
        transactionId: "tx-java-1",
        expectedSnapshotHash: "e".repeat(64),
        projectContext: expect.objectContaining({ contextHash: expect.any(String) }),
      }),
    );
  });

  it("uses saved-source mutation selection for Add Parameter and refuses dirty drafts", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.operations = ["changeSignature.addParameter"];
    caps.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    caps.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    caps.methods!.push({
      name: "intelligence.query",
      stability: "experimental",
      requiresProject: true,
      writesWorkspace: false,
    });
    caps.languageKernel!.schema!.adapters[0].capabilities.push(
      javaOperation("changeSignature.addParameter", "stable", "managed-stable"),
    );
    const fixture = sdkHarness(caps);
    const source = "class A { void run() {} }";
    const path = target().path;
    const cursor = { line: 1, column: source.indexOf("run") + 2 };
    const cursorTarget = target({
      kind: "member",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    });
    const verify = vi.fn();
    const controller = fixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path, text: source, version: 3, isDirty: false }],
        verify,
      }),
      getCursorPosition: () => cursor,
    });

    act(() => {
      controller.result.current.open("add-method-parameter", cursorTarget, {
        path,
        ...cursor,
      });
      controller.result.current.setChangeIntent({
        operation: "add-method-parameter",
        parameterType: "int",
        parameterName: "count",
        defaultExpression: "0",
      });
    });
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog?.status).toBe("preview");
    expect(fixture.harness.previewRefactoring).toHaveBeenCalledOnce();
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).toMatchObject({
      operation: "add-method-parameter",
      target: {
        kind: "member",
        identity: "@cursor",
        selection: { start: cursor.column - 1, end: cursor.column - 1 },
      },
      projectContext: expect.any(Object),
    });
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).not.toHaveProperty("editorOverlay");
    expect(verify).toHaveBeenCalledOnce();

    const dirtyFixture = sdkHarness(caps);
    const dirtyController = dirtyFixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path, text: source, version: 4, isDirty: true }],
        verify: vi.fn(),
      }),
      getCursorPosition: () => cursor,
    });
    act(() => {
      dirtyController.result.current.open("add-method-parameter", cursorTarget, {
        path,
        ...cursor,
      });
      dirtyController.result.current.setChangeIntent({
        operation: "add-method-parameter",
        parameterType: "int",
        parameterName: "count",
        defaultExpression: "0",
      });
    });
    await act(() => dirtyController.result.current.preview());
    expect(dirtyFixture.harness.previewRefactoring).not.toHaveBeenCalled();
    expect(dirtyController.result.current.dialog?.message).toContain("Save all open Java changes");

    const staleFixture = sdkHarness(caps);
    let currentCursor = cursor;
    const staleController = staleFixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path, text: source, version: 5, isDirty: false }],
        verify: vi.fn(),
      }),
      getCursorPosition: () => currentCursor,
    });
    act(() => {
      staleController.result.current.open("add-method-parameter", cursorTarget, {
        path,
        ...cursor,
      });
      staleController.result.current.setChangeIntent({
        operation: "add-method-parameter",
        parameterType: "int",
        parameterName: "count",
        defaultExpression: "0",
      });
    });
    currentCursor = { line: 1, column: cursor.column + 1 };
    await act(() => staleController.result.current.preview());
    expect(staleFixture.harness.previewRefactoring).not.toHaveBeenCalled();
    expect(staleController.result.current.dialog?.message).toContain(
      "place the cursor on the method",
    );
  });

  it("binds cursor parameter reordering to a clean saved Java method", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.operations = ["changeSignature.reorderParameters"];
    caps.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    caps.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    caps.methods!.push({
      name: "intelligence.query",
      stability: "experimental",
      requiresProject: true,
      writesWorkspace: false,
    });
    caps.languageKernel!.schema!.adapters[0].capabilities = [
      javaOperation("changeSignature.reorderParameters", "stable", "managed-stable"),
    ];
    const fixture = sdkHarness(caps);
    const source = "class A { void run(int first, int second) {} }";
    const path = target().path;
    const cursor = { line: 1, column: source.indexOf("run") + 2 };
    const cursorTarget = target({
      kind: "member",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    });
    const verify = vi.fn();
    const controller = fixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path, text: source, version: 3, isDirty: false }],
        verify,
      }),
      getCursorPosition: () => cursor,
    });

    act(() => {
      controller.result.current.open("reorder-method-parameters", cursorTarget, {
        path,
        ...cursor,
      });
      controller.result.current.setChangeIntent({
        operation: "reorder-method-parameters",
        newOrder: "second,first",
      });
    });
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog?.status).toBe("preview");
    expect(fixture.harness.previewRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "reorder-method-parameters",
        target: cursorTarget,
        changeIntent: {
          operation: "reorder-method-parameters",
          newOrder: "second,first",
        },
        projectContext: expect.any(Object),
      }),
    );
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).not.toHaveProperty("editorOverlay");
    expect(verify).toHaveBeenCalledOnce();

    const dirtyFixture = sdkHarness(caps);
    const dirtyController = dirtyFixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path, text: source, version: 4, isDirty: true }],
        verify: vi.fn(),
      }),
      getCursorPosition: () => cursor,
    });
    act(() => {
      dirtyController.result.current.open("reorder-method-parameters", cursorTarget, {
        path,
        ...cursor,
      });
      dirtyController.result.current.setChangeIntent({
        operation: "reorder-method-parameters",
        newOrder: "second,first",
      });
    });
    await act(() => dirtyController.result.current.preview());
    expect(dirtyFixture.harness.previewRefactoring).not.toHaveBeenCalled();
    expect(dirtyController.result.current.dialog?.message).toContain("Save all open Java changes");
  });

  it("renames a parameter from a clean saved Java method cursor with managed authority", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.operations = ["changeSignature.renameParameter"];
    caps.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    caps.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    caps.methods!.push({
      name: "intelligence.query",
      stability: "experimental",
      requiresProject: true,
      writesWorkspace: false,
    });
    caps.languageKernel!.schema!.adapters[0].capabilities = [
      javaOperation("changeSignature.renameParameter", "stable", "managed-stable"),
    ];
    const fixture = sdkHarness(caps);
    const source = "class A { int combine(int first, int second) { return first + second; } }";
    const path = target().path;
    const cursor = { line: 1, column: source.indexOf("combine") + 2 };
    const cursorTarget = target({
      kind: "member",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    });
    const controller = fixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path, text: source, version: 3, isDirty: false }],
        verify: vi.fn(),
      }),
      getCursorPosition: () => cursor,
    });

    act(() => {
      controller.result.current.open("change-method-signature", cursorTarget, {
        path,
        ...cursor,
      });
      controller.result.current.setChangeIntent({
        operation: "change-method-signature",
        oldParameter: "second",
        newParameter: "factor",
      });
    });
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog?.status).toBe("preview");
    expect(fixture.harness.previewRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "change-method-signature",
        target: cursorTarget,
        changeIntent: {
          operation: "change-method-signature",
          oldParameter: "second",
          newParameter: "factor",
        },
        projectContext: expect.any(Object),
      }),
    );
    const plan = controller.result.current.dialog!.plan!;
    fixture.harness.applyRefactoring.mockResolvedValueOnce(
      applyResultFor(plan, { appliedContextHash: plan.projectContext!.contextHash }),
    );
    await act(() => controller.result.current.applyDisplayedPlan(plan));
    expect(controller.result.current.dialog?.status).toBe("applied");
    expect(fixture.harness.applyRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "change-method-signature",
        changeIntent: {
          operation: "change-method-signature",
          oldParameter: "second",
          newParameter: "factor",
        },
      }),
    );
  });

  it("binds parameter removal to the clean saved Java method cursor", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.operations = ["changeSignature.removeParameter"];
    caps.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    caps.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    caps.methods!.push({
      name: "intelligence.query",
      stability: "experimental",
      requiresProject: true,
      writesWorkspace: false,
    });
    caps.languageKernel!.schema!.adapters[0].capabilities = [
      javaOperation("changeSignature.removeParameter", "stable", "managed-stable"),
    ];
    const fixture = sdkHarness(caps);
    const source = "class A { int select(int value, int unused) { return value; } }";
    const path = target().path;
    const cursor = { line: 1, column: source.indexOf("select") + 2 };
    const cursorTarget = target({
      kind: "member",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    });
    const verify = vi.fn();
    const controller = fixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path, text: source, version: 3, isDirty: false }],
        verify,
      }),
      getCursorPosition: () => cursor,
    });

    act(() => {
      controller.result.current.open("remove-method-parameter", cursorTarget, {
        path,
        ...cursor,
      });
      controller.result.current.setChangeIntent({
        operation: "remove-method-parameter",
        parameterName: "unused",
      });
    });
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog?.status).toBe("preview");
    expect(fixture.harness.previewRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "remove-method-parameter",
        target: cursorTarget,
        changeIntent: { operation: "remove-method-parameter", parameterName: "unused" },
        projectContext: expect.any(Object),
      }),
    );
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).not.toHaveProperty("editorOverlay");
    expect(verify).toHaveBeenCalledOnce();

    const dirtyFixture = sdkHarness(caps);
    const dirtyController = dirtyFixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path, text: source, version: 4, isDirty: true }],
        verify: vi.fn(),
      }),
      getCursorPosition: () => cursor,
    });
    act(() => {
      dirtyController.result.current.open("remove-method-parameter", cursorTarget, {
        path,
        ...cursor,
      });
      dirtyController.result.current.setChangeIntent({
        operation: "remove-method-parameter",
        parameterName: "unused",
      });
    });
    await act(() => dirtyController.result.current.preview());
    expect(dirtyFixture.harness.previewRefactoring).not.toHaveBeenCalled();
    expect(dirtyController.result.current.dialog?.message).toContain("Save all open Java changes");
  });

  it("binds parameter type changes to a clean saved Java method selection", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.operations = ["changeSignature.changeParameterType"];
    caps.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    caps.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    caps.methods!.push({
      name: "intelligence.query",
      stability: "experimental",
      requiresProject: true,
      writesWorkspace: false,
    });
    caps.languageKernel!.schema!.adapters[0].capabilities = [
      javaOperation("changeSignature.changeParameterType", "stable", "managed-stable"),
    ];
    const fixture = sdkHarness(caps);
    const source = "class A { void run(int count) {} }";
    const path = target().path;
    const cursor = { line: 1, column: source.indexOf("run") + 2 };
    const cursorTarget = target({
      kind: "member",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    });
    const verify = vi.fn();
    const controller = fixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path, text: source, version: 3, isDirty: false }],
        verify,
      }),
      getCursorPosition: () => cursor,
    });

    act(() => {
      controller.result.current.open("change-method-parameter-type", cursorTarget, {
        path,
        ...cursor,
      });
      controller.result.current.setChangeIntent({
        operation: "change-method-parameter-type",
        parameterName: "count",
        newType: "java.lang.Integer",
      });
    });
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog?.status).toBe("preview");
    expect(fixture.harness.previewRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "change-method-parameter-type",
        target: cursorTarget,
        changeIntent: {
          operation: "change-method-parameter-type",
          parameterName: "count",
          newType: "java.lang.Integer",
        },
        projectContext: expect.any(Object),
      }),
    );
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).not.toHaveProperty("editorOverlay");
    expect(verify).toHaveBeenCalledOnce();

    const dirtyFixture = sdkHarness(caps);
    const dirtyController = dirtyFixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path, text: source, version: 4, isDirty: true }],
        verify: vi.fn(),
      }),
      getCursorPosition: () => cursor,
    });
    act(() => {
      dirtyController.result.current.open("change-method-parameter-type", cursorTarget, {
        path,
        ...cursor,
      });
      dirtyController.result.current.setChangeIntent({
        operation: "change-method-parameter-type",
        parameterName: "count",
        newType: "java.lang.Integer",
      });
    });
    await act(() => dirtyController.result.current.preview());
    expect(dirtyFixture.harness.previewRefactoring).not.toHaveBeenCalled();
    expect(dirtyController.result.current.dialog?.message).toContain("Save all open Java changes");
  });

  function rollbackSdkHarness() {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.rollbackAuthority = true;
    caps.methods!.push({
      name: "patch.rollback",
      stability: "experimental",
      requiresProject: true,
      writesWorkspace: true,
    });
    const fixture = sdkHarness(caps);
    fixture.harness.applyRefactoring.mockImplementation(async (request) =>
      applyResultFor(previewFor(request), {
        appliedContextHash: request.projectContext!.contextHash,
        appliedSnapshotHash: "e".repeat(64),
      }),
    );
    fixture.harness.rollbackRefactoring.mockImplementation(async (request) => ({
      ...rollbackResultFor(request.transactionId),
      rolledBackContextHash: request.projectContext!.contextHash,
      restoredSnapshotHash: request.projectContext!.snapshotHash,
    }));
    return fixture;
  }

  it("rolls back with original authority after Apply retires the observed context, holding the editor guard through refresh", async () => {
    const fixture = rollbackSdkHarness();
    const release = vi.fn();
    const beginWorkspaceWrite = vi.fn(() => release);
    const onSourceChanged = vi.fn(() => {
      fixture.selected = { ...fixture.selected, context: null };
    });
    const reconcileChanges = vi.fn(async () => {
      expect(release).not.toHaveBeenCalled();
      return undefined;
    });
    const controller = fixture.render({ beginWorkspaceWrite, onSourceChanged, reconcileChanges });
    openIdle(controller);
    await act(() => controller.result.current.preview());
    await act(() =>
      controller.result.current.applyDisplayedPlan(controller.result.current.dialog!.plan!),
    );
    expect(fixture.selected.context).toBeNull();
    release.mockClear();
    onSourceChanged.mockClear();
    await act(() => controller.result.current.rollback(controller.result.current.dialog!.result!));
    expect(fixture.harness.rollbackRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        projectContext: fixture.harness.previewRefactoring.mock.calls[0][0].projectContext,
        expectedSnapshotHash: "e".repeat(64),
      }),
    );
    expect(controller.result.current.dialog?.status).toBe("rolled-back");
    expect(onSourceChanged).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("keeps a refused-before-write rollback available for an explicit guarded retry", async () => {
    const fixture = rollbackSdkHarness();
    const { RefactorRollbackNotStartedError } = await import("@ide/web-core");
    fixture.harness.rollbackRefactoring.mockRejectedValueOnce(
      new RefactorRollbackNotStartedError("Rollback was not started. Review the changed files."),
    );
    const release = vi.fn(),
      beginWorkspaceWrite = vi.fn(() => release),
      reconcileChanges = vi.fn();
    const onSourceChanged = vi.fn(() => {
      fixture.selected = { ...fixture.selected, context: null };
    });
    const controller = fixture.render({ beginWorkspaceWrite, reconcileChanges, onSourceChanged });
    openIdle(controller);
    await act(() => controller.result.current.preview());
    await act(() =>
      controller.result.current.applyDisplayedPlan(controller.result.current.dialog!.plan!),
    );
    const applied = controller.result.current.dialog!.result!;
    reconcileChanges.mockClear();
    release.mockClear();
    await act(() => controller.result.current.rollback(applied));
    expect(controller.result.current.dialog?.status).toBe("rollback-refused");
    expect(controller.result.current.dialog?.result).toBe(applied);
    expect(controller.result.current.dialog?.message).toContain("not started");
    expect(reconcileChanges).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(fixture.harness.rollbackRefactoring).toHaveBeenCalledTimes(1);
    const originalRequest = fixture.harness.rollbackRefactoring.mock.calls[0][0];
    await act(() => controller.result.current.rollback(applied));
    expect(controller.result.current.dialog?.status).toBe("rolled-back");
    const retry = fixture.harness.rollbackRefactoring.mock.calls[1][0];
    expect(retry).toMatchObject({
      transactionId: originalRequest.transactionId,
      projectContext: originalRequest.projectContext,
      expectedSnapshotHash: originalRequest.expectedSnapshotHash,
    });
    expect(retry.requestId).not.toBe(originalRequest.requestId);
    expect(reconcileChanges).toHaveBeenCalledOnce();
  });

  it("rechecks SDK settings before retrying a rollback refused before writing", async () => {
    const fixture = rollbackSdkHarness();
    const { RefactorRollbackNotStartedError } = await import("@ide/web-core");
    fixture.harness.rollbackRefactoring.mockRejectedValueOnce(
      new RefactorRollbackNotStartedError("Rollback was not started."),
    );
    const controller = fixture.render();
    openIdle(controller);
    await act(() => controller.result.current.preview());
    await act(() =>
      controller.result.current.applyDisplayedPlan(controller.result.current.dialog!.plan!),
    );
    const applied = controller.result.current.dialog!.result!;
    await act(() => controller.result.current.rollback(applied));
    fixture.selected = {
      ...fixture.selected,
      settings: { ...settings, sdkHome: "/jdk-25" },
      context: null,
    };
    await act(() => controller.result.current.rollback(applied));
    expect(fixture.harness.rollbackRefactoring).toHaveBeenCalledOnce();
    expect(controller.result.current.dialog?.status).toBe("rollback-refused");
    expect(controller.result.current.dialog?.message).toBe(JAVA_REFACTORING_STALE_CONTEXT);
  });

  it("does not retry a generic rollback failure even when its text says not started", async () => {
    const fixture = rollbackSdkHarness();
    fixture.harness.rollbackRefactoring.mockRejectedValueOnce(
      new Error("Rollback was not started."),
    );
    const controller = fixture.render();
    openIdle(controller);
    await act(() => controller.result.current.preview());
    await act(() =>
      controller.result.current.applyDisplayedPlan(controller.result.current.dialog!.plan!),
    );
    const applied = controller.result.current.dialog!.result!;
    await act(() => controller.result.current.rollback(applied));
    expect(controller.result.current.dialog?.status).toBe("error");
    await act(() => controller.result.current.rollback(applied));
    expect(fixture.harness.rollbackRefactoring).toHaveBeenCalledOnce();
  });

  it("preserves the applied transaction and refuses rollback after SDK settings change", async () => {
    const fixture = rollbackSdkHarness();
    const controller = fixture.render();
    openIdle(controller);
    await act(() => controller.result.current.preview());
    await act(() =>
      controller.result.current.applyDisplayedPlan(controller.result.current.dialog!.plan!),
    );
    fixture.selected = {
      ...fixture.selected,
      settings: { ...settings, sdkHome: "/jdk-25" },
      context: null,
    };
    await act(() => controller.result.current.rollback(controller.result.current.dialog!.result!));
    expect(fixture.harness.rollbackRefactoring).not.toHaveBeenCalled();
    expect(controller.result.current.dialog?.status).toBe("applied");
    expect(controller.result.current.dialog?.message).toBe(JAVA_REFACTORING_STALE_CONTEXT);
  });

  it("retires context and reports unknown rollback when original provider authority is missing", async () => {
    const fixture = rollbackSdkHarness();
    fixture.harness.rollbackRefactoring.mockImplementation(async (request) =>
      rollbackResultFor(request.transactionId),
    );
    const onSourceChanged = vi.fn();
    const controller = fixture.render({ onSourceChanged });
    openIdle(controller);
    await act(() => controller.result.current.preview());
    await act(() =>
      controller.result.current.applyDisplayedPlan(controller.result.current.dialog!.plan!),
    );
    onSourceChanged.mockClear();
    await act(() => controller.result.current.rollback(controller.result.current.dialog!.result!));
    expect(controller.result.current.dialog?.status).toBe("error");
    expect(controller.result.current.dialog?.message).toContain("write outcome is unknown");
    await act(() => controller.result.current.rollback(controller.result.current.dialog!.result!));
    expect(fixture.harness.rollbackRefactoring).toHaveBeenCalledOnce();
    expect(onSourceChanged).toHaveBeenCalledOnce();
  });

  it("refuses an unsynchronized or partial SDK context before any provider preview", async () => {
    const fixture = sdkHarness();
    fixture.selected = { ...fixture.selected, context: null };
    const controller = fixture.render();
    openIdle(controller);
    await act(() => controller.result.current.preview());
    expect(controller.result.current.dialog?.status).toBe("refused");
    expect(fixture.harness.previewRefactoring).not.toHaveBeenCalled();
    fixture.selected = { ...fixture.selected, context: { ...fixture.context, status: "partial" } };
    openIdle(controller);
    await act(() => controller.result.current.preview());
    expect(fixture.harness.previewRefactoring).not.toHaveBeenCalled();
  });

  it("reviews Encapsulate Field against the exact clean saved field target without intent", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.operations = ["encapsulateField"];
    caps.languageKernel!.schema!.adapters[0].capabilities.push(
      javaOperation("encapsulateField", "stable", "managed-stable"),
    );
    const path = target().path;
    const captureEditorBuffers = vi.fn(() => ({
      documents: [{ path, text: "public final int value = 1;", version: 4, isDirty: false }],
      verify: vi.fn(),
    }));
    const fixture = sdkHarness(caps);
    const controller = fixture.render({ captureEditorBuffers });
    const fieldTarget = targetForOperation("encapsulate-field");
    act(() => controller.result.current.open("encapsulate-field", fieldTarget));

    await act(() => controller.result.current.preview());

    expect(fixture.harness.previewRefactoring).toHaveBeenCalledOnce();
    const request = fixture.harness.previewRefactoring.mock.calls[0][0];
    expect(request).toMatchObject({
      operation: "encapsulate-field",
      target: { kind: "member", path, identity: "example.A#value" },
      projectContext: expect.any(Object),
    });
    expect(request).not.toHaveProperty("changeIntent");
    expect(captureEditorBuffers.mock.results[0].value.verify).toHaveBeenCalledOnce();
  });

  it("refuses Encapsulate Field when a selected-project Java buffer is dirty", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.operations = ["encapsulateField"];
    caps.languageKernel!.schema!.adapters[0].capabilities.push(
      javaOperation("encapsulateField", "stable", "managed-stable"),
    );
    const fixture = sdkHarness(caps);
    const previewRefactoring = fixture.harness.previewRefactoring;
    const controller = fixture.render({
      captureEditorBuffers: () => ({
        documents: [
          { path: target().path, text: "public final int value = 1;", version: 4, isDirty: true },
        ],
        verify: vi.fn(),
      }),
    });
    act(() =>
      controller.result.current.open("encapsulate-field", targetForOperation("encapsulate-field")),
    );

    await act(() => controller.result.current.preview());

    expect(previewRefactoring).not.toHaveBeenCalled();
    expect(controller.result.current.dialog?.message).toMatch(/Save open Java files/u);
  });

  it("previews Inline Method from an exact saved JDT method cursor without intent", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.operations = ["inlineMethod"];
    caps.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    caps.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    caps.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    caps.languageKernel!.schema!.adapters[0].capabilities.push(
      javaOperation("inlineMethod", "stable", "managed-stable"),
    );
    const fixture = sdkHarness(caps);
    const path = target().path;
    const source = "class A { private static int twice() { return 2; } }";
    const cursor = { path, line: 1, column: source.indexOf("twice") + 2 };
    const verify = vi.fn();
    const controller = fixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path, text: source, version: 1, isDirty: false }],
        verify,
      }),
      getCursorPosition: () => ({ line: cursor.line, column: cursor.column }),
    });

    act(() =>
      controller.result.current.open(
        "inline-method",
        target({
          kind: "member",
          identity: "@cursor",
          selection: { start: cursor.column - 1, end: cursor.column - 1 },
        }),
        cursor,
      ),
    );
    await act(() => controller.result.current.preview());

    expect(fixture.harness.previewRefactoring).toHaveBeenCalledOnce();
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).toMatchObject({
      operation: "inline-method",
      target: {
        kind: "member",
        path,
        identity: "@cursor",
        selection: { start: cursor.column - 1, end: cursor.column - 1 },
      },
      projectContext: expect.any(Object),
    });
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).not.toHaveProperty("changeIntent");
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).not.toHaveProperty("editorOverlay");
    expect(verify).toHaveBeenCalledOnce();

    const dirtyFixture = sdkHarness(caps);
    const dirtyController = dirtyFixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path, text: source, version: 2, isDirty: true }],
        verify: vi.fn(),
      }),
      getCursorPosition: () => ({ line: cursor.line, column: cursor.column }),
    });
    act(() =>
      dirtyController.result.current.open(
        "inline-method",
        target({
          kind: "member",
          identity: "@cursor",
          selection: { start: cursor.column - 1, end: cursor.column - 1 },
        }),
        cursor,
      ),
    );
    await act(() => dirtyController.result.current.preview());

    expect(dirtyFixture.harness.previewRefactoring).not.toHaveBeenCalled();
    expect(dirtyController.result.current.dialog?.message).toContain("Save all open Java changes");
  });

  it("previews Extract Interface from an exact saved JDT class cursor", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.operations = ["extractInterface"];
    caps.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    caps.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    caps.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    const descriptor = caps.languageKernel!.schema!.adapters[0].capabilities[0]!;
    descriptor.operation = "extractInterface";
    descriptor.evidence = "compiler";
    const fixture = sdkHarness(caps);
    const path = target().path;
    const source = "public class A { public int calculate(int value) { return value; } }";
    const cursor = { path, line: 1, column: source.indexOf("A") + 1 };
    const verify = vi.fn();
    const captureEditorBuffers = vi.fn(() => ({
      documents: [{ path, text: source, version: 1, isDirty: false }],
      verify,
    }));
    const controller = fixture.render({
      captureEditorBuffers,
      getCursorPosition: () => ({ line: cursor.line, column: cursor.column }),
    });

    act(() =>
      controller.result.current.open(
        "extract-interface",
        targetForOperation("extract-interface"),
        cursor,
        {
          operation: "extract-interface",
          interfaceName: "AOperations",
          methodName: "calculate",
        },
      ),
    );
    await act(() => controller.result.current.preview());

    expect(fixture.harness.previewRefactoring).toHaveBeenCalledOnce();
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).toMatchObject({
      operation: "extract-interface",
      target: {
        kind: "class",
        path,
        identity: "@cursor",
        selection: { start: 0, end: 0 },
      },
      changeIntent: {
        operation: "extract-interface",
        interfaceName: "AOperations",
        methodName: "calculate",
      },
      projectContext: expect.any(Object),
    });
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).not.toHaveProperty("editorOverlay");
    expect(verify).toHaveBeenCalledOnce();
  });

  it("previews Extract Superclass from an exact saved JDT class cursor", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.operations = ["extractSuperclass"];
    caps.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    caps.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    caps.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    const descriptor = caps.languageKernel!.schema!.adapters[0].capabilities[0]!;
    descriptor.operation = "extractSuperclass";
    descriptor.evidence = "compiler";
    const fixture = sdkHarness(caps);
    const path = target().path;
    const source = "public class A { public int calculate(int value) { return value; } }";
    const cursor = { path, line: 1, column: source.indexOf("A") + 1 };
    const verify = vi.fn();
    const captureEditorBuffers = vi.fn(() => ({
      documents: [{ path, text: source, version: 1, isDirty: false }],
      verify,
    }));
    const controller = fixture.render({
      captureEditorBuffers,
      getCursorPosition: () => ({ line: cursor.line, column: cursor.column }),
    });

    act(() =>
      controller.result.current.open(
        "extract-superclass",
        targetForOperation("extract-superclass"),
        cursor,
        {
          operation: "extract-superclass",
          superclassName: "ABase",
          methodName: "calculate",
        },
      ),
    );
    await act(() => controller.result.current.preview());

    expect(fixture.harness.previewRefactoring).toHaveBeenCalledOnce();
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).toMatchObject({
      operation: "extract-superclass",
      target: {
        kind: "class",
        path,
        identity: "@cursor",
        selection: { start: 0, end: 0 },
      },
      changeIntent: {
        operation: "extract-superclass",
        superclassName: "ABase",
        methodName: "calculate",
      },
      projectContext: expect.any(Object),
    });
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).not.toHaveProperty("editorOverlay");
    expect(verify).toHaveBeenCalledOnce();
  });

  it("previews Move Member with the saved cursor and exact JDT destination, and refuses dirty buffers", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.operations = ["moveMember"];
    caps.javaContextRefactoring!.selectionQueryKind = "mutationSelection";
    caps.javaContextRefactoring!.selectionSchemaVersion = "java-mutation-selection-v1";
    caps.methods!.push({
      name: "intelligence.query",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: false,
    });
    const descriptor = caps.languageKernel!.schema!.adapters[0].capabilities[0]!;
    descriptor.operation = "moveMember";
    descriptor.evidence = "compiler";
    const fixture = sdkHarness(caps);
    const path = "app/src/main/java/pkg/Types.java";
    const source =
      "package pkg; class Source { static int value() { return 42; } } class Destination {}";
    const cursor = { path, line: 1, column: source.indexOf("value") + 1 };
    const targetValue = target({
      kind: "member",
      path,
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    });
    const changeIntent: RefactorKitChangeIntent = {
      operation: "move-member",
      targetType: "pkg.Destination",
      targetPath: path,
      targetPosition: { line: 0, character: source.indexOf("Destination") + 1 },
    };
    const verify = vi.fn();
    const controller = fixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path, text: source, version: 1, isDirty: false }],
        verify,
      }),
      getCursorPosition: () => ({ line: cursor.line, column: cursor.column }),
    });

    act(() => controller.result.current.open("move-member", targetValue, cursor, changeIntent));
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog?.status).toBe("preview");
    expect(fixture.harness.previewRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "move-member",
        target: targetValue,
        changeIntent,
        projectContext: expect.any(Object),
      }),
    );
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).not.toHaveProperty("editorOverlay");
    expect(verify).toHaveBeenCalledOnce();

    const dirtyFixture = sdkHarness(caps);
    const dirtyController = dirtyFixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path, text: source, version: 2, isDirty: true }],
        verify: vi.fn(),
      }),
      getCursorPosition: () => ({ line: cursor.line, column: cursor.column }),
    });
    act(() =>
      dirtyController.result.current.open("move-member", targetValue, cursor, changeIntent),
    );
    await act(() => dirtyController.result.current.preview());

    expect(dirtyFixture.harness.previewRefactoring).not.toHaveBeenCalled();
    expect(dirtyController.result.current.dialog?.message).toContain("Save all open Java changes");
  });

  it.each([
    ["extract-constant", "extractConstant", "ANSWER"],
    ["extract-variable", "extractVariable", "doubled"],
    ["extract-method", "extractMethod", "calculateTotal"],
    ["extract-parameter", "extractParameter", "offset"],
    ["extract-field", "extractField", "value"],
  ] as const)(
    "keeps %s on the exact clean saved selection captured at action time",
    async (operation, providerOperation, name) => {
      const caps = structuredClone(sdkCapabilities);
      caps.javaContextRefactoring!.operations = [providerOperation];
      caps.languageKernel!.schema!.adapters[0].capabilities.push(
        javaOperation(providerOperation, "stable", "managed-stable"),
      );
      const fixture = sdkHarness(caps);
      const source =
        operation === "extract-method" ? "int total = 1;" : "class A { int value = 1 + 2; }";
      const path = target().path;
      const selectedSource = operation === "extract-method" ? source : "1 + 2";
      const selectionStart = operation === "extract-method" ? 0 : source.indexOf(selectedSource);
      const changeIntent: RefactorKitChangeIntent =
        operation === "extract-method" ? { operation, methodName: name } : { operation, name };
      const captureEditorBuffers = vi.fn(() => ({
        documents: [{ path, text: source, version: 1, isDirty: false }],
        verify: vi.fn(),
      }));
      const controller = fixture.render({ captureEditorBuffers });
      act(() =>
        controller.result.current.open(
          operation,
          target({
            kind: "file",
            identity: path,
            selection: { start: selectionStart, end: selectionStart + selectedSource.length },
          }),
          undefined,
          changeIntent,
          { path, text: source },
        ),
      );
      await act(() => controller.result.current.preview());
      expect(fixture.harness.previewRefactoring).toHaveBeenCalledOnce();
      expect(fixture.harness.previewRefactoring.mock.calls[0][0]).toMatchObject({
        operation,
        target: {
          identity: path,
          selection: { start: selectionStart, end: selectionStart + selectedSource.length },
        },
        changeIntent,
      });
      expect(captureEditorBuffers.mock.results[0].value.verify).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["extract-constant", "extractConstant", "ANSWER"],
    ["extract-variable", "extractVariable", "doubled"],
    ["extract-method", "extractMethod", "calculateTotal"],
    ["extract-parameter", "extractParameter", "offset"],
    ["extract-field", "extractField", "value"],
  ] as const)(
    "refuses %s if the selected source is dirty or changed after selection",
    async (operation, providerOperation, name) => {
      for (const current of [
        {
          path: target().path,
          text:
            operation === "extract-method" ? "int total = 1;" : "class A { int value = 1 + 2; }",
          version: 1,
          isDirty: true,
        },
        {
          path: target().path,
          text:
            operation === "extract-method" ? "int total = 2;" : "class A { int value = 1 + 3; }",
          version: 1,
          isDirty: false,
        },
      ]) {
        const caps = structuredClone(sdkCapabilities);
        caps.javaContextRefactoring!.operations = [providerOperation];
        caps.languageKernel!.schema!.adapters[0].capabilities.push(
          javaOperation(providerOperation, "stable", "managed-stable"),
        );
        const fixture = sdkHarness(caps);
        const source =
          operation === "extract-method" ? "int total = 1;" : "class A { int value = 1 + 2; }";
        const path = target().path;
        const selectedSource = operation === "extract-method" ? source : "1 + 2";
        const start = operation === "extract-method" ? 0 : source.indexOf(selectedSource);
        const changeIntent: RefactorKitChangeIntent =
          operation === "extract-method" ? { operation, methodName: name } : { operation, name };
        const controller = fixture.render({
          captureEditorBuffers: () => ({ documents: [current], verify: vi.fn() }),
        });
        act(() =>
          controller.result.current.open(
            operation,
            target({
              kind: "file",
              identity: path,
              selection: { start, end: start + selectedSource.length },
            }),
            undefined,
            changeIntent,
            { path, text: source },
          ),
        );
        await act(() => controller.result.current.preview());
        expect(fixture.harness.previewRefactoring).not.toHaveBeenCalled();
        expect(controller.result.current.dialog?.message).toContain("Save all open Java changes");
      }
    },
  );

  it("refuses a source outside the selected project and an unadvertised SDK operation", async () => {
    const fixture = sdkHarness();
    fixture.selected.settings.projectPath = "other-project";
    const controller = fixture.render();
    openIdle(controller);
    await act(() => controller.result.current.preview());
    expect(controller.result.current.dialog?.message).toContain("outside the selected project");
    expect(fixture.harness.previewRefactoring).not.toHaveBeenCalled();
    fixture.selected.settings.projectPath = "";
    openIdle(controller, "rename-member");
    await act(() => controller.result.current.preview());
    expect(controller.result.current.dialog?.status).toBe("unavailable");
    expect(fixture.harness.previewRefactoring).not.toHaveBeenCalled();
  });

  it("captures project settings for the preview and exact approved apply; ordinary rollback stays unavailable", async () => {
    const fixture = sdkHarness();
    fixture.harness.applyRefactoring.mockImplementation(async (request) =>
      applyResultFor(previewFor(request), {
        appliedContextHash: request.projectContext!.contextHash,
      }),
    );
    const controller = fixture.render();
    openIdle(controller);
    await act(() => controller.result.current.preview());
    const request = fixture.harness.previewRefactoring.mock.calls[0][0];
    expect(request.projectContext).toEqual({
      ...settings,
      snapshotHash: fixture.context.snapshotHash,
      contextHash: fixture.context.contextHash,
      contextSchemaVersion: fixture.context.schemaVersion,
      platformIdentities: fixture.context.sdk.map((sdk) => sdk.identitySha256),
    });
    const plan = controller.result.current.dialog!.plan!;
    await act(() => controller.result.current.applyDisplayedPlan(plan));
    expect(fixture.harness.applyRefactoring.mock.calls[0][0].projectContext).toEqual(
      request.projectContext,
    );
    expect(controller.result.current.dialog?.status).toBe("applied");
    await act(() => controller.result.current.rollback(controller.result.current.dialog!.result!));
    expect(fixture.harness.rollbackRefactoring).not.toHaveBeenCalled();
  });

  it("retires a pending preview when profiles change, without mutating the captured request", async () => {
    const fixture = sdkHarness();
    const pending = deferred<RefactorPreviewResult>();
    fixture.harness.previewRefactoring.mockReturnValue(pending.promise);
    const controller = fixture.render();
    openIdle(controller);
    let work!: Promise<void>;
    act(() => {
      work = controller.result.current.preview();
    });
    const request = fixture.harness.previewRefactoring.mock.calls[0][0];
    fixture.selected.settings.activeMavenProfiles.push("new-profile");
    await act(async () => {
      pending.resolve(previewFor(request));
      await work;
    });
    expect(request.projectContext!.activeMavenProfiles).toEqual(["alternate"]);
    expect(controller.result.current.dialog?.status).toBe("refused");
    expect(fixture.harness.discardRefactoring).toHaveBeenCalledOnce();
  });

  it("discards a reviewed plan when the SDK changes before apply", async () => {
    const fixture = sdkHarness();
    const beginWorkspaceWrite = vi.fn();
    const controller = fixture.render({ beginWorkspaceWrite });
    openIdle(controller);
    await act(() => controller.result.current.preview());
    const plan = controller.result.current.dialog!.plan!;
    fixture.selected.settings.sdkHome = "/jdk-25";
    await act(() => controller.result.current.applyDisplayedPlan(plan));
    expect(controller.result.current.dialog?.status).toBe("refused");
    expect(fixture.harness.applyRefactoring).not.toHaveBeenCalled();
    expect(beginWorkspaceWrite).not.toHaveBeenCalled();
    expect(fixture.harness.discardRefactoring).toHaveBeenCalledOnce();
  });

  it("rejects a preview without provider context attestation and never fabricates apply success", async () => {
    const fixture = sdkHarness();
    fixture.harness.previewRefactoring.mockImplementation(async (request) => previewFor(request));
    const controller = fixture.render();
    openIdle(controller);
    await act(() => controller.result.current.preview());
    expect(controller.result.current.dialog?.status).toBe("refused");
    expect(fixture.harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("keeps the editor write guard until a captured SDK write finishes and reconciles confirmed effects", async () => {
    const fixture = sdkHarness();
    const pending = deferred<RefactorApplyResult>();
    const release = vi.fn();
    const reconcileChanges = vi.fn(async () => undefined);
    const onSourceChanged = vi.fn();
    fixture.harness.applyRefactoring.mockReturnValue(pending.promise);
    const controller = fixture.render({
      beginWorkspaceWrite: () => release,
      reconcileChanges,
      onSourceChanged,
    });
    openIdle(controller);
    await act(() => controller.result.current.preview());
    const plan = controller.result.current.dialog!.plan!;
    let work!: Promise<void>;
    act(() => {
      work = controller.result.current.applyDisplayedPlan(plan);
    });
    fixture.selected.settings.sdkHome = "/jdk-25";
    expect(release).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve(applyResultFor(plan, { appliedContextHash: fixture.context.contextHash }));
      await work;
    });
    expect(reconcileChanges).toHaveBeenCalledOnce();
    expect(onSourceChanged).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(controller.result.current.dialog?.status).toBe("applied");
  });
  it("reviews immutable draft companions without saving and refuses saved-source Apply", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.editorSelectionSchemaVersion = "java-editor-mutation-selection-v1";
    Object.assign(caps.javaContextRefactoring!, {
      dirtyEditorPreview: true,
      editorPreviewMethod: "refactor.editor.preview",
      editorPreviewSchemaVersion: "java-editor-refactoring-v1",
      editorPreviewOperations: ["renameClass"],
    });
    caps.methods!.push({
      name: "intelligence.query",
      stability: "experimental",
      requiresProject: true,
      writesWorkspace: false,
    });
    caps.methods![0].features!.immutableJavaEditorOverlays = true;
    caps.methods!.push({
      name: "refactor.editor.preview",
      stability: "experimental",
      requiresProject: true,
      writesWorkspace: false,
      features: {
        sdkAuthority: true,
        immutableEditorOverlay: true,
        versionedDocumentChanges: true,
        retainedPlanHash: true,
        apply: false,
      },
    });
    const fixture = sdkHarness(caps),
      verify = vi.fn(),
      savedReview = vi.fn();
    const documents = [
      { path: target().path, text: "class A { int dirty; }", version: 7, isDirty: true },
      { path: "src/main/java/example/B.java", text: "class B {}", version: 3, isDirty: false },
    ];
    fixture.harness.previewRefactoring.mockImplementation(async (request) =>
      previewFor(request, {
        projectContext: {
          projectPath: "",
          contextHash: request.projectContext!.contextHash,
          contextSchemaVersion: "java-project-context-v1",
          platformIdentities: request.projectContext!.platformIdentities,
        },
        diffTruncated: false,
        applyEligibility: { eligible: false, blockers: ["Draft Apply unavailable"] },
        editorPreview: {
          planHash: "a".repeat(64),
          selectionHash: "b".repeat(64),
          baseSnapshotHash: request.projectContext!.snapshotHash,
          providerSnapshotHash: "c".repeat(64),
          expectedProviderSnapshotHash: "d".repeat(64),
          overlayHash: "e".repeat(64),
          documents: documents.map(({ path, version }) => ({
            path,
            version,
            contentSha256: "f".repeat(64),
          })),
        },
      }),
    );
    const controller = fixture.render({
      captureEditorBuffers: () => ({ documents, verify }),
      reviewSavedBuffers: savedReview,
      getCursorPosition: () => ({ line: 1, column: 7 }),
    });
    act(() => {
      controller.result.current.open("rename-class", target({ identity: "" }));
    });
    act(() => {
      controller.result.current.setChangeIntent({ operation: "rename-class", newName: "Renamed" });
    });
    await act(() => controller.result.current.preview());
    expect(controller.result.current.dialog?.status).toBe("preview");
    expect(fixture.harness.previewRefactoring.mock.calls[0][0].editorOverlay).toEqual({
      documents: documents.map(({ isDirty: _dirty, ...doc }) => doc),
      position: { line: 0, character: 6 },
    });
    expect(savedReview).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledOnce();
    await act(() =>
      controller.result.current.applyDisplayedPlan(controller.result.current.dialog!.plan!),
    );
    expect(fixture.harness.applyRefactoring).not.toHaveBeenCalled();
    expect(documents[0].text).toContain("dirty");
  });

  it.each([false, true])("selects the member rename route with dirty buffers = %s", async (isDirty) => {
    const caps = structuredClone(sdkCapabilities);
    Object.assign(caps.javaContextRefactoring!, {
      operations: ["renameMember"],
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
      editorSelectionSchemaVersion: "java-editor-mutation-selection-v1",
      dirtyEditorPreview: true,
      editorPreviewMethod: "refactor.editor.preview",
      editorPreviewSchemaVersion: "java-editor-refactoring-v1",
      editorPreviewOperations: ["renameMember"],
    });
    caps.methods![0].features!.immutableJavaEditorOverlays = true;
    for (const name of ["intelligence.query", "refactor.editor.preview"])
      caps.methods!.push({ name, stability: "experimental", requiresProject: true, writesWorkspace: false });
    caps.languageKernel!.schema!.adapters[0].capabilities.push(
      javaOperation("renameMember", "stable", "managed-stable"),
    );
    const fixture = sdkHarness(caps);
    const path = target().path;
    const text = "class A { int amount; }";
    const start = text.indexOf("amount");
    const cursor = { line: 1, column: start + 1 };
    const verify = vi.fn();
    const controller = fixture.render({
      captureEditorBuffers: () => ({ documents: [{ path, text, version: 4, isDirty }], verify }),
      getCursorPosition: () => cursor,
    });
    act(() => {
      controller.result.current.open(
        "rename-member",
        target({ kind: "member", identity: "@cursor", selection: { start, end: start } }),
        { path, ...cursor },
      );
      controller.result.current.setChangeIntent({ operation: "rename-member", newName: "label" });
    });
    await act(() => controller.result.current.preview());
    expect(fixture.harness.previewRefactoring).toHaveBeenCalledOnce();
    const request = fixture.harness.previewRefactoring.mock.calls[0][0];
    if (isDirty) {
      expect(request.editorOverlay).toEqual({
        documents: [{ path, text, version: 4 }],
        position: { line: 0, character: start },
      });
    } else {
      expect(request).not.toHaveProperty("editorOverlay");
      expect(request.target.selection).toEqual({ start, end: start });
      expect(verify).toHaveBeenCalledOnce();
    }
  });

  it("captures a clean cursor-selected source with the exact editor position", async () => {
    const caps = structuredClone(sdkCapabilities);
    Object.assign(caps.javaContextRefactoring!, {
      editorSelectionSchemaVersion: "java-editor-mutation-selection-v1",
      dirtyEditorPreview: true,
      editorPreviewMethod: "refactor.editor.preview",
      editorPreviewSchemaVersion: "java-editor-refactoring-v1",
      editorPreviewOperations: ["renameClass"],
    });
    caps.methods![0].features!.immutableJavaEditorOverlays = true;
    caps.methods!.push(
      {
        name: "intelligence.query",
        stability: "experimental",
        requiresProject: true,
        writesWorkspace: false,
      },
      {
        name: "refactor.editor.preview",
        stability: "experimental",
        requiresProject: true,
        writesWorkspace: false,
      },
    );
    const fixture = sdkHarness(caps);
    const verify = vi.fn();
    const documents = [{ path: target().path, text: "class A {}", version: 4, isDirty: false }];
    fixture.harness.previewRefactoring.mockImplementation(async (request) =>
      previewFor(request, {
        projectContext: {
          projectPath: "",
          contextHash: request.projectContext!.contextHash,
          contextSchemaVersion: "java-project-context-v1",
          platformIdentities: request.projectContext!.platformIdentities,
        },
        diffTruncated: false,
        applyEligibility: { eligible: false, blockers: ["Editor preview only"] },
        editorPreview: {
          planHash: "a".repeat(64),
          selectionHash: "b".repeat(64),
          baseSnapshotHash: request.projectContext!.snapshotHash,
          providerSnapshotHash: "c".repeat(64),
          expectedProviderSnapshotHash: "d".repeat(64),
          overlayHash: "e".repeat(64),
          documents: documents.map(({ path, version }) => ({
            path,
            version,
            contentSha256: "f".repeat(64),
          })),
        },
      }),
    );
    const controller = fixture.render({
      captureEditorBuffers: () => ({ documents, verify }),
      getCursorPosition: () => ({ line: 20, column: 3 }),
    });
    act(() => {
      controller.result.current.open("rename-class", target({ identity: "@cursor" }), {
        path: target().path,
        line: 2,
        column: 11,
      });
      controller.result.current.setChangeIntent({ operation: "rename-class", newName: "Renamed" });
    });
    await act(() => controller.result.current.preview());
    expect(fixture.harness.previewRefactoring.mock.calls[0][0]).toMatchObject({
      target: { identity: "@cursor" },
      editorOverlay: {
        documents: [{ path: target().path, text: "class A {}", version: 4 }],
        position: { line: 1, character: 10 },
      },
    });
    expect(controller.result.current.dialog?.status).toBe("preview");
    expect(verify).toHaveBeenCalledOnce();
  });

  it("revokes an in-flight draft review after an edit and restore", async () => {
    const caps = structuredClone(sdkCapabilities);
    caps.javaContextRefactoring!.editorSelectionSchemaVersion = "java-editor-mutation-selection-v1";
    Object.assign(caps.javaContextRefactoring!, {
      dirtyEditorPreview: true,
      editorPreviewMethod: "refactor.editor.preview",
      editorPreviewSchemaVersion: "java-editor-refactoring-v1",
      editorPreviewOperations: ["renameClass"],
    });
    caps.methods!.push({
      name: "intelligence.query",
      stability: "experimental",
      requiresProject: true,
      writesWorkspace: false,
    });
    caps.methods![0].features!.immutableJavaEditorOverlays = true;
    caps.methods!.push({
      name: "refactor.editor.preview",
      stability: "experimental",
      requiresProject: true,
      writesWorkspace: false,
      features: {
        sdkAuthority: true,
        immutableEditorOverlay: true,
        versionedDocumentChanges: true,
        retainedPlanHash: true,
        apply: false,
      },
    });
    const fixture = sdkHarness(caps),
      pending = deferred<RefactorPreviewResult>();
    let revision = 1;
    fixture.harness.previewRefactoring.mockReturnValue(pending.promise);
    const controller = fixture.render({
      captureEditorBuffers: () => ({
        documents: [{ path: target().path, text: "class A {}", version: 1, isDirty: true }],
        verify: () => {
          if (revision !== 1) throw new Error("Editor buffers changed after the review");
        },
      }),
      getCursorPosition: () => ({ line: 1, column: 7 }),
    });
    act(() => {
      controller.result.current.open("rename-class", target());
    });
    act(() => {
      controller.result.current.setChangeIntent({ operation: "rename-class", newName: "Renamed" });
    });
    let work!: Promise<void>;
    act(() => {
      work = controller.result.current.preview();
    });
    revision += 2;
    const request = fixture.harness.previewRefactoring.mock.calls[0][0];
    const state = previewFor(request, {
      projectContext: {
        projectPath: "",
        contextHash: request.projectContext!.contextHash,
        contextSchemaVersion: "java-project-context-v1",
        platformIdentities: request.projectContext!.platformIdentities,
      },
      diffTruncated: false,
      applyEligibility: { eligible: false, blockers: [] },
      editorPreview: {
        planHash: "a".repeat(64),
        selectionHash: "b".repeat(64),
        baseSnapshotHash: request.projectContext!.snapshotHash,
        providerSnapshotHash: "c".repeat(64),
        expectedProviderSnapshotHash: "d".repeat(64),
        overlayHash: "e".repeat(64),
        documents: [{ path: target().path, version: 1, contentSha256: "f".repeat(64) }],
      },
    });
    await act(async () => {
      pending.resolve(state);
      await work;
    });
    expect(controller.result.current.dialog?.status).toBe("refused");
    expect(controller.result.current.dialog?.message).toContain("buffers changed");
    expect(fixture.harness.discardRefactoring).toHaveBeenCalled();
  });
  async function editorMutationHarness() {
    const caps = structuredClone(sdkCapabilities);
    Object.assign(caps.javaContextRefactoring!, {
      editorSelectionSchemaVersion: "java-editor-mutation-selection-v1",
      dirtyEditorPreview: true,
      editorPreviewMethod: "refactor.editor.preview",
      editorPreviewSchemaVersion: "java-editor-refactoring-v1",
      editorPreviewOperations: ["renameClass"],
      dirtyEditorMutationAuthority: true,
      durableEditorRecovery: true,
      editorTransactionSchemaVersion: "java-editor-transaction-v1",
      editorMutationOperations: ["renameClass"],
    });
    caps.methods![0].features!.immutableJavaEditorOverlays = true;
    caps.methods!.push({
      name: "intelligence.query",
      stability: "experimental",
      requiresProject: true,
      writesWorkspace: false,
    });
    caps.methods!.push({
      name: "refactor.editor.preview",
      stability: "experimental",
      requiresProject: true,
      writesWorkspace: false,
      features: {
        sdkAuthority: true,
        immutableEditorOverlay: true,
        versionedDocumentChanges: true,
        retainedPlanHash: true,
        durableEditorMutationMode: true,
        qualifiedDirtyApply: true,
      },
    });
    for (const phase of [
      "prepare",
      "confirm",
      "undo.prepare",
      "undo.confirm",
      "recover",
      "transactions",
    ])
      caps.methods!.push({
        name: `refactor.editor.${phase}`,
        stability: "experimental",
        requiresProject: true,
        writesWorkspace: false,
        features: { [phase === "transactions" ? "durableDiscovery" : "durableRecovery"]: true },
      });
    const fixture = sdkHarness(caps),
      store = createEditorStore();
    const port: EditorPort = {
      loadContent: vi.fn(async (filePath) => ({
        filePath,
        content: "class A {}",
        language: "java" as const,
      })),
      saveContent: vi.fn(async () => []),
      getOpenFiles: vi.fn(async () => []),
      closeFile: vi.fn(() => []),
      adoptRenamedFile: vi.fn(async () => {}),
    };
    const editor = new EditorViewModel(store.getState, port),
      original = "class A { int dirty; }",
      renamed = "src/main/java/example/Renamed.java",
      id = "12345678-1234-1234-1234-123456789abc";
    await editor.openFile(target().path);
    editor.updateContent(target().path, original);
    fixture.harness.previewRefactoring.mockImplementation(async (request) =>
      previewFor(request, {
        projectContext: {
          projectPath: "",
          contextHash: request.projectContext!.contextHash,
          contextSchemaVersion: "java-project-context-v1",
          platformIdentities: request.projectContext!.platformIdentities,
        },
        diffTruncated: false,
        affectedFiles: [
          { change: "move", path: renamed, previousPath: target().path, primary: true },
        ],
        editorPreview: {
          mutationMode: "durable-editor-owned",
          planHash: "a".repeat(64),
          selectionHash: "b".repeat(64),
          baseSnapshotHash: request.projectContext!.snapshotHash,
          providerSnapshotHash: "c".repeat(64),
          expectedProviderSnapshotHash: "d".repeat(64),
          overlayHash: "e".repeat(64),
          documents: request.editorOverlay!.documents.map((d) => ({
            path: d.path,
            version: d.version,
            contentSha256: "f".repeat(64),
          })),
        },
      }),
    );
    const transaction = vi.fn(
      async (
        request: import("@ide/contracts").JavaEditorTransactionRequest,
      ): Promise<import("@ide/contracts").JavaEditorTransactionResult> => {
        const base = {
          transactionId: id,
          planId: request.planId!,
          approvedPlanHash: request.approvedPlanHash!,
          baseSnapshotHash: request.projectContext.snapshotHash,
          contextHash: request.projectContext.contextHash,
          platformIdentities: request.projectContext.platformIdentities,
          durableRecoveryAvailable: true as const,
        };
        const inverse = request.phase === "undo.prepare" || request.phase === "recover";
        if (["prepare", "undo.prepare", "recover"].includes(request.phase))
          return {
            kind: "transaction",
            transaction: {
              ...base,
              status: inverse ? "undo-prepared" : "prepared",
              workspaceEdit: {
                documentChanges: [
                  {
                    kind: "edit",
                    path: request.documents[0].path,
                    version: request.documents[0].version,
                    edits: [
                      {
                        range: {
                          start: { line: 0, character: 0 },
                          end: { line: 0, character: request.documents[0].text.length },
                        },
                        newText: inverse ? original : original.replace("class A", "class Renamed"),
                      },
                    ],
                  },
                  {
                    kind: "rename",
                    oldPath: request.documents[0].path,
                    path: inverse ? target().path : renamed,
                  },
                ],
              },
            },
          };
        if (request.phase === "apply-files")
          return {
            kind: "files-applied",
            transactionId: id,
            diskSources: [
              {
                oldPath: request.documents[0].path,
                path: request.documents[0].path === renamed ? target().path : renamed,
                revision: "f".repeat(64),
              },
            ],
          };
        return {
          kind: "transaction",
          transaction: { ...base, status: request.phase === "confirm" ? "applied" : "undone" },
        };
      },
    );
    fixture.harness.refactorKit.editorTransaction = transaction;
    const retire = vi.fn(() => {
        fixture.selected = { ...fixture.selected, context: null };
      }),
      reconcile = vi.fn(async () => undefined);
    const controller = fixture.render({
      captureEditorBuffers: () => editor.captureEditorBuffers(),
      beginEditorTransaction: () => editor.beginEditorTransaction(),
      getCursorPosition: () => ({ line: 1, column: 7 }),
      onEditorSourceChanged: retire,
      reconcileEditorBuffers: reconcile,
    });
    openIdle(controller, "rename-class", target({ identity: "" }));
    await act(() => controller.result.current.preview());
    expect(controller.result.current.dialog?.status).toBe("preview");
    return {
      fixture,
      store,
      port,
      editor,
      original,
      renamed,
      transaction,
      controller,
      retire,
      reconcile,
    };
  }

  it("applies and undoes dirty editor plans without source Apply, Save or stopping the SDK session", async () => {
    const h = await editorMutationHarness(),
      plan = h.controller.result.current.dialog!.plan!;
    expect(h.fixture.harness.previewRefactoring.mock.calls[0][0].editorMutationMode).toBe(
      "durable-editor-owned",
    );
    await act(() => h.controller.result.current.applyDisplayedPlan(plan));
    expect(h.controller.result.current.dialog?.status).toBe("applied");
    expect(h.store.getState().contents[h.renamed]).toBe(
      h.original.replace("class A", "class Renamed"),
    );
    expect(h.retire).toHaveBeenCalledOnce();
    expect(h.fixture.selected.context).toBeNull();
    await act(() => h.controller.result.current.undoEditorTransaction());
    expect(h.controller.result.current.dialog?.status).toBe("undone");
    expect(h.store.getState().contents[target().path]).toBe(h.original);
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
    expect(h.transaction.mock.calls.map(([q]) => q.phase)).toEqual([
      "prepare",
      "apply-files",
      "confirm",
      "undo.prepare",
      "apply-files",
      "undo.confirm",
    ]);
    expect(h.fixture.harness.applyRefactoring).not.toHaveBeenCalled();
    expect(h.fixture.harness.rollbackRefactoring).not.toHaveBeenCalled();
    expect(h.port.saveContent).not.toHaveBeenCalled();
    expect(h.reconcile).toHaveBeenCalledTimes(2);
  });
  it("revokes an editor Apply after edit-and-restore before any native preparation", async () => {
    const h = await editorMutationHarness(),
      plan = h.controller.result.current.dialog!.plan!;
    h.editor.updateContent(target().path, "changed");
    h.editor.updateContent(target().path, h.original);
    await act(() => h.controller.result.current.applyDisplayedPlan(plan));
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.controller.result.current.dialog?.status).toBe("refused");
    expect(h.store.getState().contents[target().path]).toBe(h.original);
  });
  it("retains transformed drafts and transaction identity after lost confirmation and offers guarded recovery", async () => {
    const h = await editorMutationHarness(),
      originalInvoke = h.transaction.getMockImplementation()!;
    h.transaction.mockImplementation(async (q) => {
      if (q.phase === "confirm") throw Error("lost confirmation");
      return originalInvoke(q);
    });
    await act(() =>
      h.controller.result.current.applyDisplayedPlan(h.controller.result.current.dialog!.plan!),
    );
    expect(h.controller.result.current.dialog).toMatchObject({
      status: "error",
      editorTransaction: { status: "prepared" },
    });
    expect(h.store.getState().contents[h.renamed]).toContain("class Renamed");
    await act(() => h.controller.result.current.recoverEditorTransaction());
    expect(h.controller.result.current.dialog?.status).toBe("undone");
    expect(h.store.getState().contents[target().path]).toBe(h.original);
    expect(h.port.saveContent).not.toHaveBeenCalled();
  });
  it("requires unchanged selected SDK settings for editor Undo even after context retirement", async () => {
    const h = await editorMutationHarness();
    await act(() =>
      h.controller.result.current.applyDisplayedPlan(h.controller.result.current.dialog!.plan!),
    );
    h.fixture.selected = {
      ...h.fixture.selected,
      settings: { ...h.fixture.selected.settings, sdkHome: "/other-sdk" },
    };
    await act(() => h.controller.result.current.undoEditorTransaction());
    expect(h.transaction).toHaveBeenCalledTimes(3);
    expect(h.controller.result.current.dialog?.message).toBe(JAVA_REFACTORING_STALE_CONTEXT);
    expect(h.store.getState().contents[h.renamed]).toContain("class Renamed");
  });
  it("cannot offer editor mutation after the provider withdraws durable recovery", async () => {
    const h = await editorMutationHarness();
    h.fixture.harness.capabilities.javaContextRefactoring!.durableEditorRecovery = false;
    await act(() =>
      h.controller.result.current.applyDisplayedPlan(h.controller.result.current.dialog!.plan!),
    );
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.controller.result.current.dialog?.status).toBe("unavailable");
  });
});

describe("reopening the last applied saved-source refactoring", () => {
  async function applied(harness = createHarness(), generation?: () => number) {
    const controller = renderController(harness, "workspace-one", generation);
    const plan = await previewReady(controller);
    await act(async () => controller.result.current.applyDisplayedPlan(plan));
    expect(controller.result.current.dialog?.status).toBe("applied");
    return { controller, harness, plan, result: controller.result.current.dialog!.result! };
  }
  it("closes and reopens the exact applied result without acquiring new authority, then uses ordinary guarded Rollback", async () => {
    const f = await applied();
    act(() => f.controller.result.current.cancel());
    expect(f.controller.result.current.dialog).toBeNull();
    expect(f.controller.result.current.canReopenApplied).toBe(true);
    act(() => expect(f.controller.result.current.reopenApplied()).toBe(true));
    expect(f.controller.result.current.dialog?.result).toEqual(f.result);
    expect(f.controller.result.current.dialog?.plan).toEqual(f.plan);
    expect(f.harness.previewRefactoring).toHaveBeenCalledTimes(1);
    expect(f.harness.applyRefactoring).toHaveBeenCalledTimes(1);
    expect(f.harness.discardRefactoring).not.toHaveBeenCalled();
    await act(async () =>
      f.controller.result.current.rollback(f.controller.result.current.dialog!.result!),
    );
    expect(f.controller.result.current.dialog?.status).toBe("rolled-back");
    expect(f.harness.rollbackRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: f.result.transactionId,
        operation: f.plan.operation,
        authority: f.plan.authority,
      }),
    );
    act(() => f.controller.result.current.cancel());
    expect(f.controller.result.current.canReopenApplied).toBe(false);
    act(() => expect(f.controller.result.current.reopenApplied()).toBe(false));
  });
  it("retains a typed rollback refusal for a later retry rather than fabricating a completed rollback", async () => {
    const f = await applied();
    f.harness.rollbackRefactoring.mockRejectedValueOnce(
      new RefactorRollbackNotStartedError("Rollback was not started. Review build outputs."),
    );
    await act(async () => f.controller.result.current.rollback(f.result));
    expect(f.controller.result.current.dialog?.status).toBe("rollback-refused");
    const request = f.harness.rollbackRefactoring.mock.calls[0][0];
    act(() => f.controller.result.current.cancel());
    act(() => expect(f.controller.result.current.reopenApplied()).toBe(true));
    expect(f.controller.result.current.dialog?.status).toBe("rollback-refused");
    await act(async () =>
      f.controller.result.current.rollback(f.controller.result.current.dialog!.result!),
    );
    expect(f.harness.rollbackRefactoring.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        transactionId: request.transactionId,
        authority: request.authority,
      }),
    );
  });
  it("does not retain an unapplied preview or replace another open review", async () => {
    const harness = createHarness(),
      controller = renderController(harness);
    await previewReady(controller);
    act(() => controller.result.current.cancel());
    expect(controller.result.current.canReopenApplied).toBe(false);
    const f = await applied();
    act(() => f.controller.result.current.cancel());
    openIdle(f.controller, "format-file");
    act(() => expect(f.controller.result.current.reopenApplied()).toBe(false));
    expect(f.controller.result.current.dialog?.operation).toBe("format-file");
    act(() => f.controller.result.current.cancel());
    act(() => expect(f.controller.result.current.reopenApplied()).toBe(true));
    expect(f.controller.result.current.dialog?.status).toBe("applied");
  });
  it("refuses a retired activation even before the next React render", async () => {
    let generation = 7;
    const f = await applied(createHarness(), () => generation);
    act(() => f.controller.result.current.cancel());
    generation++;
    act(() => expect(f.controller.result.current.reopenApplied()).toBe(false));
    expect(f.controller.result.current.dialog).toBeNull();
    expect(f.harness.rollbackRefactoring).not.toHaveBeenCalled();
    f.controller.rerender();
    expect(f.controller.result.current.canReopenApplied).toBe(false);
  });
  it("clears retained authority on explicit workspace reset and provider replacement", async () => {
    const f = await applied();
    act(() => f.controller.result.current.cancel());
    act(() => f.controller.result.current.resetWorkspace());
    expect(f.controller.result.current.canReopenApplied).toBe(false);
    const other = await applied();
    act(() => other.controller.result.current.cancel());
    other.harness.refactorKit = { ...other.harness.refactorKit };
    other.controller.rerender();
    expect(other.controller.result.current.canReopenApplied).toBe(false);
    act(() => expect(other.controller.result.current.reopenApplied()).toBe(false));
    expect(other.harness.rollbackRefactoring).not.toHaveBeenCalled();
  });
  it("does not reopen after the controller unmounts", async () => {
    const f = await applied();
    act(() => f.controller.result.current.cancel());
    const reopen = f.controller.result.current.reopenApplied;
    f.controller.unmount();
    expect(reopen()).toBe(false);
  });
});
