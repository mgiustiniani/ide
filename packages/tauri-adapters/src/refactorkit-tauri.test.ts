import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriAdapterError } from "./errors";
import { TauriRefactorKitAdapter } from "./refactorkit-tauri";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

const LANGUAGE_VOCABULARY = {
  stability: ["stable", "experimental", "structural", "refused", "not-applicable"],
  evidence: ["compiler", "language-server", "native-ast", "structural-parse", "lexical", "none"],
  mutationAuthority: ["managed-stable", "proposal-only", "none"],
  executionMode: ["in-process", "external-process"],
};

const JAVA_RUNTIME = {
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
};

const javaCapabilities = [
  ["changeSignature.addParameter", "experimental", "compiler", "proposal-only"],
  ["changeSignature.removeParameter", "experimental", "compiler", "proposal-only"],
  ["changeSignature.renameParameter", "experimental", "compiler", "proposal-only"],
  ["changeSignature.reorderParameters", "experimental", "compiler", "proposal-only"],
  ["extractMethod", "experimental", "compiler", "proposal-only"],
  ["formatFile", "stable", "structural-parse", "managed-stable"],
  ["moveClass", "stable", "compiler", "managed-stable"],
  ["moveSourceRoot", "stable", "structural-parse", "managed-stable"],
  ["organizeImports", "stable", "structural-parse", "managed-stable"],
  ["renameClass", "stable", "compiler", "managed-stable"],
  ["renameMember", "stable", "compiler", "managed-stable"],
  ["safeDelete", "stable", "compiler", "managed-stable"],
].map(([operation, stability, evidence, mutationAuthority]) => ({
  operation,
  stability,
  evidence,
  mutationAuthority,
  backend: "eclipse-jdt-3.44",
  runtime: structuredClone(JAVA_RUNTIME),
  extensions: ["java"],
}));

function treeSitterAdapter(languageId: "javascript" | "typescript", extension: "js" | "ts") {
  const runtime = {
    executionMode: "in-process",
    supportsTimeout: true,
    supportsCancellation: false,
    usesWorkspaceOverlay: false,
    recordsProcessProvenance: false,
    limits: {
      requestTimeoutMillis: 2_000,
      maxInputBytes: 16 * 1024 * 1024,
      maxOutputBytes: null,
      maxProcesses: null,
    },
  };
  const operationMetadata = () => ({
    backend: "tree-sitter-jni-0.25.3",
    runtime: structuredClone(runtime),
    extensions: [extension],
  });
  return {
    languageId,
    extensions: [extension],
    backend: "tree-sitter-jni-0.25.3",
    runtime,
    capabilities: [
      {
        operation: "identifierSearch",
        stability: "stable",
        evidence: "native-ast",
        mutationAuthority: "none",
        ...operationMetadata(),
      },
      {
        operation: "localRename",
        stability: "structural",
        evidence: "lexical",
        mutationAuthority: "proposal-only",
        ...operationMetadata(),
      },
      {
        operation: "outline",
        stability: "stable",
        evidence: "native-ast",
        mutationAuthority: "none",
        ...operationMetadata(),
      },
    ],
  };
}

const actualSchemaV1Capabilities = {
  api: "refactorkit",
  apiVersion: "0.2",
  provider: "refactorkit",
  providerVersion: "0.5.0-SNAPSHOT",
  javaImportExternalClass: {
    supported: true,
    targetDirectory: true,
    preview: true,
    apply: true,
    rollback: true,
    stability: "experimental",
  },
  languageKernel: {
    available: true,
    schema: {
      schemaVersion: 1,
      adapters: [
        {
          languageId: "java",
          extensions: ["java"],
          backend: "eclipse-jdt-3.44",
          runtime: structuredClone(JAVA_RUNTIME),
          capabilities: javaCapabilities,
        },
        treeSitterAdapter("javascript", "js"),
        treeSitterAdapter("typescript", "ts"),
      ],
      vocabulary: LANGUAGE_VOCABULARY,
    },
  },
  safety: {
    previewBeforeApply: true,
    snapshotValidation: true,
    transactionRollback: true,
    workspaceScopedWrites: true,
  },
};

const rustCommandResult = {
  stdout: "scan complete",
  stderr: "",
  locations: [],
  success: true,
  code: 0,
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  command: {
    executable: "/usr/local/bin/refactorkit",
    args: ["scan", "/workspace/project"],
    cwd: "/workspace/project",
    workspaceRoot: "/workspace/project",
    timeoutMs: 60_000,
    outputLimitBytes: 524_288,
  },
};

