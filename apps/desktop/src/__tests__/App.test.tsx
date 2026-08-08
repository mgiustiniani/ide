// ---------------------------------------------------------------------------
// apps/desktop/src/__tests__/App.test.tsx
// Smoke and integration tests: desktop App renders with Tauri adapters wired.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import {
  XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION,
  XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION,
} from "@ide/contracts";
import { RENDERED_FIXTURES } from "../../../../tests/spec/support/xcom2-project-foundry-rendered-fixtures";

const testHarness = vi.hoisted(() => {
  const harness: any = {};

  const initialFileTreeState = () => ({
    rootNodes: [
      {
        id: "folder-src",
        name: "src",
        path: "src",
        type: "folder",
        isOpen: true,
        children: [{ id: "file-main.tsx", name: "main.tsx", path: "src/main.tsx", type: "file" }],
      },
    ],
    expandedPaths: ["src"],
    selectedFilePath: null,
    isLoading: false,
    setSelectedFilePath: vi.fn((path: string | null) => {
      harness.fileTreeState.selectedFilePath = path;
    }),
  });

  const initialEditorState = () => ({
    openFiles: [],
    activeFilePath: null,
    tabs: [],
    contents: {},
    isLoading: false,
    setActiveFile: vi.fn(),
    closeFile: vi.fn(),
  });

  const initialTerminalState = () => ({
    output: [],
    commandHistory: [],
    isSessionActive: false,
    isLoading: false,
    currentInput: "",
    cols: 80,
    rows: 25,
    setSessionActive: vi.fn(),
    setLoading: vi.fn(),
  });

  const initialPanelState = () => ({
    layout: {
      visibility: {
        leftSidebar: { visible: true },
        bottomPanel: { active: true },
      },
      leftSidebarWidth: 260,
      bottomPanelHeight: 200,
    },
    setLeftSidebarWidth: vi.fn(),
    setBottomPanelHeight: vi.fn(),
    toggleVisibility: vi.fn(),
    setActivePanel: vi.fn(),
  });

  harness.reset = () => {
    harness.fileTreeState = initialFileTreeState();
    harness.editorState = initialEditorState();
    harness.terminalState = initialTerminalState();
    harness.panelState = initialPanelState();
    harness.fileTreeViewModel = null;
    harness.fileTreeStore = null;
    harness.useRealFileTree = false;
    harness.editorViewModel = null;
    harness.terminalViewModel = null;
    harness.restoreSessionPromise = null;
    harness.restoreSessionClearsActiveFile = false;
    harness.openFileError = null;
    harness.openFilePromise = null;
    harness.openFilePromises = {};
    harness.openFileErrors = {};
    harness.openFileActiveFilePath = null;
    harness.openFileObservedEditorText = null;
    harness.createFileError = null;
    harness.createFilePath = null;
    harness.createFilePromise = null;
    harness.aiAgentSettings = {
      enabled: false,
      provider: "pi",
      preferredIntegration: "rpc",
      fallbackIntegrations: [],
    };
    harness.aiAgentStatus = {
      provider: "pi",
      enabled: false,
      available: false,
      availability: "not-installed",
      preferredIntegration: "rpc",
      fallbackIntegrations: [],
      checkedAt: "2026-07-10T00:00:00.000Z",
    };
    harness.aiAgentPromptResponse = {
      text: "Mock Pi response",
      provider: "pi",
      integration: "rpc",
    };
    harness.aiAgentCommands = [
      {
        name: "skill:multi-agent",
        source: "skill",
        description: "Coordinate a multi-agent workflow",
        location: "user",
      },
      {
        name: "fix-tests",
        source: "prompt",
        description: "Fix failing tests",
        location: "project",
      },
    ];
    harness.aiAgentCommandsError = null;
    harness.aiAgentSessionMessages = { messages: [] };
    harness.workspaceInfo = {
      id: "workspace-one",
      name: "Workspace One",
      rootPath: "/workspace/one",
    };
    harness.workspaceRegistry = {
      currentWorkspaceId: "workspace-one",
      workspaces: [
        harness.workspaceInfo,
        { id: "workspace-two", name: "Workspace Two", rootPath: "/workspace/two" },
      ],
    };
    harness.refactorKitStatus = {
      available: true,
      path: "/usr/bin/refactorkit",
      version: "1.2.3",
      checkedAt: "2026-07-11T00:00:00.000Z",
    };
    harness.languageServiceStatus = {
      state: "stopped",
      provider: "jdt-ls",
      workspaceId: "workspace-one",
      generation: 3,
      capabilities: {
        documentSync: false,
        diagnostics: false,
        completion: false,
        hover: false,
        signature: false,
        definition: false,
        references: false,
        symbols: false,
        codeActions: false,
        formatting: false,
        rename: false,
        hierarchy: false,
      },
      checkedAt: "2026-07-11T00:00:00.000Z",
    };
    const productStatus = (product: any, lifecycle: string, percentage: number) => ({
      product,
      manifestProvenance: {
        source: "steam-appmanifest",
        displayPath: `appmanifest_${product.appId}.acf`,
        pathRedacted: true,
      },
      lifecycle,
      stateFlags: "1026",
      bytesDownloaded: "90071992547409930",
      bytesToDownload: "180143985094819860",
      bytesStaged: "45035996273704965",
      bytesToStage: "90071992547409930",
      downloadPercentage: percentage,
      stagingPercentage: percentage / 2,
      sizeOnDisk: "90071992547409930",
      installDirectoryPresent: true,
      downloadDirectoryPresent: lifecycle !== "installed",
      manifestLastModifiedAt: "2026-07-11T00:00:00.000Z",
      complete: lifecycle === "installed",
      completionReasons: [lifecycle === "installed" ? "Installed" : "Download incomplete"],
      stable: lifecycle === "installed",
      stabilityReasons: [lifecycle === "installed" ? "Stable" : "Steam activity detected"],
      mutationBlocked: true,
      mutationBlockedReasons: ["Read-only monitor"],
      checkedAt: "2026-07-11T00:00:00.000Z",
    });
    harness.xcom2SetupSnapshot = {
      workspaceId: "workspace-one",
      generation: 1,
      steamRoot: { source: "steam-client", displayRoot: "Steam Library", pathRedacted: true },
      products: [
        productStatus(
          { appId: 268500, name: "XCOM 2", kind: "game", role: "required" },
          "downloading",
          50,
        ),
        productStatus(
          {
            appId: 602410,
            name: "XCOM 2: War of the Chosen Development Tools",
            kind: "development-tools",
            role: "required",
          },
          "staging",
          25,
        ),
      ],
      overallState: "downloading",
      canPlanSetup: false,
      canApplySetup: false,
      blockers: ["Required Steam downloads are incomplete"],
      warnings: [],
      checkedAt: "2026-07-11T00:00:00.000Z",
    };
    harness.xcom2SetupError = null;
    harness.xcom2ModuleScanObservations = [];
    harness.xcom2ModuleScanError = null;
    harness.xcom2ModuleConfiguration = null;
    harness.xcom2ModuleConfigurationStopCode = null;
    harness.xcom2ModuleConfigurationStoppedExtras = null;
    harness.xcom2ModuleConfigurationGate = null;
    harness.xcom2ModuleConfigurationError = null;
    harness.xcom2Transaction = null;
    harness.xcom2Transactions = [];
    harness.xcom2TransactionError = null;
    harness.xcom2TransactionListeners = new Set<(event: any) => void>();
    harness.emitXcom2TransactionEvent = (event: any) => {
      for (const listener of harness.xcom2TransactionListeners) listener(event);
    };
    harness.xcom2SetupListeners = new Set<(event: any) => void>();
    harness.emitXcom2SetupEvent = (event: any) => {
      for (const listener of harness.xcom2SetupListeners) listener(event);
    };
    harness.languageServiceListeners = new Map<string, Set<(event: any) => void>>();
    harness.emitLanguageServiceEvent = (workspaceId: string, event: any) => {
      for (const listener of harness.languageServiceListeners.get(workspaceId) ?? [])
        listener(event);
    };
    harness.clipboardText = "public class Imported {}";
    harness.externalJavaCapabilities = {
      api: "refactorkit",
      apiVersion: "0.2",
      provider: "refactorkit",
      providerVersion: "0.5.0-SNAPSHOT",
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
          adapters: [
            {
              languageId: "java",
              extensions: ["java"],
              backend: "eclipse-jdt-3.44",
              capabilities: [],
            },
            {
              languageId: "javascript",
              extensions: ["js"],
              backend: "tree-sitter-jni-0.25.3",
              capabilities: [],
            },
            {
              languageId: "typescript",
              extensions: ["ts"],
              backend: "tree-sitter-jni-0.25.3",
              capabilities: [],
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
      safety: {
        previewBeforeApply: true,
        snapshotValidation: true,
        transactionRollback: true,
        workspaceScopedWrites: true,
      },
    };
    harness.externalJavaPlan = null;
    harness.externalJavaApplyResult = null;
    harness.latestPanelLayoutProps = null;
    harness.latestProjectFoundryDialogProps = null;
    harness.latestSemanticSymbolSearchProps = null;
    harness.latestSettingsPanelDiagnosticPresentation = null;
    harness.latestSettingsPanelConfigurationChecking = false;
    harness.latestXcom2ProjectRecognitionPanelProps = null;
    harness.refactorKitResult = {
      stdout: "RefactorKit scan complete",
      stderr: "",
      success: true,
      code: 0,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      command: ["refactorkit", "scan"],
      locations: [],
    };
  };

  harness.createDeferredRestore = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    harness.restoreSessionPromise = promise;
    return { promise, resolve };
  };

  harness.reset();
  return harness;
});

const xcom2Digest = "a".repeat(64);
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(count = 12): Promise<void> {
  await act(async () => {
    for (let index = 0; index < count; index += 1) {
      await Promise.resolve();
    }
  });
}

function externalJavaPlan(request: any, overrides: Record<string, any> = {}) {
  return {
    planId: "plan-java-1",
    status: "ready",
    summary: "Create Imported.java",
    confidence: 0.98,
    riskLevel: "low",
    evidence: [{ kind: "placement", summary: "Backend placement" }],
    affectedFiles: [{ change: "create", path: "src/Imported.java", primary: true }],
    placement: { packageName: "example", sourceRoot: "src", moduleName: "app" },
    packageChanges: [],
    renderedDiff: "+ public class Imported {}",
    structuredDiff: [],
    warnings: [],
    diagnosticsAfterPreview: [],
    provenance: {
      sourceKind: "clipboard",
      sourceUrl: null,
      detectedLicense: "MIT",
      licensePolicy: "warn",
      notices: [],
    },
    unresolvedDependencies: [],
    conflicts: [],
    refusalReasons: [],
    applyEligibility: { eligible: true, blockers: [] },
    staleness: { stale: false, reasons: [] },
    provider: "managed-refactorkit",
    providerVersion: "future",
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    selectionGeneration: request.selectionGeneration,
    requestId: request.requestId,
    ...overrides,
  };
}

function enableExternalJavaImport() {
  testHarness.externalJavaCapabilities = {
    ...testHarness.externalJavaCapabilities,
    javaImportExternalClass: {
      ...testHarness.externalJavaCapabilities.javaImportExternalClass,
      supported: true,
      targetDirectory: true,
      preview: true,
      apply: true,
    },
  };
  testHarness.externalJavaPlan = (request: any) => externalJavaPlan(request);
  testHarness.externalJavaApplyResult = {
    transactionId: "tx-java-1",
    planId: "plan-java-1",
    changedFiles: [{ change: "create", path: "src/Imported.java", primary: true }],
    primaryFile: "src/Imported.java",
    diagnostics: [],
    provider: "managed-refactorkit",
    providerVersion: "future",
  };
}

function xcom2Transaction(overrides: Record<string, any> = {}) {
  return {
    transactionId: "tx-native-1",
    planId: "plan-native-1",
    planVersion: 1,
    workspaceId: "workspace-one",
    workspaceGeneration: 1,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    state: "waiting-for-download",
    approvedStepIds: [],
    approvedOperationIds: [],
    approvedCapabilities: [],
    reviewedOperationDigest: { algorithm: "sha256", digest: xcom2Digest },
    journal: {
      scope: "local-machine",
      managedBy: "native",
      redactedLocation: "Native journal (redacted)",
    },
    applyAvailability: {
      allowed: false,
      blockers: ["Downloads, grants, and native audit are incomplete"],
    },
    rollbackAvailable: false,
    conflictReasons: [],
    recoveryGuidance: [],
    operations: [],
    externalActions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks: Tauri adapters depend on @tauri-apps/api which is unavailable in
// a jsdom environment, so we mock the entire module.
// ---------------------------------------------------------------------------
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({}),
}));

vi.mock("@tauri-apps/api/process", () => ({
  exit: vi.fn(),
}));

