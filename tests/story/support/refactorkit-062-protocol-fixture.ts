import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { act, renderHook } from "@testing-library/react";

import { createTauriAdapters } from "../../../apps/desktop/src/adapters/index.js";
import {
  useRefactorKitStatusController,
  type RefactorKitStatusController,
} from "../../../apps/desktop/src/features/refactorkit-status/useRefactorKitStatusController.js";
import { BrowserRefactorKitAdapter } from "../../../packages/browser-adapters/src/refactorkit-browser.js";
import {
  normalizeProviderPoint,
  type SavedSnapshotDefinitionRequest,
  type SavedSnapshotDefinitionResult,
  type SavedSnapshotSemanticSessionStartRequest,
  type SavedSnapshotSemanticSessionStartResult,
  type SavedSnapshotSemanticSessionStopRequest,
  type SavedSnapshotSemanticSessionStopResult,
  type SavedSnapshotSymbolSearchRequest,
  type SavedSnapshotSymbolSearchResult,
  type SavedSnapshotWorkspaceSymbol,
} from "../../../packages/contracts/src/index.js";
import type {
  RefactorKitCapabilities,
  RefactorKitCommandResult,
  RefactorKitLanguageAdapter,
  RefactorKitLanguageCapability,
} from "../../../packages/contracts/src/refactorkit.js";
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