describe("TauriRefactorKitAdapter", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("normalizes the Rust status shape and omits null optional values", async () => {
    const adapter = new TauriRefactorKitAdapter();
    invokeMock.mockResolvedValueOnce({
      available: false,
      path: null,
      version: null,
      lastError: "refactorkit was not found on PATH",
      backendOnly: true,
    });

    await expect(adapter.getStatus()).resolves.toEqual({
      available: false,
      lastError: "refactorkit was not found on PATH",
    });
    expect(invokeMock).toHaveBeenCalledWith("get_refactorkit_status", undefined);
  });

  it("normalizes a Rust command result to the port contract", async () => {
    const adapter = new TauriRefactorKitAdapter();
    invokeMock.mockResolvedValueOnce(rustCommandResult);

    await expect(adapter.scan()).resolves.toEqual({
      stdout: "scan complete",
      stderr: "",
      locations: [],
      success: true,
      code: 0,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      command: ["/usr/local/bin/refactorkit", "scan", "/workspace/project"],
    });
    expect(invokeMock).toHaveBeenCalledWith("run_refactorkit_scan", undefined);
  });

  it("normalizes multiple locations, preserves paths, and omits an absent column", async () => {
    const adapter = new TauriRefactorKitAdapter();
    invokeMock.mockResolvedValueOnce({
      ...rustCommandResult,
      locations: [
        { path: "src/main/java/com/example/Service.java", line: 17, column: 9 },
        { path: "src/./test/java/com/example/ServiceTest.java", line: 41 },
      ],
    });

    await expect(adapter.references("com.example.Service")).resolves.toMatchObject({
      locations: [
        { path: "src/main/java/com/example/Service.java", line: 17, column: 9 },
        { path: "src/./test/java/com/example/ServiceTest.java", line: 41 },
      ],
    });
  });

  it("accepts an empty locations list", async () => {
    const adapter = new TauriRefactorKitAdapter();
    invokeMock.mockResolvedValueOnce(rustCommandResult);

    await expect(adapter.symbols()).resolves.toMatchObject({ locations: [] });
  });

  it("flattens Rust command metadata without leaking backend-only fields", async () => {
    const adapter = new TauriRefactorKitAdapter();
    invokeMock.mockResolvedValueOnce({
      ...rustCommandResult,
      command: {
        ...rustCommandResult.command,
        executable: "/opt/refactorkit/bin/refactorkit",
        args: ["diagnostics", "/workspace/project"],
      },
    });

    await expect(adapter.diagnostics()).resolves.toMatchObject({
      command: ["/opt/refactorkit/bin/refactorkit", "diagnostics", "/workspace/project"],
    });
    expect(invokeMock).toHaveBeenCalledWith("run_refactorkit_diagnostics", undefined);
  });

  it.each([
    {
      name: "definition",
      invokeAdapter: (adapter: TauriRefactorKitAdapter, symbol: string) =>
        adapter.definition(symbol),
      command: "run_refactorkit_definition",
      action: "definition",
    },
    {
      name: "references",
      invokeAdapter: (adapter: TauriRefactorKitAdapter, symbol: string) =>
        adapter.references(symbol),
      command: "run_refactorkit_references",
      action: "references",
    },
  ])(
    "invokes the fixed $name command with the symbol and normalizes its result",
    async ({ invokeAdapter, command, action }) => {
      const adapter = new TauriRefactorKitAdapter();
      const symbol = "com.example.Service#execute(java.lang.String)";
      invokeMock.mockResolvedValueOnce({
        ...rustCommandResult,
        stdout: `${action} result`,
        command: {
          ...rustCommandResult.command,
          args: [action, "--symbol", symbol, "/workspace/project"],
        },
      });

      await expect(invokeAdapter(adapter, symbol)).resolves.toEqual({
        stdout: `${action} result`,
        stderr: "",
        locations: [],
        success: true,
        code: 0,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        command: ["/usr/local/bin/refactorkit", action, "--symbol", symbol, "/workspace/project"],
      });
      expect(invokeMock).toHaveBeenCalledWith(command, { symbol });
    },
  );

  it.each([
    {
      name: "definition",
      invokeAdapter: (adapter: TauriRefactorKitAdapter, symbol: string) =>
        adapter.definition(symbol),
      command: "run_refactorkit_definition",
    },
    {
      name: "references",
      invokeAdapter: (adapter: TauriRefactorKitAdapter, symbol: string) =>
        adapter.references(symbol),
      command: "run_refactorkit_references",
    },
  ])(
    "propagates $name backend rejections with command context",
    async ({ invokeAdapter, command }) => {
      const adapter = new TauriRefactorKitAdapter();
      const symbol = "com.example.Service#execute";
      const rejection = { error: "symbol was not found" };
      invokeMock.mockRejectedValueOnce(rejection);

      await expect(invokeAdapter(adapter, symbol)).rejects.toMatchObject({
        name: "TauriAdapterError",
        command,
        cause: rejection,
      } satisfies Partial<TauriAdapterError>);
      expect(invokeMock).toHaveBeenCalledWith(command, { symbol });
    },
  );

  it.each([
    {
      name: "non-object status",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.getStatus(),
      payload: null,
      command: "get_refactorkit_status",
    },
    {
      name: "non-boolean availability",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.getStatus(),
      payload: { available: "yes" },
      command: "get_refactorkit_status",
    },
    {
      name: "fractional exit code",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: { ...rustCommandResult, code: 0.5 },
      command: "run_refactorkit_scan",
    },
    {
      name: "missing locations list",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: { ...rustCommandResult, locations: undefined },
      command: "run_refactorkit_scan",
    },
    {
      name: "non-array locations list",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: { ...rustCommandResult, locations: {} },
      command: "run_refactorkit_scan",
    },
    {
      name: "empty location path",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: { ...rustCommandResult, locations: [{ path: "", line: 1 }] },
      command: "run_refactorkit_scan",
    },
    {
      name: "non-string location path",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: { ...rustCommandResult, locations: [{ path: 42, line: 1 }] },
      command: "run_refactorkit_scan",
    },
    {
      name: "zero location line",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: { ...rustCommandResult, locations: [{ path: "Main.java", line: 0 }] },
      command: "run_refactorkit_scan",
    },
    {
      name: "fractional location line",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: { ...rustCommandResult, locations: [{ path: "Main.java", line: 1.5 }] },
      command: "run_refactorkit_scan",
    },
    {
      name: "zero location column",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: {
        ...rustCommandResult,
        locations: [{ path: "Main.java", line: 1, column: 0 }],
      },
      command: "run_refactorkit_scan",
    },
    {
      name: "fractional location column",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: {
        ...rustCommandResult,
        locations: [{ path: "Main.java", line: 1, column: 2.5 }],
      },
      command: "run_refactorkit_scan",
    },
    {
      name: "null location column",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: {
        ...rustCommandResult,
        locations: [{ path: "Main.java", line: 1, column: null }],
      },
      command: "run_refactorkit_scan",
    },
    {
      name: "array command metadata",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.symbols(),
      payload: {
        ...rustCommandResult,
        command: ["refactorkit", "symbols", "/workspace/project"],
      },
      command: "run_refactorkit_symbols",
    },
    {
      name: "non-string command argument",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.symbols(),
      payload: {
        ...rustCommandResult,
        command: {
          ...rustCommandResult.command,
          args: ["symbols", 42],
        },
      },
      command: "run_refactorkit_symbols",
    },
  ])("rejects malformed payloads: $name", async ({ invokeAdapter, payload, command }) => {
    const adapter = new TauriRefactorKitAdapter();
    invokeMock.mockResolvedValueOnce(payload);

    await expect(invokeAdapter(adapter)).rejects.toMatchObject({
      name: "TauriAdapterError",
      command,
      cause: payload,
    } satisfies Partial<TauriAdapterError>);
  });
});

