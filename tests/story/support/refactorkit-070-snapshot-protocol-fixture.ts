import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  act,
  fireEvent,
  render,
  renderHook,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import { createTauriAdapters } from "../../../apps/desktop/src/adapters/index.js";
import {
  useRefactorKitStatusController,
  type RefactorKitStatusController,
} from "../../../apps/desktop/src/features/refactorkit-status/useRefactorKitStatusController.js";
import { BrowserRefactorKitAdapter } from "../../../packages/browser-adapters/src/refactorkit-browser.js";
import {
  normalizeProviderPoint,
  type EditorPoint,
  type RefactorKitStatus,
  type SavedSnapshotDefinitionRequest,
  type SavedSnapshotDefinitionResult,
  type SavedSnapshotSemanticSessionStartRequest,
  type SavedSnapshotSemanticSessionStartResult,
  type SavedSnapshotSemanticSessionStopRequest,
  type SavedSnapshotSemanticSessionStopResult,
  type SavedSnapshotSymbolSearchRequest,
  type SavedSnapshotSymbolSearchResult,
  type SavedSnapshotWorkspaceSymbol,
  type TypeScriptJavaScriptLanguageId,
  type WorkspaceInfo,
} from "../../../packages/contracts/src/index.js";
import type { RefactorKitCapabilities } from "../../../packages/contracts/src/refactorkit.js";
import type { RefactorKitPort } from "../../../packages/web-core/src/ports/refactorkit-port.js";

interface StoryDom {
  readonly window: Window & typeof globalThis;
}

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  readonly JSDOM: new (html: string, options: { url: string }) => StoryDom;
};

const QUALIFIED_RUNTIME = {
  executionMode: "external-process",
  supportsTimeout: true,
  supportsCancellation: true,
  usesWorkspaceOverlay: true,
  recordsProcessProvenance: true,
  limits: {
    requestTimeoutMillis: 10_000,
    maxInputBytes: 8 * 1024 * 1024,
    maxOutputBytes: 64 * 1024 * 1024,
    maxProcesses: 8,
  },
} as const;

const LANGUAGE_VOCABULARY = {
  stability: ["stable", "experimental", "structural", "refused", "not-applicable"],
  evidence: ["compiler", "language-server", "native-ast", "structural-parse", "lexical", "none"],
  mutationAuthority: ["managed-stable", "proposal-only", "none"],
  executionMode: ["in-process", "external-process"],
} as const;

const DIAGNOSTICS_CAPABILITY = {
  operation: "diagnostics",
  stability: "experimental",
  evidence: "compiler",
  mutationAuthority: "none",
  backend: "typescript-lsp-explicit-v1",
  runtime: QUALIFIED_RUNTIME,
} as const;

const DEFINITION_CAPABILITY = {
  ...DIAGNOSTICS_CAPABILITY,
  operation: "definition",
  evidence: "language-server",
} as const;

const WORKSPACE_SYMBOLS_CAPABILITY = {
  ...DEFINITION_CAPABILITY,
  operation: "workspaceSymbols",
} as const;

function advertisedScriptAdapter(languageId: "javascript" | "typescript") {
  const extensions = languageId === "typescript" ? ["ts", "tsx"] : ["js", "jsx"];
  return {
    languageId,
    extensions,
    backend: "tree-sitter-jni-0.25.3+typescript-lsp-explicit-v1",
    runtime: QUALIFIED_RUNTIME,
    capabilities: [
      { ...DEFINITION_CAPABILITY, extensions },
      { ...DIAGNOSTICS_CAPABILITY, extensions },
      { ...WORKSPACE_SYMBOLS_CAPABILITY, extensions },
    ],
  };
}

const REFACTORKIT_070_SNAPSHOT_ADVERTISEMENT = {
  api: "refactorkit",
  apiVersion: "0.2",
  provider: "refactorkit",
  providerVersion: "0.7.0-SNAPSHOT",
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
      adapters: [advertisedScriptAdapter("javascript"), advertisedScriptAdapter("typescript")],
      vocabulary: LANGUAGE_VOCABULARY,
    },
  },
  safety: {
    previewBeforeApply: true,
    snapshotValidation: true,
    transactionRollback: true,
    workspaceScopedWrites: true,
  },
} as const;

const READY_REFACTORKIT_070_SNAPSHOT_STATUS = {
  available: true,
  path: "/opt/refactorkit/refactorkit",
  version: "0.7.0-SNAPSHOT",
  checkedAt: "2026-07-14T00:00:00.000Z",
} as const;

const AUTHORITY = {
  workspaceId: "workspace:authorized",
  workspaceGeneration: 1,
  sessionId: `refactorkit-semantic-session-v1:${"a".repeat(64)}`,
  snapshotIdentity: `sha256:${"b".repeat(64)}`,
  semanticLease: `semantic-${"c".repeat(36)}`,
} as const;

const APPROVED_TOOLCHAIN = {
  nodeExecutable: "/opt/refactorkit-toolchains/node/bin/node",
  languageServerPackageRoot: "/opt/refactorkit-toolchains/typescript-language-server",
  typeScriptPackageRoot: "/opt/refactorkit-toolchains/typescript",
  allowPathNodeDiscovery: false,
  allowWorkspaceLocalToolchain: false,
} as const;

