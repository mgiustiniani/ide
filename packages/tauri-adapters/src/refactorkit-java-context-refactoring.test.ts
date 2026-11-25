import { webcrypto } from "node:crypto";
import type {
  RefactorKitCapabilities,
  RefactorPreviewRequest,
  RefactorPreviewResult,
  RefactorApplyRequest,
  RefactorRollbackRequest,
} from "@ide/contracts";
import { invoke } from "@tauri-apps/api/core";
import { JavaProjectContextRetiredError, RefactorRollbackNotStartedError } from "@ide/web-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TauriRefactorKitAdapter } from "./refactorkit-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);
type TestRefactorKitCapabilities = RefactorKitCapabilities & {
  javaContextRefactoring: NonNullable<RefactorKitCapabilities["javaContextRefactoring"]>;
  methods: NonNullable<RefactorKitCapabilities["methods"]>;
  generalRefactoring: NonNullable<RefactorKitCapabilities["generalRefactoring"]>;
};
const request: RefactorPreviewRequest = {
  operation: "format-file",
  target: { kind: "file", path: "project/A.java", identity: "project/A.java" },
  authority: { workspaceId: "workspace", workspaceGeneration: 1 },
  selectionGeneration: 2,
  requestId: "preview-1",
  projectContext: {
    projectPath: "project",
    sdkHome: "/jdk-21",
    mavenRepository: "/cache",
    activeMavenProfiles: ["alternate"],
    inactiveMavenProfiles: [],
    snapshotHash: "a".repeat(64),
    contextHash: "b".repeat(64),
    platformIdentities: ["c".repeat(64)],
  },
};
const formatterProfile = { path: "config/team.xml", profileName: "Team" };
const formatterProfileSha256 = "d".repeat(64);
function capabilities(): TestRefactorKitCapabilities {
  return {
    api: "refactorkit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.7.0",
    javaImportExternalClass: {
      supported: true,
      targetDirectory: true,
      preview: true,
      apply: true,
      rollback: true,
      stability: "experimental",
    },
    generalRefactoring: {
      supported: false,
      operations: [],
      preview: false,
      apply: false,
      rollback: false,
      discard: false,
      stability: "experimental",
    },
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["formatFile"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: false,
      renderedDiff: true,
    },
    languageKernel: {
      available: true,
      schema: {
        schemaVersion: 1,
        adapters: [
          {
            languageId: "java",
            extensions: ["java"],
            backend: "java-test-backend",
            runtime: {
              executionMode: "in-process",
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
            },
            capabilities: [
              {
                operation: "formatFile",
                stability: "stable",
                evidence: "structural-parse",
                mutationAuthority: "managed-stable",
                backend: "java-test-backend",
                runtime: {
                  executionMode: "in-process",
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
                },
                extensions: ["java"],
              },
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
      {
        name: "refactor.discard",
        stability: "experimental",
        requiresProject: false,
        writesWorkspace: false,
      },
    ],
  };
}
function preview(): RefactorPreviewResult {
  return {
    planId: "sdk-plan",
    operation: request.operation,
    target: request.target,
    status: "ready",
    summary: "Format A.java",
    confidence: 1,
    riskLevel: "low",
    risks: [],
    evidence: [],
    affectedFiles: [{ change: "edit", path: request.target.path, primary: false }],
    renderedDiff: "--- a/A.java\n+++ b/A.java\n-class A{}\n+class A {}\n",
    diffTruncated: false,
    diffTruncationReasons: [],
    structuredDiff: [],
    warnings: [],
    diagnosticsAfterPreview: [],
    conflicts: [],
    refusalReasons: [],
    applyEligibility: { eligible: true, blockers: [] },
    staleness: { stale: false, reasons: [] },
    grantsApplyAuthority: false,
    authority: request.authority,
    selectionGeneration: request.selectionGeneration,
    requestId: request.requestId,
    provider: "refactorkit-java",
    providerVersion: "0.7.0",
    projectContext: {
      projectPath: "project",
      contextHash: request.projectContext!.contextHash,
      contextSchemaVersion: "java-project-context-v1",
      platformIdentities: request.projectContext!.platformIdentities,
    },
  };
}
const applyRequest: RefactorApplyRequest = {
  ...request,
  planId: "sdk-plan",
  approval: {
    approvalId: "approved",
    approvedPlanId: "sdk-plan",
    approvedAt: "2026-10-03T12:00:00Z",
  },
};
const rollbackRequest: RefactorRollbackRequest = {
  transactionId: "sdk-transaction",
  operation: request.operation,
  authority: request.authority,
  requestId: "rollback-1",
  projectContext: request.projectContext,
  expectedSnapshotHash: "e".repeat(64),
};
function rollbackCapabilities() {
  const base = capabilities();
  base.javaContextRefactoring.rollbackAuthority = true;
  base.methods.push({
    name: "patch.rollback",
    stability: "experimental",
    requiresProject: true,
    writesWorkspace: true,
  });
  return base;
}
function rollbackResponse() {
  return {
    transactionId: "sdk-transaction",
    rolledBack: true,
    changedFiles: preview().affectedFiles,
    conflicts: [],
    diagnostics: [],
    rolledBackContextHash: request.projectContext!.contextHash,
    restoredSnapshotHash: request.projectContext!.snapshotHash,
  };
}
function install(base = capabilities(), response: unknown = preview()) {
  mockedInvoke.mockImplementation(async (command) => {
    if (command === "get_refactorkit_engine_capabilities")
      return {
        engineDiscovered: false,
        operations: [],
        operationalSurface: [],
        rollbackAdvertised: false,
        previewReadOnly: false,
        path: null,
        version: null,
        workspaceId: "workspace",
        reason: "CLI unavailable",
      };
    if (command === "get_refactorkit_capabilities") return base;
    if (command === "discard_refactorkit_engine_refactoring")
      return { planId: "sdk-plan", discarded: true };
    return response;
  });
}
describe("SDK-bound RefactorKit transport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rolls back with original context and committed snapshot even when ordinary rollback is unavailable", async () => {
    install(rollbackCapabilities(), rollbackResponse());
    const result = await new TauriRefactorKitAdapter().rollbackRefactoring(rollbackRequest);
    expect(result).toEqual(rollbackResponse());
    expect(mockedInvoke).toHaveBeenCalledWith("rollback_refactorkit_engine_refactoring", {
      request: rollbackRequest,
    });
  });

  it("refuses rollback before writing when SDK authority or committed snapshot is missing", async () => {
    install();
    await expect(
      new TauriRefactorKitAdapter().rollbackRefactoring(rollbackRequest),
    ).rejects.toThrow("does not advertise");
    install(rollbackCapabilities());
    await expect(
      new TauriRefactorKitAdapter().rollbackRefactoring({
        ...rollbackRequest,
        expectedSnapshotHash: undefined,
      }),
    ).rejects.toThrow("Invalid original Java rollback");
    expect(
      mockedInvoke.mock.calls.some(
        ([command]) => command === "rollback_refactorkit_engine_refactoring",
      ),
    ).toBe(false);
  });

  it("rejects successful rollback responses without original context and restored snapshot confirmation", async () => {
    for (const field of ["rolledBackContextHash", "restoredSnapshotHash"] as const) {
      const response: Record<string, unknown> = rollbackResponse();
      delete response[field];
      install(rollbackCapabilities(), response);
      await expect(
        new TauriRefactorKitAdapter().rollbackRefactoring(rollbackRequest),
      ).rejects.toThrow("write outcome is unknown");
    }
  });

  it("preserves explicit SDK admission even when the CLI is unavailable and sends captured context", async () => {
    install();
    const adapter = new TauriRefactorKitAdapter();
    expect((await adapter.getCapabilities()).javaContextRefactoring).toEqual(
      capabilities().javaContextRefactoring,
    );
    const result = await adapter.previewRefactoring(request);
    expect(result.projectContext).toEqual(preview().projectContext);
    expect(Object.isFrozen(result.projectContext!.platformIdentities)).toBe(true);
    expect(mockedInvoke).toHaveBeenCalledWith("preview_refactorkit_engine_refactoring", {
      request,
    });
    await adapter.discardRefactoring({
      planId: result.planId,
      workspaceId: "workspace",
      workspaceGeneration: 1,
      selectionGeneration: 2,
      requestId: "preview-1",
    });
    expect(mockedInvoke).toHaveBeenCalledWith("discard_refactorkit_engine_refactoring", {
      request: {
        planId: "sdk-plan",
        authority: request.authority,
        selectionGeneration: 2,
        requestId: "preview-1",
      },
    });
  });

  it("shows bounded safe-delete text-scan evidence without granting project-wide Apply", async () => {
    const base = capabilities();
    base.javaContextRefactoring.operations = ["safeDelete"];
    base.javaContextRefactoring.operationCapabilities = [
      {
        operation: "safeDelete",
        referenceAnalysis: {
          schemaVersion: "java-safe-delete-reference-analysis-v1",
          scope: "workspace-text-v1",
          resultField: "referenceAnalysis",
          statusValues: ["complete", "incomplete"],
          managedApplyAuthority: "none",
          completeProject: false,
        },
      },
    ];
    const target = {
      kind: "class" as const,
      path: "project/src/main/java/example/A.java",
      identity: "example.A",
    };
    const scan = {
      schemaVersion: "java-safe-delete-reference-analysis-v1" as const,
      operation: "safeDelete" as const,
      scope: "workspace-text-v1" as const,
      status: "complete" as const,
      inputCount: 12,
      verifiedBytes: 4096,
      snapshotHash: request.projectContext!.snapshotHash,
      managedApplyAuthority: "none" as const,
      completeProject: false as const,
      referenceClosure: "incomplete" as const,
    };
    install(base, {
      ...preview(),
      operation: "safe-delete",
      target,
      referenceAnalysis: scan,
    });
    const safeDeleteRequest: RefactorPreviewRequest = {
      ...request,
      operation: "safe-delete",
      target,
    };
    const adapter = new TauriRefactorKitAdapter();
    const result = await adapter.previewRefactoring(safeDeleteRequest);

    expect(result.referenceAnalysis).toEqual(scan);
    expect(result.referenceAnalysis?.completeProject).toBe(false);
    expect(result.applyEligibility.eligible).toBe(true);
    await expect(
      adapter.applyRefactoring({
        ...applyRequest,
        operation: "safe-delete",
        target,
      }),
    ).rejects.toThrow("does not advertise this operation with the selected Java project context");
    expect(
      mockedInvoke.mock.calls.some(
        ([command]) => command === "apply_refactorkit_engine_refactoring",
      ),
    ).toBe(false);

    install(base, {
      ...preview(),
      operation: "safe-delete",
      target,
      referenceAnalysis: { ...scan, snapshotHash: "f".repeat(64) },
    });
    await expect(adapter.previewRefactoring(safeDeleteRequest)).rejects.toThrow(
      "safe-delete reference analysis does not match the selected Java snapshot",
    );
  });

  it("forwards the selected formatter profile and requires its exact provider attestation", async () => {
    const profiledRequest: RefactorPreviewRequest = { ...request, formatterProfile };
    const response = {
      ...preview(),
      formatterProfilePath: formatterProfile.path,
      formatterProfileName: formatterProfile.profileName,
      formatterProfileSha256,
    };
    install(capabilities(), response);

    const result = await new TauriRefactorKitAdapter().previewRefactoring(profiledRequest);

    expect(result).toMatchObject({
      formatterProfilePath: formatterProfile.path,
      formatterProfileName: formatterProfile.profileName,
      formatterProfileSha256,
    });
    expect(mockedInvoke).toHaveBeenCalledWith("preview_refactorkit_engine_refactoring", {
      request: profiledRequest,
    });

    for (const invalidAttestation of [
      { ...preview() },
      { ...response, formatterProfilePath: "config/other.xml" },
      { ...response, formatterProfileName: "Other" },
      { ...response, formatterProfileSha256: "not-a-hash" },
    ]) {
      install(capabilities(), invalidAttestation);
      await expect(
        new TauriRefactorKitAdapter().previewRefactoring(profiledRequest),
      ).rejects.toThrow();
    }
  });

  it("routes the exact cleanup selection through saved SDK preview and never through overlays", async () => {
    const base = capabilities();
    base.javaContextRefactoring.operations = ["batchCleanup"];
    const input: RefactorPreviewRequest = { ...request, operation: "batch-cleanup", changeIntent: {
      operation: "batch-cleanup", actions: [
        { operation: "organize-imports", path: request.target.path },
        { operation: "format-file", path: "project/B.java" },
      ],
    } };
    install(base, { ...preview(), operation: input.operation });
    await expect(new TauriRefactorKitAdapter().previewRefactoring(input)).resolves.toMatchObject({ operation: "batch-cleanup" });
    expect(mockedInvoke).toHaveBeenCalledWith("preview_refactorkit_engine_refactoring", { request: input });
    mockedInvoke.mockClear();
    for (const changed of [
      { ...input, projectContext: undefined },
      { ...input, target: { ...input.target, path: "project/Other.java" } },
      { ...input, editorOverlay: { documents: [{ path: input.target.path, text: "class A {}", version: 1 }], position: { line: 0, character: 0 } } },
    ]) await expect(new TauriRefactorKitAdapter().previewRefactoring(changed)).rejects.toThrow("Batch cleanup requires");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("routes Add Parameter through saved project-context preview without advertising it to the legacy CLI", async () => {
    const addParameterRequest: RefactorPreviewRequest = {
      ...request,
      operation: "add-method-parameter",
      target: {
        kind: "member",
        path: "project/A.java",
        identity: "@cursor",
        selection: { start: 18, end: 18 },
      },
      changeIntent: {
        operation: "add-method-parameter",
        parameterType: "int",
        parameterName: "count",
        defaultExpression: "0",
      },
    };
    const base = capabilities();
    base.javaContextRefactoring.operations = ["changeSignature.addParameter"];
    const response = {
      ...preview(),
      operation: addParameterRequest.operation,
      target: addParameterRequest.target,
    };
    install(base, response);

    const adapter = new TauriRefactorKitAdapter();
    const result = await adapter.previewRefactoring(addParameterRequest);

    expect(result.operation).toBe("add-method-parameter");
    expect(result.target).toEqual(addParameterRequest.target);
    expect(mockedInvoke).toHaveBeenCalledWith("preview_refactorkit_engine_refactoring", {
      request: addParameterRequest,
    });
    expect((await adapter.getCapabilities()).generalRefactoring?.operations).not.toContain(
      "add-method-parameter",
    );
    mockedInvoke.mockClear();
    await expect(
      adapter.previewRefactoring({ ...addParameterRequest, projectContext: undefined }),
    ).rejects.toThrow("Invalid RefactorKit refactoring operation");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("routes stable Maven module creation through the typed project-context preview", async () => {
    const moduleRequest: RefactorPreviewRequest = {
      ...request,
      operation: "create-maven-module",
      target: {
        kind: "file",
        path: "project/pom.xml",
        identity: "project/pom.xml",
      },
      changeIntent: { operation: "create-maven-module", moduleName: "catalog-domain" },
    };
    const base = capabilities();
    base.methods.push({
      name: "java.createMavenModule",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: true,
      features: { preview: true, renderedDiff: true, apply: true, rollback: true },
    });
    base.methods.push({
      name: "patch.rollback",
      stability: "experimental",
      requiresProject: true,
      writesWorkspace: true,
    });
    const response = {
      ...preview(),
      operation: moduleRequest.operation,
      target: moduleRequest.target,
      affectedFiles: [{ change: "create", path: "project/catalog-domain/pom.xml", primary: true }],
    };
    install(base, response);

    const result = await new TauriRefactorKitAdapter().previewRefactoring(moduleRequest);

    expect(result.operation).toBe("create-maven-module");
    expect(result.target).toEqual(moduleRequest.target);
    expect(mockedInvoke).toHaveBeenCalledWith("preview_refactorkit_engine_refactoring", {
      request: moduleRequest,
    });
    expect(result.affectedFiles).toEqual([
      { change: "create", path: "project/catalog-domain/pom.xml", primary: true },
    ]);
  });

  it("routes stable Gradle module creation through project-context preview", async () => {
    const moduleRequest: RefactorPreviewRequest = {
      ...request,
      operation: "create-gradle-module",
      target: {
        kind: "file",
        path: "project/gradle/settings.gradle.kts",
        identity: "project/gradle/settings.gradle.kts",
      },
      changeIntent: {
        operation: "create-gradle-module",
        buildRoot: "gradle",
        projectPath: ":catalog-domain",
      },
    };
    const base = capabilities();
    base.methods.push({
      name: "java.createGradleModule",
      stability: "stable",
      requiresProject: true,
      writesWorkspace: true,
      features: {
        preview: true,
        renderedDiff: true,
        apply: true,
        rollback: true,
        workspaceRelativeBuildRoot: true,
        canonicalNestedProjectPath: true,
        settingsInferredDsl: true,
      },
    });
    const response = {
      ...preview(),
      operation: moduleRequest.operation,
      target: moduleRequest.target,
      affectedFiles: [
        { change: "edit", path: "project/gradle/settings.gradle.kts", primary: true },
        { change: "create", path: "project/gradle/catalog-domain/build.gradle.kts", primary: false },
      ],
    };
    install(base, response);

    const result = await new TauriRefactorKitAdapter().previewRefactoring(moduleRequest);

    expect(result.operation).toBe("create-gradle-module");
    expect(result.target).toEqual(moduleRequest.target);
    expect(mockedInvoke).toHaveBeenCalledWith("preview_refactorkit_engine_refactoring", {
      request: moduleRequest,
    });
    expect(result.affectedFiles).toEqual(response.affectedFiles);
  });

  it("routes parameter type changes through saved project-context preview only", async () => {
    const typeChangeRequest: RefactorPreviewRequest = {
      ...request,
      operation: "change-method-parameter-type",
      target: {
        kind: "member",
        path: "project/A.java",
        identity: "@cursor",
        selection: { start: 18, end: 18 },
      },
      changeIntent: {
        operation: "change-method-parameter-type",
        parameterName: "count",
        newType: "java.lang.Integer",
      },
    };
    const base = capabilities();
    base.javaContextRefactoring.operations = ["changeSignature.changeParameterType"];
    const response = {
      ...preview(),
      operation: typeChangeRequest.operation,
      target: typeChangeRequest.target,
    };
    install(base, response);

    const adapter = new TauriRefactorKitAdapter();
    const result = await adapter.previewRefactoring(typeChangeRequest);

    expect(result.operation).toBe("change-method-parameter-type");
    expect(result.target).toEqual(typeChangeRequest.target);
    expect(mockedInvoke).toHaveBeenCalledWith("preview_refactorkit_engine_refactoring", {
      request: typeChangeRequest,
    });
    expect((await adapter.getCapabilities()).generalRefactoring?.operations).not.toContain(
      "change-method-parameter-type",
    );
    mockedInvoke.mockClear();
    await expect(
      adapter.previewRefactoring({ ...typeChangeRequest, projectContext: undefined }),
    ).rejects.toThrow("Invalid RefactorKit refactoring operation");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("routes Inline Method through saved project-context preview only", async () => {
    const inlineMethodRequest: RefactorPreviewRequest = {
      ...request,
      operation: "inline-method",
      target: {
        kind: "member",
        path: "project/A.java",
        identity: "@cursor",
        selection: { start: 18, end: 18 },
      },
    };
    const base = capabilities();
    base.javaContextRefactoring.operations = ["inlineMethod"];
    const response = {
      ...preview(),
      operation: inlineMethodRequest.operation,
      target: inlineMethodRequest.target,
    };
    install(base, response);

    const adapter = new TauriRefactorKitAdapter();
    const result = await adapter.previewRefactoring(inlineMethodRequest);

    expect(result.operation).toBe("inline-method");
    expect(result.target).toEqual(inlineMethodRequest.target);
    expect(mockedInvoke).toHaveBeenCalledWith("preview_refactorkit_engine_refactoring", {
      request: inlineMethodRequest,
    });
    expect((await adapter.getCapabilities()).generalRefactoring?.operations).not.toContain(
      "inline-method",
    );
    mockedInvoke.mockClear();
    await expect(
      adapter.previewRefactoring({ ...inlineMethodRequest, projectContext: undefined }),
    ).rejects.toThrow("Invalid RefactorKit refactoring operation");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("preserves v2 context attestation through SDK-bound preview", async () => {
    const requestV2: RefactorPreviewRequest = {
      ...request,
      projectContext: {
        ...request.projectContext!,
        contextSchemaVersion: "java-project-context-v2",
      },
    };
    const responseV2 = {
      ...preview(),
      projectContext: {
        ...preview().projectContext!,
        contextSchemaVersion: "java-project-context-v2",
      },
    };
    install(capabilities(), responseV2);
    const result = await new TauriRefactorKitAdapter().previewRefactoring(requestV2);
    expect(result.projectContext?.contextSchemaVersion).toBe("java-project-context-v2");
    expect(mockedInvoke).toHaveBeenCalledWith("preview_refactorkit_engine_refactoring", {
      request: requestV2,
    });
  });

  it("preserves v3 context attestation through SDK-bound preview", async () => {
    const requestV3: RefactorPreviewRequest = {
      ...request,
      projectContext: {
        ...request.projectContext!,
        contextSchemaVersion: "java-project-context-v3",
      },
    };
    const responseV3 = {
      ...preview(),
      projectContext: {
        ...preview().projectContext!,
        contextSchemaVersion: "java-project-context-v3",
      },
    };
    install(capabilities(), responseV3);
    const result = await new TauriRefactorKitAdapter().previewRefactoring(requestV3);
    expect(result.projectContext?.contextSchemaVersion).toBe("java-project-context-v3");
    expect(mockedInvoke).toHaveBeenCalledWith("preview_refactorkit_engine_refactoring", {
      request: requestV3,
    });
  });

  it.each([
    "java-project-context-v4",
    "java-project-context-v5",
    "java-project-context-v6",
    "java-project-context-v7",
  ] as const)("preserves %s attestation through SDK-bound preview", async (schemaVersion) => {
    const selectedRequest: RefactorPreviewRequest = {
      ...request,
      projectContext: { ...request.projectContext!, contextSchemaVersion: schemaVersion },
    };
    const response = {
      ...preview(),
      projectContext: { ...preview().projectContext!, contextSchemaVersion: schemaVersion },
    };
    install(capabilities(), response);
    const result = await new TauriRefactorKitAdapter().previewRefactoring(selectedRequest);
    expect(result.projectContext?.contextSchemaVersion).toBe(schemaVersion);
    expect(mockedInvoke).toHaveBeenCalledWith("preview_refactorkit_engine_refactoring", {
      request: selectedRequest,
    });
  });

  it("refuses SDK calls before the native command when operation admission is absent", async () => {
    const base = capabilities();
    base.javaContextRefactoring.operations = [];
    install(base);
    await expect(new TauriRefactorKitAdapter().previewRefactoring(request)).rejects.toThrow(
      "does not advertise",
    );
    expect(
      mockedInvoke.mock.calls.some(
        ([command]) => command === "preview_refactorkit_engine_refactoring",
      ),
    ).toBe(false);
  });

  it("rejects missing or changed preview attestation instead of accepting an unconfigured result", async () => {
    const noContext = preview();
    delete noContext.projectContext;
    install(capabilities(), noContext);
    await expect(new TauriRefactorKitAdapter().previewRefactoring(request)).rejects.toThrow(
      "does not attest",
    );
    const changed = preview();
    changed.projectContext!.platformIdentities = ["d".repeat(64)];
    install(capabilities(), changed);
    await expect(new TauriRefactorKitAdapter().previewRefactoring(request)).rejects.toThrow(
      "does not attest",
    );
  });

  it("sends the exact context on apply and requires provider confirmation for success", async () => {
    const response = {
      planId: "sdk-plan",
      operation: "format-file",
      outcome: "applied",
      changedFiles: preview().affectedFiles,
      primaryFile: null,
      diagnostics: [],
      transactionId: "sdk-transaction",
      provider: "refactorkit",
      providerVersion: "0.7.0",
      appliedContextHash: request.projectContext!.contextHash,
      appliedSnapshotHash: "e".repeat(64),
    };
    install(capabilities(), response);
    const result = await new TauriRefactorKitAdapter().applyRefactoring(applyRequest);
    expect(result.appliedContextHash).toBe(request.projectContext!.contextHash);
    expect(result.appliedSnapshotHash).toBe("e".repeat(64));
    expect(mockedInvoke).toHaveBeenCalledWith("apply_refactorkit_engine_refactoring", {
      request: applyRequest,
    });
    install(capabilities(), { ...response, appliedContextHash: undefined });
    await expect(new TauriRefactorKitAdapter().applyRefactoring(applyRequest)).rejects.toThrow(
      "write outcome is unknown",
    );
  });

  it("forwards the selected formatter identity and hash on saved Apply", async () => {
    const profiledApplyRequest: RefactorApplyRequest = {
      ...applyRequest,
      formatterProfile,
      formatterProfileSha256,
    };
    const response = {
      planId: "sdk-plan",
      operation: "format-file",
      outcome: "applied",
      changedFiles: preview().affectedFiles,
      primaryFile: null,
      diagnostics: [],
      transactionId: "sdk-transaction",
      provider: "refactorkit",
      providerVersion: "0.7.0",
      appliedContextHash: request.projectContext!.contextHash,
      appliedSnapshotHash: "e".repeat(64),
    };
    install(capabilities(), response);

    await new TauriRefactorKitAdapter().applyRefactoring(profiledApplyRequest);

    expect(mockedInvoke).toHaveBeenCalledWith("apply_refactorkit_engine_refactoring", {
      request: profiledApplyRequest,
    });
    mockedInvoke.mockClear();
    install(capabilities(), response);
    await expect(
      new TauriRefactorKitAdapter().applyRefactoring({
        ...profiledApplyRequest,
        formatterProfileSha256: undefined,
      }),
    ).rejects.toThrow("Invalid or stale Eclipse formatter profile approval");
    expect(
      mockedInvoke.mock.calls.some(
        ([command]) => command === "apply_refactorkit_engine_refactoring",
      ),
    ).toBe(false);
  });

  it("refuses safe-delete Apply through the SDK adapter without complete project coverage", async () => {
    const base = capabilities();
    base.javaContextRefactoring.operations = ["safeDelete"];
    const languageKernel = base.languageKernel;
    if (!languageKernel?.available) throw new Error("Missing Java language-kernel fixture");
    languageKernel.schema.adapters[0]!.capabilities[0] = {
      ...languageKernel.schema.adapters[0]!.capabilities[0]!,
      operation: "safeDelete",
    };
    const safeDeleteRequest: RefactorApplyRequest = {
      ...applyRequest,
      operation: "safe-delete",
      target: {
        kind: "class",
        path: "project/src/main/java/example/A.java",
        identity: "example.A",
      },
    };
    install(base);

    await expect(new TauriRefactorKitAdapter().applyRefactoring(safeDeleteRequest)).rejects.toThrow(
      "does not advertise this operation with the selected Java project context",
    );
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      "apply_refactorkit_engine_refactoring",
      expect.anything(),
    );
  });

  it("rejects malformed SDK inputs and metadata before any mutation command", async () => {
    install();
    await expect(
      new TauriRefactorKitAdapter().applyRefactoring({
        ...applyRequest,
        projectContext: { ...request.projectContext!, snapshotHash: "invalid" },
      }),
    ).rejects.toThrow("Invalid Java project context");
    const base = capabilities();
    base.javaContextRefactoring.operations.push("formatFile");
    install(base);
    await expect(new TauriRefactorKitAdapter().applyRefactoring(applyRequest)).rejects.toThrow(
      "advertisement",
    );
    expect(
      mockedInvoke.mock.calls.some(
        ([command]) => command === "apply_refactorkit_engine_refactoring",
      ),
    ).toBe(false);
  });
});

describe("read-only Java draft preview transport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("crypto", webcrypto);
  });
  afterEach(() => vi.unstubAllGlobals());
  async function draftSetup(selectedFormatterProfile?: RefactorPreviewRequest["formatterProfile"]) {
    const base = capabilities();
    Object.assign(base.javaContextRefactoring, {
      dirtyEditorPreview: true,
      editorPreviewMethod: "refactor.editor.preview",
      editorPreviewSchemaVersion: "java-editor-refactoring-v1",
      editorSelectionSchemaVersion: "java-editor-mutation-selection-v1",
      editorPreviewOperations: ["formatFile"],
    });
    Object.assign(base.methods[0].features!, { immutableJavaEditorOverlays: true });
    base.methods.push(
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
    const input: RefactorPreviewRequest = {
      ...request,
      ...(selectedFormatterProfile ? { formatterProfile: selectedFormatterProfile } : {}),
      editorOverlay: {
        documents: [
          { path: request.target.path, text: "class A {int dirty;}", version: 7 },
          { path: "project/B.java", text: "class B {}", version: 2 },
        ],
        position: { line: 0, character: 0 },
      },
    };
    const documents = await Promise.all(
      input.editorOverlay!.documents.map(async ({ path, version, text }) => ({
        path,
        version,
        contentSha256: [
          ...new Uint8Array(
            await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
          ),
        ]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join(""),
      })),
    );
    const plan: RefactorPreviewResult = {
      ...preview(),
      ...(selectedFormatterProfile
        ? {
            formatterProfilePath: selectedFormatterProfile.path,
            formatterProfileName: selectedFormatterProfile.profileName,
            formatterProfileSha256,
          }
        : {}),
      applyEligibility: { eligible: false, blockers: ["Draft Apply unavailable"] },
      editorPreview: {
        planHash: "d".repeat(64),
        baseSnapshotHash: request.projectContext!.snapshotHash,
        providerSnapshotHash: "e".repeat(64),
        expectedProviderSnapshotHash: "f".repeat(64),
        overlayHash: "a".repeat(64),
        documents,
      },
    };
    return { base, input, plan };
  }
  function refusal(input: RefactorPreviewRequest) {
    return {
      workspaceId: input.authority.workspaceId,
      generation: input.authority.workspaceGeneration,
      requestId: input.requestId,
      kind: "mutationSelection",
      documentPath: input.target.path,
      documentVersion: input.editorOverlay!.documents[0].version,
      status: "refused",
      message: "RefactorKit refused this Java draft preview.",
      projectContextRetired: true,
    };
  }

  it("preserves explicit session retirement on a correlated draft refusal", async () => {
    const { base, input } = await draftSetup();
    install(base, refusal(input));
    await expect(new TauriRefactorKitAdapter().previewRefactoring(input)).rejects.toBeInstanceOf(
      JavaProjectContextRetiredError,
    );
    expect(mockedInvoke.mock.calls.filter(([command]) => command === "query_refactorkit_java_navigation")).toHaveLength(1);
  });

  it.each([
    { workspaceId: "other" },
    { generation: 99 },
    { requestId: "old" },
    { kind: "definition" },
    { documentPath: "project/Other.java" },
    { documentVersion: 99 },
    { projectContextRetired: false },
  ])("rejects uncorrelated or invalid retirement metadata %o", async (changed) => {
    const { base, input } = await draftSetup();
    install(base, { ...refusal(input), ...changed });
    const error = await new TauriRefactorKitAdapter().previewRefactoring(input).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(JavaProjectContextRetiredError);
    expect((error as Error).message).toMatch(/invalid|uncorrelated/i);
  });

  it("does not infer retirement from the refusal message", async () => {
    const { base, input } = await draftSetup();
    const response: Record<string, unknown> = refusal(input);
    delete response.projectContextRetired;
    install(base, response);
    const error = await new TauriRefactorKitAdapter().previewRefactoring(input).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(JavaProjectContextRetiredError);
  });

  it("uses the immutable query session and rejects applying an editor plan through the saved route", async () => {
    const { base, input, plan } = await draftSetup();
    install(base, plan);
    const adapter = new TauriRefactorKitAdapter();
    const result = await adapter.previewRefactoring(input);
    expect(result.editorPreview).toEqual(plan.editorPreview);
    const command = mockedInvoke.mock.calls.find(
      ([name]) => name === "query_refactorkit_java_navigation",
    )!;
    expect(command[1]).toMatchObject({
      request: {
        kind: "mutationSelection",
        editorOverlay: { documents: input.editorOverlay!.documents },
        editorRefactoring: { operation: "format-file" },
        document: input.editorOverlay!.documents[0],
      },
    });
    expect(
      mockedInvoke.mock.calls.some(([name]) => name === "preview_refactorkit_engine_refactoring"),
    ).toBe(false);
    await expect(adapter.applyRefactoring(applyRequest)).rejects.toThrow("draft preview");
    expect(
      mockedInvoke.mock.calls.some(([name]) => name === "apply_refactorkit_engine_refactoring"),
    ).toBe(false);
  });
  it("forwards the selected formatter profile with a dirty editor preview", async () => {
    const { base, input, plan } = await draftSetup(formatterProfile);
    install(base, plan);

    const result = await new TauriRefactorKitAdapter().previewRefactoring(input);

    expect(result.formatterProfileSha256).toBe(formatterProfileSha256);
    expect(mockedInvoke).toHaveBeenCalledWith(
      "query_refactorkit_java_navigation",
      expect.objectContaining({
        request: expect.objectContaining({
          editorRefactoring: expect.objectContaining({ formatterProfile }),
        }),
      }),
    );
  });
  it("rejects missing receipts, changed versions/content and forged Apply eligibility", async () => {
    const { base, input, plan } = await draftSetup();
    for (const changed of [
      { ...plan, editorPreview: undefined },
      {
        ...plan,
        editorPreview: {
          ...plan.editorPreview!,
          documents: [
            { ...plan.editorPreview!.documents[0], version: 6 },
            plan.editorPreview!.documents[1],
          ],
        },
      },
      {
        ...plan,
        editorPreview: {
          ...plan.editorPreview!,
          documents: [
            { ...plan.editorPreview!.documents[0], contentSha256: "0".repeat(64) },
            plan.editorPreview!.documents[1],
          ],
        },
      },
      { ...plan, applyEligibility: { eligible: true, blockers: [] } },
    ]) {
      install(base, changed);
      await expect(new TauriRefactorKitAdapter().previewRefactoring(input)).rejects.toThrow();
    }
  });
  it("refuses oversized or duplicate documents before native invocation", async () => {
    const { base, input, plan } = await draftSetup();
    install(base, plan);
    for (const documents of [
      [input.editorOverlay!.documents[0], input.editorOverlay!.documents[0]],
      [{ ...input.editorOverlay!.documents[0], version: 2147483648 }],
      [{ ...input.editorOverlay!.documents[0], text: "x".repeat(1024 * 1024 + 1) }],
    ]) {
      await expect(
        new TauriRefactorKitAdapter().previewRefactoring({
          ...input,
          editorOverlay: { ...input.editorOverlay!, documents },
        }),
      ).rejects.toThrow();
    }
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});

it.each([
  ["Saved project inputs changed after Apply; rollback was not started (expected private-hash, current private-new-hash).", "REFACTORKIT_ROLLBACK_INPUTS_CHANGED", "Rollback was not started"],
  ["Rollback write outcome is unknown: the original Java authority was not confirmed.", "REFACTORKIT_ROLLBACK_OUTCOME_UNKNOWN", "may have changed files"],
  ["Rollback write outcome is unknown: file changes do not match the transaction.", "REFACTORKIT_ROLLBACK_OUTCOME_UNKNOWN", "may have changed files"],
])("preserves the safe rollback distinction for %s", async (message, code, guidance) => {
  install(rollbackCapabilities(), rollbackResponse());
  const handler = mockedInvoke.getMockImplementation()!;
  mockedInvoke.mockImplementation((...args) => args[0] === "rollback_refactorkit_engine_refactoring"
    ? Promise.reject(`${message} /private/repository/Secret.java class PrivateSource {} token=private-token`)
    : handler(...args));
  const error = await new TauriRefactorKitAdapter().rollbackRefactoring(rollbackRequest).catch((value: unknown) => value);
  expect(error).toMatchObject({ command: "rollback_refactorkit_engine_refactoring", code, cause: undefined });
  expect(error instanceof RefactorRollbackNotStartedError).toBe(code === "REFACTORKIT_ROLLBACK_INPUTS_CHANGED");
  expect(String(error)).toContain(guidance);
  expect(String(error)).not.toContain("tauri:");
  const exposed = String(error) + JSON.stringify(error);
  for (const detail of ["private-hash", "/private", "PrivateSource", "private-token"]) expect(exposed).not.toContain(detail);
});