describe("TauriRefactorKitAdapter managed external import protocol", () => {
  const previewRequest = {
    code: "package incoming; public class Widget {}",
    targetDirectory: "src/main/java/example",
    sourceKind: "clipboard" as const,
    sourceUrl: null,
    licensePolicy: "warn" as const,
    workspaceId: "workspace:1",
    workspaceGeneration: 7,
    selectionGeneration: 9,
    requestId: "request-1",
  };

  const plan = {
    planId: "plan-1",
    status: "ready",
    summary: "Import Widget",
    confidence: 0.85,
    riskLevel: "medium",
    evidence: [
      { kind: "source-root", summary: "Maven source root", path: "pom.xml", detail: "main" },
    ],
    affectedFiles: [
      { change: "create", path: "src/main/java/example/Widget.java", primary: true },
      { change: "edit", path: "pom.xml", primary: false },
    ],
    placement: { packageName: "example", sourceRoot: "src/main/java", moduleName: null },
    packageChanges: [
      { fromPackage: null, toPackage: null },
      { path: "src/main/java/example/Widget.java", fromPackage: "incoming", toPackage: "example" },
    ],
    renderedDiff: "--- /dev/null\n+++ b/src/main/java/example/Widget.java",
    structuredDiff: [
      {
        path: "src/main/java/example/Widget.java",
        change: "create",
        hunks: [
          { oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ["+package example;"] },
        ],
      },
    ],
    warnings: ["Review generated package"],
    diagnosticsAfterPreview: [
      { severity: "warning", message: "Review", path: "pom.xml", line: 1, column: 1 },
    ],
    provenance: {
      sourceKind: "clipboard",
      sourceUrl: null,
      detectedLicense: "Apache-2.0",
      licensePolicy: "warn",
      notices: ["Retain copyright notice"],
    },
    unresolvedDependencies: ["org.example:widget:1.0"],
    conflicts: [
      { kind: "existing-file", summary: "Existing type", path: "src/main/java/example/Old.java" },
    ],
    refusalReasons: [],
    applyEligibility: { eligible: true, blockers: [] },
    staleness: { stale: false, reasons: [] },
    provider: "refactorkit",
    providerVersion: "2.0.0",
    workspaceId: "workspace:1",
    workspaceGeneration: 7,
    selectionGeneration: 9,
    requestId: "request-1",
  };

  beforeEach(() => invokeMock.mockReset());

  it("normalizes current managed capabilities as authoritative true flags", async () => {
    const capabilities = {
      api: "refactorkit",
      apiVersion: "0.2",
      provider: "refactorkit",
      providerVersion: "0.5.0-SNAPSHOT",
      javaImportExternalClass: {
        supported: true,
        targetDirectory: true,
        preview: true,
        apply: true,
        rollback: true,
        stability: "experimental",
      },
    };
    invokeMock.mockResolvedValueOnce(capabilities);
    await expect(new TauriRefactorKitAdapter().getCapabilities()).resolves.toEqual(capabilities);
    expect(invokeMock).toHaveBeenCalledWith("get_refactorkit_capabilities", undefined);
  });

  it("normalizes actual schema-v1 Java, JavaScript, and TypeScript discovery with exact safety flags", async () => {
    invokeMock.mockResolvedValueOnce(structuredClone(actualSchemaV1Capabilities));

    await expect(new TauriRefactorKitAdapter().getCapabilities()).resolves.toEqual(
      actualSchemaV1Capabilities,
    );
    expect(invokeMock.mock.calls).toEqual([["get_refactorkit_capabilities", undefined]]);
  });

  it("normalizes an arbitrary adapter exactly without language-specific inference", async () => {
    const providerNeutralCapabilities = {
      ...actualSchemaV1Capabilities,
      languageKernel: {
        available: true as const,
        schema: {
          schemaVersion: 1 as const,
          adapters: [
            {
              languageId: "kotlin",
              extensions: ["kt", "kts"],
              backend: "custom-language-kernel-v7",
              runtime: {
                executionMode: "external-process",
                supportsTimeout: true,
                supportsCancellation: true,
                usesWorkspaceOverlay: true,
                recordsProcessProvenance: true,
                limits: {
                  requestTimeoutMillis: 7_500,
                  maxInputBytes: 4_096,
                  maxOutputBytes: 8_192,
                  maxProcesses: 2,
                },
              },
              capabilities: [
                {
                  operation: "inspectModule",
                  stability: "refused",
                  evidence: "none",
                  mutationAuthority: "none",
                  backend: "custom-language-kernel-v7",
                  runtime: {
                    executionMode: "external-process",
                    supportsTimeout: true,
                    supportsCancellation: true,
                    usesWorkspaceOverlay: true,
                    recordsProcessProvenance: true,
                    limits: {
                      requestTimeoutMillis: 7_500,
                      maxInputBytes: 4_096,
                      maxOutputBytes: 8_192,
                      maxProcesses: 2,
                    },
                  },
                  extensions: ["kt", "kts"],
                },
                {
                  operation: "renameModule",
                  stability: "experimental",
                  evidence: "language-server",
                  mutationAuthority: "proposal-only",
                  backend: "kotlin-analysis-server-v2",
                  runtime: {
                    executionMode: "in-process",
                    supportsTimeout: false,
                    supportsCancellation: false,
                    usesWorkspaceOverlay: false,
                    recordsProcessProvenance: false,
                    limits: {
                      requestTimeoutMillis: null,
                      maxInputBytes: 2_048,
                      maxOutputBytes: null,
                      maxProcesses: null,
                    },
                  },
                  extensions: ["kt"],
                },
              ],
            },
          ],
          vocabulary: LANGUAGE_VOCABULARY,
        },
      },
      safety: {
        previewBeforeApply: false,
        snapshotValidation: true,
        transactionRollback: false,
        workspaceScopedWrites: true,
      },
    };
    invokeMock.mockResolvedValueOnce(structuredClone(providerNeutralCapabilities));

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();
    expect(normalized).toEqual(providerNeutralCapabilities);
    expect(normalized.languageKernel?.available).toBe(true);
    if (!normalized.languageKernel?.available)
      throw new Error("expected available language kernel");
    const kotlinAdapter = normalized.languageKernel.schema.adapters[0];
    const renameCapability = kotlinAdapter.capabilities[1];
    expect(renameCapability).toMatchObject({
      backend: "kotlin-analysis-server-v2",
      runtime: {
        executionMode: "in-process",
        limits: { maxInputBytes: 2_048 },
      },
      extensions: ["kt"],
    });
    expect(renameCapability.backend).not.toBe(kotlinAdapter.backend);
    expect(renameCapability.runtime).not.toEqual(kotlinAdapter.runtime);
    expect(renameCapability.extensions).not.toEqual(kotlinAdapter.extensions);
    expect(invokeMock.mock.calls).toEqual([["get_refactorkit_capabilities", undefined]]);
  });

  it("clones operation runtime limits and extensions instead of retaining wire references", async () => {
    const response = structuredClone(actualSchemaV1Capabilities);
    const sourceCapability = response.languageKernel.schema.adapters[0].capabilities[0];
    invokeMock.mockResolvedValueOnce(response);

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();
    if (!normalized.languageKernel?.available)
      throw new Error("expected available language kernel");
    const normalizedCapability = normalized.languageKernel.schema.adapters[0].capabilities[0];

    expect(normalizedCapability.runtime).not.toBe(sourceCapability.runtime);
    expect(normalizedCapability.runtime.limits).not.toBe(sourceCapability.runtime.limits);
    expect(normalizedCapability.extensions).not.toBe(sourceCapability.extensions);

    sourceCapability.runtime.limits.requestTimeoutMillis = 1;
    (sourceCapability.extensions as string[]).push("jav");
    expect(normalizedCapability.runtime.limits.requestTimeoutMillis).toBeNull();
    expect(normalizedCapability.extensions).toEqual(["java"]);
  });

  it("normalizes explicit language-kernel unavailability and keeps legacy metadata absent", async () => {
    const unavailable = {
      ...actualSchemaV1Capabilities,
      languageKernel: {
        available: false,
        schema: null,
        reason: "RefactorKit language-kernel capability metadata is unavailable.",
      },
    };
    invokeMock.mockResolvedValueOnce(unavailable);
    await expect(new TauriRefactorKitAdapter().getCapabilities()).resolves.toEqual(unavailable);

    const legacy = {
      api: "refactorkit",
      apiVersion: "unknown",
      provider: "refactorkit",
      providerVersion: null,
      javaImportExternalClass: {
        supported: false,
        targetDirectory: false,
        preview: false,
        apply: false,
        rollback: false,
        stability: "experimental",
      },
    };
    invokeMock.mockResolvedValueOnce(legacy);
    const normalizedLegacy = await new TauriRefactorKitAdapter().getCapabilities();
    expect(normalizedLegacy).toEqual(legacy);
    expect(normalizedLegacy).not.toHaveProperty("languageKernel");
    expect(normalizedLegacy).not.toHaveProperty("safety");
  });

  it("preserves explicit false capability flags from an old installation", async () => {
    invokeMock.mockResolvedValueOnce({
      api: "refactorkit",
      apiVersion: "unknown",
      provider: "refactorkit",
      providerVersion: null,
      javaImportExternalClass: {
        supported: false,
        targetDirectory: false,
        preview: false,
        apply: false,
        rollback: false,
        stability: "experimental",
      },
    });
    await expect(new TauriRefactorKitAdapter().getCapabilities()).resolves.toMatchObject({
      javaImportExternalClass: {
        supported: false,
        targetDirectory: false,
        preview: false,
        apply: false,
        rollback: false,
      },
    });
  });

  it.each([
    [
      "missing backend",
      (value: any) => {
        delete value.languageKernel.schema.adapters[0].capabilities[0].backend;
      },
    ],
    [
      "missing runtime",
      (value: any) => {
        delete value.languageKernel.schema.adapters[0].capabilities[0].runtime;
      },
    ],
    [
      "missing extensions",
      (value: any) => {
        delete value.languageKernel.schema.adapters[0].capabilities[0].extensions;
      },
    ],
    [
      "extra operation field",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].inferred = true;
      },
    ],
    [
      "wrong backend type",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].backend = 7;
      },
    ],
    [
      "wrong runtime type",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].runtime = "in-process";
      },
    ],
    [
      "wrong extensions type",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].extensions = "java";
      },
    ],
    [
      "empty backend",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].backend = "";
      },
    ],
    [
      "control character in backend",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].backend = "jdt\u0000private";
      },
    ],
    [
      "UTF-8 backend bound",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].backend = "é".repeat(129);
      },
    ],
    [
      "non-canonical extension",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].extensions = [".java"];
      },
    ],
    [
      "duplicate extension",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].extensions = ["java", "java"];
      },
    ],
    [
      "empty extensions",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].extensions = [];
      },
    ],
    [
      "operation extension bound",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].extensions = Array.from(
          { length: 65 },
          (_, index) => `x${index}`,
        );
      },
    ],
    [
      "missing runtime field",
      (value: any) => {
        delete value.languageKernel.schema.adapters[0].capabilities[0].runtime.supportsCancellation;
      },
    ],
    [
      "extra runtime field",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].runtime.threadCount = 1;
      },
    ],
    [
      "wrong runtime boolean",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].runtime.supportsCancellation = "no";
      },
    ],
    [
      "missing runtime limit",
      (value: any) => {
        delete value.languageKernel.schema.adapters[0].capabilities[0].runtime.limits.maxInputBytes;
      },
    ],
    [
      "extra runtime limit",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].runtime.limits.maxThreads = 1;
      },
    ],
    [
      "wrong runtime limit",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].runtime.limits.maxInputBytes =
          "4096";
      },
    ],
    [
      "incoherent in-process provenance",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].runtime.recordsProcessProvenance = true;
      },
    ],
    [
      "incoherent timeout limit",
      (value: any) => {
        value.languageKernel.schema.adapters[1].capabilities[0].runtime.limits.requestTimeoutMillis =
          null;
      },
    ],
  ])("rejects strict operation metadata: %s", async (_name, mutate) => {
    const response = structuredClone(actualSchemaV1Capabilities) as any;
    const source = "private operation metadata must stay redacted";
    mutate(response);
    response.source = source;
    invokeMock.mockResolvedValueOnce(response);

    const error = await new TauriRefactorKitAdapter()
      .getCapabilities()
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: "get_refactorkit_capabilities",
      cause: undefined,
    });
    expect(String(error)).not.toContain(source);
    expect(JSON.stringify(error)).not.toContain(source);
  });

  it.each([
    [
      "adapter bound",
      (value: any) =>
        value.languageKernel.schema.adapters.push(
          ...Array.from({ length: 62 }, (_, index) => ({
            ...structuredClone(value.languageKernel.schema.adapters[0]),
            languageId: `extra-${index}`,
            extensions: [`x${index}`],
          })),
        ),
    ],
    [
      "extension bound",
      (value: any) => {
        value.languageKernel.schema.adapters[0].extensions = Array.from(
          { length: 65 },
          (_, index) => `x${index}`,
        );
      },
    ],
    [
      "capability bound",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities = Array.from(
          { length: 513 },
          (_, index) => ({
            operation: `operation-${index}`,
            stability: "stable",
            evidence: "compiler",
            mutationAuthority: "none",
            backend: "eclipse-jdt-3.44",
            runtime: structuredClone(JAVA_RUNTIME),
            extensions: ["java"],
          }),
        );
      },
    ],
    [
      "UTF-8 backend bound",
      (value: any) => {
        value.languageKernel.schema.adapters[0].backend = "é".repeat(129);
      },
    ],
    [
      "non-canonical language ID",
      (value: any) => {
        value.languageKernel.schema.adapters[0].languageId = "TypeScript";
      },
    ],
    [
      "duplicate language ID",
      (value: any) => {
        value.languageKernel.schema.adapters[1].languageId = "java";
      },
    ],
    [
      "non-canonical extension",
      (value: any) => {
        value.languageKernel.schema.adapters[0].extensions = [".java"];
      },
    ],
    [
      "duplicate extension within an adapter",
      (value: any) => {
        value.languageKernel.schema.adapters[0].extensions = ["java", "java"];
      },
    ],
    [
      "ambiguous extension across adapters",
      (value: any) => {
        value.languageKernel.schema.adapters[1].extensions = ["java"];
      },
    ],
    [
      "duplicate operation",
      (value: any) =>
        value.languageKernel.schema.adapters[1].capabilities.push(
          structuredClone(value.languageKernel.schema.adapters[1].capabilities[0]),
        ),
    ],
    [
      "wrong schema version",
      (value: any) => {
        value.languageKernel.schema.schemaVersion = 2;
      },
    ],
    [
      "reordered vocabulary",
      (value: any) => {
        value.languageKernel.schema.vocabulary.stability.reverse();
      },
    ],
    [
      "unknown stability",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].stability = "beta";
      },
    ],
    [
      "unknown evidence",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].evidence = "guess";
      },
    ],
    [
      "unknown mutation authority",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].mutationAuthority = "direct";
      },
    ],
    [
      "managed-stable experimental capability",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].mutationAuthority =
          "managed-stable";
      },
    ],
    [
      "managed-stable lexical capability",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[5].evidence = "lexical";
      },
    ],
    [
      "unknown execution mode",
      (value: any) => {
        value.languageKernel.schema.adapters[0].runtime.executionMode = "worker";
      },
    ],
    [
      "in-process process provenance",
      (value: any) => {
        value.languageKernel.schema.adapters[0].runtime.recordsProcessProvenance = true;
      },
    ],
    [
      "in-process workspace overlay",
      (value: any) => {
        value.languageKernel.schema.adapters[0].runtime.usesWorkspaceOverlay = true;
      },
    ],
    [
      "timeout without timeout limit",
      (value: any) => {
        value.languageKernel.schema.adapters[1].runtime.limits.requestTimeoutMillis = null;
      },
    ],
    [
      "timeout above bound",
      (value: any) => {
        value.languageKernel.schema.adapters[1].runtime.limits.requestTimeoutMillis = 300_001;
      },
    ],
    [
      "input bytes above bound",
      (value: any) => {
        value.languageKernel.schema.adapters[1].runtime.limits.maxInputBytes = 4 * 1024 ** 3 + 1;
      },
    ],
    [
      "processes above bound",
      (value: any) => {
        value.languageKernel.schema.adapters[1].runtime.limits.maxProcesses = 65;
      },
    ],
    [
      "unavailable schema attached",
      (value: any) => {
        value.languageKernel = {
          available: false,
          schema: value.languageKernel.schema,
          reason: "unavailable",
        };
      },
    ],
    [
      "safety flag missing",
      (value: any) => {
        delete value.safety.snapshotValidation;
      },
    ],
    [
      "safety flag not boolean",
      (value: any) => {
        value.safety.transactionRollback = "yes";
      },
    ],
    [
      "extra safety claim",
      (value: any) => {
        value.safety.diagnosticsGate = true;
      },
    ],
    [
      "extra adapter field",
      (value: any) => {
        value.languageKernel.schema.adapters[0].semanticCommands = ["rename"];
      },
    ],
  ])("fails closed with a redacted language-kernel protocol error: %s", async (_name, mutate) => {
    const response = structuredClone(actualSchemaV1Capabilities) as any;
    const source = "private backend source must stay redacted";
    mutate(response);
    response.source = source;
    invokeMock.mockResolvedValueOnce(response);

    const error = await new TauriRefactorKitAdapter()
      .getCapabilities()
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: "get_refactorkit_capabilities",
      cause: undefined,
    });
    expect(error).not.toHaveProperty("response");
    expect(error).not.toHaveProperty("source");
    expect(String(error)).not.toContain(source);
    expect(JSON.stringify(error)).not.toContain(source);
  });

  it("rejects incomplete capability mappings with a redacted protocol error", async () => {
    invokeMock.mockResolvedValueOnce({
      api: "refactorkit",
      apiVersion: "0.2",
      provider: "refactorkit",
      providerVersion: "0.5.0-SNAPSHOT",
      javaImportExternalClass: {
        supported: true,
        targetDirectory: true,
        preview: true,
        apply: true,
        // rollback is deliberately absent
        stability: "experimental",
        backendSource: previewRequest.code,
      },
    });
    const error = await new TauriRefactorKitAdapter()
      .getCapabilities()
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ command: "get_refactorkit_capabilities", cause: undefined });
    expect(JSON.stringify(error)).not.toContain(previewRequest.code);
  });

  it.each(["ready", "refused", "stale", "error"])("normalizes a future %s plan", async (status) => {
    const response = {
      ...plan,
      status,
      refusalReasons: status === "ready" ? [] : [`${status} reason`],
      applyEligibility: {
        eligible: status === "ready",
        blockers: status === "ready" ? [] : ["blocked"],
      },
      staleness: {
        stale: status === "stale",
        reasons: status === "stale" ? ["workspace changed"] : [],
      },
    };
    invokeMock.mockResolvedValueOnce(response);
    await expect(
      new TauriRefactorKitAdapter().previewExternalJavaImport(previewRequest),
    ).resolves.toEqual(response);
    expect(invokeMock).toHaveBeenCalledWith("preview_refactorkit_external_java_import", {
      request: previewRequest,
    });
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("request.targetPackage");
  });

  it("sends exact apply, discard, and rollback requests without source fields", async () => {
    const adapter = new TauriRefactorKitAdapter();
    const applyRequest = {
      planId: "plan-1",
      workspaceId: "workspace:1",
      workspaceGeneration: 7,
      selectionGeneration: 9,
      requestId: "apply-1",
      approval: {
        approvalId: "approval-1",
        approvedPlanId: "plan-1",
        approvedAt: "2026-07-12T12:34:56.123Z",
      },
    };
    const applyResult = {
      transactionId: "transaction-1",
      planId: "plan-1",
      changedFiles: plan.affectedFiles,
      primaryFile: "src/main/java/example/Widget.java",
      diagnostics: [],
      provider: "refactorkit",
      providerVersion: "2.0.0",
    };
    invokeMock.mockResolvedValueOnce(applyResult);
    await expect(adapter.applyPlan(applyRequest)).resolves.toEqual(applyResult);
    expect(invokeMock).toHaveBeenLastCalledWith("apply_refactorkit_plan", {
      request: applyRequest,
    });
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("request.code");
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("request.source");

    const discardRequest = {
      planId: "plan-2",
      workspaceId: "workspace:1",
      workspaceGeneration: 7,
      selectionGeneration: 9,
      requestId: "discard-1",
    };
    invokeMock.mockResolvedValueOnce({ planId: "plan-2", discarded: true });
    await expect(adapter.discardPlan(discardRequest)).resolves.toEqual({
      planId: "plan-2",
      discarded: true,
    });
    expect(invokeMock).toHaveBeenLastCalledWith("discard_refactorkit_plan", {
      request: discardRequest,
    });

    const rollbackRequest = {
      transactionId: "transaction-1",
      workspaceId: "workspace:1",
      workspaceGeneration: 7,
      requestId: "rollback-1",
    };
    const rollbackResult = {
      transactionId: "transaction-1",
      rolledBack: true,
      changedFiles: plan.affectedFiles,
      diagnostics: [],
    };
    invokeMock.mockResolvedValueOnce(rollbackResult);
    await expect(adapter.rollbackTransaction(rollbackRequest)).resolves.toEqual(rollbackResult);
    expect(invokeMock).toHaveBeenLastCalledWith("rollback_refactorkit_transaction", {
      request: rollbackRequest,
    });
    expect(invokeMock.mock.calls[2]?.[1]).not.toHaveProperty("request.force");
    for (const [, args] of invokeMock.mock.calls.slice(0, 3)) {
      expect(args).not.toHaveProperty("request.source");
      expect(args).not.toHaveProperty("request.code");
      expect(args).not.toHaveProperty("request.targetPackage");
    }
  });

  it("defensively rejects a mismatched discard result without retaining its payload", async () => {
    invokeMock.mockResolvedValueOnce({
      planId: "other-plan",
      discarded: true,
      source: previewRequest.code,
    });
    const error = await new TauriRefactorKitAdapter()
      .discardPlan({
        planId: "plan-1",
        workspaceId: "workspace:1",
        workspaceGeneration: 7,
        selectionGeneration: 9,
        requestId: "discard-1",
      })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ command: "discard_refactorkit_plan", cause: undefined });
    expect(String(error)).not.toContain(previewRequest.code);
  });

  it.each([
    ["traversal", { affectedFiles: [{ change: "create", path: "../Secret.java", primary: true }] }],
    [
      "absolute path",
      { affectedFiles: [{ change: "create", path: "/tmp/Secret.java", primary: true }] },
    ],
    ["bad confidence", { confidence: 1.1 }],
    [
      "zero diagnostic line",
      { diagnosticsAfterPreview: [{ severity: "error", message: "bad", line: 0 }] },
    ],
    ["oversized diff", { renderedDiff: "x".repeat(2 * 1024 * 1024 + 1) }],
  ])("rejects malformed future plan: %s", async (_name, override) => {
    const secret = "class BackendSecret {}";
    const response = { ...plan, ...override, backendSource: secret };
    invokeMock.mockResolvedValueOnce(response);
    const error = await new TauriRefactorKitAdapter()
      .previewExternalJavaImport(previewRequest)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: "preview_refactorkit_external_java_import",
      cause: undefined,
    });
    expect(String(error)).not.toContain(secret);
  });

  it.each([
    [
      "preview refused",
      "preview_refactorkit_external_java_import",
      "REFACTORKIT_PREVIEW_REFUSED",
      "request rejected",
    ],
    [
      "preview failure",
      "preview_refactorkit_external_java_import",
      "REFACTORKIT_PREVIEW_FAILED",
      "session failed",
    ],
    [
      "apply stale",
      "apply_refactorkit_plan",
      "REFACTORKIT_APPLY_STALE",
      "plan is stale or unknown",
    ],
    ["apply refused", "apply_refactorkit_plan", "REFACTORKIT_APPLY_REFUSED", "approval rejected"],
    ["apply failure", "apply_refactorkit_plan", "REFACTORKIT_APPLY_FAILED", "session failed"],
    ["discard failure", "discard_refactorkit_plan", "REFACTORKIT_DISCARD_FAILED", "session failed"],
    [
      "rollback conflict",
      "rollback_refactorkit_transaction",
      "REFACTORKIT_ROLLBACK_CONFLICT",
      "rollback conflict",
    ],
    [
      "rollback failure",
      "rollback_refactorkit_transaction",
      "REFACTORKIT_ROLLBACK_FAILED",
      "session failed",
    ],
  ])("redacts a source-echoing %s", async (_name, command, code, nativeMessage) => {
    invokeMock.mockRejectedValueOnce(`${nativeMessage}: ${previewRequest.code}`);
    const adapter = new TauriRefactorKitAdapter();
    const requestByCommand: Record<string, () => Promise<unknown>> = {
      preview_refactorkit_external_java_import: () =>
        adapter.previewExternalJavaImport(previewRequest),
      apply_refactorkit_plan: () =>
        adapter.applyPlan({
          planId: "plan-1",
          workspaceId: "workspace:1",
          workspaceGeneration: 7,
          selectionGeneration: 9,
          requestId: "apply-1",
          approval: {
            approvalId: "approval-1",
            approvedPlanId: "plan-1",
            approvedAt: "2026-07-12T12:34:56Z",
          },
        }),
      discard_refactorkit_plan: () =>
        adapter.discardPlan({
          planId: "plan-1",
          workspaceId: "workspace:1",
          workspaceGeneration: 7,
          selectionGeneration: 9,
          requestId: "discard-1",
        }),
      rollback_refactorkit_transaction: () =>
        adapter.rollbackTransaction({
          transactionId: "transaction-1",
          workspaceId: "workspace:1",
          workspaceGeneration: 7,
          requestId: "rollback-1",
        }),
    };
    const error = await requestByCommand[command]().catch((value: unknown) => value);
    expect(error).toMatchObject({ code, command, cause: undefined });
    expect(String(error)).not.toContain(previewRequest.code);
    expect(JSON.stringify(error)).not.toContain(previewRequest.code);
  });

  it("maps a capability command failure to a static error without attaching or logging private detail", async () => {
    const privateValues = [
      previewRequest.code,
      "private-diagnostic-sentinel",
      "private-response-payload-sentinel",
      "private-response-id-sentinel",
      "private-native-detail-sentinel",
    ];
    const loggingSpies = [
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
    ];
    invokeMock.mockRejectedValueOnce({
      message: `unsupported: ${privateValues.at(-1)}`,
      source: privateValues[0],
      diagnostics: [privateValues[1]],
      response: { payload: privateValues[2], id: privateValues[3] },
    });

    try {
      const error = await new TauriRefactorKitAdapter()
        .getCapabilities()
        .catch((value: unknown) => value);
      expect(error).toMatchObject({ code: "REFACTORKIT_UPDATE_REQUIRED", cause: undefined });
      expect(error).not.toHaveProperty("response");
      expect(String(error)).toContain("updated managed backend");
      for (const privateValue of privateValues) {
        expect(String(error)).not.toContain(privateValue);
        expect(JSON.stringify(error)).not.toContain(privateValue);
      }
      for (const loggingSpy of loggingSpies) expect(loggingSpy).not.toHaveBeenCalled();
    } finally {
      for (const loggingSpy of loggingSpies) loggingSpy.mockRestore();
    }
  });
});