const PARTICIPATING_BUFFERS = [
  {
    path: "src/service.ts",
    languageId: "typescript",
    savedContentHash: "sha256:saved-service-source",
    bufferContentHash: "sha256:saved-service-source",
    saved: true,
  },
  {
    path: "src/runtime.js",
    languageId: "javascript",
    savedContentHash: "sha256:saved-runtime-source",
    bufferContentHash: "sha256:saved-runtime-source",
    saved: true,
  },
] as const;

const OPAQUE_SYMBOL_ID = `lsp-symbol-v1:${"c".repeat(64)}`;

const SEMANTIC_SESSION_START_REQUEST = {
  languageId: "typescript",
  workspaceRoot: "/workspace/authorized",
  workspaceId: AUTHORITY.workspaceId,
  workspaceGeneration: AUTHORITY.workspaceGeneration,
  provider: "refactorkit",
  providerVersion: "0.7.0-SNAPSHOT",
  backend: "typescript-lsp-explicit-v1",
  runtime: QUALIFIED_RUNTIME,
  extensions: ["ts", "tsx"],
  toolchain: APPROVED_TOOLCHAIN,
  acceptedSemanticCompleteness: ["full-typescript"],
} as const satisfies SavedSnapshotSemanticSessionStartRequest;

const SEMANTIC_SESSION_START_RESULT = {
  languageId: "typescript",
  workspaceRoot: SEMANTIC_SESSION_START_REQUEST.workspaceRoot,
  workspaceId: AUTHORITY.workspaceId,
  workspaceGeneration: AUTHORITY.workspaceGeneration,
  sessionId: AUTHORITY.sessionId,
  providerProjectSnapshotIdentity: AUTHORITY.snapshotIdentity,
  semanticLease: AUTHORITY.semanticLease,
  startSnapshotHash: AUTHORITY.snapshotIdentity,
  provider: "refactorkit",
  providerVersion: "0.7.0-SNAPSHOT",
  backend: "typescript-lsp-explicit-v1",
  toolchain: {
    backend: "typescript-lsp-explicit-v1",
    runtime: QUALIFIED_RUNTIME,
    extensions: ["ts", "tsx"],
    nodeExecutable: APPROVED_TOOLCHAIN.nodeExecutable,
    languageServerPackageRoot: APPROVED_TOOLCHAIN.languageServerPackageRoot,
    typeScriptPackageRoot: APPROVED_TOOLCHAIN.typeScriptPackageRoot,
  },
  semanticCompleteness: "full-typescript",
  processProvenance: {
    serverName: "typescript-language-server",
    serverVersion: "5.1.3",
    capabilitiesSha256: "d".repeat(64),
    executableSha256: "e".repeat(64),
    argumentsSha256: "f".repeat(64),
    processId: 42,
  },
} as const satisfies SavedSnapshotSemanticSessionStartResult;

const SYMBOL_SEARCH_REQUEST = {
  languageId: "typescript",
  query: "Service",
  ...AUTHORITY,
  providerVersion: "0.7.0-SNAPSHOT",
  backend: "typescript-lsp-explicit-v1",
  toolchain: APPROVED_TOOLCHAIN,
} as const satisfies SavedSnapshotSymbolSearchRequest;

const SYMBOL_SEARCH_RESULT = {
  languageId: "typescript",
  query: "Service",
  workspaceId: AUTHORITY.workspaceId,
  workspaceGeneration: AUTHORITY.workspaceGeneration,
  sessionId: AUTHORITY.sessionId,
  snapshotIdentity: AUTHORITY.snapshotIdentity,
  providerVersion: "0.7.0-SNAPSHOT",
  backend: "typescript-lsp-explicit-v1",
  completeness: {
    resultCompleteness: "unknown",
    truncation: "unknown",
    semanticCompleteness: "full-typescript",
    experimentalDisclosure: "shown",
  },
  symbols: [{ id: OPAQUE_SYMBOL_ID, name: "Service", kind: "CLASS" }],
} as const satisfies SavedSnapshotSymbolSearchResult;

const DEFINITION_REQUEST = {
  languageId: "typescript",
  symbolId: OPAQUE_SYMBOL_ID,
  ...AUTHORITY,
  providerVersion: "0.7.0-SNAPSHOT",
  backend: "typescript-lsp-explicit-v1",
} as const satisfies SavedSnapshotDefinitionRequest;

const DEFINITION_RESULT = {
  languageId: "typescript",
  workspaceId: AUTHORITY.workspaceId,
  workspaceGeneration: AUTHORITY.workspaceGeneration,
  sessionId: AUTHORITY.sessionId,
  snapshotIdentity: AUTHORITY.snapshotIdentity,
  providerVersion: "0.7.0-SNAPSHOT",
  backend: "typescript-lsp-explicit-v1",
  selectedSymbol: SYMBOL_SEARCH_RESULT.symbols[0],
  file: "src/service.ts",
  point: { line: 2, character: 13 },
} as const satisfies SavedSnapshotDefinitionResult;

const SEMANTIC_SESSION_STOP_REQUEST = {
  languageId: "typescript",
  workspaceId: AUTHORITY.workspaceId,
  workspaceGeneration: AUTHORITY.workspaceGeneration,
  sessionId: AUTHORITY.sessionId,
} as const satisfies SavedSnapshotSemanticSessionStopRequest;

const SEMANTIC_SESSION_STOP_RESULT = {
  ...SEMANTIC_SESSION_STOP_REQUEST,
  stopped: true,
} as const satisfies SavedSnapshotSemanticSessionStopResult;

interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface RefactorKitStatusControllerHarness {
  readonly result: { readonly current: RefactorKitStatusController };
  unmount(): void;
}