const REFACTORKIT_062_ADVERTISEMENT = {
  api: "refactorkit",
  apiVersion: "0.2",
  provider: "refactorkit",
  providerVersion: "0.6.2",
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

const READY_REFACTORKIT_STATUS = {
  available: true,
  path: "/opt/refactorkit/refactorkit",
  version: "0.6.2",
  checkedAt: "2026-07-14T00:00:00.000Z",
} as const;

const AUTHORITY = {
  workspaceId: "workspace:authorized",
  workspaceGeneration: 1,
  sessionId: `refactorkit-semantic-session-v1:${"a".repeat(64)}`,
  snapshotIdentity: `sha256:${"b".repeat(64)}`,
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
  providerVersion: "0.6.2",
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
  provider: "refactorkit",
  providerVersion: "0.6.2",
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
  providerVersion: "0.6.2",
  backend: "typescript-lsp-explicit-v1",
  toolchain: APPROVED_TOOLCHAIN,
} as const satisfies SavedSnapshotSymbolSearchRequest;

const SYMBOL_SEARCH_RESULT = {
  languageId: "typescript",
  query: "Service",
  ...AUTHORITY,
  providerVersion: "0.6.2",
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
  providerVersion: "0.6.2",
  backend: "typescript-lsp-explicit-v1",
} as const satisfies SavedSnapshotDefinitionRequest;

const DEFINITION_RESULT = {
  languageId: "typescript",
  ...AUTHORITY,
  providerVersion: "0.6.2",
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

const LEGACY_DIAGNOSTICS_RESULT = {
  stdout:
    '[{"severity":"ERROR","message":"Type \\"string\\" is not assignable to type \\"number\\".","code":"TS2322","file":"src/broken.ts","line":1}]',
  stderr: "",
  locations: [],
  success: true,
  code: 0,
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  command: {
    executable: "/opt/refactorkit/refactorkit",
    args: ["diagnostics", "/workspace/authorized"],
    cwd: "/workspace/authorized",
    workspaceRoot: "/workspace/authorized",
    timeoutMs: 60_000,
    outputLimitBytes: 512 * 1024,
  },
} as const;

interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface RefactorKitStatusControllerHarness {
  readonly result: { readonly current: RefactorKitStatusController };
  unmount(): void;
}

interface FixtureInvocation {
  readonly command: string;
  readonly args?: Record<string, unknown>;
}

interface StructuredDiagnosticsResult {
  readonly diagnostics?: unknown;
  readonly workspaceId?: unknown;
  readonly workspaceGeneration?: unknown;
  readonly sessionId?: unknown;
  readonly snapshotHash?: unknown;
  readonly providerVersion?: unknown;
  readonly toolchain?: unknown;
  readonly fallback?: unknown;
}

/**
 * Deterministic desktop harness for the published RefactorKit 0.6.2 protocol slice.
 * It enters through the desktop adapter composition and the application-owned status
 * controller, while the Tauri seam retains the authoritative backend advertisement.
 */
export class RefactorKit062ProtocolFixture {
  readonly #adapter: RefactorKitPort;
  readonly #invocations: FixtureInvocation[] = [];
  readonly #globalDescriptors = new Map<string, PropertyDescriptor | undefined>();
  readonly #dom: StoryDom;
  readonly #statusController: RefactorKitStatusControllerHarness;
  #capabilities?: RefactorKitCapabilities;
  #diagnostics?: RefactorKitCommandResult;
  #semanticSession?: SavedSnapshotSemanticSessionStartResult;
  #symbolSearch?: SavedSnapshotSymbolSearchResult;
  #selectedSymbol?: Readonly<SavedSnapshotWorkspaceSymbol>;
  #definition?: SavedSnapshotDefinitionResult;
  #semanticStop?: SavedSnapshotSemanticSessionStopResult;
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
    ] as const) {
      this.#globalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }

    const internals: TauriInternals = {
      invoke: async (command, args) => {
        this.#invocations.push(args === undefined ? { command } : { command, args });
        if (command === "get_refactorkit_status") {
          return structuredClone(READY_REFACTORKIT_STATUS);
        }
        if (command === "get_refactorkit_capabilities") {
          return structuredClone(REFACTORKIT_062_ADVERTISEMENT);
        }
        if (command === "run_refactorkit_diagnostics") {
          return structuredClone(LEGACY_DIAGNOSTICS_RESULT);
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
          return structuredClone(SYMBOL_SEARCH_RESULT);
        }
        if (command === "resolve_refactorkit_saved_snapshot_definition") {
          assert.equal(
            this.#nativeSemanticSessionActive && this.#nativeSearchAvailable,
            true,
            "The fixture received definition lookup without the current saved-snapshot search",
          );
          assert.deepEqual(args, { request: DEFINITION_REQUEST });
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
          return structuredClone(SEMANTIC_SESSION_STOP_RESULT);
        }
        throw new Error(
          `The RefactorKit 0.6.2 fixture does not implement Tauri command ${command}`,
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

  async requestCurrentSnapshotDiagnostics(): Promise<void> {
    this.#diagnostics = await this.#adapter.diagnostics();
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
    assert.equal(capabilities.providerVersion, "0.6.2");
    assert.equal(capabilities.languageKernel?.available, true);
    if (!capabilities.languageKernel?.available) return;

    for (const adapter of capabilities.languageKernel.schema.adapters) {
      for (const operation of ["workspaceSymbols", "definition"] as const) {
        const observed = adapter.capabilities.find(
          (capability) => capability.operation === operation,
        );
        const advertised = REFACTORKIT_062_ADVERTISEMENT.languageKernel.schema.adapters
          .find(({ languageId }) => languageId === adapter.languageId)
          ?.capabilities.find((capability) => capability.operation === operation);
        assert.deepEqual(
          observed,
          advertised,
          `The IDE did not retain the experimental language-server ${operation} capability for ${adapter.languageId}`,
        );
      }
    }
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
    this.#toolchainApproved = true;
  }

  async searchWorkspaceSymbol(): Promise<void> {
    assert.equal(this.#buffersMatchSavedFiles, true);
    assert.equal(this.#toolchainApproved, true);
    this.#requireSemanticCapability("workspaceSymbols");
    this.#requireSemanticCapability("definition");

    this.#semanticSession = await this.#adapter.startSavedSnapshotSemanticSession(
      SEMANTIC_SESSION_START_REQUEST,
    );
    assert.deepEqual(this.#semanticSession, SEMANTIC_SESSION_START_RESULT);
    assert.deepEqual(this.#semanticSessionStartInvocation().args, {
      request: SEMANTIC_SESSION_START_REQUEST,
    });

    this.#searchRequested = true;
    this.#symbolSearch = await this.#adapter.searchSavedSnapshotSymbols(SYMBOL_SEARCH_REQUEST);
    assert.deepEqual(this.#symbolSearch, SYMBOL_SEARCH_RESULT);
    assert.deepEqual(this.#symbolSearchInvocation().args, { request: SYMBOL_SEARCH_REQUEST });
  }

  selectSemanticSearchResult(): void {
    assert.equal(this.#searchRequested, true);
    const selectedSymbol = this.#symbolSearch?.symbols[0];
    assert.ok(selectedSymbol, "The workspace-symbol request returned no semantic result");
    this.#selectedSymbol = selectedSymbol;
    this.#selectionRequested = true;
  }

  async assertSemanticDefinitionOpenedAtProviderPoint(): Promise<void> {
    assert.equal(this.#selectionRequested, true);
    assert.deepEqual(this.#selectedSymbol, SYMBOL_SEARCH_RESULT.symbols[0]);

    this.#definition = await this.#adapter.resolveSavedSnapshotDefinition(DEFINITION_REQUEST);
    assert.deepEqual(this.#definition, DEFINITION_RESULT);
    assert.deepEqual(this.#semanticDefinitionInvocation().args, { request: DEFINITION_REQUEST });

    this.#semanticStop = await this.#adapter.stopSavedSnapshotSemanticSession(
      SEMANTIC_SESSION_STOP_REQUEST,
    );
    assert.deepEqual(this.#semanticStop, SEMANTIC_SESSION_STOP_RESULT);
    assert.deepEqual(this.#semanticSessionStopInvocation().args, {
      request: SEMANTIC_SESSION_STOP_REQUEST,
    });

    const editorPoint = normalizeProviderPoint(this.#definition.point);
    assert.deepEqual(editorPoint, {
      kind: "ready",
      point: { lineNumber: 3, column: 14 },
    });
    assert.fail(
      "MISSING_UI_CAPABILITY: The desktop application has no controller/composition that submits saved-snapshot symbol navigation from the existing generic Search surface and maps the selected provider point to the existing document-navigation/editor-reveal seam.",
    );
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
    assert.equal(this.#dom.window.document.body.textContent?.includes(symbol.id), false);
  }

  assertUnsafeBuffersRefused(): void {
    assert.fail(
      "MISSING_UI_CAPABILITY: The desktop symbol-navigation controller must refuse dirty and never-saved participating buffers before starting a semantic session.",
    );
  }

  assertSearchCompatibilityDisclosure(): void {
    assert.deepEqual(this.#symbolSearch?.completeness, SYMBOL_SEARCH_RESULT.completeness);
    assert.fail(
      "MISSING_UI_CAPABILITY: The existing generic Search surface must render the dynamic-or-mixed JavaScript incompleteness disclosure.",
    );
  }

  assertOnlyApprovedExternalToolchainEligible(): void {
    const startRequest = this.#semanticSessionStartInvocation().args?.request as
      { readonly toolchain?: unknown } | undefined;
    const searchRequest = this.#symbolSearchInvocation().args?.request as
      { readonly toolchain?: unknown } | undefined;
    assert.deepEqual(startRequest?.toolchain, APPROVED_TOOLCHAIN);
    assert.deepEqual(searchRequest?.toolchain, APPROVED_TOOLCHAIN);
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
    ]);
    assert.equal(
      this.#invocations.some(({ command }) => /(?:apply|write|script|terminal)/i.test(command)),
      false,
    );
  }

  assertNoScriptSpecificPanel(): void {
    const panelCommands = this.#invocations.filter(({ command }) =>
      /(typescript|javascript).*(panel|surface)|(panel|surface).*(typescript|javascript)/i.test(
        command,
      ),
    );
    assert.deepEqual(panelCommands, []);
  }

  assertNoProjectActionInGlobalSettings(): void {
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
    await assert.rejects(
      browser.startSavedSnapshotSemanticSession(SEMANTIC_SESSION_START_REQUEST),
      {
        code: "BROWSER_REFACTORKIT_UNAVAILABLE",
      },
    );
  }

  assertOperationMetadataPreserved(): void {
    const capabilities = this.#requireCapabilities();
    assert.equal(capabilities.providerVersion, "0.6.2");
    assert.equal(capabilities.languageKernel?.available, true);
    if (!capabilities.languageKernel?.available) return;

    for (const advertisedAdapter of REFACTORKIT_062_ADVERTISEMENT.languageKernel.schema.adapters) {
      const observedAdapter: RefactorKitLanguageAdapter | undefined =
        capabilities.languageKernel.schema.adapters.find(
          (adapter: RefactorKitLanguageAdapter) =>
            adapter.languageId === advertisedAdapter.languageId,
        );
      assert.ok(
        observedAdapter,
        `The IDE omitted the advertised ${advertisedAdapter.languageId} adapter`,
      );
      const observedDiagnostics: RefactorKitLanguageCapability | undefined =
        observedAdapter.capabilities.find(
          (capability: RefactorKitLanguageCapability) => capability.operation === "diagnostics",
        );
      assert.deepEqual(
        observedDiagnostics,
        advertisedAdapter.capabilities.find(({ operation }) => operation === "diagnostics"),
        `The IDE dropped RefactorKit 0.6.2 per-operation capability metadata for ${advertisedAdapter.languageId} diagnostics`,
      );
    }
  }

  assertQualifiedSnapshotRequest(): void {
    const invocation = this.#diagnosticsInvocation();
    assert.deepEqual(
      invocation.args,
      {
        request: {
          languageId: "typescript",
          workspaceId: "workspace:authorized",
          workspaceGeneration: 1,
          sessionId: "typescript-session:1",
          snapshotHash: "sha256:current-source-snapshot",
          providerVersion: "0.6.2",
          backend: "typescript-lsp-explicit-v1",
        },
      },
      "The diagnostics request must bind the authorized workspace, semantic session, source snapshot, provider, and advertised backend",
    );
  }

  assertStructuredDiagnosticsAvailableForExistingSurfaces(): void {
    const result = this.#diagnostics as StructuredDiagnosticsResult | undefined;
    assert.ok(result, "No RefactorKit diagnostics result was returned");
    assert.ok(
      Array.isArray(result.diagnostics),
      "The RefactorKit result has no structured diagnostics for Problems and Monaco",
    );
  }

  assertStaleAuthorityRejected(): void {
    const result = this.#diagnostics as StructuredDiagnosticsResult | undefined;
    assert.equal(result?.workspaceId, "workspace:authorized");
    assert.equal(result?.workspaceGeneration, 1);
    assert.equal(result?.sessionId, "typescript-session:1");
    assert.equal(result?.snapshotHash, "sha256:current-source-snapshot");
  }

  assertReadinessIsRepresentable(): void {
    const result = this.#diagnostics as StructuredDiagnosticsResult | undefined;
    assert.ok(
      result?.toolchain,
      "The diagnostics contract does not expose qualified toolchain readiness or refusal evidence",
    );
  }

  assertReadOnlyExecution(): void {
    const invocation = this.#diagnosticsInvocation();
    assert.equal(invocation.command, "run_refactorkit_diagnostics");
    const commandArguments: readonly string[] = LEGACY_DIAGNOSTICS_RESULT.command.args;
    assert.equal(
      commandArguments.some((argument) => argument === "npm" || argument === "pnpm"),
      false,
    );
  }

  assertNoFallbackOutput(): void {
    const result = this.#diagnostics as StructuredDiagnosticsResult | undefined;
    assert.equal(result?.fallback, undefined);
    assert.equal(
      this.#diagnostics?.stdout,
      "",
      "Unstructured fallback diagnostics must not cross the IDE contract",
    );
  }

  assertNoTypeScriptSpecificPanel(): void {
    const panelCommands = this.#invocations.filter(({ command }) =>
      /typescript.*panel|panel.*typescript/i.test(command),
    );
    assert.deepEqual(panelCommands, []);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#statusController.unmount();
    this.#dom.window.close();
    for (const [name, descriptor] of [...this.#globalDescriptors].reverse()) {
      this.#restoreProperty(name, descriptor);
    }
  }

  #requireCapabilities() {
    assert.ok(this.#capabilities, "RefactorKit capabilities were not discovered");
    return this.#capabilities;
  }

  #diagnosticsInvocation(): FixtureInvocation {
    const invocation = this.#invocations.find(
      ({ command }) => command === "run_refactorkit_diagnostics",
    );
    assert.ok(invocation, "The IDE did not invoke its RefactorKit diagnostics boundary");
    return invocation;
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