vi.mock("@ide/tauri-adapters", () => {
  const fileTreeAdapter = {
    getRoot: vi.fn().mockResolvedValue([]),
    getChildren: vi.fn().mockResolvedValue([]),
    createFile: vi.fn().mockResolvedValue([]),
    createFolder: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue([]),
    rename: vi.fn().mockResolvedValue([]),
    onFileSelect: vi.fn().mockReturnValue(vi.fn()),
  };
  testHarness.fileTreeAdapter = fileTreeAdapter;

  const editorAdapter = {
    loadContent: vi.fn().mockResolvedValue({
      filePath: "src/App.tsx",
      content: "",
      language: "typescript",
    }),
    saveContent: vi.fn().mockResolvedValue([]),
    getOpenFiles: vi.fn().mockResolvedValue([]),
    closeFile: vi.fn().mockResolvedValue([]),
  };

  const terminalAdapter = {
    executeCommand: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    onOutput: vi.fn().mockReturnValue(vi.fn()),
    onExit: vi.fn().mockReturnValue(vi.fn()),
    startSession: vi.fn(),
    stopSession: vi.fn(),
  };

  const aiAgentAdapter = {
    getSettings: vi.fn(() => Promise.resolve(testHarness.aiAgentSettings)),
    getStatus: vi.fn(() => Promise.resolve(testHarness.aiAgentStatus)),
    updateSettings: vi.fn((settings: any) => {
      testHarness.aiAgentSettings = {
        ...testHarness.aiAgentSettings,
        ...settings,
        provider: "pi",
      };
      return Promise.resolve(testHarness.aiAgentSettings);
    }),
    installPiAgent: vi.fn().mockResolvedValue({
      provider: "pi",
      success: true,
      outcome: "already-installed",
      message: "Pi Agent verified.",
    }),
    listCommands: vi.fn(() => {
      if (testHarness.aiAgentCommandsError) {
        return Promise.reject(testHarness.aiAgentCommandsError);
      }
      return Promise.resolve(testHarness.aiAgentCommands);
    }),
    getSessionMessages: vi.fn(() => Promise.resolve(testHarness.aiAgentSessionMessages)),
    sendPrompt: vi.fn((prompt: string) => {
      const responseMetadata = testHarness.aiAgentPromptResponse?.metadata;
      return Promise.resolve({
        ...testHarness.aiAgentPromptResponse,
        metadata: {
          ...(responseMetadata &&
          typeof responseMetadata === "object" &&
          !Array.isArray(responseMetadata)
            ? responseMetadata
            : {}),
          prompt,
        },
      });
    }),
  };
  testHarness.aiAgentAdapter = aiAgentAdapter;

  const workspaceAdapter = {
    ensureCurrentWorkspace: vi.fn(() => Promise.resolve(testHarness.workspaceInfo)),
    listWorkspaces: vi.fn(() => Promise.resolve(testHarness.workspaceRegistry)),
    switchWorkspace: vi.fn((workspaceId: string) => {
      const workspace = testHarness.workspaceRegistry.workspaces.find(
        (candidate: any) => candidate.id === workspaceId,
      );
      testHarness.workspaceInfo = workspace;
      testHarness.workspaceRegistry = {
        ...testHarness.workspaceRegistry,
        currentWorkspaceId: workspaceId,
      };
      return Promise.resolve(workspace);
    }),
  };
  testHarness.workspaceAdapter = workspaceAdapter;

  const clipboardAdapter = {
    readText: vi.fn(() => Promise.resolve(testHarness.clipboardText)),
  };
  testHarness.clipboardAdapter = clipboardAdapter;

  const refactorKitAdapter = {
    getStatus: vi.fn(() => Promise.resolve(testHarness.refactorKitStatus)),
    getCapabilities: vi.fn(() => Promise.resolve(testHarness.externalJavaCapabilities)),
    previewExternalJavaImport: vi.fn((request: any) =>
      Promise.resolve(
        typeof testHarness.externalJavaPlan === "function"
          ? testHarness.externalJavaPlan(request)
          : testHarness.externalJavaPlan,
      ),
    ),
    applyPlan: vi.fn(() => Promise.resolve(testHarness.externalJavaApplyResult)),
    rollbackTransaction: vi.fn(),
    discardPlan: vi.fn((request: any) =>
      Promise.resolve({ planId: request.planId, discarded: true }),
    ),
    scan: vi.fn(() => Promise.resolve(testHarness.refactorKitResult)),
    diagnostics: vi.fn(() => Promise.resolve(testHarness.refactorKitResult)),
    symbols: vi.fn(() => Promise.resolve(testHarness.refactorKitResult)),
    definition: vi.fn(() => Promise.resolve(testHarness.refactorKitResult)),
    references: vi.fn(() => Promise.resolve(testHarness.refactorKitResult)),
    startSavedSnapshotSemanticSession: vi.fn(),
    stopSavedSnapshotSemanticSession: vi.fn(),
    searchSavedSnapshotSymbols: vi.fn(),
    resolveSavedSnapshotDefinition: vi.fn(),
  };
  testHarness.refactorKitAdapter = refactorKitAdapter;

  const languageSessionAdapter = {
    getStatus: vi.fn(({ workspaceId }: any) =>
      Promise.resolve({ ...testHarness.languageServiceStatus, workspaceId }),
    ),
    start: vi.fn(({ workspaceId }: any) => {
      testHarness.languageServiceStatus = {
        ...testHarness.languageServiceStatus,
        workspaceId,
        state: "ready",
        generation: testHarness.languageServiceStatus.generation + 1,
      };
      return Promise.resolve(testHarness.languageServiceStatus);
    }),
    stop: vi.fn(({ workspaceId }: any) => {
      const status = { ...testHarness.languageServiceStatus, workspaceId, state: "stopped" };
      if (workspaceId === testHarness.languageServiceStatus.workspaceId) {
        testHarness.languageServiceStatus = status;
      }
      return Promise.resolve(status);
    }),
    restart: vi.fn(({ workspaceId }: any) => {
      testHarness.languageServiceStatus = {
        ...testHarness.languageServiceStatus,
        workspaceId,
        state: "ready",
        generation: testHarness.languageServiceStatus.generation + 1,
      };
      return Promise.resolve(testHarness.languageServiceStatus);
    }),
    didOpen: vi.fn().mockResolvedValue(undefined),
    didChange: vi.fn().mockResolvedValue(undefined),
    didSave: vi.fn().mockResolvedValue(undefined),
    didClose: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((workspaceId: string, listener: (event: any) => void) => {
      const listeners = testHarness.languageServiceListeners.get(workspaceId) ?? new Set();
      listeners.add(listener);
      testHarness.languageServiceListeners.set(workspaceId, listeners);
      return vi.fn(() => listeners.delete(listener));
    }),
  };
  testHarness.languageSessionAdapter = languageSessionAdapter;

  const javaIntelligenceAdapter = {
    completion: vi.fn(),
    hover: vi.fn(),
    signatureHelp: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
  testHarness.javaIntelligenceAdapter = javaIntelligenceAdapter;

  const xcom2ModuleScannerAdapter = {
    scan: vi.fn((request: any) =>
      testHarness.xcom2ModuleScanError
        ? Promise.reject(testHarness.xcom2ModuleScanError)
        : Promise.resolve({
            workspaceId: request.workspaceId,
            workspaceGeneration: request.workspaceGeneration,
            scanId: request.scanId,
            scanGeneration: request.scanGeneration,
            completeness: "complete",
            issues: [],
            limits: request.limits,
            observations: testHarness.xcom2ModuleScanObservations,
          }),
    ),
  };
  testHarness.xcom2ModuleScannerAdapter = xcom2ModuleScannerAdapter;

  const xcom2ModuleConfigurationAdapter = {
    read: vi.fn(async (request: any) => {
      if (testHarness.xcom2ModuleConfigurationGate) {
        await testHarness.xcom2ModuleConfigurationGate;
      }
      if (testHarness.xcom2ModuleConfigurationError) {
        throw testHarness.xcom2ModuleConfigurationError;
      }
      if (testHarness.xcom2ModuleConfigurationStopCode) {
        return {
          ...request,
          kind: "stopped",
          code: testHarness.xcom2ModuleConfigurationStopCode,
          ...testHarness.xcom2ModuleConfigurationStoppedExtras,
        };
      }
      return testHarness.xcom2ModuleConfiguration
        ? { ...request, kind: "ready", configuration: testHarness.xcom2ModuleConfiguration }
        : { ...request, kind: "absent" };
    }),
  };
  testHarness.xcom2ModuleConfigurationAdapter = xcom2ModuleConfigurationAdapter;

  const xcom2SetupMonitorAdapter = {
    getSnapshot: vi.fn(() =>
      testHarness.xcom2SetupError
        ? Promise.reject(testHarness.xcom2SetupError)
        : Promise.resolve(testHarness.xcom2SetupSnapshot),
    ),
    refresh: vi.fn(() =>
      testHarness.xcom2SetupError
        ? Promise.reject(testHarness.xcom2SetupError)
        : Promise.resolve(testHarness.xcom2SetupSnapshot),
    ),
    subscribe: vi.fn((listener: (event: any) => void) => {
      testHarness.xcom2SetupListeners.add(listener);
      return vi.fn(() => testHarness.xcom2SetupListeners.delete(listener));
    }),
  };
  testHarness.xcom2SetupMonitorAdapter = xcom2SetupMonitorAdapter;

  const result = () =>
    testHarness.xcom2TransactionError
      ? Promise.resolve({ ok: false, error: testHarness.xcom2TransactionError })
      : Promise.resolve({ ok: true, value: testHarness.xcom2Transaction });
  const xcom2SetupAdapter = {
    prepare: vi.fn(result),
    approve: vi.fn(),
    apply: vi.fn(result),
    getTransaction: vi.fn(result),
    listTransactions: vi.fn(() =>
      testHarness.xcom2TransactionError
        ? Promise.resolve({ ok: false, error: testHarness.xcom2TransactionError })
        : Promise.resolve({ ok: true, value: { transactions: testHarness.xcom2Transactions } }),
    ),
    cancel: vi.fn(result),
    rollback: vi.fn(result),
    recover: vi.fn(result),
    subscribe: vi.fn((_filter: any, listener: (event: any) => void) => {
      testHarness.xcom2TransactionListeners.add(listener);
      return vi.fn(() => testHarness.xcom2TransactionListeners.delete(listener));
    }),
  };
  testHarness.xcom2SetupAdapter = xcom2SetupAdapter;

  return {
    TauriFileTreeAdapter: vi.fn().mockImplementation(() => fileTreeAdapter),
    TauriEditorAdapter: vi.fn().mockImplementation(() => editorAdapter),
    TauriTerminalAdapter: vi.fn().mockImplementation(() => terminalAdapter),
    TauriAiAgentAdapter: vi.fn().mockImplementation(() => aiAgentAdapter),
    createTauriAdapters: vi.fn(() => ({
      fileTreeAdapter,
      editorAdapter,
      terminalAdapter,
      aiAgentAdapter,
      workspaceAdapter,
      clipboardAdapter,
      refactorKitAdapter,
      languageSessionAdapter,
      documentSyncAdapter: languageSessionAdapter,
      javaIntelligenceAdapter,
      xcom2ModuleConfigurationAdapter,
      xcom2ModuleScannerAdapter,
      xcom2SetupAdapter,
      xcom2SetupMonitorAdapter,
    })),
  };
});

// ---------------------------------------------------------------------------
// Mock UI components that may rely on CSS or external assets
// ---------------------------------------------------------------------------
vi.mock("@ide/ui", () => ({
  Icon: ({ type }: any) => <span data-testid={`icon-${type}`} />,
  PanelLayout: ({
    leftSidebar,
    searchActivityContent,
    activityContributions = [],
    activeActivity = "explorer",
    onActivityChange,
    onToggleLeftSidebar,
    onToggleBottomPanel,
    mainContent,
    rightSidebarContent,
    bottomContent,
  }: any) => {
    const contribution = activityContributions.find(
      (candidate: any) => candidate.id === activeActivity,
    );
    const selectedActivity =
      activeActivity === "search" || contribution ? activeActivity : "explorer";
    const selectableActivities = [
      "explorer",
      ...(searchActivityContent === undefined ? [] : ["search"]),
      ...activityContributions.map((candidate: any) => candidate.id),
    ];
    const selectAdjacentActivity = (event: any, activity: string) => {
      const currentIndex = selectableActivities.indexOf(activity);
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        onActivityChange?.(selectableActivities[(currentIndex + 1) % selectableActivities.length]);
      }
    };
    testHarness.latestPanelLayoutProps = {
      activeActivity,
      activityContributions,
      hasSearchActivityContent: searchActivityContent !== undefined,
      onActivityChange,
      onToggleLeftSidebar,
      onToggleBottomPanel,
    };
    return (
      <div data-testid="PanelLayout" data-active-activity={activeActivity}>
        <div role="tablist" aria-label="Primary activity">
          <button
            type="button"
            role="tab"
            aria-selected={selectedActivity === "explorer"}
            onClick={() => onActivityChange?.("explorer")}
            onKeyDown={(event) => selectAdjacentActivity(event, "explorer")}
          >
            Explorer
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={selectedActivity === "search"}
            disabled={searchActivityContent === undefined || !onActivityChange}
            onClick={() => onActivityChange?.("search")}
            onKeyDown={(event) => selectAdjacentActivity(event, "search")}
          >
            Search
          </button>
          {activityContributions.map((candidate: any) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={selectedActivity === candidate.id}
              title={candidate.title}
              onClick={() => onActivityChange?.(candidate.id)}
              onKeyDown={(event) => selectAdjacentActivity(event, candidate.id)}
            >
              {candidate.label}
            </button>
          ))}
        </div>
        {selectedActivity === "search"
          ? searchActivityContent
          : contribution
            ? contribution.content
            : leftSidebar}
        {mainContent}
        {rightSidebarContent ? <div data-testid="RightSidebar">{rightSidebarContent}</div> : null}
        {bottomContent}
      </div>
    );
  },
  SemanticSymbolSearchPanel: (props: any) => {
    testHarness.latestSemanticSymbolSearchProps = props;
    return (
      <div
        data-testid="SemanticSymbolSearchPanel"
        data-language={props.language}
        data-query={props.query}
        data-snapshot-state={props.snapshotState}
        data-evidence-state={props.evidenceState}
        data-availability={props.availability}
        data-result-limit={String(props.resultLimit)}
      >
        Semantic symbol search
      </div>
    );
  },
  Xcom2ProjectRecognitionPanel: (props: any) => {
    testHarness.latestXcom2ProjectRecognitionPanelProps = props;
    const recognitionSnapshot = props.recognitionSnapshot ?? props.snapshot;
    const renderedDecisions = props.activeProjectDecisions ?? props.activeDecisions;
    return (
      <section
        data-testid="Xcom2ProjectRecognitionPanel"
        data-workspace={recognitionSnapshot.workspaceId}
        data-active-count={String(renderedDecisions.length)}
        aria-label="XCOM 2 Project"
      >
        <h2>XCOM 2 Project</h2>
        {renderedDecisions.map((decision: any) => (
          <div key={decision.moduleRoot}>{decision.moduleRoot}</div>
        ))}
        {props.diagnosticPresentation ? (
          <div role="alert">
            <strong>{props.diagnosticPresentation.title}</strong>
            <span>Project file: {props.diagnosticPresentation.projectFileLabel}</span>
            <span>{props.diagnosticPresentation.summary}</span>
            <span>{props.diagnosticPresentation.remediation}</span>
            <code>{props.diagnosticPresentation.supportIdentifier}</code>
          </div>
        ) : null}
      </section>
    );
  },
  Xcom2ProjectFoundryDialog: (props: any) => {
    testHarness.latestProjectFoundryDialogProps = props;
    const terminal = props.creationState?.kind === "attention";
    return (
      <div
        role="dialog"
        aria-label="New XCOM 2 Project"
        data-testid="Xcom2ProjectFoundryDialog"
        data-view-state={props.viewState.kind}
        data-creation-state={props.creationState?.kind ?? ""}
      >
        <label>
          EMPT repository
          <input value={props.sourceRepository} readOnly disabled={terminal} />
        </label>
        <button
          type="button"
          disabled={terminal}
          onClick={() => void props.onSelectSourceRepository()}
        >
          Select EMPT repository
        </button>
        <label>
          Destination parent
          <input value={props.destinationParent} readOnly disabled={terminal} />
        </label>
        <button
          type="button"
          disabled={terminal}
          onClick={() => void props.onSelectDestinationParent()}
        >
          Select Destination parent
        </button>
        <label>
          ModId
          <input
            value={props.modId}
            disabled={terminal}
            onChange={(event) => props.onModIdChange(event.target.value)}
          />
        </label>
        <label>
          Final project location
          <input value={props.finalProjectLocation ?? ""} readOnly disabled={terminal} />
        </label>
        {props.viewState.kind === "ready" ? (
          <output>{props.viewState.plan.planDigest}</output>
        ) : props.viewState.kind === "refused" ? (
          <div role="alert">{props.viewState.code}</div>
        ) : null}
        {props.creationState?.kind === "creating" ? (
          <div role="status">Creating project…</div>
        ) : null}
        {props.creationState?.kind === "created" ? (
          <div role="status">
            Project created
            <span>{props.creationState.receipt.finalProjectLocation}</span>
          </div>
        ) : null}
        {props.creationState?.kind === "attention" ? (
          <section role="alert" aria-atomic="true">
            <h3>{props.creationState.presentation.title}</h3>
            <dl>
              <dt>Summary</dt>
              <dd>{props.creationState.presentation.summary}</dd>
              <dt>Remediation</dt>
              <dd>{props.creationState.presentation.remediation}</dd>
              <dt>Support code</dt>
              <dd>{props.creationState.presentation.supportCode}</dd>
            </dl>
          </section>
        ) : null}
        <button type="button" onClick={() => void props.onCancel()}>
          Cancel
        </button>
        <button
          type="button"
          disabled={terminal || !props.sourceRepository || !props.destinationParent || !props.modId}
          onClick={() => void props.onPreview(props.modId)}
        >
          Preview
        </button>
        {props.viewState.kind === "ready" && props.creationState?.kind !== "unavailable" ? (
          <button
            type="button"
            disabled={terminal || props.creationState?.kind !== "ready"}
            onClick={() => void props.onCreateProject?.(props.viewState.plan.planDigest)}
          >
            Create project
          </button>
        ) : null}
      </div>
    );
  },
  LeftSidebar: ({ children, workspaceContent, isVisible, onToggle }: any) => {
    const [filesExpanded, setFilesExpanded] = useState(true);
    const [workspacesExpanded, setWorkspacesExpanded] = useState(true);
    return (
      <div data-testid="LeftSidebar">
        <button
          type="button"
          aria-label={isVisible ? "Collapse sidebar" : "Expand sidebar"}
          onClick={onToggle}
        >
          Sidebar
        </button>
        <section>
          <button
            type="button"
            aria-expanded={filesExpanded}
            onClick={() => setFilesExpanded((expanded) => !expanded)}
          >
            File Explorer
          </button>
          {filesExpanded ? <div data-testid="FilesSection">{children}</div> : null}
        </section>
        {workspaceContent ? (
          <section>
            <button
              type="button"
              aria-expanded={workspacesExpanded}
              onClick={() => setWorkspacesExpanded((expanded) => !expanded)}
            >
              Workspace Explorer
            </button>
            {workspacesExpanded ? (
              <div data-testid="WorkspacesSection">{workspaceContent}</div>
            ) : null}
          </section>
        ) : null}
      </div>
    );
  },
  WorkspaceExplorer: ({
    registry,
    currentWorkspaceId,
    currentWorkspace,
    onSwitchWorkspace,
    onRefresh,
    isLoading,
    isSwitching,
    switchingWorkspaceId,
    error,
  }: any) => {
    const activeId = currentWorkspaceId ?? currentWorkspace?.id ?? registry?.currentWorkspaceId;
    const disabled = isLoading || isSwitching || switchingWorkspaceId != null;
    return (
      <div data-testid="WorkspaceExplorer" aria-busy={disabled}>
        <button type="button" disabled={disabled} onClick={() => onRefresh?.()}>
          Refresh Workspaces
        </button>
        {error ? <div role="alert">{String(error)}</div> : null}
        {isLoading ? <div role="status">Loading workspaces…</div> : null}
        <div role="listbox" aria-label="Registered workspaces">
          {(registry?.workspaces ?? []).map((workspace: any) => (
            <button
              key={workspace.id}
              type="button"
              role="option"
              aria-selected={workspace.id === activeId}
              disabled={disabled || workspace.id === activeId}
              onClick={() => onSwitchWorkspace?.(workspace.id)}
            >
              {workspace.name}
              {workspace.id === activeId ? " Current" : ""}
            </button>
          ))}
        </div>
      </div>
    );
  },
  BottomPanel: ({ tabs, onTabActivate, children }: any) => (
    <div data-testid="BottomPanel">
      <div role="tablist" aria-label="Bottom panel tabs">
        {tabs.map((tab: any) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.isActive}
            aria-label={tab.badge ? `${tab.label}, ${tab.badge.ariaLabel}` : tab.label}
            data-scope={tab.scope}
            data-has-icon={String(tab.icon !== undefined)}
            data-badge-count={String(tab.badge?.count ?? "")}
            data-badge-severity={tab.badge?.severity ?? ""}
            title={tab.title}
            onClick={() => onTabActivate(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  ),
  FileTree: ({
    onSelect,
    selectedDirectoryPath,
    onSelectDirectory,
    onFocusDirectory,
    onPasteJavaClass,
  }: any) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const directory = { id: "folder-src", name: "src", path: "src", type: "folder" };
    const otherDirectory = { id: "folder-lib", name: "lib", path: "lib", type: "folder" };
    return (
      <div
        data-testid="FileTree"
        tabIndex={0}
        data-selected-directory={selectedDirectoryPath ?? ""}
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "v" &&
            selectedDirectoryPath === "src"
          ) {
            event.preventDefault();
            onPasteJavaClass?.(directory);
          }
        }}
      >
        <button
          type="button"
          data-testid="directory-src"
          onClick={() => onSelectDirectory?.(directory)}
          onFocus={() => onFocusDirectory?.(directory)}
          onContextMenu={(event) => {
            event.preventDefault();
            onSelectDirectory?.(directory);
            setMenuOpen(true);
          }}
        >
          src
        </button>
        <button
          type="button"
          data-testid="directory-lib"
          onClick={() => onSelectDirectory?.(otherDirectory)}
          onFocus={() => onFocusDirectory?.(otherDirectory)}
        >
          lib
        </button>
        {menuOpen ? (
          <button
            type="button"
            onClick={() => {
              onPasteJavaClass?.(directory);
              setMenuOpen(false);
            }}
          >
            Paste Java Class from Clipboard
          </button>
        ) : null}
        <button
          type="button"
          data-testid="file-src-main"
          onClick={() =>
            onSelect({ id: "file-main.tsx", name: "main.tsx", path: "src/main.tsx", type: "file" })
          }
        >
          main.tsx
        </button>
        <button
          type="button"
          data-testid="file-src-main-java"
          onClick={() =>
            onSelect({
              id: "file-main.java",
              name: "Main.java",
              path: "src/Main.java",
              type: "file",
            })
          }
        >
          Main.java
        </button>
        <button
          type="button"
          data-testid="file-src-other"
          onClick={() =>
            onSelect({ id: "file-other.ts", name: "other.ts", path: "src/other.ts", type: "file" })
          }
        >
          other.ts
        </button>
      </div>
    );
  },
  ExternalJavaImportPreviewDialog: ({
    status,
    selectedTargetDirectory,
    plan,
    result,
    unavailableReason,
    errorMessage,
    onCancel,
    onApply,
  }: any) => (
    <div role="dialog" aria-label="Paste Java Class from Clipboard" data-status={status}>
      <span>{selectedTargetDirectory}</span>
      <span>{unavailableReason ?? errorMessage}</span>
      <span>{plan?.summary}</span>
      <pre data-testid="external-java-plan">{plan ? JSON.stringify(plan) : ""}</pre>
      <span>{result?.transactionId}</span>
      <button type="button" onClick={onCancel}>
        Cancel import
      </button>
      <button type="button" disabled={!plan || status !== "preview"} onClick={() => onApply(plan)}>
        Apply Import
      </button>
    </div>
  ),
  Editor: ({
    content,
    filePath,
    tabs,
    onTabClose,
    revealRequest,
    diagnostics,
    onChange,
    onCreateNewFile,
    createFileTargetLabel,
    javaSemantics,
    isLoading,
  }: any) => {
    testHarness.latestJavaSemantics = javaSemantics;
    const [createError, setCreateError] = useState<string | null>(null);
    return (
      <div
        data-testid="Editor"
        data-content={content}
        data-file-path={filePath}
        data-tabs-count={tabs?.length ?? 0}
        data-has-tab-close={String(typeof onTabClose === "function")}
        data-create-file-target={createFileTargetLabel ?? ""}
        data-reveal-file-path={revealRequest?.filePath ?? ""}
        data-reveal-line={revealRequest?.line ?? ""}
        data-reveal-column={revealRequest?.column ?? ""}
        data-reveal-request-id={revealRequest?.requestId ?? ""}
        data-diagnostics-count={diagnostics?.length ?? 0}
        data-has-java-semantics={String(javaSemantics !== undefined)}
        data-java-workspace={javaSemantics?.context?.workspaceId ?? ""}
        data-java-generation={javaSemantics?.context?.generation ?? ""}
        data-java-path={javaSemantics?.context?.document.path ?? ""}
        data-java-uri={javaSemantics?.context?.document.uri ?? ""}
        data-java-version={javaSemantics?.context?.document.version ?? ""}
        data-is-loading={String(isLoading)}
      >
        {filePath === "" ? (
          <h2>No document open</h2>
        ) : isLoading ? (
          <div role="status">
            <strong>{filePath.split("/").pop()}</strong> Opening editor…
          </div>
        ) : (
          <div data-testid="monaco-editor">Monaco</div>
        )}
        <button type="button" onClick={() => onChange?.("edited Java source")}>
          Edit active file
        </button>
        <button type="button" onClick={() => onTabClose?.(filePath)}>
          Close active file
        </button>
        {filePath === "" ? (
          <button
            type="button"
            onClick={() => {
              setCreateError(null);
              void Promise.resolve(onCreateNewFile?.("created.ts")).catch((error) => {
                setCreateError(error instanceof Error ? error.message : "Create failed");
              });
            }}
          >
            Create test file
          </button>
        ) : null}
        {createError ? <span role="alert">{createError}</span> : null}
      </div>
    );
  },
  ProblemsPanel: ({ items, onNavigate }: any) => (
    <div data-testid="ProblemsPanel" data-count={items.length}>
      {items.map((item: any) => (
        <button key={item.id} type="button" onClick={() => onNavigate(item.filePath, item.range)}>
          {item.message}
        </button>
      ))}
    </div>
  ),
  Terminal: ({ commandHistory, onClear }: any) => (
    <div
      data-testid="Terminal"
      data-history-size={commandHistory?.length ?? 0}
      data-has-clear={String(typeof onClear === "function")}
    />
  ),
  AiAgentPanel: ({
    messages,
    isAvailable,
    isEnabled,
    isSending,
    error,
    commands = [],
    isLoadingCommands,
    commandsError,
    onRefreshCommands,
    onSendPrompt,
    onOpenSettings,
  }: any) => (
    <div
      data-testid="AiAgentPanel"
      data-available={String(isAvailable)}
      data-enabled={String(isEnabled)}
      data-sending={String(isSending)}
      data-command-count={String(commands.length)}
      data-loading-commands={String(isLoadingCommands)}
    >
      {!isEnabled ? <div>Pi Agent disabled</div> : null}
      {isEnabled && !isAvailable ? <div>Pi Agent not available</div> : null}
      {error ? <div role="alert">{error}</div> : null}
      {commandsError ? <div role="alert">{commandsError}</div> : null}
      <button type="button" onClick={() => onOpenSettings?.()}>
        Open Settings
      </button>
      <button type="button" disabled={isLoadingCommands} onClick={() => onRefreshCommands?.()}>
        Refresh Commands
      </button>
      <div data-testid="AiAgentCommands">
        {commands.map((command: any) => (
          <button
            key={`${command.source}-${command.name}`}
            type="button"
            onClick={() => {
              const prompt = document.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]');
              if (prompt) prompt.value = `/${command.name} `;
            }}
          >
            Use /{command.name}
          </button>
        ))}
      </div>
      <div data-testid="AiAgentMessages">
        {messages.map((message: any) => (
          <div key={message.id ?? `${message.role}-${message.content}`}>
            {message.role}: {message.content}
          </div>
        ))}
      </div>
      <form
        onSubmit={(event: any) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void onSendPrompt(String(data.get("prompt") ?? ""));
        }}
      >
        <textarea
          aria-label="Prompt"
          name="prompt"
          disabled={!isEnabled || !isAvailable || isSending}
        />
        <button type="submit" disabled={!isEnabled || !isAvailable || isSending}>
          Send
        </button>
      </form>
    </div>
  ),
  Xcom2SetupPanel: ({ snapshot, plan, isLoading, error, isStale, onRefresh, onPlanSetup }: any) => (
    <div
      data-testid="Xcom2SetupPanel"
      data-workspace={snapshot?.workspaceId ?? ""}
      data-generation={String(snapshot?.generation ?? "")}
      data-plan-state={plan?.state ?? ""}
      data-loading={String(isLoading)}
      data-stale={String(isStale)}
    >
      <div>Built-in · Experimental</div>
      <div>Feature ID ide.xcom2-wotc · Currently non-removable</div>
      {error ? <div role="alert">{error}</div> : null}
      {(snapshot?.products ?? []).map((product: any) => (
        <div key={product.product.appId}>
          {product.product.name}: {product.lifecycle} {product.downloadPercentage}%
        </div>
      ))}
      {snapshot?.products?.length === 0 ? <div>Steam products not found.</div> : null}
      <button type="button" disabled={isLoading} onClick={() => onRefresh?.()}>
        Refresh now
      </button>
      <button type="button" disabled={!snapshot || !onPlanSetup} onClick={() => onPlanSetup?.()}>
        Plan Setup
      </button>
    </div>
  ),
  JavaIntelligencePanel: ({
    status,
    isChecking,
    error,
    isRunning,
    runningOperation,
    latestOperation,
    result,
    symbol,
    onSymbolChange,
    onRefresh,
    onScan,
    onDiagnostics,
    onSymbols,
    onDefinition,
    onReferences,
    onNavigateLocation,
    languageServiceStatus,
    isLanguageServiceRefreshing,
    onStartLanguageService,
    onStopLanguageService,
    onRestartLanguageService,
    onRefreshLanguageService,
  }: any) => {
    const lookupsDisabled = !status?.available || isRunning || !symbol.trim();
    return (
      <div
        data-testid="JavaIntelligencePanel"
        data-available={String(status?.available ?? false)}
        data-checking={String(isChecking)}
        data-running={String(isRunning)}
        data-running-operation={runningOperation ?? ""}
        data-latest-operation={latestOperation ?? ""}
        data-language-state={languageServiceStatus?.state ?? ""}
        data-language-workspace={languageServiceStatus?.workspaceId ?? ""}
        data-language-generation={String(languageServiceStatus?.generation ?? "")}
        data-document-sync={String(languageServiceStatus?.capabilities?.documentSync ?? false)}
        data-language-refreshing={String(isLanguageServiceRefreshing)}
      >
        <div>{status?.version ? `RefactorKit ${status.version}` : "RefactorKit unavailable"}</div>
        <div role="status">JDT LS {languageServiceStatus?.state ?? "not checked"}</div>
        {languageServiceStatus?.lastError ? (
          <div role="alert">{languageServiceStatus.lastError}</div>
        ) : null}
        {!languageServiceStatus?.capabilities?.documentSync ? (
          <div>Document sync unavailable</div>
        ) : null}
        <button type="button" onClick={() => onStartLanguageService?.()}>
          Start JDT LS
        </button>
        <button type="button" onClick={() => onStopLanguageService?.()}>
          Stop JDT LS
        </button>
        <button type="button" onClick={() => onRestartLanguageService?.()}>
          Restart JDT LS
        </button>
        <button type="button" onClick={() => onRefreshLanguageService?.()}>
          Refresh JDT LS
        </button>
        {error ? <div role="alert">{error}</div> : null}
        {result ? <pre aria-label="RefactorKit operation output">{result.stdout}</pre> : null}
        {result?.locations?.map((location: any, index: number) => (
          <button
            key={`${location.path}-${location.line}-${location.column ?? ""}-${index}`}
            type="button"
            onClick={() => onNavigateLocation?.(location)}
          >
            {location.path}:{location.line}
            {location.column === undefined ? "" : `:${location.column}`}
          </button>
        ))}
        <button type="button" onClick={() => onRefresh()}>
          Refresh RefactorKit
        </button>
        <button type="button" onClick={() => onScan()}>
          Scan
        </button>
        <button type="button" onClick={() => onDiagnostics()}>
          Diagnostics
        </button>
        <button type="button" onClick={() => onSymbols()}>
          Symbols
        </button>
        <label>
          Symbol selector
          <input
            aria-label="Symbol selector"
            value={symbol}
            onChange={(event) => onSymbolChange(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          disabled={lookupsDisabled}
          onClick={() => onDefinition(symbol.trim())}
        >
          Definition
        </button>
        <button
          type="button"
          disabled={lookupsDisabled}
          onClick={() => onReferences(symbol.trim())}
        >
          References
        </button>
      </div>
    );
  },
  AiAgentResponsePanel: ({
    latestResponse,
    messages,
    activities,
    isSending,
    error,
    onClose,
  }: any) => (
    <aside
      data-testid="AiAgentResponsePanel"
      data-sending={String(isSending)}
      data-message-count={String(messages?.length ?? 0)}
      data-activity-count={String(activities?.length ?? 0)}
    >
      {isSending ? <div>Waiting</div> : null}
      {latestResponse ? <div data-testid="AiAgentLatestResponse">{latestResponse}</div> : null}
      {error ? <div role="alert">{error}</div> : null}
      <ol data-testid="AiAgentResponseHistory">
        {(messages ?? []).map((message: any) => (
          <li key={message.id ?? `${message.role}-${message.content}`}>
            {message.role}: {message.content}
          </li>
        ))}
      </ol>
      <ol data-testid="AiAgentActivities">
        {(activities ?? []).map((activity: any) => (
          <li key={activity.id ?? `${activity.type}-${activity.pluginName ?? ""}`}>
            {activity.pluginName ? `${activity.pluginName}: ` : ""}
            {activity.type} {activity.status ? `(${activity.status})` : ""} {activity.detail ?? ""}
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => onClose?.()}>
        Close response
      </button>
    </aside>
  ),
  SettingsPanel: ({
    isOpen,
    aiAgentSettings,
    aiAgentStatus,
    workspaceInfo,
    workspaceRegistry,
    xcom2ModuleConfigurationDiagnosticPresentation,
    isXcom2ModuleConfigurationChecking,
    xcom2SetupSnapshot,
    xcom2SetupPlan,
    isXcom2SetupLoading,
    xcom2SetupError,
    isXcom2SetupStale,
    xcom2SetupTransaction,
    xcom2SetupTransactions = [],
    isXcom2SetupTransactionLoading,
    xcom2SetupTransactionError,
    xcom2SetupTransactionProgressEvent,
    javaLanguageServiceStatus,
    isJavaLanguageServiceRefreshing,
    javaRefactorKitStatus,
    javaRefactorKitCapabilities,
    isJavaRefactorKitChecking,
    javaRefactorKitError,
    languageToolingDiagnostics,
    onRequestLanguageToolingDiagnostics,
    onRefreshStatus,
    onRefreshWorkspace,
    onSwitchWorkspace,
    onRefreshXcom2Setup,
    onPlanXcom2Setup,
    onPrepareXcom2Setup,
    onApplyXcom2Setup,
    onCancelXcom2Setup,
    onRollbackXcom2Setup,
    onRecoverXcom2Setup,
    onRefreshXcom2SetupHistory,
    onSaveAiAgentSettings,
    onInstallPiAgent,
    onStartJavaLanguageService,
    onStopJavaLanguageService,
    onRestartJavaLanguageService,
    onRefreshJavaLanguageService,
    onRefreshJavaRefactorKit,
    onClose,
  }: any) => {
    testHarness.latestSettingsPanelDiagnosticPresentation =
      xcom2ModuleConfigurationDiagnosticPresentation ?? null;
    testHarness.latestSettingsPanelConfigurationChecking =
      isXcom2ModuleConfigurationChecking ?? false;
    const [section, setSection] = useState("ai-agents");
    return isOpen ? (
      <div
        role="dialog"
        aria-label="Settings"
        data-testid="SettingsPanel"
        data-settings-enabled={String(aiAgentSettings?.enabled)}
        data-status-availability={aiAgentStatus?.availability ?? ""}
        data-has-refresh={String(typeof onRefreshStatus === "function")}
        data-has-save={String(typeof onSaveAiAgentSettings === "function")}
        data-has-install={String(typeof onInstallPiAgent === "function")}
        data-has-close={String(typeof onClose === "function")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={section === "ai-agents"}
          onClick={() => setSection("ai-agents")}
        >
          AI Agents
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "java"}
          onClick={() => setSection("java")}
        >
          Java
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "xcom2"}
          onClick={() => setSection("xcom2")}
        >
          XCOM 2
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "workspace"}
          onClick={() => setSection("workspace")}
        >
          Workspace
        </button>
        {section === "workspace" && isXcom2ModuleConfigurationChecking ? (
          <div role="status">Checking XCOM 2 project configuration…</div>
        ) : section === "workspace" && xcom2ModuleConfigurationDiagnosticPresentation ? (
          <div role="alert">
            <strong>{xcom2ModuleConfigurationDiagnosticPresentation.title}</strong>
            <span>
              Project file: {xcom2ModuleConfigurationDiagnosticPresentation.projectFileLabel}
            </span>
            <span>{xcom2ModuleConfigurationDiagnosticPresentation.summary}</span>
            <span>{xcom2ModuleConfigurationDiagnosticPresentation.remediation}</span>
            <code>{xcom2ModuleConfigurationDiagnosticPresentation.supportIdentifier}</code>
          </div>
        ) : null}
        {section === "java" ? (
          <div
            data-testid="JavaIntelligencePanel"
            data-available={String(javaRefactorKitStatus?.available ?? false)}
            data-checking={String(isJavaRefactorKitChecking)}
            data-language-kernel={String(
              javaRefactorKitCapabilities?.languageKernel?.available ?? false,
            )}
            data-language-ids={
              javaRefactorKitCapabilities?.languageKernel?.available
                ? javaRefactorKitCapabilities.languageKernel.schema.adapters
                    .map((adapter: any) => adapter.languageId)
                    .join(",")
                : ""
            }
            data-language-backends={
              javaRefactorKitCapabilities?.languageKernel?.available
                ? javaRefactorKitCapabilities.languageKernel.schema.adapters
                    .map((adapter: any) => adapter.backend)
                    .join(",")
                : ""
            }
            data-language-state={javaLanguageServiceStatus?.state ?? ""}
            data-language-workspace={javaLanguageServiceStatus?.workspaceId ?? ""}
            data-language-generation={String(javaLanguageServiceStatus?.generation ?? "")}
            data-document-sync={String(
              javaLanguageServiceStatus?.capabilities?.documentSync ?? false,
            )}
            data-language-refreshing={String(isJavaLanguageServiceRefreshing)}
            data-diagnostics-state={languageToolingDiagnostics?.state ?? ""}
            data-diagnostics-count={String(languageToolingDiagnostics?.diagnosticCount ?? "")}
          >
            <div>
              {javaRefactorKitStatus?.version
                ? `RefactorKit ${javaRefactorKitStatus.version}`
                : "RefactorKit unavailable"}
            </div>
            <div role="status">JDT LS {javaLanguageServiceStatus?.state ?? "not checked"}</div>
            {javaRefactorKitCapabilities?.languageKernel?.available ? (
              <div data-testid="RefactorKitDiscovery">
                {javaRefactorKitCapabilities.languageKernel.schema.adapters
                  .map((adapter: any) => `${adapter.languageId}: ${adapter.backend}`)
                  .join("; ")}
              </div>
            ) : null}
            {javaLanguageServiceStatus?.lastError ? (
              <div role="alert">{javaLanguageServiceStatus.lastError}</div>
            ) : null}
            {!javaLanguageServiceStatus?.capabilities?.documentSync ? (
              <div>Document sync unavailable</div>
            ) : null}
            {javaRefactorKitError ? <div role="alert">{javaRefactorKitError}</div> : null}
            <button type="button" onClick={() => onStartJavaLanguageService?.()}>
              Start JDT LS
            </button>
            <button type="button" onClick={() => onStopJavaLanguageService?.()}>
              Stop JDT LS
            </button>
            <button type="button" onClick={() => onRestartJavaLanguageService?.()}>
              Restart JDT LS
            </button>
            <button type="button" onClick={() => onRefreshJavaLanguageService?.()}>
              Refresh JDT LS
            </button>
            <button type="button" onClick={() => onRefreshJavaRefactorKit?.()}>
              Refresh RefactorKit
            </button>
            <button type="button" onClick={() => onRequestLanguageToolingDiagnostics?.()}>
              Request diagnostics
            </button>
            {languageToolingDiagnostics?.message ? (
              <div data-testid="LanguageToolingDiagnosticsMessage">
                {languageToolingDiagnostics.message}
              </div>
            ) : null}
          </div>
        ) : section === "xcom2" ? (
          <div
            data-testid="Xcom2SetupPanel"
            data-workspace={xcom2SetupSnapshot?.workspaceId ?? ""}
            data-generation={String(xcom2SetupSnapshot?.generation ?? "")}
            data-plan-state={xcom2SetupPlan?.state ?? ""}
            data-loading={String(isXcom2SetupLoading)}
            data-stale={String(isXcom2SetupStale)}
            data-transaction={xcom2SetupTransaction?.transactionId ?? ""}
            data-transaction-state={xcom2SetupTransaction?.state ?? ""}
            data-transaction-loading={String(isXcom2SetupTransactionLoading)}
            data-history-count={String(xcom2SetupTransactions.length)}
            data-progress-sequence={String(xcom2SetupTransactionProgressEvent?.sequence ?? "")}
          >
            <div>Built-in · Experimental</div>
            <div>Feature ID ide.xcom2-wotc · Currently non-removable</div>
            {xcom2SetupError ? <div role="alert">{xcom2SetupError}</div> : null}
            {xcom2SetupTransactionError ? (
              <div role="alert">{xcom2SetupTransactionError}</div>
            ) : null}
            {(xcom2SetupSnapshot?.products ?? []).map((product: any) => (
              <div key={product.product.appId}>
                {product.product.name}: {product.lifecycle} {product.downloadPercentage}%
              </div>
            ))}
            {xcom2SetupSnapshot?.products?.length === 0 ? (
              <div>Steam products not found.</div>
            ) : null}
            <button
              type="button"
              disabled={isXcom2SetupLoading}
              onClick={() => onRefreshXcom2Setup?.()}
            >
              Refresh now
            </button>
            <button
              type="button"
              disabled={!xcom2SetupSnapshot || !onPlanXcom2Setup}
              onClick={() => onPlanXcom2Setup?.()}
            >
              Plan Setup
            </button>
            <button type="button" onClick={() => onPrepareXcom2Setup?.()}>
              Prepare transaction
            </button>
            <button type="button" onClick={() => onRefreshXcom2SetupHistory?.()}>
              Refresh history
            </button>
            {xcom2SetupTransaction?.applyAvailability?.allowed ? (
              <button
                type="button"
                onClick={() =>
                  onApplyXcom2Setup?.(
                    xcom2SetupTransaction.transactionId,
                    xcom2SetupTransaction.reviewedOperationDigest.digest,
                  )
                }
              >
                Apply reviewed transaction
              </button>
            ) : null}
            {xcom2SetupTransaction ? (
              <button
                type="button"
                onClick={() => onCancelXcom2Setup?.(xcom2SetupTransaction.transactionId)}
              >
                Cancel transaction
              </button>
            ) : null}
            {xcom2SetupTransaction?.rollbackAvailable ? (
              <button
                type="button"
                onClick={() => onRollbackXcom2Setup?.(xcom2SetupTransaction.transactionId)}
              >
                Confirm rollback
              </button>
            ) : null}
            {xcom2SetupTransaction &&
            ["partial", "recovery-required", "rollback-conflict"].includes(
              xcom2SetupTransaction.state,
            ) ? (
              <button
                type="button"
                onClick={() => onRecoverXcom2Setup?.(xcom2SetupTransaction.transactionId)}
              >
                Recover transaction
              </button>
            ) : null}
            <ol aria-label="Setup transaction history">
              {xcom2SetupTransactions.map((transaction: any) => (
                <li key={transaction.transactionId}>
                  {transaction.transactionId}: {transaction.state}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        <button type="button" onClick={() => onRefreshWorkspace?.()}>
          Refresh workspace
        </button>
        {(workspaceRegistry?.workspaces ?? [])
          .filter((workspace: any) => workspace.id !== workspaceInfo?.id)
          .map((workspace: any) => (
            <button
              key={workspace.id}
              type="button"
              onClick={() => onSwitchWorkspace?.(workspace.id)}
            >
              Switch to {workspace.name} in Settings
            </button>
          ))}
        <button type="button" onClick={() => onClose?.()}>
          Close settings
        </button>
      </div>
    ) : null;
  },
}));

// ---------------------------------------------------------------------------
// Mock CSS imports that vite would normally handle
// ---------------------------------------------------------------------------
vi.mock("@ide/ui/styles/globals.css", () => "");

// ---------------------------------------------------------------------------
// Mock web-core packages so vitest can resolve workspace imports
// ---------------------------------------------------------------------------
vi.mock("@ide/web-core/state", async () => {
  const actual = await vi.importActual<typeof import("@ide/web-core/state")>("@ide/web-core/state");

  // Zustand-like store factory: returns a callable function (selector) that
  // also has getState / subscribe / destroy methods.
  const createMockStore = (state: Record<string, any>) => {
    const store = ((sel: any) => sel(state)) as any;
    store.getState = () => state;
    store.subscribe = () => () => {};
    store.destroy = () => {};
    return store;
  };

  return {
    createFileTreeStore: vi.fn().mockImplementation(() => {
      if (!testHarness.useRealFileTree) return createMockStore(testHarness.fileTreeState);
      const store = actual.createFileTreeStore();
      testHarness.fileTreeStore = store;
      testHarness.fileTreeState = store.getState();
      return store;
    }),
    createEditorStore: vi.fn().mockImplementation(() => createMockStore(testHarness.editorState)),
    createTerminalStore: vi
      .fn()
      .mockImplementation(() => createMockStore(testHarness.terminalState)),
    createPanelStore: vi.fn().mockImplementation(() => createMockStore(testHarness.panelState)),
  };
});

vi.mock("@ide/web-core/view-models", async () => {
  const actual = await vi.importActual<typeof import("@ide/web-core/view-models")>(
    "@ide/web-core/view-models",
  );

  return {
    FileTreeViewModel: vi.fn().mockImplementation((store, port) => {
      if (testHarness.useRealFileTree) {
        const instance = new actual.FileTreeViewModel(store, port);
        testHarness.fileTreeViewModel = instance;
        return instance;
      }
      const instance = {
        loadRoot: vi.fn().mockResolvedValue(undefined),
        selectFile: vi.fn((filePath: string) => {
          testHarness.fileTreeState.selectedFilePath = filePath;
        }),
        toggleFolder: vi.fn().mockResolvedValue(undefined),
        refreshDirectory: vi.fn().mockResolvedValue(undefined),
        createFile: vi.fn(async (parentPath: string, name: string) => {
          if (testHarness.createFilePromise) return testHarness.createFilePromise;
          if (testHarness.createFileError) throw testHarness.createFileError;
          return testHarness.createFilePath ?? (parentPath ? `${parentPath}/${name}` : name);
        }),
        subscribeToFileSelection: vi.fn().mockReturnValue(vi.fn()),
        openFiles: [],
      };
      testHarness.fileTreeViewModel = instance;
      return instance;
    }),
    EditorViewModel: vi.fn().mockImplementation(() => {
      const instance = {
        openIntent: 0,
        openFile: vi.fn(async (filePath: string) => {
          testHarness.openFileObservedEditorText =
            document.querySelector('[data-testid="Editor"]')?.textContent;
          const intent = ++instance.openIntent;
          const pathPromise = testHarness.openFilePromises[filePath];
          if (pathPromise) {
            await pathPromise;
          } else if (testHarness.openFilePromise) {
            await testHarness.openFilePromise;
          }
          const pathError = testHarness.openFileErrors[filePath];
          if (pathError) throw pathError;
          if (testHarness.openFileError) {
            throw testHarness.openFileError;
          }
          if (intent !== instance.openIntent) return;

          const activeFilePath = testHarness.openFileActiveFilePath ?? filePath;
          testHarness.editorState.activeFilePath = activeFilePath;
          testHarness.editorState.contents[activeFilePath] = `content for ${activeFilePath}`;
          testHarness.editorState.tabs = [{ filePath: activeFilePath, isDirty: false }];
          testHarness.editorState.openFiles = [
            {
              filePath: activeFilePath,
              name: activeFilePath.split("/").pop() ?? activeFilePath,
              language: filePath.toLowerCase().endsWith(".java") ? "java" : "typescript",
              openedAt: 1,
            },
          ];
          instance.openFiles = testHarness.editorState.openFiles;
        }),
        updateContent: vi.fn((filePath: string, content: string) => {
          testHarness.editorState.contents[filePath] = content;
          testHarness.editorState.tabs = testHarness.editorState.tabs.map((tab: any) =>
            tab.filePath === filePath ? { ...tab, isDirty: true } : tab,
          );
        }),
        saveFile: vi.fn().mockResolvedValue(undefined),
        closeFile: vi.fn().mockResolvedValue(undefined),
        cancelPendingOpen: vi.fn(() => {
          instance.openIntent += 1;
        }),
        restoreSession: vi.fn(() => {
          const restorePromise = testHarness.restoreSessionPromise ?? Promise.resolve();
          return restorePromise.then(() => {
            if (testHarness.restoreSessionClearsActiveFile) {
              testHarness.editorState.activeFilePath = null;
            }
          });
        }),
        switchActiveFile: vi.fn(),
        openFiles: [],
      };
      testHarness.editorViewModel = instance;
      return instance;
    }),
    TerminalViewModel: vi.fn().mockImplementation(() => {
      const instance = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        executeCommand: vi.fn().mockResolvedValue(undefined),
        updateCurrentInput: vi.fn(),
        clearOutput: vi.fn(),
      };
      testHarness.terminalViewModel = instance;
      return instance;
    }),
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("App", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    testHarness.reset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the desktop shell with Tauri adapters", async () => {
    // Lazy import so mocks are applied first.
    const { App } = await import("../App");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Pi Agent: not-installed")).toBeDefined();
    });

    // The PanelLayout should be present as the root container.
    expect(screen.getByTestId("PanelLayout")).toBeDefined();

    // The three core UI sections should render.
    expect(screen.getByTestId("LeftSidebar")).toBeDefined();
    expect(screen.getByTestId("Editor")).toBeDefined();
    expect(screen.getByTestId("Terminal")).toBeDefined();

    // Desktop composition should pass live getState functions and expose new UI wiring.
    const viewModels = await import("@ide/web-core/view-models");
    expect(vi.mocked(viewModels.FileTreeViewModel).mock.calls[0]?.[0]).toEqual(
      expect.any(Function),
    );
    expect(vi.mocked(viewModels.EditorViewModel).mock.calls[0]?.[0]).toEqual(expect.any(Function));
    expect(vi.mocked(viewModels.TerminalViewModel).mock.calls[0]?.[0]).toEqual(
      expect.any(Function),
    );
    expect(screen.getByTestId("Editor").dataset.hasTabClose).toBe("true");
    expect(screen.getByTestId("Terminal").dataset.hasClear).toBe("true");
    expect(screen.getByRole("button", { name: "Settings" })).toBeDefined();
  });

  it("renders one global Project Foundry control and disables preview honestly without a composition", async () => {
    const { App } = await import("../App");
    render(<App />);

    await screen.findByText("Workspace: Workspace One");
    const controls = screen.getAllByRole("button", { name: "New XCOM 2 Project" });
    expect(controls).toHaveLength(1);
    expect((controls[0] as HTMLButtonElement).disabled).toBe(false);
    expect(controls[0]?.getAttribute("title")).toContain("unavailable");
    fireEvent.click(controls[0]!);
    const dialog = screen.getByRole("dialog", { name: "New XCOM 2 Project" });
    expect(
      (within(dialog).getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("wires the provider-neutral Project Foundry flow independently of project activation and discards it", async () => {
    const revokeAll = vi.fn(async () => undefined);
    const selectSourceRepository = vi.fn(async () => ({
      kind: "source-repository" as const,
      repository: "/scenario/empt-v1_4",
      identity: "source-grant-foundry-preview-001",
    }));
    const selectDestinationParent = vi.fn(async () => ({
      kind: "destination-parent" as const,
      parent: "/scenario/foundry-output",
      identity: "destination-parent-grant-foundry-preview-001",
    }));
    const renderPreview = vi.fn(async () => structuredClone(RENDERED_FIXTURES[0].rendered));
    const revokeOperation = vi.fn(async () => undefined);
    const composition = {
      selectors: { selectSourceRepository, selectDestinationParent },
      renderer: { renderPreview },
      grants: { revokeOperation, revokeAll },
    };
    const { App } = await import("../App");
    render(<App projectFoundry={composition} />);

    expect(screen.queryByRole("tab", { name: "XCOM 2 Project" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New XCOM 2 Project" }));
    const dialog = screen.getByRole("dialog", { name: "New XCOM 2 Project" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Select EMPT repository" }));
    await within(dialog).findByDisplayValue("/scenario/empt-v1_4");
    fireEvent.click(within(dialog).getByRole("button", { name: "Select Destination parent" }));
    await within(dialog).findByDisplayValue("/scenario/foundry-output");
    fireEvent.change(within(dialog).getByLabelText("ModId"), {
      target: { value: "FoundryPreviewFixture" },
    });
    expect(
      (within(dialog).getByLabelText("Final project location") as HTMLInputElement).value,
    ).toBe("/scenario/foundry-output/FoundryPreviewFixture");
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(screen.getByTestId("Xcom2ProjectFoundryDialog").dataset.viewState).toBe("ready");
    });
    expect(selectDestinationParent).toHaveBeenCalledExactlyOnceWith();
    expect(renderPreview).toHaveBeenCalledExactlyOnceWith({
      sourceGrant: RENDERED_FIXTURES[0].request.sourceGrant,
      destinationParentGrant: RENDERED_FIXTURES[0].request.destinationParentGrant,
      modId: "FoundryPreviewFixture",
    });
    expect(screen.getByText(/^[0-9a-f]{64}$/u)).toBeDefined();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(revokeAll).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "New XCOM 2 Project" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New XCOM 2 Project" }));
    const reopened = screen.getByRole("dialog", { name: "New XCOM 2 Project" });
    expect((within(reopened).getByLabelText("EMPT repository") as HTMLInputElement).value).toBe("");
    expect((within(reopened).getByLabelText("Destination parent") as HTMLInputElement).value).toBe(
      "",
    );
    expect((within(reopened).getByLabelText("ModId") as HTMLInputElement).value).toBe("");
    expect(
      (within(reopened).getByLabelText("Final project location") as HTMLInputElement).value,
    ).toBe("");
  });

  it("retains a Preview activation behind queued ModId operation revocation", async () => {
    const revocation = createDeferred<undefined>();
    const revokeOperation = vi.fn(async () => undefined);
    const renderPreview = vi.fn(async (request: any) =>
      structuredClone(
        request.modId === "Mod_1" ? RENDERED_FIXTURES[1].rendered : RENDERED_FIXTURES[0].rendered,
      ),
    );
    const composition = {
      selectors: {
        selectSourceRepository: vi.fn(async () => RENDERED_FIXTURES[0].request.sourceGrant),
        selectDestinationParent: vi.fn(
          async () => RENDERED_FIXTURES[0].request.destinationParentGrant,
        ),
      },
      renderer: { renderPreview },
      grants: { revokeOperation, revokeAll: vi.fn(async () => undefined) },
    };
    const { App } = await import("../App");
    render(<App projectFoundry={composition} />);

    fireEvent.click(screen.getByRole("button", { name: "New XCOM 2 Project" }));
    const dialog = screen.getByRole("dialog", { name: "New XCOM 2 Project" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Select EMPT repository" }));
    await within(dialog).findByDisplayValue("/scenario/empt-v1_4");
    fireEvent.click(within(dialog).getByRole("button", { name: "Select Destination parent" }));
    await within(dialog).findByDisplayValue("/scenario/foundry-output");
    fireEvent.change(within(dialog).getByLabelText("ModId"), {
      target: { value: "FoundryPreviewFixture" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(renderPreview).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByTestId("Xcom2ProjectFoundryDialog").dataset.viewState).toBe("ready"),
    );

    revokeOperation.mockImplementationOnce(() => revocation.promise);
    fireEvent.change(within(dialog).getByLabelText("ModId"), { target: { value: "Mod_1" } });
    expect(
      (within(dialog).getByLabelText("Final project location") as HTMLInputElement).value,
    ).toBe("/scenario/foundry-output/Mod_1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    await Promise.resolve();
    expect(renderPreview).toHaveBeenCalledOnce();

    revocation.resolve(undefined);
    await waitFor(() => expect(renderPreview).toHaveBeenCalledTimes(2));
    expect(renderPreview.mock.calls[1]?.[0]).toMatchObject({ modId: "Mod_1" });
    await waitFor(() =>
      expect(screen.getByTestId("Xcom2ProjectFoundryDialog").dataset.viewState).toBe("ready"),
    );
  });

  it("wires one exact pending Foundry Apply, locks before entry, and retains the created receipt", async () => {
    const applyGate = createDeferred<any>();
    const revokeAll = vi.fn(async () => undefined);
    const source = {
      kind: "source-repository" as const,
      repository: "/scenario/empt-v1_4",
      identity: "source-grant-foundry-preview-001",
    };
    const destination = {
      kind: "destination-parent" as const,
      parent: "/scenario/foundry-output",
      identity: "destination-parent-grant-foundry-preview-001",
    };
    const operation = {
      kind: "preview-operation" as const,
      derivedDestination: "/scenario/foundry-output/FoundryPreviewFixture",
      identity: "operation-grant-foundry-preview-001",
    };
    let createDisabledAtPortEntry = false;
    let creatingVisibleAtPortEntry = false;
    const apply = vi.fn((request: any) => {
      const create = screen.getByRole("button", { name: "Create project" }) as HTMLButtonElement;
      createDisabledAtPortEntry = create.disabled;
      creatingVisibleAtPortEntry = screen
        .queryAllByRole("status")
        .some((status) => status.textContent === "Creating project…");
      return applyGate.promise.then(() => ({
        result: "created" as const,
        planDigest: request.approvedPlanDigest,
        finalProjectLocation: operation.derivedDestination,
        sourceCommit: "d968be3c32b250376723563a743a120770ec5c95",
        sourceTree: "cc8823fa99c0d292c4fe48a8b9463ff790176371",
        committedDirectories: 12,
        committedFiles: 27,
      }));
    });
    const composition = {
      selectors: {
        selectSourceRepository: vi.fn(async () => source),
        selectDestinationParent: vi.fn(async () => destination),
      },
      renderer: {
        renderPreview: vi.fn(async () => structuredClone(RENDERED_FIXTURES[0].rendered)),
      },
      apply,
      grants: { revokeOperation: vi.fn(async () => undefined), revokeAll },
    };
    const { App } = await import("../App");
    render(
      <StrictMode>
        <App projectFoundry={composition} />
      </StrictMode>,
    );
    const strictRevocations = revokeAll.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "New XCOM 2 Project" }));
    const dialog = screen.getByRole("dialog", { name: "New XCOM 2 Project" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Select EMPT repository" }));
    await within(dialog).findByDisplayValue(source.repository);
    fireEvent.click(within(dialog).getByRole("button", { name: "Select Destination parent" }));
    await within(dialog).findByDisplayValue(destination.parent);
    expect(
      (within(dialog).getByLabelText("Final project location") as HTMLInputElement).value,
    ).toBe("");
    fireEvent.change(within(dialog).getByLabelText("ModId"), {
      target: { value: "FoundryPreviewFixture" },
    });
    expect(
      (within(dialog).getByLabelText("Final project location") as HTMLInputElement).value,
    ).toBe(operation.derivedDestination);
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    const create = await within(dialog).findByRole("button", { name: "Create project" });
    expect(
      (within(dialog).getByLabelText("Final project location") as HTMLInputElement).value,
    ).toBe(operation.derivedDestination);
    const digest = within(dialog).getByText(/^[0-9a-f]{64}$/u).textContent ?? "";

    fireEvent.click(create);
    fireEvent.click(create);
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
    expect(createDisabledAtPortEntry).toBe(true);
    expect(creatingVisibleAtPortEntry).toBe(true);
    expect(apply.mock.calls[0]?.[0]).toEqual({
      schemaVersion: 1,
      sourceGrant: source,
      destinationParentGrant: destination,
      operationGrant: operation,
      modId: "FoundryPreviewFixture",
      approvedPlanDigest: digest,
    });

    applyGate.resolve(undefined);
    await screen.findByText("Project created", { exact: true });
    expect(screen.getAllByText(operation.derivedDestination)).not.toHaveLength(0);
    expect(revokeAll.mock.calls.length).toBeGreaterThan(strictRevocations);
    fireEvent.click(create);
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(apply).toHaveBeenCalledOnce();
  });

  it("renders terminal destination attention synchronously with retained context and only Cancel live", async () => {
    const applyGate = createDeferred<any>();
    const revokeGate = createDeferred<undefined>();
    const revokeAll = vi.fn(() => revokeGate.promise);
    const apply = vi.fn(() => applyGate.promise);
    const composition = {
      selectors: {
        selectSourceRepository: vi.fn(async () => RENDERED_FIXTURES[0].request.sourceGrant),
        selectDestinationParent: vi.fn(
          async () => RENDERED_FIXTURES[0].request.destinationParentGrant,
        ),
      },
      renderer: {
        renderPreview: vi.fn(async () => structuredClone(RENDERED_FIXTURES[0].rendered)),
      },
      apply,
      grants: { revokeOperation: vi.fn(async () => undefined), revokeAll },
    };
    const { App } = await import("../App");
    render(<App projectFoundry={composition} />);

    fireEvent.click(screen.getByRole("button", { name: "New XCOM 2 Project" }));
    const dialog = screen.getByRole("dialog", { name: "New XCOM 2 Project" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Select EMPT repository" }));
    await within(dialog).findByDisplayValue("/scenario/empt-v1_4");
    fireEvent.click(within(dialog).getByRole("button", { name: "Select Destination parent" }));
    await within(dialog).findByDisplayValue("/scenario/foundry-output");
    fireEvent.change(within(dialog).getByLabelText("ModId"), {
      target: { value: "FoundryPreviewFixture" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    const create = await within(dialog).findByRole("button", { name: "Create project" });
    const reviewedDigest = within(dialog).getByText(/^[0-9a-f]{64}$/u).textContent;
    fireEvent.click(create);
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());

    await act(async () => {
      applyGate.resolve({
        result: "refused",
        phase: "pre-commit",
        reason: "destination-present",
      });
      await applyGate.promise;
      await Promise.resolve();
    });

    const alert = within(dialog).getByRole("alert");
    expect(alert.getAttribute("aria-atomic")).toBe("true");
    expect(within(alert).getByRole("heading").textContent).toBe(
      XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION.title,
    );
    expect(Array.from(alert.querySelectorAll("dd"), (entry) => entry.textContent)).toEqual([
      XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION.summary,
      XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION.remediation,
      XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION.supportCode,
    ]);
    expect(screen.getByTestId("Xcom2ProjectFoundryDialog").dataset.creationState).toBe("attention");
    expect(within(dialog).getByText(reviewedDigest!, { exact: true })).toBeDefined();
    expect((within(dialog).getByLabelText("EMPT repository") as HTMLInputElement).value).toBe(
      "/scenario/empt-v1_4",
    );
    expect((within(dialog).getByLabelText("Destination parent") as HTMLInputElement).value).toBe(
      "/scenario/foundry-output",
    );
    expect((within(dialog).getByLabelText("ModId") as HTMLInputElement).value).toBe(
      "FoundryPreviewFixture",
    );
    const enabled = within(dialog)
      .getAllByRole("button")
      .filter((button) => !(button as HTMLButtonElement).disabled)
      .map((button) => button.textContent?.trim());
    expect(enabled).toEqual(["Cancel"]);
    expect(testHarness.latestProjectFoundryDialogProps.creationState.terminalDecision).toEqual({
      kind: "terminal",
      authority: "consumed",
      preview: "retained-context",
      disabledControls: [
        "source-selection",
        "destination-selection",
        "mod-id",
        "preview",
        "create",
      ],
      enabledControls: ["cancel"],
    });
    expect(revokeAll).toHaveBeenCalledOnce();

    const sourceCalls = composition.selectors.selectSourceRepository.mock.calls.length;
    const destinationCalls = composition.selectors.selectDestinationParent.mock.calls.length;
    const renderCalls = composition.renderer.renderPreview.mock.calls.length;
    await act(async () => {
      const callbacks = testHarness.latestProjectFoundryDialogProps;
      callbacks.onModIdChange("ProgrammaticRetry");
      await Promise.all([
        callbacks.onSelectSourceRepository(),
        callbacks.onSelectDestinationParent(),
        callbacks.onPreview("ProgrammaticRetry"),
        callbacks.onCreateProject(reviewedDigest),
      ]);
    });
    expect(composition.selectors.selectSourceRepository).toHaveBeenCalledTimes(sourceCalls);
    expect(composition.selectors.selectDestinationParent).toHaveBeenCalledTimes(destinationCalls);
    expect(composition.renderer.renderPreview).toHaveBeenCalledTimes(renderCalls);
    expect(apply).toHaveBeenCalledOnce();
    expect((within(dialog).getByLabelText("ModId") as HTMLInputElement).value).toBe(
      "FoundryPreviewFixture",
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "New XCOM 2 Project" })).toBeNull();
    revokeGate.resolve(undefined);
    await flushMicrotasks();
  });

  it("does not trust malformed verified-cleanup attestation for fallback attention", async () => {
    const raw = "RAW_CAUSE_CANARY /tmp/private-stage errno=17";
    const apply = vi.fn(
      async () =>
        ({
          result: "failed",
          phase: "pre-commit",
          reason: "stage-write-failed",
          cleanupStatus: "verified-complete",
          rawCause: raw,
        }) as never,
    );
    const composition = {
      selectors: {
        selectSourceRepository: vi.fn(async () => RENDERED_FIXTURES[0].request.sourceGrant),
        selectDestinationParent: vi.fn(
          async () => RENDERED_FIXTURES[0].request.destinationParentGrant,
        ),
      },
      renderer: {
        renderPreview: vi.fn(async () => structuredClone(RENDERED_FIXTURES[0].rendered)),
      },
      apply,
      grants: {
        revokeOperation: vi.fn(async () => undefined),
        revokeAll: vi.fn(async () => undefined),
      },
    };
    const { App } = await import("../App");
    render(<App projectFoundry={composition} />);

    fireEvent.click(screen.getByRole("button", { name: "New XCOM 2 Project" }));
    const dialog = screen.getByRole("dialog", { name: "New XCOM 2 Project" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Select EMPT repository" }));
    await within(dialog).findByDisplayValue("/scenario/empt-v1_4");
    fireEvent.click(within(dialog).getByRole("button", { name: "Select Destination parent" }));
    await within(dialog).findByDisplayValue("/scenario/foundry-output");
    fireEvent.change(within(dialog).getByLabelText("ModId"), {
      target: { value: "FoundryPreviewFixture" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Create project" }));

    const alert = await within(dialog).findByRole("alert");
    expect(within(alert).getByRole("heading").textContent).toBe(
      XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION.title,
    );
    expect(alert.textContent).toContain(
      XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION.summary,
    );
    expect(alert.textContent).toContain(
      XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION.supportCode,
    );
    expect(alert.textContent).not.toMatch(
      /RAW_CAUSE_CANARY|stage-write-failed|verified-complete|private-stage|errno/u,
    );
    expect(apply).toHaveBeenCalledOnce();
    expect(composition.grants.revokeAll).toHaveBeenCalledOnce();
  });

  it("keeps back-to-back Foundry selectors serialized and rendered under StrictMode", async () => {
    const sourceSelection = createDeferred<{
      kind: "source-repository";
      repository: string;
      identity: string;
    }>();
    const destinationSelection = createDeferred<{
      kind: "destination-parent";
      parent: string;
      identity: string;
    }>();
    const selectSourceRepository = vi.fn(() => sourceSelection.promise);
    const selectDestinationParent = vi.fn(() => destinationSelection.promise);
    const revokeAll = vi.fn(async () => undefined);
    const composition = {
      selectors: { selectSourceRepository, selectDestinationParent },
      renderer: { renderPreview: vi.fn() },
      grants: { revokeOperation: vi.fn(async () => undefined), revokeAll },
    };
    const { App } = await import("../App");
    render(
      <StrictMode>
        <App projectFoundry={composition} />
      </StrictMode>,
    );
    await waitFor(() => expect(revokeAll).toHaveBeenCalledOnce());
    const strictModeRevocations = revokeAll.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "New XCOM 2 Project" }));
    const dialog = screen.getByRole("dialog", { name: "New XCOM 2 Project" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Select EMPT repository" }));
    await waitFor(() => expect(selectSourceRepository).toHaveBeenCalledOnce());
    fireEvent.click(within(dialog).getByRole("button", { name: "Select Destination parent" }));
    expect(selectDestinationParent).not.toHaveBeenCalled();

    await act(async () => {
      sourceSelection.resolve({
        kind: "source-repository",
        repository: "/scenario/empt-v1_4",
        identity: "source-grant-foundry-preview-001",
      });
      await sourceSelection.promise;
    });
    expect((within(dialog).getByLabelText("EMPT repository") as HTMLInputElement).value).toBe(
      "/scenario/empt-v1_4",
    );
    await waitFor(() => expect(selectDestinationParent).toHaveBeenCalledExactlyOnceWith());
    await act(async () => {
      destinationSelection.resolve({
        kind: "destination-parent",
        parent: "/scenario/foundry-output",
        identity: "destination-parent-grant-foundry-preview-001",
      });
      await destinationSelection.promise;
    });
    expect((within(dialog).getByLabelText("Destination parent") as HTMLInputElement).value).toBe(
      "/scenario/foundry-output",
    );

    expect(selectDestinationParent).toHaveBeenCalledExactlyOnceWith();
    expect(revokeAll).toHaveBeenCalledTimes(strictModeRevocations);
    expect(screen.getByTestId("PanelLayout")).toBeDefined();
    expect(screen.getAllByRole("button", { name: "New XCOM 2 Project" })).toHaveLength(1);
  });

  it("composes persistent panel controls while retaining the sidebar collapse control", async () => {
    const { App } = await import("../App");
    render(<App />);

    await screen.findByText("Workspace: Workspace One");
    expect(testHarness.latestPanelLayoutProps).toMatchObject({
      onToggleLeftSidebar: expect.any(Function),
      onToggleBottomPanel: expect.any(Function),
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    act(() => {
      testHarness.latestPanelLayoutProps.onToggleLeftSidebar();
      testHarness.latestPanelLayoutProps.onToggleBottomPanel();
    });

    expect(testHarness.panelState.toggleVisibility.mock.calls).toEqual([
      ["leftSidebar"],
      ["leftSidebar"],
      ["bottomPanel"],
    ]);
  });

  it("keeps Search host-controlled and composes the semantic panel through PanelLayout", async () => {
    const { App } = await import("../App");
    render(<App />);

    await screen.findByText("Workspace: Workspace One");
    expect(testHarness.latestPanelLayoutProps).toMatchObject({
      activeActivity: "explorer",
      hasSearchActivityContent: true,
      onActivityChange: expect.any(Function),
    });
    expect(screen.queryByTestId("SemanticSymbolSearchPanel")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Search" }));

    expect(screen.getByTestId("PanelLayout").dataset.activeActivity).toBe("search");
    expect(screen.getByTestId("SemanticSymbolSearchPanel").dataset).toMatchObject({
      language: "typescript",
      query: "",
      snapshotState: "saved",
      resultLimit: "100",
    });
    expect(testHarness.latestSemanticSymbolSearchProps).toMatchObject({
      toolchainPaths: {
        nodeExecutable: "",
        languageServerPackageRoot: "",
        typeScriptPackageRoot: "",
      },
      approvedForSession: false,
      results: [],
      isBusy: false,
      canSubmit: false,
      onLanguageChange: expect.any(Function),
      onQueryChange: expect.any(Function),
      onToolchainPathChange: expect.any(Function),
      onApprovalChange: expect.any(Function),
      onSubmit: expect.any(Function),
      onCancel: expect.any(Function),
      onStop: expect.any(Function),
      onResultSelect: expect.any(Function),
    });

    fireEvent.click(screen.getByRole("tab", { name: "Explorer" }));
    expect(screen.getByTestId("PanelLayout").dataset.activeActivity).toBe("explorer");
    expect(screen.getByTestId("LeftSidebar")).toBeDefined();
    expect(screen.queryByTestId("SemanticSymbolSearchPanel")).toBeNull();
  });

  it("cold-mounts a persisted workspace only after authorization and promotes stale registry data", async () => {
    const authorization = createDeferred<any>();
    const lifecycle: string[] = [];
    const persistedWorkspace = {
      id: "persisted-workspace",
      name: "Persisted Workspace",
      rootPath: "/workspace/persisted",
      markerFolder: ".ide",
    };
    const authorizedRoot = [
      {
        id: "folder-source",
        name: "source",
        path: "source",
        type: "folder",
        isOpen: true,
        children: [
          {
            id: "file-cold-start",
            name: "cold-start.ts",
            path: "source/cold-start.ts",
            type: "file",
          },
        ],
      },
    ];
    testHarness.useRealFileTree = true;
    testHarness.workspaceInfo = persistedWorkspace;
    testHarness.workspaceRegistry = { currentWorkspaceId: null, workspaces: [] };
    testHarness.workspaceAdapter.ensureCurrentWorkspace.mockImplementationOnce(async () => {
      lifecycle.push("workspace.ensure:start");
      const workspace = await authorization.promise;
      lifecycle.push("workspace.ensure:authorized");
      return workspace;
    });
    testHarness.workspaceAdapter.listWorkspaces.mockImplementationOnce(async () => {
      lifecycle.push("workspace.list");
      return testHarness.workspaceRegistry;
    });

    const { App } = await import("../App");
    testHarness.editorViewModel.restoreSession.mockImplementationOnce(async () => {
      lifecycle.push("editor.restore");
    });
    testHarness.fileTreeAdapter.getRoot.mockImplementationOnce(async () => {
      lifecycle.push("file-tree.load");
      return authorizedRoot;
    });
    testHarness.languageSessionAdapter.getStatus.mockImplementationOnce(
      async ({ workspaceId }: any) => {
        lifecycle.push("java.load");
        return { ...testHarness.languageServiceStatus, workspaceId };
      },
    );
    testHarness.aiAgentAdapter.listCommands.mockImplementationOnce(async () => {
      lifecycle.push("ai.commands");
      return testHarness.aiAgentCommands;
    });
    testHarness.aiAgentAdapter.getSessionMessages.mockImplementationOnce(async () => {
      lifecycle.push("ai.session");
      return testHarness.aiAgentSessionMessages;
    });
    testHarness.refactorKitAdapter.getStatus.mockImplementationOnce(async () => {
      lifecycle.push("refactorkit.status");
      return testHarness.refactorKitStatus;
    });
    testHarness.refactorKitAdapter.getCapabilities.mockImplementationOnce(async () => {
      lifecycle.push("refactorkit.capabilities");
      return testHarness.externalJavaCapabilities;
    });
    testHarness.xcom2SetupMonitorAdapter.getSnapshot.mockImplementationOnce(async () => {
      lifecycle.push("xcom.load");
      return { ...testHarness.xcom2SetupSnapshot, workspaceId: persistedWorkspace.id };
    });

    render(<App />);
    await waitFor(() =>
      expect(testHarness.workspaceAdapter.ensureCurrentWorkspace).toHaveBeenCalledOnce(),
    );

    expect(lifecycle).toEqual(["workspace.ensure:start"]);
    expect(testHarness.workspaceAdapter.listWorkspaces).not.toHaveBeenCalled();
    expect(testHarness.editorViewModel.restoreSession).not.toHaveBeenCalled();
    expect(testHarness.fileTreeAdapter.getRoot).not.toHaveBeenCalled();
    expect(testHarness.fileTreeStore.getState().rootNodes).toEqual([]);
    expect(testHarness.languageSessionAdapter.getStatus).not.toHaveBeenCalled();
    expect(testHarness.aiAgentAdapter.listCommands).not.toHaveBeenCalled();
    expect(testHarness.aiAgentAdapter.getSessionMessages).not.toHaveBeenCalled();
    expect(testHarness.refactorKitAdapter.getStatus).not.toHaveBeenCalled();
    expect(testHarness.refactorKitAdapter.getCapabilities).not.toHaveBeenCalled();
    expect(testHarness.xcom2SetupMonitorAdapter.getSnapshot).not.toHaveBeenCalled();
    expect(screen.getByText("Workspace: loading…")).toBeDefined();

    authorization.resolve(persistedWorkspace);
    await screen.findByText("Workspace: Persisted Workspace");
    await waitFor(() => {
      expect(testHarness.editorViewModel.restoreSession).toHaveBeenCalledOnce();
      expect(testHarness.fileTreeAdapter.getRoot).toHaveBeenCalledOnce();
      expect(testHarness.fileTreeStore.getState().rootNodes).toEqual(authorizedRoot);
      expect(testHarness.languageSessionAdapter.getStatus).toHaveBeenCalledOnce();
      expect(testHarness.aiAgentAdapter.listCommands).toHaveBeenCalledOnce();
      expect(testHarness.aiAgentAdapter.getSessionMessages).toHaveBeenCalledOnce();
      expect(testHarness.refactorKitAdapter.getStatus).toHaveBeenCalledOnce();
      expect(testHarness.refactorKitAdapter.getCapabilities).toHaveBeenCalledOnce();
      expect(testHarness.xcom2SetupMonitorAdapter.getSnapshot).not.toHaveBeenCalled();
    });

    expect(lifecycle.slice(0, 3)).toEqual([
      "workspace.ensure:start",
      "workspace.ensure:authorized",
      "workspace.list",
    ]);
    const registryIndex = lifecycle.indexOf("workspace.list");
    for (const activation of [
      "editor.restore",
      "file-tree.load",
      "java.load",
      "ai.commands",
      "ai.session",
      "refactorkit.status",
      "refactorkit.capabilities",
    ]) {
      expect(lifecycle.indexOf(activation), activation).toBeGreaterThan(registryIndex);
    }
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(
      screen
        .getByRole("option", { name: "Persisted Workspace Current" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(testHarness.fileTreeStore.getState().rootNodes[0].children).toEqual([
      expect.objectContaining({ path: "source/cold-start.ts" }),
    ]);
    expect(JSON.stringify(testHarness.fileTreeStore.getState().rootNodes)).not.toContain(
      persistedWorkspace.rootPath,
    );
    expect(document.body.textContent).not.toContain(persistedWorkspace.rootPath);
  });

  it("shows the current RefactorKit capability as unavailable without reading clipboard", async () => {
    const { App } = await import("../App");
    render(<App />);
    await screen.findByText("Workspace: Workspace One");

    fireEvent.contextMenu(screen.getByTestId("directory-src"));
    fireEvent.click(screen.getByRole("button", { name: "Paste Java Class from Clipboard" }));

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Paste Java Class from Clipboard" }).dataset.status,
      ).toBe("unavailable");
    });
    expect(
      screen.getByText(
        "Update RefactorKit to a version that supports path-driven external Java import.",
      ),
    ).toBeDefined();
    expect(testHarness.clipboardAdapter.readText).not.toHaveBeenCalled();
    expect(testHarness.refactorKitAdapter.previewExternalJavaImport).not.toHaveBeenCalled();
  });

  it("previews a directory context paste, applies the exact plan, refreshes and opens backend evidence", async () => {
    enableExternalJavaImport();
    const { App } = await import("../App");
    render(<App />);
    await screen.findByText("Workspace: Workspace One");

    fireEvent.contextMenu(screen.getByTestId("directory-src"));
    fireEvent.click(screen.getByRole("button", { name: "Paste Java Class from Clipboard" }));

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Paste Java Class from Clipboard" }).dataset.status,
      ).toBe("preview");
    });
    const request = testHarness.refactorKitAdapter.previewExternalJavaImport.mock.calls[0][0];
    expect(request).toMatchObject({
      code: "public class Imported {}",
      targetDirectory: "src",
      workspaceId: "workspace-one",
      sourceKind: "clipboard",
      sourceUrl: null,
      licensePolicy: "warn",
    });
    expect(request.workspaceGeneration).toBeGreaterThan(0);
    expect(request).not.toHaveProperty("targetPackage");
    expect(screen.getByText("Create Imported.java")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Apply Import" }));
    await waitFor(() => expect(testHarness.refactorKitAdapter.applyPlan).toHaveBeenCalledOnce());
    const applyRequest = testHarness.refactorKitAdapter.applyPlan.mock.calls[0][0];
    expect(applyRequest).toEqual({
      planId: "plan-java-1",
      workspaceId: "workspace-one",
      workspaceGeneration: request.workspaceGeneration,
      selectionGeneration: 1,
      requestId: request.requestId,
      approval: {
        approvalId: `desktop-approval-${request.requestId}`,
        approvedPlanId: "plan-java-1",
        approvedAt: expect.any(String),
      },
    });
    expect(applyRequest).not.toHaveProperty("code");
    expect(applyRequest).not.toHaveProperty("targetDirectory");
    await waitFor(() => {
      expect(testHarness.fileTreeViewModel.refreshDirectory).toHaveBeenCalledWith("src");
      expect(testHarness.editorViewModel.openFile).toHaveBeenCalledWith("src/Imported.java");
      expect(screen.getByText("tx-java-1")).toBeDefined();
      expect(screen.getByRole("status").textContent).toContain("tx-java-1");
    });
    expect(testHarness.aiAgentAdapter.sendPrompt).not.toHaveBeenCalled();
    expect(testHarness.refactorKitAdapter.discardPlan).not.toHaveBeenCalled();
    for (const mutation of ["createFile", "createFolder", "delete", "rename"]) {
      expect(testHarness.fileTreeAdapter[mutation]).not.toHaveBeenCalled();
    }
  });

  it("retains complete refused conflict and license evidence while disabling apply", async () => {
    enableExternalJavaImport();
    let refusedPlan: any;
    testHarness.externalJavaPlan = (request: any) => {
      refusedPlan = externalJavaPlan(request, {
        status: "refused",
        summary: "Import conflicts with Existing.java",
        riskLevel: "high",
        conflicts: [
          {
            path: "src/Existing.java",
            kind: "type-name-collision",
            message: "Imported already exists.",
          },
        ],
        provenance: {
          sourceKind: "clipboard",
          sourceUrl: null,
          detectedLicense: "GPL-3.0-only",
          licensePolicy: "warn",
          notices: ["Copyleft review required."],
        },
        refusalReasons: ["Resolve the existing type conflict."],
        applyEligibility: { eligible: false, blockers: ["Type conflict blocks apply."] },
      });
      return refusedPlan;
    };
    const { App } = await import("../App");
    render(<App />);
    await screen.findByText("Workspace: Workspace One");

    fireEvent.contextMenu(screen.getByTestId("directory-src"));
    fireEvent.click(screen.getByRole("button", { name: "Paste Java Class from Clipboard" }));

    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Paste Java Class from Clipboard" }).dataset.status,
      ).toBe("refused"),
    );
    expect(screen.getByText("Resolve the existing type conflict.")).toBeDefined();
    expect(JSON.parse(screen.getByTestId("external-java-plan").textContent ?? "null")).toEqual(
      refusedPlan,
    );
    const apply = screen.getByRole("button", { name: "Apply Import" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(apply);
    expect(testHarness.refactorKitAdapter.applyPlan).not.toHaveBeenCalled();
  });

  it("retains stale plan evidence while disabling apply", async () => {
    enableExternalJavaImport();
    let stalePlan: any;
    testHarness.externalJavaPlan = (request: any) => {
      stalePlan = externalJavaPlan(request, {
        status: "stale",
        summary: "Workspace changed after analysis",
        staleness: { stale: true, reasons: ["Workspace generation advanced."] },
        refusalReasons: ["Preview the import again."],
        applyEligibility: { eligible: false, blockers: ["The plan is stale."] },
      });
      return stalePlan;
    };
    const { App } = await import("../App");
    render(<App />);
    await screen.findByText("Workspace: Workspace One");

    fireEvent.contextMenu(screen.getByTestId("directory-src"));
    fireEvent.click(screen.getByRole("button", { name: "Paste Java Class from Clipboard" }));

    await screen.findByText("Workspace changed after analysis");
    expect(JSON.parse(screen.getByTestId("external-java-plan").textContent ?? "null")).toEqual(
      stalePlan,
    );
    expect(
      (screen.getByRole("button", { name: "Apply Import" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(testHarness.refactorKitAdapter.applyPlan).not.toHaveBeenCalled();
  });

  it("shows a backend plan error message with its evidence and never applies", async () => {
    enableExternalJavaImport();
    testHarness.externalJavaPlan = (request: any) =>
      externalJavaPlan(request, {
        status: "error",
        summary: "RefactorKit analysis failed",
        diagnosticsAfterPreview: [
          { severity: "error", code: "RK-JAVA-42", message: "Parser backend timed out." },
        ],
        refusalReasons: ["Parser backend timed out."],
        applyEligibility: { eligible: false, blockers: ["No valid patch was generated."] },
      });
    const { App } = await import("../App");
    render(<App />);
    await screen.findByText("Workspace: Workspace One");

    fireEvent.contextMenu(screen.getByTestId("directory-src"));
    fireEvent.click(screen.getByRole("button", { name: "Paste Java Class from Clipboard" }));

    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Paste Java Class from Clipboard" }).dataset.status,
      ).toBe("error"),
    );
    expect(screen.getByText("Parser backend timed out.")).toBeDefined();
    expect(
      JSON.parse(screen.getByTestId("external-java-plan").textContent ?? "null"),
    ).toMatchObject({
      status: "error",
      diagnosticsAfterPreview: [{ code: "RK-JAVA-42" }],
    });
    expect(
      (screen.getByRole("button", { name: "Apply Import" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(testHarness.refactorKitAdapter.applyPlan).not.toHaveBeenCalled();
  });

  it("keeps a local empty-clipboard refusal reason-only with no plan", async () => {
    enableExternalJavaImport();
    testHarness.clipboardText = "   ";
    const { App } = await import("../App");
    render(<App />);
    await screen.findByText("Workspace: Workspace One");

    fireEvent.contextMenu(screen.getByTestId("directory-src"));
    fireEvent.click(screen.getByRole("button", { name: "Paste Java Class from Clipboard" }));

    await screen.findByText("The clipboard does not contain text.");
    expect(screen.getByTestId("external-java-plan").textContent).toBe("");
    expect(
      (screen.getByRole("button", { name: "Apply Import" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(testHarness.refactorKitAdapter.previewExternalJavaImport).not.toHaveBeenCalled();
    expect(testHarness.refactorKitAdapter.applyPlan).not.toHaveBeenCalled();
  });

  it("clears retained non-ready evidence on selection and workspace invalidation", async () => {
    enableExternalJavaImport();
    testHarness.externalJavaPlan = (request: any) =>
      externalJavaPlan(request, {
        status: "stale",
        summary: "Retained stale evidence",
        staleness: { stale: true, reasons: ["Selection is stale."] },
        applyEligibility: { eligible: false, blockers: ["Preview again."] },
      });
    const { App } = await import("../App");
    render(<App />);
    await screen.findByText("Workspace: Workspace One");

    fireEvent.contextMenu(screen.getByTestId("directory-src"));
    fireEvent.click(screen.getByRole("button", { name: "Paste Java Class from Clipboard" }));
    await screen.findByText("Retained stale evidence");
    const firstPreviewRequest =
      testHarness.refactorKitAdapter.previewExternalJavaImport.mock.calls[0][0];
    fireEvent.click(screen.getByTestId("directory-lib"));
    expect(screen.queryByText("Retained stale evidence")).toBeNull();
    expect(testHarness.refactorKitAdapter.discardPlan).toHaveBeenCalledOnce();
    expect(testHarness.refactorKitAdapter.discardPlan.mock.calls[0][0]).toEqual({
      planId: "plan-java-1",
      workspaceId: firstPreviewRequest.workspaceId,
      workspaceGeneration: firstPreviewRequest.workspaceGeneration,
      selectionGeneration: firstPreviewRequest.selectionGeneration,
      requestId: firstPreviewRequest.requestId,
    });

    fireEvent.contextMenu(screen.getByTestId("directory-src"));
    fireEvent.click(screen.getByRole("button", { name: "Paste Java Class from Clipboard" }));
    await screen.findByText("Retained stale evidence");
    const secondPreviewRequest =
      testHarness.refactorKitAdapter.previewExternalJavaImport.mock.calls[1][0];
    fireEvent.click(screen.getByRole("option", { name: "Workspace Two" }));
    await screen.findByText("Workspace: Workspace Two");
    expect(screen.queryByText("Retained stale evidence")).toBeNull();
    expect(testHarness.refactorKitAdapter.discardPlan).toHaveBeenCalledTimes(2);
    expect(testHarness.refactorKitAdapter.discardPlan.mock.calls[1][0]).toEqual({
      planId: "plan-java-1",
      workspaceId: secondPreviewRequest.workspaceId,
      workspaceGeneration: secondPreviewRequest.workspaceGeneration,
      selectionGeneration: secondPreviewRequest.selectionGeneration,
      requestId: secondPreviewRequest.requestId,
    });
    expect(testHarness.refactorKitAdapter.applyPlan).not.toHaveBeenCalled();
  });

  it("refreshes every affected branch and opens only the backend primary for a multi-file apply", async () => {
    enableExternalJavaImport();
    testHarness.externalJavaApplyResult = {
      ...testHarness.externalJavaApplyResult,
      changedFiles: [
        { change: "create", path: "src/generated/Imported.java", primary: true },
        { change: "edit", path: "config/java/imports.json", primary: false },
        {
          change: "move",
          path: "src/archive/OldImported.java",
          previousPath: "legacy/OldImported.java",
          primary: false,
        },
      ],
      primaryFile: "src/generated/Imported.java",
    };
    const { App } = await import("../App");
    render(<App />);
    await screen.findByText("Workspace: Workspace One");

    fireEvent.contextMenu(screen.getByTestId("directory-src"));
    fireEvent.click(screen.getByRole("button", { name: "Paste Java Class from Clipboard" }));
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Paste Java Class from Clipboard" }).dataset.status,
      ).toBe("preview"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Import" }));

    await waitFor(() => {
      expect(
        testHarness.fileTreeViewModel.refreshDirectory.mock.calls.map((call: any[]) => call[0]),
      ).toEqual(expect.arrayContaining(["src/generated", "config/java", "src/archive", "legacy"]));
      expect(testHarness.editorViewModel.openFile).toHaveBeenCalledWith(
        "src/generated/Imported.java",
      );
    });
    expect(testHarness.editorViewModel.openFile).not.toHaveBeenCalledWith(
      "config/java/imports.json",
    );
    expect(testHarness.fileTreeViewModel.loadRoot).toHaveBeenCalledTimes(1);
  });

  it("invalidates an in-flight preview when the directory selection changes", async () => {
    enableExternalJavaImport();
    const deferredPlan = createDeferred<any>();
    testHarness.externalJavaPlan = () => deferredPlan.promise;
    const { App } = await import("../App");
    render(<App />);
    await screen.findByText("Workspace: Workspace One");

    fireEvent.contextMenu(screen.getByTestId("directory-src"));
    fireEvent.click(screen.getByRole("button", { name: "Paste Java Class from Clipboard" }));
    await waitFor(() =>
      expect(testHarness.refactorKitAdapter.previewExternalJavaImport).toHaveBeenCalledOnce(),
    );
    const request = testHarness.refactorKitAdapter.previewExternalJavaImport.mock.calls[0][0];

    fireEvent.click(screen.getByTestId("directory-lib"));
    expect(screen.queryByRole("dialog", { name: "Paste Java Class from Clipboard" })).toBeNull();
    deferredPlan.resolve(externalJavaPlan(request));
    await act(async () => deferredPlan.promise);

    expect(screen.queryByText("Create Imported.java")).toBeNull();
    expect(testHarness.refactorKitAdapter.discardPlan).toHaveBeenCalledOnce();
    expect(testHarness.refactorKitAdapter.discardPlan.mock.calls[0][0]).toEqual({
      planId: "plan-java-1",
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
    });
    expect(testHarness.refactorKitAdapter.applyPlan).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight preview when the workspace changes", async () => {
    enableExternalJavaImport();
    const deferredPlan = createDeferred<any>();
    testHarness.externalJavaPlan = () => deferredPlan.promise;
    const { App } = await import("../App");
    render(<App />);
    await screen.findByText("Workspace: Workspace One");

    fireEvent.contextMenu(screen.getByTestId("directory-src"));
    fireEvent.click(screen.getByRole("button", { name: "Paste Java Class from Clipboard" }));
    await waitFor(() =>
      expect(testHarness.refactorKitAdapter.previewExternalJavaImport).toHaveBeenCalledOnce(),
    );
    const request = testHarness.refactorKitAdapter.previewExternalJavaImport.mock.calls[0][0];

    fireEvent.click(screen.getByRole("option", { name: "Workspace Two" }));
    await screen.findByText("Workspace: Workspace Two");
    deferredPlan.resolve(externalJavaPlan(request));
    await act(async () => deferredPlan.promise);

    expect(screen.queryByRole("dialog", { name: "Paste Java Class from Clipboard" })).toBeNull();
    expect(testHarness.refactorKitAdapter.discardPlan).toHaveBeenCalledOnce();
    expect(testHarness.refactorKitAdapter.discardPlan.mock.calls[0][0]).toEqual({
      planId: "plan-java-1",
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
    });
    expect(testHarness.refactorKitAdapter.applyPlan).not.toHaveBeenCalled();
  });

  it("handles Ctrl+V only inside the tree after a directory selection", async () => {
    enableExternalJavaImport();
    const { App } = await import("../App");
    render(<App />);
    await screen.findByText("Workspace: Workspace One");
    const tree = screen.getByTestId("FileTree");

    fireEvent.keyDown(tree, { key: "v", ctrlKey: true });
    expect(testHarness.clipboardAdapter.readText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("directory-src"));
    fireEvent.keyDown(tree, { key: "v", ctrlKey: true });

    await waitFor(() => expect(testHarness.clipboardAdapter.readText).toHaveBeenCalledOnce());
    expect(
      testHarness.refactorKitAdapter.previewExternalJavaImport.mock.calls[0][0].targetDirectory,
    ).toBe("src");
  });

  it("closes immediately, discards once, and tolerates a nonfatal discard failure on cancel", async () => {
    enableExternalJavaImport();
    const discard = createDeferred<any>();
    testHarness.refactorKitAdapter.discardPlan.mockImplementationOnce(() => discard.promise);
    const { App } = await import("../App");
    render(<App />);
    await screen.findByText("Workspace: Workspace One");
    fireEvent.contextMenu(screen.getByTestId("directory-src"));
    fireEvent.click(screen.getByRole("button", { name: "Paste Java Class from Clipboard" }));
    await screen.findByText("Create Imported.java");
    const previewRequest =
      testHarness.refactorKitAdapter.previewExternalJavaImport.mock.calls[0][0];
    fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));

    expect(screen.queryByRole("dialog", { name: "Paste Java Class from Clipboard" })).toBeNull();
    expect(testHarness.refactorKitAdapter.discardPlan).toHaveBeenCalledOnce();
    const discardRequest = testHarness.refactorKitAdapter.discardPlan.mock.calls[0][0];
    expect(discardRequest).toEqual({
      planId: "plan-java-1",
      workspaceId: previewRequest.workspaceId,
      workspaceGeneration: previewRequest.workspaceGeneration,
      selectionGeneration: previewRequest.selectionGeneration,
      requestId: previewRequest.requestId,
    });
    expect(JSON.stringify(discardRequest)).not.toContain(testHarness.clipboardText);
    expect(testHarness.refactorKitAdapter.applyPlan).not.toHaveBeenCalled();
    expect(testHarness.fileTreeViewModel.refreshDirectory).not.toHaveBeenCalled();
    expect(testHarness.fileTreeViewModel.loadRoot).toHaveBeenCalledTimes(1);

    discard.reject(new Error(`discard failed: ${testHarness.clipboardText}`));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog", { name: "Paste Java Class from Clipboard" })).toBeNull();
    expect(testHarness.refactorKitAdapter.discardPlan).toHaveBeenCalledOnce();
  });

  it("opens Settings on the AI Agents section with the mocked Pi adapter data", async () => {
    const { App } = await import("../App");

    render(<App />);

    await waitFor(() => {
      expect(testHarness.aiAgentAdapter.getSettings).toHaveBeenCalled();
      expect(testHarness.aiAgentAdapter.getStatus).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeDefined();
      expect(screen.getByRole("tab", { name: /AI Agents/i }).getAttribute("aria-selected")).toBe(
        "true",
      );
    });

    const panel = screen.getByTestId("SettingsPanel");
    expect(panel.dataset.statusAvailability).toBe("not-installed");
    expect(panel.dataset.hasRefresh).toBe("true");
    expect(panel.dataset.hasSave).toBe("true");
    expect(panel.dataset.hasInstall).toBe("true");
    expect(testHarness.aiAgentAdapter.getSettings).toHaveBeenCalledTimes(2);
  });

  it("switches between Terminal and AI Agent bottom tabs", async () => {
    const { App } = await import("../App");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Pi Agent: not-installed")).toBeDefined();
    });

    expect(screen.getByRole("tab", { name: "Terminal" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("tab", { name: "AI Agent" }).getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(screen.getByTestId("Terminal")).toBeDefined();
    const terminalTab = screen.getByRole("tab", { name: "Terminal" });
    const aiAgentTab = screen.getByRole("tab", { name: "AI Agent" });
    expect(terminalTab.dataset.scope).toBe("core");
    expect(terminalTab.dataset.hasIcon).toBe("true");
    expect(terminalTab.title).toBe("Integrated terminal");
    expect(aiAgentTab.dataset.scope).toBe("core");
    expect(aiAgentTab.dataset.hasIcon).toBe("true");
    expect(aiAgentTab.title).toBe("AI coding agent");

    fireEvent.click(aiAgentTab);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "AI Agent" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(screen.getByTestId("AiAgentPanel")).toBeDefined();
    });
    expect(screen.queryByTestId("Terminal")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Terminal" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(screen.getByTestId("Terminal")).toBeDefined();
    });
  });

  it.each([
    ["generic workspace", [], null],
    [
      "weak convention evidence",
      [
        {
          evidenceKind: "x2proj",
          moduleRoot: "MyMod",
          relativePath: "MyMod/MyMod.x2proj",
        },
      ],
      null,
    ],
    ["scanner error", [], new Error("private native scanner detail")],
  ])("keeps %s contribution-free", async (_label, observations, scanError) => {
    testHarness.xcom2ModuleScanObservations = observations;
    testHarness.xcom2ModuleScanError = scanError;
    const consoleError = scanError
      ? vi.spyOn(console, "error").mockImplementation(() => undefined)
      : null;
    const { App } = await import("../App");

    render(<App />);

    await waitFor(() =>
      expect(testHarness.xcom2ModuleScannerAdapter.scan).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => {
      expect(testHarness.latestPanelLayoutProps.activityContributions).toEqual([]);
    });
    expect(Object.isFrozen(testHarness.latestPanelLayoutProps.activityContributions)).toBe(true);
    expect(testHarness.latestSettingsPanelDiagnosticPresentation).toBeNull();
    expect(screen.queryByRole("tab", { name: "XCOM 2 Project" })).toBeNull();
    expect(screen.queryByTestId("Xcom2ProjectRecognitionPanel")).toBeNull();
    consoleError?.mockRestore();
  });

  it("composes configured-only activation as one accessible immutable project contribution with exact project props", async () => {
    testHarness.xcom2ModuleConfiguration = {
      version: 1,
      target: "wotc",
      moduleRoots: ["ConfiguredMod"],
    };
    const { App } = await import("../App");

    render(<App />);

    const xcomActivity = await screen.findByRole("tab", { name: "XCOM 2 Project" });
    expect(testHarness.xcom2ModuleScannerAdapter.scan).toHaveBeenCalledTimes(1);
    expect(testHarness.xcom2ModuleConfigurationAdapter.read).toHaveBeenCalledTimes(1);
    expect(xcomActivity.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("PanelLayout").dataset.activeActivity).toBe("explorer");
    expect(screen.queryByTestId("Xcom2ProjectRecognitionPanel")).toBeNull();

    const contributions = testHarness.latestPanelLayoutProps.activityContributions;
    expect(contributions).toHaveLength(1);
    expect(Object.isFrozen(contributions)).toBe(true);
    expect(Object.isFrozen(contributions[0])).toBe(true);
    expect(contributions[0]).toMatchObject({
      id: "xcom2-project",
      label: "XCOM 2 Project",
      title: "XCOM 2 Project",
    });
    const props = contributions[0].content.props;
    expect(props.snapshot).toBe(props.recognitionSnapshot);
    expect(props.snapshot).toEqual({
      workspaceId: "workspace-one",
      workspaceGeneration: 1,
      scanId: "xcom2-module-scan:1",
      scanGeneration: 1,
      completeness: "complete",
      state: "inactive",
      confidence: "none",
      decisions: [],
      issues: [],
      limits: { maximumDepth: 8, maximumEncounteredEntries: 20_000 },
    });
    expect(props.activeDecisions).toEqual([]);
    expect(props.projectSnapshot).toEqual({
      workspaceId: "workspace-one",
      workspaceGeneration: 1,
      activationGeneration: 1,
      configurationReadId: "xcom2-configuration-read:1",
      scanId: "xcom2-module-scan:1",
      scanGeneration: 1,
      state: "active",
      recognitionConfidence: "none",
      decisions: [
        {
          moduleRoot: "ConfiguredMod",
          state: "active",
          source: "configured",
          activationConfidence: "explicit",
          recognitionConfidence: "none",
          reasons: [{ kind: "configuration", target: "wotc" }],
        },
      ],
    });
    expect(props.activeProjectDecisions).toEqual(props.projectSnapshot.decisions);
    expect(props.diagnosticPresentation).toBeNull();

    fireEvent.click(xcomActivity);
    const panel = screen.getByTestId("Xcom2ProjectRecognitionPanel");
    expect(panel.getAttribute("aria-label")).toBe("XCOM 2 Project");
    expect(panel.dataset).toMatchObject({ workspace: "workspace-one", activeCount: "1" });
    expect(screen.getByText("ConfiguredMod")).toBeDefined();
    expect(testHarness.latestXcom2ProjectRecognitionPanelProps).toEqual(props);
  });

  it("composes one immutable active project contribution without automatically opening it", async () => {
    testHarness.xcom2ModuleScanObservations = [
      {
        evidenceKind: "x2proj",
        moduleRoot: "MyMod",
        relativePath: "MyMod/MyMod.x2proj",
      },
      {
        evidenceKind: "xcommod",
        moduleRoot: "MyMod",
        relativePath: "MyMod/MyMod.xcommod",
      },
    ];
    const { App } = await import("../App");

    render(<App />);

    const xcomActivity = await screen.findByRole("tab", { name: "XCOM 2 Project" });
    expect(screen.getByTestId("PanelLayout").dataset.activeActivity).toBe("explorer");
    expect(xcomActivity.getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByTestId("Xcom2ProjectRecognitionPanel")).toBeNull();

    const contributions = testHarness.latestPanelLayoutProps.activityContributions;
    expect(contributions).toHaveLength(1);
    expect(Object.isFrozen(contributions)).toBe(true);
    expect(Object.isFrozen(contributions[0])).toBe(true);
    expect(contributions[0]).toMatchObject({
      id: "xcom2-project",
      label: "XCOM 2 Project",
      title: "XCOM 2 Project",
    });
    expect(xcomActivity.title).toBe("XCOM 2 Project");

    const searchActivity = screen.getByRole("tab", { name: "Search" });
    searchActivity.focus();
    fireEvent.keyDown(searchActivity, { key: "ArrowRight" });

    expect(screen.getByTestId("PanelLayout").dataset.activeActivity).toBe("xcom2-project");
    expect(xcomActivity.getAttribute("aria-selected")).toBe("true");
    const recognitionPanel = screen.getByTestId("Xcom2ProjectRecognitionPanel");
    expect(recognitionPanel.getAttribute("aria-label")).toBe("XCOM 2 Project");
    expect(recognitionPanel.dataset).toMatchObject({
      workspace: "workspace-one",
      activeCount: "1",
    });
    expect(testHarness.latestXcom2ProjectRecognitionPanelProps.snapshot).toBe(
      contributions[0].content.props.snapshot,
    );
    expect(testHarness.latestXcom2ProjectRecognitionPanelProps.activeDecisions).toBe(
      contributions[0].content.props.activeDecisions,
    );
    expect(testHarness.latestXcom2ProjectRecognitionPanelProps.snapshot).toMatchObject({
      workspaceId: "workspace-one",
      state: "active",
      confidence: "high",
    });
    expect(testHarness.latestXcom2ProjectRecognitionPanelProps.activeDecisions).toEqual([
      {
        moduleRoot: "MyMod",
        state: "active",
        confidence: "high",
        reasons: [
          { evidenceKind: "x2proj", relativePath: "MyMod/MyMod.x2proj" },
          { evidenceKind: "xcommod", relativePath: "MyMod/MyMod.xcommod" },
        ],
      },
    ]);
    expect(testHarness.latestXcom2ProjectRecognitionPanelProps.recognitionSnapshot).toBe(
      testHarness.latestXcom2ProjectRecognitionPanelProps.snapshot,
    );
    expect(testHarness.latestXcom2ProjectRecognitionPanelProps.projectSnapshot).toMatchObject({
      workspaceId: "workspace-one",
      state: "active",
      recognitionConfidence: "high",
    });
    expect(testHarness.latestXcom2ProjectRecognitionPanelProps.activeProjectDecisions).toEqual([
      {
        moduleRoot: "MyMod",
        state: "active",
        source: "recognized",
        activationConfidence: "high",
        recognitionConfidence: "high",
        reasons: [
          { kind: "recognition", evidenceKind: "x2proj", relativePath: "MyMod/MyMod.x2proj" },
          {
            kind: "recognition",
            evidenceKind: "xcommod",
            relativePath: "MyMod/MyMod.xcommod",
          },
        ],
      },
    ]);

    const bottomTabList = screen.getByRole("tablist", { name: "Bottom panel tabs" });
    expect(
      within(bottomTabList)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Terminal", "AI Agent"]);
    for (const label of ["XCOM 2 Project", "Build", "Problems", "Logs", "Language"]) {
      expect(within(bottomTabList).queryByRole("tab", { name: label })).toBeNull();
    }
  });

  it("renders combined configured and recognized activation from the joint project decision", async () => {
    testHarness.xcom2ModuleConfiguration = {
      version: 1,
      target: "wotc",
      moduleRoots: ["MyMod"],
    };
    testHarness.xcom2ModuleScanObservations = [
      {
        evidenceKind: "x2proj",
        moduleRoot: "MyMod",
        relativePath: "MyMod/MyMod.x2proj",
      },
      {
        evidenceKind: "xcommod",
        moduleRoot: "MyMod",
        relativePath: "MyMod/MyMod.xcommod",
      },
    ];
    const { App } = await import("../App");
    render(<App />);

    const xcomActivity = await screen.findByRole("tab", { name: "XCOM 2 Project" });
    fireEvent.click(xcomActivity);

    expect(testHarness.latestXcom2ProjectRecognitionPanelProps.activeProjectDecisions).toEqual([
      {
        moduleRoot: "MyMod",
        state: "active",
        source: "configured-and-recognized",
        activationConfidence: "explicit",
        recognitionConfidence: "high",
        reasons: [
          { kind: "configuration", target: "wotc" },
          { kind: "recognition", evidenceKind: "x2proj", relativePath: "MyMod/MyMod.x2proj" },
          {
            kind: "recognition",
            evidenceKind: "xcommod",
            relativePath: "MyMod/MyMod.xcommod",
          },
        ],
      },
    ]);
    expect(testHarness.latestXcom2ProjectRecognitionPanelProps.projectSnapshot).toMatchObject({
      state: "active",
      recognitionConfidence: "high",
    });
    expect(screen.getByText("MyMod")).toBeDefined();
  });

  it("presents an invalid-only configuration safely in Settings without creating activity", async () => {
    testHarness.xcom2ModuleConfigurationStopCode = "configuration-invalid-json";
    testHarness.xcom2ModuleConfigurationStoppedExtras = {
      path: "/private/workspace/.ide/xcom2.json",
      content: "PRIVATE_CONFIGURATION_CONTENT",
      cause: "PRIVATE_PARSER_CAUSE",
      result: "PRIVATE_NATIVE_RESULT",
    };
    const { App } = await import("../App");
    render(<App />);

    await waitFor(() => {
      expect(testHarness.xcom2ModuleScannerAdapter.scan).toHaveBeenCalledTimes(1);
      expect(testHarness.xcom2ModuleConfigurationAdapter.read).toHaveBeenCalledTimes(1);
    });
    expect(testHarness.latestPanelLayoutProps.activityContributions).toEqual([]);
    expect(Object.isFrozen(testHarness.latestPanelLayoutProps.activityContributions)).toBe(true);
    expect(screen.queryByRole("tab", { name: "XCOM 2 Project" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Workspace" }));

    const warning = screen.getByRole("alert");
    expect(warning.textContent).toContain("XCOM 2 project configuration needs attention");
    expect(warning.textContent).toContain("Project file: .ide/xcom2.json");
    expect(warning.textContent).toContain("not valid JSON");
    expect(warning.textContent).toContain("Correct the JSON syntax");
    expect(warning.textContent).toContain("configuration-invalid-json");
    expect(testHarness.latestSettingsPanelConfigurationChecking).toBe(false);
    expect(JSON.stringify(testHarness.latestSettingsPanelDiagnosticPresentation)).not.toMatch(
      /PRIVATE_|\/private\//u,
    );
    expect(document.body.textContent).not.toMatch(/PRIVATE_|\/private\//u);
  });

  it("keeps strong Option A recognized activity and mirrors one safe diagnostic object without configured authority", async () => {
    testHarness.xcom2ModuleConfigurationStopCode = "configuration-invalid-json";
    testHarness.xcom2ModuleConfigurationStoppedExtras = {
      path: "/private/workspace/.ide/xcom2.json",
      content: "PRIVATE_CONFIGURATION_CONTENT",
      cause: "PRIVATE_PARSER_CAUSE",
      result: "PRIVATE_NATIVE_RESULT",
    };
    testHarness.xcom2ModuleScanObservations = [
      {
        evidenceKind: "x2proj",
        moduleRoot: "MyMod",
        relativePath: "MyMod/MyMod.x2proj",
      },
      {
        evidenceKind: "xcommod",
        moduleRoot: "MyMod",
        relativePath: "MyMod/MyMod.xcommod",
      },
    ];
    const { App } = await import("../App");
    render(<App />);

    fireEvent.click(await screen.findByRole("tab", { name: "XCOM 2 Project" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Workspace" }));

    const recognitionProps = testHarness.latestXcom2ProjectRecognitionPanelProps;
    expect(recognitionProps.activeProjectDecisions).toEqual([
      {
        moduleRoot: "MyMod",
        state: "active",
        source: "recognized",
        activationConfidence: "high",
        recognitionConfidence: "high",
        reasons: [
          { kind: "recognition", evidenceKind: "x2proj", relativePath: "MyMod/MyMod.x2proj" },
          {
            kind: "recognition",
            evidenceKind: "xcommod",
            relativePath: "MyMod/MyMod.xcommod",
          },
        ],
      },
    ]);
    expect(recognitionProps.projectSnapshot.diagnostic).toEqual({
      code: "configuration-invalid-json",
    });
    expect(recognitionProps.diagnosticPresentation).toBe(
      testHarness.latestSettingsPanelDiagnosticPresentation,
    );
    expect(Object.isFrozen(recognitionProps.diagnosticPresentation)).toBe(true);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    for (const warning of screen.getAllByRole("alert")) {
      expect(warning.textContent).toContain("XCOM 2 project configuration needs attention");
      expect(warning.textContent).toContain("configuration-invalid-json");
    }
    expect(JSON.stringify(recognitionProps)).not.toMatch(/PRIVATE_|\/private\//u);
    expect(document.body.textContent).not.toMatch(/PRIVATE_|\/private\//u);
  });

  it("synchronously replaces an old warning with checking, then clears it for valid configured activity", async () => {
    testHarness.xcom2ModuleConfigurationStopCode = "configuration-invalid-json";
    const { App } = await import("../App");
    render(<App />);

    await waitFor(() =>
      expect(testHarness.xcom2ModuleConfigurationAdapter.read).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Workspace" }));
    expect(screen.getByRole("alert").textContent).toContain("not valid JSON");

    const gate = createDeferred<void>();
    testHarness.xcom2ModuleConfigurationGate = gate.promise;
    testHarness.xcom2ModuleConfigurationStopCode = null;
    testHarness.xcom2ModuleConfiguration = {
      version: 1,
      target: "wotc",
      moduleRoots: ["ConfiguredMod"],
    };
    fireEvent.click(screen.getByRole("button", { name: "Refresh workspace" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Checking XCOM 2 project configuration…")).toBeDefined();
    expect(testHarness.latestSettingsPanelConfigurationChecking).toBe(true);
    expect(testHarness.latestSettingsPanelDiagnosticPresentation).toBeNull();
    expect(testHarness.latestPanelLayoutProps.activityContributions).toEqual([]);

    await act(async () => {
      gate.resolve();
    });
    await screen.findByRole("tab", { name: "XCOM 2 Project" });
    expect(screen.queryByText("Checking XCOM 2 project configuration…")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(testHarness.latestSettingsPanelConfigurationChecking).toBe(false);
    expect(testHarness.latestSettingsPanelDiagnosticPresentation).toBeNull();
    expect(testHarness.latestPanelLayoutProps.activityContributions[0].content.props).toMatchObject(
      { diagnosticPresentation: null },
    );
    expect(
      testHarness.latestPanelLayoutProps.activityContributions[0].content.props
        .activeProjectDecisions,
    ).toEqual([expect.objectContaining({ moduleRoot: "ConfiguredMod", source: "configured" })]);
  });

  it("revokes configured activation synchronously on refresh, restores it explicitly, and never renders stale project props", async () => {
    testHarness.xcom2ModuleConfiguration = {
      version: 1,
      target: "wotc",
      moduleRoots: ["ConfiguredMod"],
    };
    const { App } = await import("../App");
    render(<App />);

    fireEvent.click(await screen.findByRole("tab", { name: "XCOM 2 Project" }));
    expect(screen.getByTestId("PanelLayout").dataset.activeActivity).toBe("xcom2-project");
    expect(screen.getByText("ConfiguredMod")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    testHarness.xcom2ModuleConfiguration = null;
    fireEvent.click(await screen.findByRole("button", { name: "Refresh workspace" }));

    expect(screen.queryByRole("tab", { name: "XCOM 2 Project" })).toBeNull();
    expect(screen.queryByTestId("Xcom2ProjectRecognitionPanel")).toBeNull();
    expect(screen.getByTestId("PanelLayout").dataset.activeActivity).toBe("explorer");
    await waitFor(() => {
      expect(testHarness.xcom2ModuleConfigurationAdapter.read).toHaveBeenCalledTimes(2);
      expect(testHarness.latestPanelLayoutProps.activityContributions).toEqual([]);
    });

    testHarness.xcom2ModuleConfiguration = {
      version: 1,
      target: "wotc",
      moduleRoots: ["ConfiguredMod"],
    };
    fireEvent.click(screen.getByRole("button", { name: "Refresh workspace" }));

    const restoredActivity = await screen.findByRole("tab", { name: "XCOM 2 Project" });
    expect(restoredActivity.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("PanelLayout").dataset.activeActivity).toBe("explorer");
    expect(screen.queryByTestId("Xcom2ProjectRecognitionPanel")).toBeNull();
    const restoredProps = testHarness.latestPanelLayoutProps.activityContributions[0].content.props;
    expect(restoredProps.projectSnapshot).toMatchObject({
      activationGeneration: 3,
      configurationReadId: "xcom2-configuration-read:3",
      scanGeneration: 3,
      scanId: "xcom2-module-scan:3",
      state: "active",
    });
    expect(restoredProps.activeProjectDecisions).toEqual([
      expect.objectContaining({ moduleRoot: "ConfiguredMod", source: "configured" }),
    ]);
    expect(JSON.stringify(restoredProps)).not.toContain("xcom2-configuration-read:1");
  });

  it("revokes a selected project contribution at switch start and does not reselect it", async () => {
    testHarness.xcom2ModuleScanObservations = [
      {
        evidenceKind: "x2proj",
        moduleRoot: "MyMod",
        relativePath: "MyMod/MyMod.x2proj",
      },
      {
        evidenceKind: "xcommod",
        moduleRoot: "MyMod",
        relativePath: "MyMod/MyMod.xcommod",
      },
    ];
    const switchResult = createDeferred<any>();
    testHarness.workspaceAdapter.switchWorkspace.mockReturnValueOnce(switchResult.promise);
    const { App } = await import("../App");
    render(<App />);

    fireEvent.click(await screen.findByRole("tab", { name: "XCOM 2 Project" }));
    expect(screen.getByTestId("PanelLayout").dataset.activeActivity).toBe("xcom2-project");

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Switch to Workspace Two in Settings" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: "XCOM 2 Project" })).toBeNull();
      expect(screen.getByTestId("PanelLayout").dataset.activeActivity).toBe("explorer");
    });
    expect(screen.queryByText("Workspace: Workspace Two")).toBeNull();
    expect(screen.getByText("Workspace: loading…").getAttribute("title")).toBe("/workspace/one");
    expect(testHarness.workspaceAdapter.switchWorkspace).toHaveBeenCalledWith("workspace-two");

    const nextWorkspace = testHarness.workspaceRegistry.workspaces[1];
    testHarness.workspaceInfo = nextWorkspace;
    testHarness.workspaceRegistry = {
      ...testHarness.workspaceRegistry,
      currentWorkspaceId: nextWorkspace.id,
    };
    switchResult.resolve(nextWorkspace);

    const restoredActivity = await screen.findByRole("tab", { name: "XCOM 2 Project" });
    await screen.findByText("Workspace: Workspace Two");
    expect(restoredActivity.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("PanelLayout").dataset.activeActivity).toBe("explorer");
    expect(screen.queryByTestId("Xcom2ProjectRecognitionPanel")).toBeNull();
  });

  it("runs activation only for initial load, switch, and explicit workspace refresh", async () => {
    testHarness.xcom2ModuleScanObservations = [
      {
        evidenceKind: "x2proj",
        moduleRoot: "MyMod",
        relativePath: "MyMod/MyMod.x2proj",
      },
      {
        evidenceKind: "xcommod",
        moduleRoot: "MyMod",
        relativePath: "MyMod/MyMod.xcommod",
      },
    ];
    const { XCOM2_MODULE_SCAN_LIMITS } = await import("@ide/contracts");
    const { App } = await import("../App");
    render(<App />);

    await waitFor(() => {
      expect(testHarness.xcom2ModuleScannerAdapter.scan).toHaveBeenCalledTimes(1);
      expect(testHarness.xcom2ModuleConfigurationAdapter.read).toHaveBeenCalledTimes(1);
    });
    const initialRequest = testHarness.xcom2ModuleScannerAdapter.scan.mock.calls[0][0];
    expect(initialRequest).toEqual({
      workspaceId: "workspace-one",
      workspaceGeneration: 1,
      scanId: "xcom2-module-scan:1",
      scanGeneration: 1,
      limits: XCOM2_MODULE_SCAN_LIMITS,
    });
    expect(testHarness.xcom2SetupMonitorAdapter.getSnapshot).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Settings" })).toBeDefined());
    expect(testHarness.xcom2ModuleScannerAdapter.scan).toHaveBeenCalledTimes(1);
    expect(testHarness.xcom2ModuleConfigurationAdapter.read).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh workspace" }));
    await waitFor(() => {
      expect(testHarness.xcom2ModuleScannerAdapter.scan).toHaveBeenCalledTimes(2);
      expect(testHarness.xcom2ModuleConfigurationAdapter.read).toHaveBeenCalledTimes(2);
    });
    expect(testHarness.xcom2ModuleConfigurationAdapter.read.mock.calls[1][0]).toEqual({
      workspaceId: "workspace-one",
      workspaceGeneration: 1,
      activationGeneration: 2,
      configurationReadId: "xcom2-configuration-read:2",
    });

    fireEvent.click(screen.getByRole("option", { name: /Workspace Two/ }));
    await waitFor(() =>
      expect(testHarness.xcom2ModuleScannerAdapter.scan).toHaveBeenCalledTimes(3),
    );
    expect(testHarness.xcom2ModuleScannerAdapter.scan.mock.calls[2][0]).toEqual({
      workspaceId: "workspace-two",
      workspaceGeneration: 2,
      scanId: "xcom2-module-scan:3",
      scanGeneration: 3,
      limits: XCOM2_MODULE_SCAN_LIMITS,
    });
    expect(screen.queryByRole("tab", { name: "XCOM 2 Modules" })).toBeNull();
  });

  it("keeps XCOM 2 out of bottom tabs and shows active setup progress in Settings", async () => {
    const { App } = await import("../App");
    render(<App />);

    expect(screen.getByRole("tab", { name: "Terminal" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.queryByRole("tab", { name: "XCOM 2" })).toBeNull();
    expect(testHarness.xcom2SetupMonitorAdapter.getSnapshot).not.toHaveBeenCalled();
    expect(testHarness.xcom2SetupAdapter.listTransactions).not.toHaveBeenCalled();
    expect(testHarness.xcom2SetupMonitorAdapter.subscribe).not.toHaveBeenCalled();
    expect(testHarness.xcom2SetupAdapter.subscribe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "XCOM 2" }));

    await waitFor(() => {
      expect(screen.getByText("XCOM 2: downloading 50%")).toBeDefined();
      expect(
        screen.getByText("XCOM 2: War of the Chosen Development Tools: staging 25%"),
      ).toBeDefined();
    });
    expect(screen.getByText("Built-in · Experimental")).toBeDefined();
    expect(screen.getByText(/Currently non-removable/)).toBeDefined();
    expect(testHarness.xcom2SetupMonitorAdapter.getSnapshot).toHaveBeenCalledTimes(1);
    expect(testHarness.xcom2SetupAdapter.listTransactions).toHaveBeenCalledTimes(1);
    expect(testHarness.xcom2SetupMonitorAdapter.refresh).not.toHaveBeenCalled();
    expect(testHarness.xcom2SetupMonitorAdapter.subscribe).toHaveBeenCalledTimes(1);
    expect(testHarness.xcom2SetupAdapter.subscribe).toHaveBeenCalledTimes(1);
  });

  it("cancels both XCOM Settings lifecycles on close and creates one fresh lifecycle on reopen", async () => {
    const { App } = await import("../App");
    render(<App />);
    await screen.findByText("Workspace: Workspace One");

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() =>
      expect(testHarness.xcom2SetupMonitorAdapter.getSnapshot).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(testHarness.xcom2SetupAdapter.listTransactions).toHaveBeenCalledTimes(1),
    );
    expect(testHarness.xcom2SetupMonitorAdapter.subscribe).toHaveBeenCalledTimes(1);
    expect(testHarness.xcom2SetupAdapter.subscribe).toHaveBeenCalledTimes(1);
    expect(testHarness.xcom2SetupListeners.size).toBe(1);
    expect(testHarness.xcom2TransactionListeners.size).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(testHarness.xcom2SetupListeners.size).toBe(0);
    expect(testHarness.xcom2TransactionListeners.size).toBe(0);
    const closedHistoryReads = testHarness.xcom2SetupAdapter.listTransactions.mock.calls.length;
    act(() => {
      for (let interval = 1; interval <= 5; interval += 1) {
        testHarness.emitXcom2SetupEvent({
          type: "snapshot",
          cause: "poll",
          sequence: interval,
          snapshot: { ...testHarness.xcom2SetupSnapshot, generation: interval + 1 },
        });
        testHarness.emitXcom2TransactionEvent({
          transactionId: "tx-closed",
          sequence: interval,
          occurredAt: "2026-07-16T00:00:00.000Z",
          kind: "operation-progress",
          state: "applying",
          terminal: false,
        });
      }
    });
    expect(testHarness.xcom2SetupAdapter.listTransactions).toHaveBeenCalledTimes(
      closedHistoryReads,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() =>
      expect(testHarness.xcom2SetupMonitorAdapter.getSnapshot).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(testHarness.xcom2SetupAdapter.listTransactions).toHaveBeenCalledTimes(2),
    );
    expect(testHarness.xcom2SetupMonitorAdapter.subscribe).toHaveBeenCalledTimes(2);
    expect(testHarness.xcom2SetupAdapter.subscribe).toHaveBeenCalledTimes(2);
    expect(testHarness.xcom2SetupListeners.size).toBe(1);
    expect(testHarness.xcom2TransactionListeners.size).toBe(1);
    expect(testHarness.xcom2SetupMonitorAdapter.refresh).not.toHaveBeenCalled();
  });

  it("creates a dry-run waiting plan from Settings", async () => {
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "XCOM 2" }));
    await screen.findByText("XCOM 2: downloading 50%");

    fireEvent.click(screen.getByRole("button", { name: "Plan Setup" }));

    await waitFor(() => {
      expect(screen.getByTestId("Xcom2SetupPanel").dataset.planState).toBe("waiting-for-download");
    });
    expect(testHarness.xcom2SetupMonitorAdapter.refresh).not.toHaveBeenCalled();
  });

  it("applies live XCOM 2 events and refreshes through Settings", async () => {
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "XCOM 2" }));
    await screen.findByText("XCOM 2: downloading 50%");

    const updated = {
      ...testHarness.xcom2SetupSnapshot,
      generation: 2,
      products: testHarness.xcom2SetupSnapshot.products.map((product: any) =>
        product.product.appId === 268500
          ? { ...product, lifecycle: "verifying", downloadPercentage: 100 }
          : product,
      ),
      overallState: "verifying",
    };
    act(() => {
      testHarness.emitXcom2SetupEvent({
        type: "snapshot",
        cause: "poll",
        sequence: 1,
        snapshot: updated,
      });
    });
    expect(await screen.findByText("XCOM 2: verifying 100%")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await waitFor(() =>
      expect(testHarness.xcom2SetupMonitorAdapter.refresh).toHaveBeenCalledTimes(1),
    );
    expect(testHarness.aiAgentAdapter.sendPrompt).not.toHaveBeenCalled();
  });

  it("keeps Settings XCOM state safe from stale workspace events", async () => {
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "XCOM 2" }));
    await screen.findByText("XCOM 2: downloading 50%");

    testHarness.xcom2SetupSnapshot = {
      ...testHarness.xcom2SetupSnapshot,
      workspaceId: "workspace-two",
      generation: 1,
      products: [],
      overallState: "not-found",
      blockers: ["Steam products not found"],
    };
    fireEvent.click(screen.getByRole("option", { name: /Workspace Two/ }));
    await waitFor(() => {
      expect(screen.getByTestId("Xcom2SetupPanel").dataset.workspace).toBe("workspace-two");
      expect(screen.getByText("Steam products not found.")).toBeDefined();
    });

    act(() => {
      testHarness.emitXcom2SetupEvent({
        type: "snapshot",
        cause: "poll",
        sequence: 99,
        snapshot: {
          ...testHarness.xcom2SetupSnapshot,
          workspaceId: "workspace-one",
          generation: 999,
          products: [],
        },
      });
    });
    expect(screen.getByTestId("Xcom2SetupPanel").dataset.workspace).toBe("workspace-two");
    expect(screen.queryByRole("tab", { name: "XCOM 2", hidden: true })).toBeDefined();
    expect(testHarness.xcom2SetupMonitorAdapter.subscribe).toHaveBeenCalledTimes(2);
  });

  it("shows missing Steam data and monitor errors honestly in Settings", async () => {
    testHarness.xcom2SetupSnapshot = {
      ...testHarness.xcom2SetupSnapshot,
      products: [],
      overallState: "not-found",
      blockers: ["Steam unavailable"],
    };
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "XCOM 2" }));
    expect(await screen.findByText("Steam products not found.")).toBeDefined();

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    testHarness.xcom2SetupError = new Error("Steam monitor unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Steam monitor unavailable");
      expect(screen.getByTestId("Xcom2SetupPanel").dataset.stale).toBe("true");
    });
    consoleError.mockRestore();
  });

  it("uses native prepare and keeps a blocked production transaction non-executable", async () => {
    const blocked = xcom2Transaction();
    testHarness.xcom2Transaction = blocked;
    testHarness.xcom2Transactions = [blocked];
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "XCOM 2" }));
    await screen.findByText("XCOM 2: downloading 50%");

    fireEvent.click(screen.getByRole("button", { name: "Prepare transaction" }));
    await waitFor(() => expect(testHarness.xcom2SetupAdapter.prepare).toHaveBeenCalledTimes(1));
    expect(testHarness.xcom2SetupAdapter.prepare).toHaveBeenCalledWith({
      plan: expect.objectContaining({ state: "waiting-for-download" }),
    });
    expect(screen.getByTestId("Xcom2SetupPanel").dataset.transactionState).toBe(
      "waiting-for-download",
    );
    expect(screen.queryByRole("button", { name: "Apply reviewed transaction" })).toBeNull();
    expect(testHarness.xcom2SetupAdapter.apply).not.toHaveBeenCalled();
    expect(testHarness.aiAgentAdapter.sendPrompt).not.toHaveBeenCalled();
  });

  it("passes the exact UI-reviewed transaction id and digest to native apply", async () => {
    const executable = xcom2Transaction({
      transactionId: "tx-executable",
      state: "awaiting-approval",
      executable: true,
      approvedStepIds: ["write-workspace-configuration"],
      approvedOperationIds: ["operation-1"],
      approvedCapabilities: ["manage-generated-workspace-content"],
      applyAvailability: { allowed: true, blockers: [] },
    });
    testHarness.xcom2Transaction = executable;
    testHarness.xcom2Transactions = [executable];
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "XCOM 2" }));
    await waitFor(() =>
      expect(screen.getByTestId("Xcom2SetupPanel").dataset.transaction).toBe("tx-executable"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply reviewed transaction" }));
    await waitFor(() =>
      expect(testHarness.xcom2SetupAdapter.apply).toHaveBeenCalledWith({
        transactionId: "tx-executable",
        approvalToken: xcom2Digest,
      }),
    );
    expect(testHarness.xcom2SetupAdapter.listTransactions.mock.calls.length).toBeGreaterThan(1);
  });

  it("wires cancel, rollback, recover, conflicts, and native history", async () => {
    const waiting = xcom2Transaction({ transactionId: "tx-lifecycle" });
    testHarness.xcom2Transaction = waiting;
    testHarness.xcom2Transactions = [waiting];
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "XCOM 2" }));
    await waitFor(() =>
      expect(screen.getByText("tx-lifecycle: waiting-for-download")).toBeDefined(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel transaction" }));
    await waitFor(() =>
      expect(testHarness.xcom2SetupAdapter.cancel).toHaveBeenCalledWith({
        transactionId: "tx-lifecycle",
      }),
    );

    const applied = xcom2Transaction({
      transactionId: "tx-lifecycle",
      state: "applied",
      rollbackAvailable: true,
    });
    testHarness.xcom2Transaction = applied;
    testHarness.xcom2Transactions = [applied];
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirm rollback" })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm rollback" }));
    await waitFor(() =>
      expect(testHarness.xcom2SetupAdapter.rollback).toHaveBeenCalledWith({
        transactionId: "tx-lifecycle",
      }),
    );

    const conflict = xcom2Transaction({
      transactionId: "tx-lifecycle",
      state: "rollback-conflict",
      conflictReasons: ["External edit detected"],
    });
    testHarness.xcom2Transaction = conflict;
    testHarness.xcom2Transactions = [conflict];
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Recover transaction" })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Recover transaction" }));
    await waitFor(() =>
      expect(testHarness.xcom2SetupAdapter.recover).toHaveBeenCalledWith({
        transactionId: "tx-lifecycle",
        strategy: "retry-rollback",
      }),
    );

    const interrupted = xcom2Transaction({
      transactionId: "tx-lifecycle",
      state: "recovery-required",
      recoveryGuidance: ["Resume the interrupted rollback"],
    });
    testHarness.xcom2Transaction = interrupted;
    testHarness.xcom2Transactions = [interrupted];
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Recover transaction" })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Recover transaction" }));
    await waitFor(() =>
      expect(testHarness.xcom2SetupAdapter.recover).toHaveBeenLastCalledWith({
        transactionId: "tx-lifecycle",
        strategy: "resume-rollback",
      }),
    );
    expect(testHarness.xcom2SetupAdapter.recover).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("Xcom2SetupPanel").dataset.historyCount).toBe("1");
  });

  it("subscribes once, reconciles current transaction events, and suppresses stale sequences", async () => {
    const current = xcom2Transaction({ transactionId: "tx-events", state: "applying" });
    testHarness.xcom2Transaction = current;
    testHarness.xcom2Transactions = [current];
    const { App } = await import("../App");
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "XCOM 2" }));
    await waitFor(() =>
      expect(screen.getByTestId("Xcom2SetupPanel").dataset.transaction).toBe("tx-events"),
    );
    const readsBefore = testHarness.xcom2SetupAdapter.listTransactions.mock.calls.length;

    act(() =>
      testHarness.emitXcom2TransactionEvent({
        transactionId: "tx-events",
        sequence: 7,
        occurredAt: "2026-07-12T00:01:00.000Z",
        kind: "operation-progress",
        state: "applying",
        terminal: false,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("Xcom2SetupPanel").dataset.progressSequence).toBe("7"),
    );
    expect(testHarness.xcom2SetupAdapter.listTransactions.mock.calls.length).toBeGreaterThan(
      readsBefore,
    );

    act(() =>
      testHarness.emitXcom2TransactionEvent({
        transactionId: "tx-events",
        sequence: 6,
        occurredAt: "2026-07-12T00:00:59.000Z",
        kind: "transaction-state",
        state: "awaiting-approval",
        terminal: false,
      }),
    );
    expect(screen.getByTestId("Xcom2SetupPanel").dataset.progressSequence).toBe("7");
    expect(testHarness.xcom2SetupAdapter.subscribe).toHaveBeenCalledTimes(1);
    unmount();
    expect(testHarness.xcom2TransactionListeners.size).toBe(0);
  });

  it("clears transaction journals on workspace switch and rejects old-workspace events", async () => {
    const oldTransaction = xcom2Transaction({ transactionId: "tx-workspace-one" });
    testHarness.xcom2Transaction = oldTransaction;
    testHarness.xcom2Transactions = [oldTransaction];
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "XCOM 2" }));
    await waitFor(() =>
      expect(screen.getByTestId("Xcom2SetupPanel").dataset.transaction).toBe("tx-workspace-one"),
    );

    const newTransaction = xcom2Transaction({
      transactionId: "tx-workspace-two",
      workspaceId: "workspace-two",
    });
    testHarness.xcom2Transaction = newTransaction;
    testHarness.xcom2Transactions = [newTransaction];
    testHarness.xcom2SetupSnapshot = {
      ...testHarness.xcom2SetupSnapshot,
      workspaceId: "workspace-two",
      generation: 1,
      products: [],
    };
    fireEvent.click(screen.getByRole("option", { name: /Workspace Two/ }));
    await waitFor(() =>
      expect(screen.getByTestId("Xcom2SetupPanel").dataset.transaction).toBe("tx-workspace-two"),
    );

    act(() =>
      testHarness.emitXcom2TransactionEvent({
        transactionId: "tx-workspace-one",
        sequence: 999,
        occurredAt: "2026-07-12T00:02:00.000Z",
        kind: "terminal",
        state: "applied",
        terminal: true,
      }),
    );
    expect(screen.getByTestId("Xcom2SetupPanel").dataset.transaction).toBe("tx-workspace-two");
    expect(screen.getByTestId("Xcom2SetupPanel").dataset.progressSequence).toBe("");
  });

  it("restores Pi session messages into the workspace-scoped AI UI", async () => {
    testHarness.aiAgentSessionMessages = {
      messages: [
        { id: "restored-user", role: "user", content: "Review this workspace" },
        { id: "restored-assistant", role: "assistant", content: "Restored Pi answer" },
      ],
    };
    const { App } = await import("../App");

    await act(async () => {
      render(<App />);
    });

    await waitFor(() => {
      expect(testHarness.aiAgentAdapter.getSessionMessages).toHaveBeenCalledTimes(1);
      expect(testHarness.aiAgentAdapter.getSettings).toHaveBeenCalled();
      expect(testHarness.aiAgentAdapter.getStatus).toHaveBeenCalled();
      expect(testHarness.aiAgentAdapter.listCommands).toHaveBeenCalled();
      expect(testHarness.refactorKitAdapter.getStatus).toHaveBeenCalled();
      expect(screen.getByText("Pi Agent: not-installed")).toBeDefined();
      expect(screen.getByTestId("AiAgentLatestResponse").textContent).toBe("Restored Pi answer");
    });

    fireEvent.click(screen.getByRole("tab", { name: "AI Agent" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "AI Agent" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(screen.getByTestId("AiAgentMessages").textContent).toContain(
        "user: Review this workspace",
      );
      expect(screen.getByTestId("AiAgentMessages").textContent).toContain(
        "assistant: Restored Pi answer",
      );
      expect(screen.getByTestId("AiAgentPanel").dataset.loadingCommands).toBe("false");
      expect(screen.getByTestId("AiAgentResponsePanel").dataset.messageCount).toBe("2");
    });
  });

  it("renders Files above Workspaces, omits the header selector, and switches by exact sidebar ID", async () => {
    const { App } = await import("../App");

    render(<App />);

    await screen.findByRole("option", { name: /Workspace Two/ });
    expect(screen.queryByLabelText("Switch workspace")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();

    const filesHeading = screen.getByRole("button", { name: "File Explorer" });
    const workspacesHeading = screen.getByRole("button", { name: "Workspace Explorer" });
    expect(
      filesHeading.compareDocumentPosition(workspacesHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(
      screen.getByRole("option", { name: /Workspace One/ }).getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.click(filesHeading);
    expect(filesHeading.getAttribute("aria-expanded")).toBe("false");
    expect(workspacesHeading.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByTestId("FileTree")).toBeNull();
    expect(screen.getByTestId("WorkspaceExplorer")).toBeDefined();

    fireEvent.click(filesHeading);
    fireEvent.click(workspacesHeading);
    expect(filesHeading.getAttribute("aria-expanded")).toBe("true");
    expect(workspacesHeading.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(workspacesHeading);

    fireEvent.click(screen.getByRole("option", { name: /Workspace Two/ }));

    await waitFor(() => {
      expect(testHarness.workspaceAdapter.switchWorkspace).toHaveBeenCalledWith("workspace-two");
      expect(
        screen.getByRole("option", { name: /Workspace Two/ }).getAttribute("aria-selected"),
      ).toBe("true");
      expect(screen.getByText("Workspace: Workspace Two")).toBeDefined();
    });
  });

  it("disables sidebar workspace actions while switching and surfaces refresh errors", async () => {
    let resolveSwitch!: () => void;
    const switchGate = new Promise<void>((resolve) => {
      resolveSwitch = resolve;
    });
    testHarness.workspaceAdapter.switchWorkspace.mockImplementationOnce(
      async (workspaceId: string) => {
        await switchGate;
        const workspace = testHarness.workspaceRegistry.workspaces.find(
          (candidate: any) => candidate.id === workspaceId,
        );
        testHarness.workspaceInfo = workspace;
        testHarness.workspaceRegistry = {
          ...testHarness.workspaceRegistry,
          currentWorkspaceId: workspaceId,
        };
        return workspace;
      },
    );

    const { App } = await import("../App");
    render(<App />);
    const workspaceTwo = await screen.findByRole("option", { name: /Workspace Two/ });

    fireEvent.click(workspaceTwo);
    await waitFor(() => {
      expect((workspaceTwo as HTMLButtonElement).disabled).toBe(true);
      expect(
        (screen.getByRole("button", { name: "Refresh Workspaces" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(screen.getByTestId("WorkspaceExplorer").getAttribute("aria-busy")).toBe("true");
    });

    resolveSwitch();
    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: /Workspace Two/ }).getAttribute("aria-selected"),
      ).toBe("true");
      expect(
        (screen.getByRole("button", { name: "Refresh Workspaces" }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    testHarness.workspaceAdapter.listWorkspaces.mockRejectedValueOnce(
      new Error("Workspace registry unavailable"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh Workspaces" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Workspace registry unavailable");
    });
    consoleError.mockRestore();
  });

  it("keeps Java out of generic bottom tabs and surfaces RefactorKit language discovery without inventing commands", async () => {
    const { App } = await import("../App");

    render(<App />);

    await waitFor(() => {
      expect(testHarness.refactorKitAdapter.getStatus).toHaveBeenCalled();
      expect(testHarness.refactorKitAdapter.getCapabilities).toHaveBeenCalled();
      expect(testHarness.languageSessionAdapter.getStatus).toHaveBeenCalled();
    });

    const refactorKitChecksBeforeSettings =
      testHarness.refactorKitAdapter.getStatus.mock.calls.length;
    const capabilityChecksBeforeSettings =
      testHarness.refactorKitAdapter.getCapabilities.mock.calls.length;
    const languageChecksBeforeSettings =
      testHarness.languageSessionAdapter.getStatus.mock.calls.length;
    expect(screen.queryByRole("tab", { name: "Java" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Terminal" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Java" }));

    await waitFor(() => {
      expect(testHarness.refactorKitAdapter.getStatus.mock.calls.length).toBeGreaterThan(
        refactorKitChecksBeforeSettings,
      );
      expect(testHarness.refactorKitAdapter.getCapabilities.mock.calls.length).toBeGreaterThan(
        capabilityChecksBeforeSettings,
      );
      expect(testHarness.languageSessionAdapter.getStatus.mock.calls.length).toBeGreaterThan(
        languageChecksBeforeSettings,
      );
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.available).toBe("true");
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageKernel).toBe("true");
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageIds).toBe(
        "java,javascript,typescript",
      );
      expect(screen.getByText("RefactorKit 1.2.3")).toBeDefined();
      expect(screen.getByTestId("RefactorKitDiscovery").textContent).toContain(
        "javascript: tree-sitter-jni-0.25.3",
      );
      expect(screen.getByTestId("RefactorKitDiscovery").textContent).toContain(
        "typescript: tree-sitter-jni-0.25.3",
      );
    });

    const checksBeforeRefresh = testHarness.refactorKitAdapter.getStatus.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh RefactorKit" }));
    await waitFor(() => {
      expect(testHarness.refactorKitAdapter.getStatus.mock.calls.length).toBeGreaterThan(
        checksBeforeRefresh,
      );
    });
    for (const operation of ["scan", "diagnostics", "symbols", "definition", "references"]) {
      expect(testHarness.refactorKitAdapter[operation]).not.toHaveBeenCalled();
    }
    expect(Object.keys(testHarness.refactorKitAdapter)).not.toEqual(
      expect.arrayContaining(["javascriptRename", "typescriptRename", "runLanguageOperation"]),
    );
  });

  it("wires the existing Language Tooling diagnostics affordance to current desktop authority", async () => {
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Java" }));
    await screen.findByTestId("RefactorKitDiscovery");

    const panel = screen.getByTestId("JavaIntelligencePanel");
    expect(panel.dataset.diagnosticsState).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Request diagnostics" }));

    await waitFor(() => expect(panel.dataset.diagnosticsState).toBe("refused"));
    expect(screen.getByTestId("LanguageToolingDiagnosticsMessage").textContent).toBe(
      "Compiler diagnostics require a current authorized TypeScript snapshot and qualified semantic session.",
    );
    expect(testHarness.refactorKitAdapter.diagnostics).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/TypeScript.*diagnostic/iu)).toBeNull();
  });

  it("preserves RefactorKit availability when capability discovery refresh fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { App } = await import("../App");
    render(<App />);
    await waitFor(() => expect(testHarness.refactorKitAdapter.getCapabilities).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Java" }));
    await screen.findByTestId("RefactorKitDiscovery");

    testHarness.refactorKitAdapter.getStatus.mockResolvedValueOnce({
      ...testHarness.refactorKitStatus,
      version: "1.2.4",
    });
    testHarness.refactorKitAdapter.getCapabilities.mockRejectedValueOnce(
      new Error("malformed capability metadata"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh RefactorKit" }));

    await waitFor(() => {
      expect(screen.getByText("RefactorKit 1.2.4")).toBeDefined();
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.available).toBe("true");
      expect(screen.getByRole("alert").textContent).toContain(
        "Unable to load RefactorKit capability discovery.",
      );
    });
    expect(screen.queryByTestId("RefactorKitDiscovery")).toBeNull();
    consoleError.mockRestore();
  });

  it("suppresses stale RefactorKit status and discovery refreshes across workspace generations", async () => {
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Java" }));
    await screen.findByTestId("RefactorKitDiscovery");

    const staleStatus = createDeferred<any>();
    const staleCapabilities = createDeferred<any>();
    const currentCapabilities = structuredClone(testHarness.externalJavaCapabilities);
    currentCapabilities.providerVersion = "0.6.0-SNAPSHOT";
    currentCapabilities.languageKernel.schema.adapters[1].backend = "tree-sitter-current";
    currentCapabilities.languageKernel.schema.adapters[2].backend = "tree-sitter-current";

    testHarness.refactorKitAdapter.getStatus
      .mockImplementationOnce(() => staleStatus.promise)
      .mockResolvedValueOnce({
        ...testHarness.refactorKitStatus,
        version: "2.0.0",
      });
    testHarness.refactorKitAdapter.getCapabilities
      .mockImplementationOnce(() => staleCapabilities.promise)
      .mockResolvedValueOnce(currentCapabilities);

    fireEvent.click(screen.getByRole("button", { name: "Refresh RefactorKit" }));
    await waitFor(() => expect(testHarness.refactorKitAdapter.getStatus).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("option", { name: "Workspace Two" }));

    await waitFor(() => {
      expect(screen.getByText("Workspace: Workspace Two")).toBeDefined();
      expect(screen.getByText("RefactorKit 2.0.0")).toBeDefined();
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageBackends).toContain(
        "tree-sitter-current",
      );
    });

    staleStatus.resolve({ ...testHarness.refactorKitStatus, version: "stale-9.9.9" });
    const staleDiscovery = structuredClone(testHarness.externalJavaCapabilities);
    staleDiscovery.languageKernel.schema.adapters[1].backend = "stale-backend";
    staleDiscovery.languageKernel.schema.adapters[2].backend = "stale-backend";
    staleCapabilities.resolve(staleDiscovery);
    await flushMicrotasks();

    expect(screen.queryByText("RefactorKit stale-9.9.9")).toBeNull();
    expect(screen.getByText("RefactorKit 2.0.0")).toBeDefined();
    expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageBackends).not.toContain(
      "stale-backend",
    );
  });

  it("loads the initial managed JDT LS status without claiming document sync", async () => {
    const { App } = await import("../App");

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Java" }));

    await waitFor(() => {
      expect(testHarness.languageSessionAdapter.getStatus).toHaveBeenCalledWith({
        workspaceId: "workspace-one",
      });
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageState).toBe("stopped");
    });
    expect(screen.getByTestId("JavaIntelligencePanel").dataset.documentSync).toBe("false");
    expect(screen.getByText("Document sync unavailable")).toBeDefined();
    expect(testHarness.languageSessionAdapter.subscribe).toHaveBeenCalledTimes(1);

    const checksBeforeRefresh = testHarness.languageSessionAdapter.getStatus.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh JDT LS" }));
    await waitFor(() => {
      expect(testHarness.languageSessionAdapter.getStatus.mock.calls.length).toBeGreaterThan(
        checksBeforeRefresh,
      );
    });
  });

  it("starts, stops, and restarts the managed JDT LS session", async () => {
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Java" }));
    await waitFor(() =>
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageState).toBe("stopped"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Start JDT LS" }));
    await waitFor(() => {
      expect(testHarness.languageSessionAdapter.start).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "workspace-one" }),
      );
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageState).toBe("ready");
    });

    fireEvent.click(screen.getByRole("button", { name: "Stop JDT LS" }));
    await waitFor(() => {
      expect(testHarness.languageSessionAdapter.stop).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "workspace-one", generation: 4 }),
      );
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageState).toBe("stopped");
    });

    fireEvent.click(screen.getByRole("button", { name: "Restart JDT LS" }));
    await waitFor(() => {
      expect(testHarness.languageSessionAdapter.restart).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "workspace-one", generation: 4 }),
      );
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageState).toBe("ready");
    });
    expect(testHarness.aiAgentAdapter.sendPrompt).not.toHaveBeenCalled();
  });

  it("applies current language-service events and suppresses stale generations", async () => {
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Java" }));
    await waitFor(() =>
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageGeneration).toBe("3"),
    );

    act(() => {
      testHarness.emitLanguageServiceEvent("workspace-one", {
        type: "status",
        status: { ...testHarness.languageServiceStatus, state: "ready", generation: 5 },
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageState).toBe("ready");
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageGeneration).toBe("5");
    });

    act(() => {
      testHarness.emitLanguageServiceEvent("workspace-one", {
        type: "status",
        status: { ...testHarness.languageServiceStatus, state: "failed", generation: 4 },
      });
    });
    expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageState).toBe("ready");
    expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageGeneration).toBe("5");
  });

  it("detaches and stops the old language session before loading switched workspace status", async () => {
    testHarness.languageServiceStatus = {
      ...testHarness.languageServiceStatus,
      state: "ready",
      generation: 9,
    };
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Java" }));
    await waitFor(() =>
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageState).toBe("ready"),
    );

    fireEvent.click(screen.getByRole("option", { name: /Workspace Two/ }));
    await waitFor(() => {
      expect(testHarness.languageSessionAdapter.stop).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "workspace-one", generation: 9 }),
      );
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageWorkspace).toBe(
        "workspace-two",
      );
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageState).toBe("stopped");
    });
    expect(testHarness.languageSessionAdapter.start).not.toHaveBeenCalled();
    expect(testHarness.languageSessionAdapter.subscribe).toHaveBeenCalledTimes(2);

    act(() => {
      testHarness.emitLanguageServiceEvent("workspace-one", {
        type: "status",
        status: {
          ...testHarness.languageServiceStatus,
          workspaceId: "workspace-one",
          state: "failed",
        },
      });
    });
    expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageWorkspace).toBe(
      "workspace-two",
    );
  });

  it("renders an unavailable managed JDT LS state separately from RefactorKit", async () => {
    testHarness.languageServiceStatus = {
      ...testHarness.languageServiceStatus,
      state: "unavailable",
      lastError: "JDT LS is not installed",
    };
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Java" }));

    await waitFor(() => {
      expect(screen.getByTestId("JavaIntelligencePanel").dataset.languageState).toBe("unavailable");
      expect(screen.getByRole("alert").textContent).toContain("JDT LS is not installed");
      expect(screen.getByText("RefactorKit 1.2.3")).toBeDefined();
    });
  });

  it("sends an AI Agent prompt through the desktop adapter and renders the response", async () => {
    testHarness.aiAgentSettings = {
      enabled: true,
      provider: "pi",
      preferredIntegration: "rpc",
      fallbackIntegrations: [],
    };
    testHarness.aiAgentStatus = {
      provider: "pi",
      enabled: true,
      available: true,
      availability: "available",
      preferredIntegration: "rpc",
      activeIntegration: "rpc",
      fallbackIntegrations: [],
      checkedAt: "2026-07-10T00:00:00.000Z",
    };
    testHarness.aiAgentPromptResponse = {
      text: "A mocked assistant answer",
      provider: "pi",
      integration: "rpc",
    };
    const { App } = await import("../App");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Pi Agent: available")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: "AI Agent" }));

    await waitFor(() => {
      expect(screen.getByTestId("AiAgentPanel").dataset.enabled).toBe("true");
      expect(screen.getByTestId("AiAgentPanel").dataset.available).toBe("true");
    });

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "Explain the active file" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(testHarness.aiAgentAdapter.sendPrompt).toHaveBeenCalledWith("Explain the active file");
      expect(screen.getAllByText("user: Explain the active file").length).toBeGreaterThan(0);
      expect(screen.getAllByText("assistant: A mocked assistant answer").length).toBeGreaterThan(0);
    });
  });

  it("loads AI Agent commands, inserts a skill command, and sends it", async () => {
    testHarness.aiAgentSettings = {
      enabled: true,
      provider: "pi",
      preferredIntegration: "rpc",
      fallbackIntegrations: [],
    };
    testHarness.aiAgentStatus = {
      provider: "pi",
      enabled: true,
      available: true,
      availability: "available",
      preferredIntegration: "rpc",
      activeIntegration: "rpc",
      fallbackIntegrations: [],
      checkedAt: "2026-07-10T00:00:00.000Z",
    };
    const { App } = await import("../App");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Pi Agent: available")).toBeDefined();
      expect(testHarness.aiAgentAdapter.listCommands).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("tab", { name: "AI Agent" }));

    await waitFor(() => {
      expect(screen.getByTestId("AiAgentPanel").dataset.commandCount).toBe("2");
      expect(screen.getByRole("button", { name: "Use /skill:multi-agent" })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Use /skill:multi-agent" }));
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe(
      "/skill:multi-agent ",
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(testHarness.aiAgentAdapter.sendPrompt).toHaveBeenCalledWith("/skill:multi-agent");
      expect(screen.getAllByText("user: /skill:multi-agent").length).toBeGreaterThan(0);
    });
  });

  it("opens the right AI Agent response panel while sending and renders plugin activity", async () => {
    testHarness.aiAgentSettings = {
      enabled: true,
      provider: "pi",
      preferredIntegration: "rpc",
      fallbackIntegrations: [],
    };
    testHarness.aiAgentStatus = {
      provider: "pi",
      enabled: true,
      available: true,
      availability: "available",
      preferredIntegration: "rpc",
      activeIntegration: "rpc",
      fallbackIntegrations: [],
      checkedAt: "2026-07-10T00:00:00.000Z",
    };

    let resolvePrompt!: (value: any) => void;
    const promptPromise = new Promise((resolve) => {
      resolvePrompt = resolve;
    });
    testHarness.aiAgentAdapter.sendPrompt.mockImplementationOnce(() => promptPromise);
    const { App } = await import("../App");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Pi Agent: available")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: "AI Agent" }));
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "Run diagnostics" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByTestId("RightSidebar")).toBeDefined();
      expect(screen.getByTestId("AiAgentResponsePanel").dataset.sending).toBe("true");
      expect(screen.getByText("Waiting")).toBeDefined();
    });

    await act(async () => {
      resolvePrompt({
        text: "Diagnostics completed",
        provider: "pi",
        integration: "rpc",
        metadata: {
          events: [
            null,
            "ignored",
            {
              type: "tool_execution_start",
              name: "bash",
              status: "started",
              preview: '{"command":"pnpm test"}',
            },
            { type: 42, name: "ignored" },
          ],
        },
      });
      await promptPromise;
    });

    await waitFor(() => {
      expect(screen.getByTestId("AiAgentResponsePanel").dataset.sending).toBe("false");
      expect(screen.getByTestId("AiAgentLatestResponse").textContent).toBe("Diagnostics completed");
      expect(screen.getByTestId("AiAgentActivities").textContent).toContain("bash");
      expect(screen.getByTestId("AiAgentActivities").textContent).toContain("tool_execution_start");
      expect(screen.getByTestId("AiAgentActivities").textContent).toContain("pnpm test");
      expect(screen.getByTestId("AiAgentResponsePanel").dataset.activityCount).toBe("1");
    });
  });

  it("opens Settings from the disabled AI Agent panel", async () => {
    const { App } = await import("../App");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Pi Agent: not-installed")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: "AI Agent" }));

    await waitFor(() => {
      expect(screen.getByTestId("AiAgentPanel").dataset.enabled).toBe("false");
      expect(screen.getByText("Pi Agent disabled")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeDefined();
      expect(screen.getByTestId("SettingsPanel").dataset.statusAvailability).toBe("not-installed");
    });
  });

  it("creates at the workspace root through FileTreeViewModel without flushSync warnings", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    testHarness.createFilePath = "backend/exact-created.ts";
    const { App } = await import("../App");
    render(<App />);

    await screen.findByText("Workspace: Workspace One");
    expect(screen.getByTestId("Editor").dataset.createFileTarget).toBe("Workspace root");
    fireEvent.click(screen.getByRole("button", { name: "Create test file" }));

    await waitFor(() => {
      expect(testHarness.fileTreeViewModel.createFile).toHaveBeenCalledWith("", "created.ts");
      expect(testHarness.editorViewModel.openFile).toHaveBeenCalledWith("backend/exact-created.ts");
      expect(screen.getByTestId("Editor").dataset.filePath).toBe("backend/exact-created.ts");
    });
    expect(testHarness.fileTreeAdapter.createFile).not.toHaveBeenCalled();
    expect(
      consoleError.mock.calls.some((call) =>
        call.some((value) => String(value).includes("flushSync was called")),
      ),
    ).toBe(false);
    consoleError.mockRestore();
  });

  it("creates in the selected directory and labels that exact target", async () => {
    testHarness.createFilePath = "src/server-created.ts";
    const { App } = await import("../App");
    render(<App />);

    await screen.findByText("Workspace: Workspace One");
    fireEvent.click(screen.getByTestId("directory-src"));
    expect(screen.getByTestId("Editor").dataset.createFileTarget).toBe("src");
    fireEvent.click(screen.getByRole("button", { name: "Create test file" }));

    await waitFor(() => {
      expect(testHarness.fileTreeViewModel.createFile).toHaveBeenCalledWith("src", "created.ts");
      expect(testHarness.editorViewModel.openFile).toHaveBeenCalledWith("src/server-created.ts");
    });
  });

  it("keeps the empty editor and surfaces create failures to the welcome form", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    testHarness.createFileError = new Error("File already exists");
    const { App } = await import("../App");
    render(<App />);

    await screen.findByText("Workspace: Workspace One");
    fireEvent.click(screen.getByRole("button", { name: "Create test file" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("File already exists");
      expect(screen.getByTestId("Editor").dataset.filePath).toBe("");
    });
    expect(testHarness.editorViewModel.openFile).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "[App] Empty-editor file creation failed",
      expect.objectContaining({ target: "<workspace-root>", errorType: "Error" }),
    );
    consoleError.mockRestore();
  });

  it("rejects empty-editor creation while a workspace switch is in progress", async () => {
    const switchDeferred = createDeferred<any>();
    testHarness.workspaceAdapter.switchWorkspace.mockReturnValueOnce(switchDeferred.promise);
    const { App } = await import("../App");
    render(<App />);

    const workspaceTwo = await screen.findByRole("option", { name: /Workspace Two/ });
    fireEvent.click(workspaceTwo);
    await waitFor(() => expect(testHarness.workspaceAdapter.switchWorkspace).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Create test file" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("workspace switch");
    });
    expect(testHarness.fileTreeViewModel.createFile).not.toHaveBeenCalled();

    const switchedWorkspace = testHarness.workspaceRegistry.workspaces[1];
    switchDeferred.resolve(switchedWorkspace);
    await waitFor(() => expect((workspaceTwo as HTMLButtonElement).disabled).toBe(false));
  });

  it("does not open a path returned after the workspace generation changes", async () => {
    const createDeferredResult = createDeferred<string>();
    testHarness.createFilePromise = createDeferredResult.promise;
    const { App } = await import("../App");
    render(<App />);

    await screen.findByText("Workspace: Workspace One");
    fireEvent.click(screen.getByRole("button", { name: "Create test file" }));
    await waitFor(() => expect(testHarness.fileTreeViewModel.createFile).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("option", { name: /Workspace Two/ }));
    await waitFor(() => expect(testHarness.workspaceAdapter.switchWorkspace).toHaveBeenCalled());
    createDeferredResult.resolve("old-workspace-created.ts");

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("workspace changed");
    });
    expect(testHarness.editorViewModel.openFile).not.toHaveBeenCalled();
  });

  it("commits the opening placeholder before starting the deferred native load", async () => {
    const deferred = createDeferred<void>();
    testHarness.openFilePromise = deferred.promise;
    const { App } = await import("../App");
    render(<App />);

    expect(screen.getByRole("heading", { name: "No document open" })).toBeDefined();
    fireEvent.click(screen.getByTestId("file-src-main"));

    expect(screen.queryByRole("heading", { name: "No document open" })).toBeNull();
    expect(screen.getByTestId("Editor").textContent).toContain("main.tsx");
    expect(screen.getByTestId("Editor").textContent).toContain("Opening editor");
    expect(screen.queryByTestId("monaco-editor")).toBeNull();
    expect(testHarness.editorViewModel.openFile).toHaveBeenCalledWith("src/main.tsx");
    expect(testHarness.openFileObservedEditorText).toContain("main.tsx");
    expect(testHarness.openFileObservedEditorText).toContain("Opening editor");
    expect(screen.getByTestId("Editor").textContent).toContain("Opening editor");

    deferred.resolve();
    await waitFor(() => {
      const editor = screen.getByTestId("Editor");
      expect(editor.dataset.filePath).toBe("src/main.tsx");
      expect(editor.dataset.content).toBe("content for src/main.tsx");
      expect(editor.dataset.isLoading).toBe("false");
      expect(screen.getByTestId("monaco-editor")).toBeDefined();
    });

    expect(testHarness.fileTreeState.selectedFilePath).toBe("src/main.tsx");
    expect(testHarness.editorViewModel.openFile).toHaveBeenCalledWith("src/main.tsx");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not invent an opening intent from file-tree selection alone", async () => {
    testHarness.fileTreeState.selectedFilePath = "src/main.tsx";
    const { App } = await import("../App");
    render(<App />);

    await screen.findByText("Workspace: Workspace One");
    expect(screen.getByRole("heading", { name: "No document open" })).toBeDefined();
    expect(screen.getByTestId("Editor").dataset.filePath).toBe("");
    expect(testHarness.editorViewModel.openFile).not.toHaveBeenCalled();
  });

  it("shows a sanitized diagnostic and keeps the empty placeholder when opening fails", async () => {
    const error = new Error("read_file denied at /private/workspace/secret.ts");
    testHarness.openFileError = error;
    const { App } = await import("../App");

    render(<App />);

    fireEvent.click(screen.getByTestId("file-src-main"));

    await waitFor(() => {
      const editor = screen.getByTestId("Editor");
      expect(editor.dataset.filePath).toBe("");
      expect(editor.dataset.content).toBe("");
      expect(screen.getByRole("alert").textContent).toContain("Unable to open this file.");
      expect(screen.getByRole("alert").textContent).not.toContain("/private/workspace");
      expect(screen.getByRole("heading", { name: "No document open" })).toBeDefined();
      expect(screen.queryByTestId("monaco-editor")).toBeNull();
    });

    expect(testHarness.fileTreeState.selectedFilePath).toBe("src/main.tsx");
    expect(testHarness.editorViewModel.openFile).toHaveBeenCalledWith("src/main.tsx");
  });

  it("returns to the empty placeholder when the adapter times out", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    testHarness.openFilePromise = new Promise<void>((_resolve, reject) => {
      setTimeout(() => reject(new Error("File read timed out")), 10_000);
    });
    const { App } = await import("../App");
    render(<App />);

    fireEvent.click(screen.getByTestId("file-src-main"));
    expect(screen.getByTestId("Editor").textContent).toContain("Opening editor");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.getByRole("alert").textContent).toContain("Unable to open this file.");
    expect(screen.getByRole("heading", { name: "No document open" })).toBeDefined();
    expect(screen.queryByTestId("monaco-editor")).toBeNull();
    consoleError.mockRestore();
  });

  it("opens and resolves even when requestAnimationFrame never fires", async () => {
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { App } = await import("../App");
    render(<App />);

    fireEvent.click(screen.getByTestId("file-src-main"));

    expect(testHarness.editorViewModel.openFile).toHaveBeenCalledWith("src/main.tsx");
    await waitFor(() => {
      expect(screen.getByTestId("Editor").dataset.content).toBe("content for src/main.tsx");
    });
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("activates an already-buffered target without waiting for a paint frame", async () => {
    testHarness.editorState.contents["src/main.tsx"] = "buffered content";
    const { App } = await import("../App");
    render(<App />);

    await screen.findByText("Workspace: Workspace One");
    fireEvent.click(screen.getByTestId("file-src-main"));
    expect(testHarness.editorViewModel.openFile).toHaveBeenCalledWith("src/main.tsx");
    await flushMicrotasks();
  });

  it("keeps only the newest opening intent and ignores stale completion", async () => {
    const openA = createDeferred<void>();
    const openB = createDeferred<void>();
    testHarness.openFilePromises["src/main.tsx"] = openA.promise;
    testHarness.openFilePromises["src/other.ts"] = openB.promise;
    const { App } = await import("../App");
    render(<App />);

    fireEvent.click(screen.getByTestId("file-src-main"));
    expect(screen.getByTestId("Editor").textContent).toContain("main.tsx");
    fireEvent.click(screen.getByTestId("file-src-other"));
    expect(screen.getByTestId("Editor").textContent).toContain("other.ts");
    expect(screen.getByTestId("Editor").dataset.filePath).toBe("src/other.ts");

    openB.resolve();
    await waitFor(() => {
      expect(screen.getByTestId("Editor").dataset.filePath).toBe("src/other.ts");
      expect(screen.getByTestId("Editor").dataset.content).toBe("content for src/other.ts");
      expect(screen.getByTestId("monaco-editor")).toBeDefined();
    });
    expect(screen.queryByRole("alert")).toBeNull();

    openA.resolve();
    await act(async () => Promise.resolve());
    expect(screen.getByTestId("Editor").dataset.filePath).toBe("src/other.ts");
    expect(screen.getByTestId("Editor").dataset.content).toBe("content for src/other.ts");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not enable Java synchronization or semantics for an opening path without a buffer", async () => {
    const deferred = createDeferred<void>();
    testHarness.openFilePromises["src/Main.java"] = deferred.promise;
    testHarness.languageServiceStatus = {
      ...testHarness.languageServiceStatus,
      state: "ready",
      capabilities: {
        ...testHarness.languageServiceStatus.capabilities,
        documentSync: true,
        completion: true,
        hover: true,
        signature: true,
      },
    };
    const { App } = await import("../App");
    render(<App />);
    await act(async () => Promise.resolve());

    fireEvent.click(screen.getByTestId("file-src-main-java"));
    expect(screen.getByTestId("Editor").textContent).toContain("Main.java");
    expect(screen.getByTestId("Editor").dataset.hasJavaSemantics).toBe("false");
    expect(testHarness.languageSessionAdapter.didOpen).not.toHaveBeenCalled();

    deferred.resolve();
    await waitFor(() => expect(testHarness.languageSessionAdapter.didOpen).toHaveBeenCalledOnce());
    expect(screen.getByTestId("Editor").dataset.filePath).toBe("src/Main.java");
  });

  it("accepts the provider's canonical active path without a duplicate App diagnostic", async () => {
    testHarness.openFileActiveFilePath = "src/other.ts";
    const { App } = await import("../App");

    render(<App />);

    fireEvent.click(screen.getByTestId("file-src-main"));

    await waitFor(() => {
      const editor = screen.getByTestId("Editor");
      expect(editor.dataset.filePath).toBe("src/other.ts");
      expect(editor.dataset.content).toBe("content for src/other.ts");
      expect(screen.queryByRole("alert")).toBeNull();
    });

    expect(testHarness.fileTreeState.selectedFilePath).toBe("src/main.tsx");
    expect(testHarness.editorViewModel.openFile).toHaveBeenCalledWith("src/main.tsx");
  });

  it("starts and synchronizes Java only, coalescing changes with sent monotonic versions", async () => {
    vi.useFakeTimers();
    testHarness.languageServiceStatus.capabilities = {
      ...testHarness.languageServiceStatus.capabilities,
      documentSync: true,
      diagnostics: true,
    };
    const { App } = await import("../App");
    render(<App />);

    await act(async () => Promise.resolve());
    expect(testHarness.languageSessionAdapter.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("file-src-main"));
    await act(async () => Promise.resolve());
    expect(testHarness.languageSessionAdapter.start).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("file-src-main-java"));
    await flushMicrotasks();
    expect(testHarness.languageSessionAdapter.start).toHaveBeenCalledTimes(1);
    expect(testHarness.languageSessionAdapter.didOpen).toHaveBeenCalledTimes(1);
    expect(testHarness.languageSessionAdapter.didOpen.mock.calls[0][0].document).toEqual(
      expect.objectContaining({ path: "src/Main.java", version: 1, languageId: "java" }),
    );

    fireEvent.click(screen.getByText("Edit active file"));
    fireEvent.click(screen.getByText("Edit active file"));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(testHarness.languageSessionAdapter.didChange).toHaveBeenCalledTimes(1);
    expect(testHarness.languageSessionAdapter.didChange.mock.calls[0][0].document.version).toBe(3);

    fireEvent.click(screen.getByTestId("file-src-main-java"));
    await act(async () => Promise.resolve());
    expect(testHarness.languageSessionAdapter.didOpen).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("exposes guarded Java semantics and flushes the optimistic version before delegation", async () => {
    vi.useFakeTimers();
    testHarness.languageServiceStatus = {
      ...testHarness.languageServiceStatus,
      state: "ready",
      capabilities: {
        ...testHarness.languageServiceStatus.capabilities,
        documentSync: true,
        completion: true,
        hover: true,
        signature: true,
      },
    };
    const failure = (request: any) =>
      Promise.resolve({
        ok: false,
        requestId: request.requestId,
        error: { kind: "provider-error" },
      });
    testHarness.javaIntelligenceAdapter.completion.mockImplementation(failure);
    testHarness.javaIntelligenceAdapter.hover.mockImplementation(failure);
    testHarness.javaIntelligenceAdapter.signatureHelp.mockImplementation(failure);

    const { App } = await import("../App");
    render(<App />);
    expect(screen.getByTestId("Editor").dataset.hasJavaSemantics).toBe("false");

    fireEvent.click(screen.getByTestId("file-src-main-java"));
    await flushMicrotasks();
    expect(screen.getByTestId("Editor").dataset.hasJavaSemantics).toBe("true");
    expect(screen.getByTestId("Editor").dataset.javaPath).toBe("src/Main.java");
    expect(screen.getByTestId("Editor").dataset.javaVersion).toBe("1");

    fireEvent.click(screen.getByText("Edit active file"));
    const semantics = testHarness.latestJavaSemantics;
    expect(semantics.context.document.version).toBe(2);
    const request = {
      ...semantics.context,
      document: { ...semantics.context.document },
      position: { line: 4, character: 7 },
      requestId: "completion-request",
      cancellationId: "completion-cancel",
      trigger: { kind: "invoked" },
      source: "must-not-cross-boundary",
    };
    await act(async () => {
      await semantics.completion(request);
    });
    expect(testHarness.languageSessionAdapter.didChange).toHaveBeenCalledBefore(
      testHarness.javaIntelligenceAdapter.completion,
    );
    expect(testHarness.languageSessionAdapter.didChange.mock.calls[0][0].document.version).toBe(2);
    expect(testHarness.javaIntelligenceAdapter.completion.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        position: { line: 4, character: 7 },
        document: expect.objectContaining({ version: 2 }),
      }),
    );
    expect(testHarness.javaIntelligenceAdapter.completion.mock.calls[0][0]).not.toHaveProperty(
      "source",
    );

    await semantics.hover({
      ...request,
      requestId: "hover-request",
      cancellationId: "hover-cancel",
    });
    await semantics.signatureHelp({
      ...request,
      requestId: "signature-request",
      cancellationId: "signature-cancel",
    });
    await semantics.cancel("exact-cancellation-id");
    expect(testHarness.javaIntelligenceAdapter.hover).toHaveBeenCalledOnce();
    expect(testHarness.javaIntelligenceAdapter.signatureHelp).toHaveBeenCalledOnce();
    expect(testHarness.javaIntelligenceAdapter.cancel).toHaveBeenCalledWith(
      "exact-cancellation-id",
    );
  });

  it("flushes Java changes on save, closes cleanly, and never logs source text on sync failure", async () => {
    vi.useFakeTimers();
    testHarness.languageServiceStatus.capabilities = {
      ...testHarness.languageServiceStatus.capabilities,
      documentSync: true,
      diagnostics: true,
    };
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByTestId("file-src-main-java"));
    await flushMicrotasks();
    expect(testHarness.languageSessionAdapter.didOpen).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByText("Edit active file"));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await act(async () => Promise.resolve());
    expect(testHarness.languageSessionAdapter.didChange).toHaveBeenCalledTimes(1);
    expect(testHarness.languageSessionAdapter.didSave).toHaveBeenCalledTimes(1);
    expect(testHarness.languageSessionAdapter.didSave.mock.calls[0][0].document.version).toBe(2);

    const secret = "SECRET_JAVA_SOURCE_MUST_NOT_LEAK";
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    testHarness.languageSessionAdapter.didChange.mockRejectedValueOnce(new Error(secret));
    fireEvent.click(screen.getByText("Edit active file"));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(warning).toHaveBeenCalledWith("[App] Java document change synchronization failed", {
      path: "src/Main.java",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(testHarness.aiAgentSessionMessages)).not.toContain(secret);
    warning.mockRestore();

    fireEvent.click(screen.getByText("Close active file"));
    await act(async () => Promise.resolve());
    expect(testHarness.languageSessionAdapter.didClose).toHaveBeenCalledWith({
      document: expect.objectContaining({ path: "src/Main.java", version: 3 }),
    });
  });

  it("closes synchronized Java documents before restart and workspace switch", async () => {
    testHarness.languageServiceStatus = {
      ...testHarness.languageServiceStatus,
      state: "ready",
      capabilities: {
        ...testHarness.languageServiceStatus.capabilities,
        documentSync: true,
        diagnostics: true,
      },
    };
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByTestId("file-src-main-java"));
    await waitFor(() =>
      expect(testHarness.languageSessionAdapter.didOpen).toHaveBeenCalledTimes(1),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Java" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart JDT LS" }));
    await waitFor(() => expect(testHarness.languageSessionAdapter.restart).toHaveBeenCalled());
    expect(testHarness.languageSessionAdapter.didClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("file-src-main"));
    await waitFor(() => expect(screen.getByTestId("Editor").dataset.filePath).toBe("src/main.tsx"));
    fireEvent.click(screen.getByTestId("file-src-main-java"));
    await waitFor(() =>
      expect(testHarness.languageSessionAdapter.didOpen).toHaveBeenCalledTimes(2),
    );
    fireEvent.click(screen.getByRole("option", { name: /Workspace Two/ }));
    await waitFor(() =>
      expect(testHarness.workspaceAdapter.switchWorkspace).toHaveBeenCalledWith("workspace-two"),
    );
    expect(testHarness.languageSessionAdapter.didClose).toHaveBeenCalledTimes(2);
  });

  it("closes a didOpen that finishes after unmount without accepting late diagnostics", async () => {
    testHarness.languageServiceStatus = {
      ...testHarness.languageServiceStatus,
      state: "ready",
      capabilities: {
        ...testHarness.languageServiceStatus.capabilities,
        documentSync: true,
        diagnostics: true,
      },
    };
    const didOpen = createDeferred<void>();
    testHarness.languageSessionAdapter.didOpen.mockReturnValueOnce(didOpen.promise);
    const { App } = await import("../App");
    const { unmount } = render(<App />);

    fireEvent.click(screen.getByTestId("file-src-main-java"));
    await waitFor(() =>
      expect(testHarness.languageSessionAdapter.didOpen).toHaveBeenCalledTimes(1),
    );
    unmount();
    await act(async () => didOpen.resolve());

    expect(testHarness.languageSessionAdapter.didClose).toHaveBeenCalledTimes(1);
    expect(testHarness.languageSessionAdapter.didClose).toHaveBeenCalledWith({
      document: expect.objectContaining({ workspaceId: "workspace-one", path: "src/Main.java" }),
    });
  });

  it("best-effort closes a didOpen that finishes while restart is pending", async () => {
    testHarness.languageServiceStatus = {
      ...testHarness.languageServiceStatus,
      state: "ready",
      capabilities: {
        ...testHarness.languageServiceStatus.capabilities,
        documentSync: true,
        diagnostics: true,
      },
    };
    const didOpen = createDeferred<void>();
    const restart = createDeferred<any>();
    testHarness.languageSessionAdapter.didOpen.mockReturnValueOnce(didOpen.promise);
    testHarness.languageSessionAdapter.restart.mockReturnValueOnce(restart.promise);
    const { App } = await import("../App");
    render(<App />);

    fireEvent.click(screen.getByTestId("file-src-main-java"));
    await waitFor(() =>
      expect(testHarness.languageSessionAdapter.didOpen).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Java" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart JDT LS" }));
    await waitFor(() =>
      expect(testHarness.languageSessionAdapter.restart).toHaveBeenCalledTimes(1),
    );

    await act(async () => didOpen.resolve());
    expect(testHarness.languageSessionAdapter.didClose).toHaveBeenCalledTimes(1);
    act(() =>
      testHarness.emitLanguageServiceEvent("workspace-one", {
        type: "diagnostics",
        workspaceId: "workspace-one",
        generation: 3,
        provider: "jdt-ls",
        document: {
          workspaceId: "workspace-one",
          path: "src/Main.java",
          uri: "file:///workspace/one/src/Main.java",
          version: 1,
        },
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: "error",
            message: "stale diagnostic",
          },
        ],
      }),
    );
    expect(screen.getByTestId("Editor").dataset.diagnosticsCount).toBe("0");

    const restarted = { ...testHarness.languageServiceStatus, state: "ready", generation: 4 };
    testHarness.languageServiceStatus = restarted;
    await act(async () => restart.resolve(restarted));
  });

  it("does not let a pending old-workspace start open or block the same path after switching", async () => {
    testHarness.languageServiceStatus = {
      ...testHarness.languageServiceStatus,
      state: "stopped",
      capabilities: {
        ...testHarness.languageServiceStatus.capabilities,
        documentSync: true,
        diagnostics: true,
      },
    };
    const start = createDeferred<any>();
    testHarness.languageSessionAdapter.start.mockReturnValueOnce(start.promise);
    const { App } = await import("../App");
    render(<App />);

    fireEvent.click(screen.getByTestId("file-src-main-java"));
    await waitFor(() => expect(testHarness.languageSessionAdapter.start).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("option", { name: /Workspace Two/ }));
    await waitFor(() =>
      expect(testHarness.workspaceAdapter.switchWorkspace).toHaveBeenCalledWith("workspace-two"),
    );

    await act(async () =>
      start.resolve({
        ...testHarness.languageServiceStatus,
        workspaceId: "workspace-one",
        state: "ready",
        generation: 4,
      }),
    );
    await waitFor(() =>
      expect(testHarness.languageSessionAdapter.didOpen).toHaveBeenCalledTimes(1),
    );
    expect(testHarness.languageSessionAdapter.didOpen.mock.calls[0][0].document).toEqual(
      expect.objectContaining({ workspaceId: "workspace-two", path: "src/Main.java" }),
    );
    expect(
      testHarness.languageSessionAdapter.didOpen.mock.calls.some(
        ([request]: any[]) => request.document.workspaceId === "workspace-one",
      ),
    ).toBe(false);
  });

  it("rejects stale diagnostics, accepts clears, and navigates Problems with one-based reveal", async () => {
    testHarness.languageServiceStatus = {
      ...testHarness.languageServiceStatus,
      state: "ready",
      capabilities: {
        ...testHarness.languageServiceStatus.capabilities,
        documentSync: true,
        diagnostics: true,
      },
    };
    const { App } = await import("../App");
    render(<App />);
    fireEvent.click(screen.getByTestId("file-src-main-java"));
    await waitFor(() => expect(testHarness.languageSessionAdapter.didOpen).toHaveBeenCalled());

    const diagnostic = {
      range: { start: { line: 2, character: 4 }, end: { line: 2, character: 8 } },
      severity: "error",
      message: "Java syntax problem",
    };
    act(() =>
      testHarness.emitLanguageServiceEvent("workspace-one", {
        type: "diagnostics",
        workspaceId: "workspace-one",
        generation: testHarness.languageServiceStatus.generation,
        provider: "jdt-ls",
        document: {
          workspaceId: "workspace-one",
          path: "src/Main.java",
          uri: "file:///workspace/one/src/Main.java",
          version: 2,
        },
        diagnostics: [diagnostic],
      }),
    );
    expect(screen.getByTestId("Editor").dataset.diagnosticsCount).toBe("1");
    const problemsTab = screen.getByRole("tab", { name: /Problems/ });
    expect(problemsTab.dataset.badgeCount).toBe("1");
    expect(problemsTab.dataset.badgeSeverity).toBe("error");
    expect(problemsTab.dataset.scope).toBe("project");
    fireEvent.click(problemsTab);
    fireEvent.click(screen.getByText("Java syntax problem"));
    await waitFor(() => {
      expect(screen.getByTestId("Editor").dataset.revealLine).toBe("3");
      expect(screen.getByTestId("Editor").dataset.revealColumn).toBe("5");
    });

    act(() =>
      testHarness.emitLanguageServiceEvent("workspace-one", {
        type: "diagnostics",
        workspaceId: "workspace-one",
        generation: testHarness.languageServiceStatus.generation,
        provider: "jdt-ls",
        document: {
          workspaceId: "workspace-one",
          path: "src/Main.java",
          uri: "file:///workspace/one/src/Main.java",
          version: 1,
        },
        diagnostics: [],
      }),
    );
    expect(screen.getByTestId("Editor").dataset.diagnosticsCount).toBe("1");
    act(() =>
      testHarness.emitLanguageServiceEvent("workspace-one", {
        type: "diagnostics",
        workspaceId: "workspace-one",
        generation: testHarness.languageServiceStatus.generation,
        provider: "jdt-ls",
        document: {
          workspaceId: "workspace-one",
          path: "src/Main.java",
          uri: "file:///workspace/one/src/Main.java",
          version: 3,
        },
        diagnostics: [],
      }),
    );
    expect(screen.getByTestId("Editor").dataset.diagnosticsCount).toBe("0");
    expect(screen.getByRole("tab", { name: /Problems/ }).dataset.badgeCount).toBe("0");

    fireEvent.click(screen.getByTestId("file-src-main"));
    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: /Problems/ })).toBeNull();
      expect(screen.getByRole("tab", { name: "Terminal" }).getAttribute("aria-selected")).toBe(
        "true",
      );
    });
  });

  it("reopens a user-selected file after delayed session restore clobbers the active file", async () => {
    const deferredRestore = testHarness.createDeferredRestore();
    testHarness.restoreSessionClearsActiveFile = true;
    const { App } = await import("../App");

    render(<App />);

    fireEvent.click(screen.getByTestId("file-src-main"));

    await waitFor(() => {
      expect(testHarness.editorViewModel.openFile).toHaveBeenCalledTimes(1);
      expect(testHarness.editorViewModel.openFile).toHaveBeenLastCalledWith("src/main.tsx");
    });

    await act(async () => {
      deferredRestore.resolve();
      await deferredRestore.promise;
    });

    await waitFor(() => {
      expect(testHarness.editorViewModel.openFile).toHaveBeenCalledTimes(2);
      expect(testHarness.editorViewModel.openFile).toHaveBeenLastCalledWith("src/main.tsx");
    });
  });
});