interface SemanticNavigationEditorBuffer {
  readonly path: string;
  readonly languageId?: TypeScriptJavaScriptLanguageId;
  readonly savedState: "saved" | "never-saved";
  readonly dirty: boolean;
}

interface SemanticNavigationWorkspaceContext {
  generation: number;
  workspaceId: string | null;
  isSwitching: boolean;
  isMetadataLoading: boolean;
}

interface StorySemanticSymbolResult {
  readonly opaqueSymbolId: string;
  readonly name: string;
  readonly kind: string;
}

interface RefactorKitSymbolNavigationController {
  readonly language: TypeScriptJavaScriptLanguageId;
  readonly query: string;
  readonly toolchainPaths: {
    readonly nodeExecutable: string;
    readonly languageServerPackageRoot: string;
    readonly typeScriptPackageRoot: string;
  };
  readonly approvedForSession: boolean;
  readonly snapshotState: "saved" | "dirty" | "never-saved";
  readonly evidenceState: "accepted" | "checking" | "unavailable";
  readonly availability: "available" | "unavailable" | "browser-unavailable";
  readonly availabilityReason: string | null;
  readonly results: readonly StorySemanticSymbolResult[];
  readonly resultLimit: number;
  readonly isBusy: boolean;
  readonly canSubmit: boolean;
  readonly error: string | null;
  readonly refusal: string | null;
  readonly hasActiveSession: boolean;
  setLanguage(language: TypeScriptJavaScriptLanguageId): void;
  setQuery(query: string): void;
  setToolchainPath(
    field: "nodeExecutable" | "languageServerPackageRoot" | "typeScriptPackageRoot",
    value: string,
  ): void;
  setApprovedForSession(approved: boolean): void;
  submit(): Promise<void>;
  selectResult(result: StorySemanticSymbolResult): Promise<void>;
  cancel(): void;
  stop(): Promise<void>;
}

interface UseRefactorKitSymbolNavigationControllerDependencies {
  readonly refactorKit: RefactorKitPort;
  readonly status: RefactorKitStatus | null;
  readonly capabilities: RefactorKitCapabilities | null;
  readonly isCheckingCapabilities: boolean;
  readonly workspaceInfo: WorkspaceInfo | null;
  readonly workspaceGeneration: number;
  getWorkspaceContext(): SemanticNavigationWorkspaceContext;
  getRelevantBuffers(): readonly SemanticNavigationEditorBuffer[];
  navigateToPoint(filePath: string, point: EditorPoint): Promise<void>;
}

type UseRefactorKitSymbolNavigationController = (
  dependencies: UseRefactorKitSymbolNavigationControllerDependencies,
) => RefactorKitSymbolNavigationController;

type StoryComponent = unknown;
type StoryReactNode = Parameters<typeof render>[0];

const storyReact = createRequire(import.meta.url)("react") as {
  createElement(
    type: StoryComponent,
    props: Record<string, unknown> | null,
    ...children: StoryReactNode[]
  ): StoryReactNode;
};
const { createElement } = storyReact;

interface RefactorKitSymbolNavigationControllerHarness {
  readonly result: { readonly current: RefactorKitSymbolNavigationController };
  unmount(): void;
}

interface FixtureInvocation {
  readonly command: string;
  readonly args?: Record<string, unknown>;
}

/**
 * Deterministic desktop harness for the published RefactorKit 0.7.0-SNAPSHOT protocol slice.
 * It enters through the desktop adapter composition and the application-owned status
 * controller, while the Tauri seam retains the authoritative backend advertisement.
 */
export class RefactorKit070SnapshotProtocolFixture {
  readonly #adapter: RefactorKitPort;
  readonly #invocations: FixtureInvocation[] = [];
  readonly #globalDescriptors = new Map<string, PropertyDescriptor | undefined>();
  readonly #dom: StoryDom;
  readonly #statusController: RefactorKitStatusControllerHarness;
  readonly #workspaceContext: SemanticNavigationWorkspaceContext = {
    generation: AUTHORITY.workspaceGeneration,
    workspaceId: AUTHORITY.workspaceId,
    isSwitching: false,
    isMetadataLoading: false,
  };
  readonly #navigations: Array<{
    readonly filePath: string;
    readonly point: { readonly lineNumber: number; readonly column: number };
  }> = [];
  #participatingBuffers: SemanticNavigationEditorBuffer[] = PARTICIPATING_BUFFERS.map(
    ({ path, languageId }) => ({ path, languageId, savedState: "saved", dirty: false }),
  );
  #useSymbolNavigationController?: UseRefactorKitSymbolNavigationController;
  #semanticSymbolSearchPanel?: StoryComponent;
  #symbolNavigationHarness?: RefactorKitSymbolNavigationControllerHarness;
  #symbolNavigationSurface?: RenderResult;
  #capabilities?: RefactorKitCapabilities;
  #semanticSession?: SavedSnapshotSemanticSessionStartResult;
  #symbolSearch?: SavedSnapshotSymbolSearchResult;
  #selectedSymbol?: Readonly<SavedSnapshotWorkspaceSymbol>;
  #definition?: SavedSnapshotDefinitionResult;
  #semanticStop?: SavedSnapshotSemanticSessionStopResult;
  #searchSurfaceTextBeforeSelection = "";
  #nativeSemanticSessionActive = false;
  #nativeSearchAvailable = false;
  #buffersMatchSavedFiles = false;
  #toolchainApproved = false;
  #searchRequested = false;
  #selectionRequested = false;
  #disposed = false;

  constructor() {
    this.#dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://desktop.story.invalid",
    });
    for (const [name, value] of [
      ["window", this.#dom.window],
      ["document", this.#dom.window.document],
      ["navigator", this.#dom.window.navigator],
      ["React", storyReact],
    ] as const) {
      this.#globalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }

    const internals: TauriInternals = {
      invoke: async (command, args) => {
        this.#invocations.push(args === undefined ? { command } : { command, args });
        if (command === "get_refactorkit_status") {
          return structuredClone(READY_REFACTORKIT_070_SNAPSHOT_STATUS);
        }
        if (command === "get_refactorkit_capabilities") {
          return structuredClone(REFACTORKIT_070_SNAPSHOT_ADVERTISEMENT);
        }
        if (command === "start_refactorkit_saved_snapshot_semantic_session") {
          assert.equal(
            this.#nativeSemanticSessionActive,
            false,
            "The fixture received a second semantic-session start without a stop",
          );
          assert.deepEqual(args, { request: SEMANTIC_SESSION_START_REQUEST });
          this.#nativeSemanticSessionActive = true;
          this.#nativeSearchAvailable = false;
          this.#semanticSession = structuredClone(SEMANTIC_SESSION_START_RESULT);
          return structuredClone(SEMANTIC_SESSION_START_RESULT);
        }
        if (command === "search_refactorkit_saved_snapshot_symbols") {
          assert.equal(
            this.#nativeSemanticSessionActive,
            true,
            "The fixture received symbol search without an active semantic session",
          );
          assert.deepEqual(args, { request: SYMBOL_SEARCH_REQUEST });
          this.#nativeSearchAvailable = true;
          this.#symbolSearch = structuredClone(SYMBOL_SEARCH_RESULT);
          return structuredClone(SYMBOL_SEARCH_RESULT);
        }
        if (command === "resolve_refactorkit_saved_snapshot_definition") {
          assert.equal(
            this.#nativeSemanticSessionActive && this.#nativeSearchAvailable,
            true,
            "The fixture received definition lookup without the current saved-snapshot search",
          );
          assert.deepEqual(args, { request: DEFINITION_REQUEST });
          this.#definition = structuredClone(DEFINITION_RESULT);
          return structuredClone(DEFINITION_RESULT);
        }
        if (command === "stop_refactorkit_saved_snapshot_semantic_session") {
          assert.equal(
            this.#nativeSemanticSessionActive,
            true,
            "The fixture received semantic-session stop without an active session",
          );
          assert.deepEqual(args, { request: SEMANTIC_SESSION_STOP_REQUEST });
          this.#nativeSemanticSessionActive = false;
          this.#nativeSearchAvailable = false;
          this.#semanticStop = structuredClone(SEMANTIC_SESSION_STOP_RESULT);
          return structuredClone(SEMANTIC_SESSION_STOP_RESULT);
        }
        throw new Error(
          `The RefactorKit 0.7.0-SNAPSHOT fixture does not implement Tauri command ${command}`,
        );
      },
    };
    Object.defineProperty(this.#dom.window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: internals,
    });

    this.#adapter = createTauriAdapters().refactorKitAdapter;
    this.#statusController = renderHook(() =>
      useRefactorKitStatusController({
        refactorKit: this.#adapter,
        deferWorkspaceActivation: true,
      }),
    );
  }

  async discoverCapabilities(): Promise<void> {
    await act(async () => {
      await this.#statusController.result.current.workspaceCollaborator.load(1);
    });
    assert.equal(this.#statusController.result.current.isChecking, false);
    this.#capabilities = this.#statusController.result.current.capabilities ?? undefined;
  }

  confirmParticipatingBuffersMatchSavedFiles(): void {
    assert.ok(PARTICIPATING_BUFFERS.every(({ saved }) => saved));
    assert.ok(
      PARTICIPATING_BUFFERS.every(
        ({ bufferContentHash, savedContentHash }) => bufferContentHash === savedContentHash,
      ),
    );
    this.#buffersMatchSavedFiles = true;
  }

  async discoverSymbolNavigationCapabilities(): Promise<void> {
    await this.discoverCapabilities();
    const capabilities = this.#requireCapabilities();
    assert.equal(capabilities.providerVersion, "0.7.0-SNAPSHOT");
    assert.equal(capabilities.languageKernel?.available, true);
    if (!capabilities.languageKernel?.available) return;

    for (const adapter of capabilities.languageKernel.schema.adapters) {
      for (const operation of ["workspaceSymbols", "definition"] as const) {
        const observed = adapter.capabilities.find(
          (capability) => capability.operation === operation,
        );
        const advertised = REFACTORKIT_070_SNAPSHOT_ADVERTISEMENT.languageKernel.schema.adapters
          .find(({ languageId }) => languageId === adapter.languageId)
          ?.capabilities.find((capability) => capability.operation === operation);
        assert.deepEqual(
          observed,
          advertised,
          `The IDE did not retain the experimental language-server ${operation} capability for ${adapter.languageId}`,
        );
      }
    }

    const controllerModulePath =
      "../../../apps/desktop/src/features/refactorkit-symbol-navigation/useRefactorKitSymbolNavigationController.js";
    const panelModulePath =
      "../../../packages/ui/src/components/SemanticSymbolSearchPanel/SemanticSymbolSearchPanel.js";
    const controllerModule = (await import(controllerModulePath)) as {
      useRefactorKitSymbolNavigationController: UseRefactorKitSymbolNavigationController;
    };
    const panelModule = (await import(panelModulePath)) as {
      SemanticSymbolSearchPanel: StoryComponent;
    };
    this.#useSymbolNavigationController = controllerModule.useRefactorKitSymbolNavigationController;
    this.#semanticSymbolSearchPanel = panelModule.SemanticSymbolSearchPanel;

    const dependencies = this.#symbolNavigationDependencies(
      () => this.#participatingBuffers,
      async (filePath, point) => {
        this.#navigations.push({ filePath, point: { ...point } });
      },
    );
    this.#symbolNavigationHarness = renderHook(() =>
      this.#useSymbolNavigationController!(dependencies),
    );
    this.#symbolNavigationSurface = render(this.#symbolSurfaceElement());
    assert.equal(this.#symbolNavigation().availability, "available");
    assert.equal(this.#symbolNavigation().evidenceState, "accepted");
    assert.equal(this.#symbolNavigation().snapshotState, "saved");
  }

  approveExplicitExternalToolchain(): void {
    for (const path of [
      APPROVED_TOOLCHAIN.nodeExecutable,
      APPROVED_TOOLCHAIN.languageServerPackageRoot,
      APPROVED_TOOLCHAIN.typeScriptPackageRoot,
    ]) {
      assert.ok(path.startsWith("/opt/refactorkit-toolchains/"));
      assert.equal(path.startsWith("/workspace/authorized/"), false);
    }

    const surface = this.#symbolSurface();
    for (const label of [
      "External Node executable path",
      "External typescript-language-server package path",
      "External TypeScript package path",
    ]) {
      assert.ok(surface.getByLabelText(label));
    }
    assert.ok(
      surface.getByRole("checkbox", {
        name: "Approve these external toolchain paths for this session",
      }),
    );
    act(() => {
      const controller = this.#symbolNavigation();
      controller.setToolchainPath("nodeExecutable", APPROVED_TOOLCHAIN.nodeExecutable);
      controller.setToolchainPath(
        "languageServerPackageRoot",
        APPROVED_TOOLCHAIN.languageServerPackageRoot,
      );
      controller.setToolchainPath(
        "typeScriptPackageRoot",
        APPROVED_TOOLCHAIN.typeScriptPackageRoot,
      );
      controller.setApprovedForSession(true);
    });
    this.#rerenderSymbolSurface();

    assert.deepEqual(this.#symbolNavigation().toolchainPaths, {
      nodeExecutable: APPROVED_TOOLCHAIN.nodeExecutable,
      languageServerPackageRoot: APPROVED_TOOLCHAIN.languageServerPackageRoot,
      typeScriptPackageRoot: APPROVED_TOOLCHAIN.typeScriptPackageRoot,
    });
    assert.equal(this.#symbolNavigation().approvedForSession, true);
    assert.match(
      surface.getByText(/PATH discovery and workspace-local toolchain discovery are disabled/u)
        .textContent ?? "",
      /does not persist paths/u,
    );
    this.#toolchainApproved = true;
  }

  async searchWorkspaceSymbol(): Promise<void> {
    assert.equal(this.#buffersMatchSavedFiles, true);
    assert.equal(this.#toolchainApproved, true);
    this.#requireSemanticCapability("workspaceSymbols");
    this.#requireSemanticCapability("definition");

    const surface = this.#symbolSurface();
    assert.ok(surface.getByRole("textbox", { name: "Symbol query" }));
    act(() => this.#symbolNavigation().setQuery(SYMBOL_SEARCH_REQUEST.query));
    await waitFor(() => assert.equal(this.#symbolNavigation().canSubmit, true));
    this.#rerenderSymbolSurface();
    fireEvent.submit(surface.getByRole("form", { name: "Workspace symbol search" }));
    await waitFor(() =>
      assert.deepEqual(this.#symbolNavigation().results, [
        { opaqueSymbolId: OPAQUE_SYMBOL_ID, name: "Service", kind: "CLASS" },
      ]),
    );
    this.#rerenderSymbolSurface();

    assert.deepEqual(this.#semanticSession, SEMANTIC_SESSION_START_RESULT);
    assert.deepEqual(this.#semanticSessionStartInvocation().args, {
      request: SEMANTIC_SESSION_START_REQUEST,
    });
    assert.deepEqual(this.#symbolSearch, SYMBOL_SEARCH_RESULT);
    assert.deepEqual(this.#symbolSearchInvocation().args, { request: SYMBOL_SEARCH_REQUEST });
    this.#searchRequested = true;
  }

  async selectSemanticSearchResult(): Promise<void> {
    assert.equal(this.#searchRequested, true);
    const selectedSymbol = this.#symbolSearch?.symbols[0];
    assert.ok(selectedSymbol, "The workspace-symbol request returned no semantic result");
    this.#selectedSymbol = selectedSymbol;
    this.#searchSurfaceTextBeforeSelection = this.#symbolSurface().container.textContent ?? "";

    fireEvent.click(
      this.#symbolSurface().getByRole("button", {
        name: "Resolve definition for Service, CLASS",
      }),
    );
    await waitFor(() => assert.equal(this.#navigations.length, 1));
    this.#selectionRequested = true;
  }

  async assertSemanticDefinitionOpenedAtProviderPoint(): Promise<void> {
    assert.equal(this.#selectionRequested, true);
    assert.deepEqual(this.#selectedSymbol, SYMBOL_SEARCH_RESULT.symbols[0]);
    assert.deepEqual(this.#definition, DEFINITION_RESULT);
    assert.deepEqual(this.#semanticDefinitionInvocation().args, { request: DEFINITION_REQUEST });

    const editorPoint = normalizeProviderPoint(DEFINITION_RESULT.point);
    assert.deepEqual(editorPoint, {
      kind: "ready",
      point: { lineNumber: 3, column: 14 },
    });
    assert.deepEqual(this.#navigations, [
      { filePath: DEFINITION_RESULT.file, point: { lineNumber: 3, column: 14 } },
    ]);

    await act(() => this.#symbolNavigation().stop());
    assert.deepEqual(this.#semanticStop, SEMANTIC_SESSION_STOP_RESULT);
    assert.deepEqual(this.#semanticSessionStopInvocation().args, {
      request: SEMANTIC_SESSION_STOP_REQUEST,
    });
    assert.equal(this.#symbolNavigation().hasActiveSession, false);
  }

  assertSymbolNavigationAuthorityCorrelated(): void {
    const search = this.#symbolSearch;
    const definition = this.#definition;
    for (const field of [
      "workspaceId",
      "workspaceGeneration",
      "sessionId",
      "snapshotIdentity",
    ] as const) {
      assert.equal(search?.[field], AUTHORITY[field]);
      assert.equal(definition?.[field], AUTHORITY[field]);
    }
    assert.equal(
      this.#semanticSession?.providerProjectSnapshotIdentity,
      AUTHORITY.snapshotIdentity,
    );
    assert.equal(this.#semanticStop?.stopped, true);
  }

  assertOpaqueSymbolIdentityIsTransient(): void {
    const symbol = this.#selectedSemanticSymbol();
    assert.match(symbol.id, /^lsp-symbol-v1:[a-f0-9]{64}$/);
    assert.deepEqual(this.#semanticDefinitionInvocation().args, {
      request: { ...DEFINITION_REQUEST, symbolId: symbol.id },
    });
    assert.equal(this.#dom.window.localStorage.length, 0);
    assert.equal(this.#searchSurfaceTextBeforeSelection.includes(symbol.id), false);
    assert.equal(this.#dom.window.document.body.textContent?.includes(symbol.id), false);
    assert.equal(
      this.#symbolSurface().queryByLabelText(/opaque|symbol id/iu),
      null,
      "The Search surface exposed an input for a provider-owned opaque symbol identity",
    );
  }

  async assertUnsafeBuffersRefused(): Promise<void> {
    const invocationsBeforeRefusals = this.#invocations.length;
    for (const probe of [
      {
        buffer: {
          path: "src/dirty.ts",
          languageId: "typescript",
          savedState: "saved",
          dirty: true,
        } as const,
        state: "dirty" as const,
        refusal: "Semantic search is refused while a participating buffer is dirty.",
      },
      {
        buffer: {
          path: "src/new.ts",
          languageId: "typescript",
          savedState: "never-saved",
          dirty: false,
        } as const,
        state: "never-saved" as const,
        refusal: "Semantic search is refused while a participating buffer has never been saved.",
      },
    ]) {
      const harness = renderHook(() =>
        this.#useSymbolNavigationController!(
          this.#symbolNavigationDependencies(
            () => [probe.buffer],
            async () => undefined,
          ),
        ),
      );
      await this.#configureApprovedController(harness);
      assert.equal(harness.result.current.snapshotState, probe.state);
      assert.equal(harness.result.current.canSubmit, false);
      await act(() => harness.result.current.submit());
      assert.equal(harness.result.current.refusal, probe.refusal);
      assert.equal(harness.result.current.results.length, 0);
      harness.unmount();
    }
    assert.equal(
      this.#invocations.length,
      invocationsBeforeRefusals,
      "Unsafe buffers reached the native semantic-session boundary",
    );

    const staleContext = { ...this.#workspaceContext };
    const staleHarness = renderHook(() =>
      this.#useSymbolNavigationController!({
        ...this.#symbolNavigationDependencies(
          () => [
            {
              path: "src/service.ts",
              languageId: "typescript",
              savedState: "saved",
              dirty: false,
            },
          ],
          async () => assert.fail("A stale selection reached document navigation"),
        ),
        getWorkspaceContext: () => ({ ...staleContext }),
      }),
    );
    await this.#configureApprovedController(staleHarness);
    await act(() => staleHarness.result.current.submit());
    assert.equal(staleHarness.result.current.results.length, 1);
    const definitionsBeforeStaleSelection = this.#invocations.filter(
      ({ command }) => command === "resolve_refactorkit_saved_snapshot_definition",
    ).length;
    staleContext.generation += 1;
    await act(() =>
      staleHarness.result.current.selectResult(staleHarness.result.current.results[0]!),
    );
    assert.equal(
      staleHarness.result.current.refusal,
      "The selected result is stale. Run the search again.",
    );
    assert.equal(
      this.#invocations.filter(
        ({ command }) => command === "resolve_refactorkit_saved_snapshot_definition",
      ).length,
      definitionsBeforeStaleSelection,
    );
    staleContext.generation = AUTHORITY.workspaceGeneration;
    await act(() => staleHarness.result.current.stop());
    assert.equal(staleHarness.result.current.hasActiveSession, false);
    staleHarness.unmount();
  }

  assertSearchCompatibilityDisclosure(): void {
    assert.deepEqual(this.#symbolSearch?.completeness, SYMBOL_SEARCH_RESULT.completeness);
    assert.ok(
      this.#symbolSurface().getByText(
        /JavaScript results may be incomplete for dynamic or mixed JavaScript/u,
      ),
    );
  }

  assertOnlyApprovedExternalToolchainEligible(): void {
    const startRequest = this.#semanticSessionStartInvocation().args?.request as
      { readonly toolchain?: unknown } | undefined;
    const searchRequest = this.#symbolSearchInvocation().args?.request as
      { readonly toolchain?: unknown } | undefined;
    assert.deepEqual(startRequest?.toolchain, APPROVED_TOOLCHAIN);
    assert.deepEqual(searchRequest?.toolchain, APPROVED_TOOLCHAIN);
    assert.equal(APPROVED_TOOLCHAIN.allowPathNodeDiscovery, false);
    assert.equal(APPROVED_TOOLCHAIN.allowWorkspaceLocalToolchain, false);
    assert.equal(
      this.#invocations.some(({ command }) =>
        /discover|resolve.*toolchain|search.*path/iu.test(command),
      ),
      false,
    );
  }

  assertNoStructuralIdentifierFallback(): void {
    this.#requireSemanticCapability("workspaceSymbols");
    this.#requireSemanticCapability("definition");
    assert.equal(
      this.#invocations.some(
        ({ command }) =>
          command === "run_refactorkit_symbols" || command === "run_refactorkit_definition",
      ),
      false,
    );
  }

  assertReadOnlySymbolNavigation(): void {
    const semanticCommands = this.#invocations
      .map(({ command }) => command)
      .filter((command) => command.includes("saved_snapshot"));
    assert.deepEqual(semanticCommands, [
      "start_refactorkit_saved_snapshot_semantic_session",
      "search_refactorkit_saved_snapshot_symbols",
      "resolve_refactorkit_saved_snapshot_definition",
      "stop_refactorkit_saved_snapshot_semantic_session",
      "start_refactorkit_saved_snapshot_semantic_session",
      "search_refactorkit_saved_snapshot_symbols",
      "stop_refactorkit_saved_snapshot_semantic_session",
    ]);
    assert.equal(
      this.#invocations.some(({ command }) => /(?:apply|write|script|terminal)/i.test(command)),
      false,
    );
  }

  assertNoScriptSpecificPanel(): void {
    const searchActivity = this.#symbolSurface().getByRole("region", { name: "Search activity" });
    assert.ok(searchActivity);
    assert.equal(
      this.#symbolSurface().getByRole("heading", { name: "Workspace Symbols" }).textContent,
      "Workspace Symbols",
    );
    assert.equal(
      this.#symbolSurface().queryByRole("region", {
        name: /TypeScript|JavaScript/iu,
      }),
      null,
    );
    const panelCommands = this.#invocations.filter(({ command }) =>
      /(typescript|javascript).*(panel|surface)|(panel|surface).*(typescript|javascript)/i.test(
        command,
      ),
    );
    assert.deepEqual(panelCommands, []);
  }

  assertNoProjectActionInGlobalSettings(): void {
    assert.equal(this.#symbolSurface().queryByRole("button", { name: /Settings/iu }), null);
    assert.equal(this.#symbolSurface().queryByRole("link", { name: /Settings/iu }), null);
    const settingsCommands = this.#invocations.filter(({ command }) =>
      /settings.*(typescript|javascript|refactorkit)/i.test(command),
    );
    assert.deepEqual(settingsCommands, []);
  }

  async assertUnsimmulatedBrowserUnavailable(): Promise<void> {
    const browser = new BrowserRefactorKitAdapter();
    const capabilities = await browser.getCapabilities();
    assert.deepEqual(capabilities.languageKernel, {
      available: false,
      schema: null,
      reason: "Local RefactorKit daemon access is desktop-only and unavailable in browser clients.",
    });
    for (const operation of [
      () => browser.startSavedSnapshotSemanticSession(SEMANTIC_SESSION_START_REQUEST),
      () => browser.searchSavedSnapshotSymbols(SYMBOL_SEARCH_REQUEST),
      () => browser.resolveSavedSnapshotDefinition(DEFINITION_REQUEST),
      () => browser.stopSavedSnapshotSemanticSession(SEMANTIC_SESSION_STOP_REQUEST),
    ]) {
      await assert.rejects(operation(), { code: "BROWSER_REFACTORKIT_UNAVAILABLE" });
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#symbolNavigationHarness) {
      await act(() => this.#symbolNavigationHarness!.result.current.stop());
    }
    this.#symbolNavigationSurface?.unmount();
    this.#symbolNavigationHarness?.unmount();
    this.#symbolNavigationSurface = undefined;
    this.#symbolNavigationHarness = undefined;
    this.#useSymbolNavigationController = undefined;
    this.#semanticSymbolSearchPanel = undefined;
    assert.equal(this.#nativeSemanticSessionActive, false);
    this.#statusController.unmount();
    this.#dom.window.close();
    for (const [name, descriptor] of [...this.#globalDescriptors].reverse()) {
      this.#restoreProperty(name, descriptor);
    }
  }

  #symbolNavigationDependencies(
    getRelevantBuffers: () => readonly SemanticNavigationEditorBuffer[],
    navigateToPoint: UseRefactorKitSymbolNavigationControllerDependencies["navigateToPoint"],
  ): UseRefactorKitSymbolNavigationControllerDependencies {
    return {
      refactorKit: this.#adapter,
      status: this.#statusController.result.current.status,
      capabilities: this.#requireCapabilities(),
      isCheckingCapabilities: false,
      workspaceInfo: {
        id: AUTHORITY.workspaceId,
        name: "Authorized Story Workspace",
        rootPath: SEMANTIC_SESSION_START_REQUEST.workspaceRoot,
      },
      workspaceGeneration: AUTHORITY.workspaceGeneration,
      getWorkspaceContext: () => ({ ...this.#workspaceContext }),
      getRelevantBuffers: () => getRelevantBuffers().map((buffer) => ({ ...buffer })),
      navigateToPoint,
    };
  }

  async #configureApprovedController(
    harness: RefactorKitSymbolNavigationControllerHarness,
  ): Promise<void> {
    act(() => {
      harness.result.current.setToolchainPath("nodeExecutable", APPROVED_TOOLCHAIN.nodeExecutable);
      harness.result.current.setToolchainPath(
        "languageServerPackageRoot",
        APPROVED_TOOLCHAIN.languageServerPackageRoot,
      );
      harness.result.current.setToolchainPath(
        "typeScriptPackageRoot",
        APPROVED_TOOLCHAIN.typeScriptPackageRoot,
      );
      harness.result.current.setQuery(SYMBOL_SEARCH_REQUEST.query);
      harness.result.current.setApprovedForSession(true);
    });
    await act(async () => Promise.resolve());
  }

  #symbolNavigation(): RefactorKitSymbolNavigationController {
    assert.ok(
      this.#symbolNavigationHarness,
      "The desktop semantic symbol-navigation controller has not been composed",
    );
    return this.#symbolNavigationHarness.result.current;
  }

  #symbolSurfaceElement(): StoryReactNode {
    assert.ok(
      this.#semanticSymbolSearchPanel,
      "The generic semantic symbol Search panel has not been loaded",
    );
    const controller = this.#symbolNavigation();
    return createElement(
      "section",
      { "aria-label": "Search activity" },
      createElement(this.#semanticSymbolSearchPanel, {
        language: controller.language,
        query: controller.query,
        toolchainPaths: controller.toolchainPaths,
        approvedForSession: controller.approvedForSession,
        snapshotState: controller.snapshotState,
        evidenceState: controller.evidenceState,
        availability: controller.availability,
        availabilityReason: controller.availabilityReason,
        results: controller.results,
        resultLimit: controller.resultLimit,
        isBusy: controller.isBusy,
        canSubmit: controller.canSubmit,
        error: controller.error,
        refusal: controller.refusal,
        onLanguageChange: controller.setLanguage,
        onQueryChange: controller.setQuery,
        onToolchainPathChange: controller.setToolchainPath,
        onApprovalChange: controller.setApprovedForSession,
        onSubmit: controller.submit,
        onCancel: controller.cancel,
        onStop: controller.stop,
        onResultSelect: controller.selectResult,
      }),
    );
  }

  #rerenderSymbolSurface(): void {
    this.#symbolSurface().rerender(this.#symbolSurfaceElement());
  }

  #symbolSurface(): RenderResult {
    assert.ok(
      this.#symbolNavigationSurface,
      "The generic Search surface has not been composed for semantic symbol navigation",
    );
    return this.#symbolNavigationSurface;
  }

  #requireCapabilities() {
    assert.ok(this.#capabilities, "RefactorKit capabilities were not discovered");
    return this.#capabilities;
  }

  #semanticSessionStartInvocation(): FixtureInvocation {
    const invocation = this.#invocations.find(
      ({ command }) => command === "start_refactorkit_saved_snapshot_semantic_session",
    );
    assert.ok(
      invocation,
      "The IDE did not invoke its saved-snapshot semantic-session start boundary",
    );
    return invocation;
  }

  #symbolSearchInvocation(): FixtureInvocation {
    const invocation = this.#invocations.find(
      ({ command }) => command === "search_refactorkit_saved_snapshot_symbols",
    );
    assert.ok(invocation, "The IDE did not invoke its saved-snapshot workspace-symbol boundary");
    return invocation;
  }

  #semanticDefinitionInvocation(): FixtureInvocation {
    const invocation = this.#invocations.find(
      ({ command }) => command === "resolve_refactorkit_saved_snapshot_definition",
    );
    assert.ok(invocation, "The IDE did not invoke its saved-snapshot definition boundary");
    return invocation;
  }

  #semanticSessionStopInvocation(): FixtureInvocation {
    const invocation = this.#invocations.find(
      ({ command }) => command === "stop_refactorkit_saved_snapshot_semantic_session",
    );
    assert.ok(
      invocation,
      "The IDE did not invoke its saved-snapshot semantic-session stop boundary",
    );
    return invocation;
  }

  #requireSemanticCapability(operation: "definition" | "workspaceSymbols"): void {
    const capabilities = this.#requireCapabilities();
    assert.equal(capabilities.languageKernel?.available, true);
    if (!capabilities.languageKernel?.available) return;
    const capability = capabilities.languageKernel.schema.adapters
      .find(({ languageId }) => languageId === "typescript")
      ?.capabilities.find((candidate) => candidate.operation === operation);
    assert.deepEqual(capability, {
      ...(operation === "definition" ? DEFINITION_CAPABILITY : WORKSPACE_SYMBOLS_CAPABILITY),
      extensions: ["ts", "tsx"],
    });
  }

  #selectedSemanticSymbol(): Readonly<SavedSnapshotWorkspaceSymbol> {
    assert.ok(this.#selectedSymbol, "No semantic workspace symbol has been selected");
    return this.#selectedSymbol;
  }

  #restoreProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
}
