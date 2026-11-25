import assert from "node:assert/strict";
import { createRequire, register } from "node:module";

import {
  act,
  fireEvent,
  render,
  renderHook,
  waitFor,
  within,
  type RenderResult,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

register(new URL("./story-css-loader.js", import.meta.url), import.meta.url);

import { createTauriAdapters } from "../../../apps/desktop/src/adapters/index.js";
import {
  useRefactorKitStatusController,
  type RefactorKitStatusController,
} from "../../../apps/desktop/src/features/refactorkit-status/useRefactorKitStatusController.js";
import type {
  RefactorKitCapabilities,
  RefactorKitLanguageAdapter,
} from "../../../packages/contracts/src/refactorkit.js";
import type { RefactorKitPort } from "../../../packages/web-core/src/ports/refactorkit-port.js";

interface StoryDom {
  readonly window: Window & typeof globalThis;
}

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  readonly JSDOM: new (html: string, options: { url: string }) => StoryDom;
};
const storyReact = createRequire(import.meta.url)("react") as {
  createElement(type: unknown, props: Record<string, unknown> | null): React.ReactNode;
};

const OPERATION = "diagnostics.v2" as const;
const SCHEMA_VERSION = 2 as const;
const PROVIDER_VERSION = "0.7.0-SNAPSHOT" as const;
const COMPILER_BACKEND = "typescript-compiler-exact-v1" as const;
const MAX_RESPONSE_BYTES = 2_097_152;

const AUTHORITY = {
  workspaceId: "workspace:authorized",
  workspaceGeneration: 1,
  sessionId: `refactorkit-semantic-session-v1:${"a".repeat(64)}`,
  semanticLease: "semantic-00000000-0000-4000-8000-000000000001",
  projectSnapshotHash: `sha256:${"b".repeat(64)}`,
  providerSnapshotHash: "c".repeat(64),
} as const;

const DIAGNOSTICS_RUNTIME = {
  executionMode: "external-process",
  supportsTimeout: true,
  supportsCancellation: true,
  usesWorkspaceOverlay: true,
  recordsProcessProvenance: true,
  limits: {
    requestTimeoutMillis: 30_000,
    maxInputBytes: 536_870_912,
    maxOutputBytes: 8_388_608,
    maxProcesses: 1,
  },
} as const;

const DIAGNOSTICS_V2_METHOD = {
  name: OPERATION,
  stability: "additive-api-0.2",
  requiresProject: true,
  writesWorkspace: false,
  features: {
    requestCorrelation: true,
    semanticLease: true,
    savedDiskAuthority: true,
    immutableEditorOverlay: true,
    exactUtf16Ranges: true,
    structuredReadiness: true,
    compilerAttestation: true,
    boundedResponse: true,
  },
} as const;

const CURRENT_IDE_METHODS = [
  {
    name: "refactor.apply",
    stability: "beta-contract",
    requiresProject: true,
    writesWorkspace: true,
  },
  {
    name: "refactor.discard",
    stability: "beta-contract",
    requiresProject: false,
    writesWorkspace: false,
  },
  {
    name: "patch.rollback",
    stability: "beta-contract",
    requiresProject: true,
    writesWorkspace: true,
  },
  {
    name: "java.importExternalClass",
    stability: "experimental",
    requiresProject: true,
    writesWorkspace: false,
    features: {
      targetDirectory: true,
      preview: true,
      apply: true,
      discard: true,
      rollback: true,
    },
  },
  DIAGNOSTICS_V2_METHOD,
] as const;

const DIAGNOSTICS_CAPABILITY = {
  operation: "diagnostics",
  stability: "experimental",
  evidence: "compiler",
  mutationAuthority: "none",
  backend: COMPILER_BACKEND,
  runtime: DIAGNOSTICS_RUNTIME,
  diagnosticSnapshotModes: ["immutable-editor-overlay", "saved-disk"],
  diagnosticRangeCapability: "exact-utf16-or-explicit-partial",
} as const;

const SEMANTIC_RUNTIME = {
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

const DEFINITION_CAPABILITY = {
  operation: "definition",
  stability: "experimental",
  evidence: "language-server",
  mutationAuthority: "none",
  backend: "typescript-lsp-explicit-v1",
  runtime: SEMANTIC_RUNTIME,
} as const;

const WORKSPACE_SYMBOLS_CAPABILITY = {
  ...DEFINITION_CAPABILITY,
  operation: "workspaceSymbols",
} as const;

const APPROVED_TOOLCHAIN = {
  nodeExecutable: "/opt/refactorkit-toolchains/node/bin/node",
  languageServerPackageRoot: "/opt/refactorkit-toolchains/typescript-language-server",
  typeScriptPackageRoot: "/opt/refactorkit-toolchains/typescript",
} as const;

const LANGUAGE_VOCABULARY = {
  stability: ["stable", "experimental", "structural", "refused", "not-applicable"],
  evidence: ["compiler", "language-server", "native-ast", "structural-parse", "lexical", "none"],
  mutationAuthority: ["managed-stable", "proposal-only", "none"],
  executionMode: ["in-process", "external-process"],
  diagnosticSnapshotMode: ["saved-disk", "immutable-editor-overlay"],
  diagnosticRangeCapability: ["exact-utf16-or-explicit-partial"],
} as const;

function diagnosticsAdapter(languageId: "javascript" | "typescript") {
  const extensions = languageId === "typescript" ? ["ts", "tsx"] : ["js", "jsx"];
  return {
    languageId,
    extensions,
    backend: "tree-sitter-jni-0.25.3+typescript-lsp-explicit-v1",
    runtime: {
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
    },
    capabilities: [
      { ...DIAGNOSTICS_CAPABILITY, extensions },
      { ...DEFINITION_CAPABILITY, extensions },
      { ...WORKSPACE_SYMBOLS_CAPABILITY, extensions },
    ],
  } as const;
}

/** Exact scenario-owned extraction of the source-built provider advertisement. */
const SOURCE_BUILT_DIAGNOSTICS_V2_ADVERTISEMENT = {
  name: "refactorkit",
  version: PROVIDER_VERSION,
  apiVersion: "0.2",
  protocol: "json-rpc-2.0",
  transport: "stdio",
  methods: [DIAGNOSTICS_V2_METHOD],
  languageKernel: {
    schemaVersion: 1,
    adapters: [diagnosticsAdapter("javascript"), diagnosticsAdapter("typescript")],
    vocabulary: LANGUAGE_VOCABULARY,
  },
  safety: {
    previewBeforeApply: true,
    snapshotValidation: true,
    transactionRollback: true,
    workspaceScopedWrites: true,
  },
} as const;

/** Current production native normalization with retained diagnostics.v2 metadata. */
const CURRENT_IDE_CAPABILITIES = {
  api: "refactorkit",
  apiVersion: "0.2",
  provider: "refactorkit",
  providerVersion: PROVIDER_VERSION,
  javaImportExternalClass: {
    supported: true,
    targetDirectory: true,
    preview: true,
    apply: true,
    rollback: true,
    stability: "experimental",
  },
  methods: CURRENT_IDE_METHODS,
  languageKernel: {
    available: true,
    schema: {
      schemaVersion: 1,
      adapters: SOURCE_BUILT_DIAGNOSTICS_V2_ADVERTISEMENT.languageKernel.adapters,
      vocabulary: LANGUAGE_VOCABULARY,
    },
  },
  safety: SOURCE_BUILT_DIAGNOSTICS_V2_ADVERTISEMENT.safety,
} as const;

const READY_REFACTORKIT_STATUS = {
  available: true,
  path: "/opt/refactorkit/refactorkit-daemon",
  version: PROVIDER_VERSION,
  checkedAt: "2026-08-08T00:00:00.000Z",
} as const;

const ACCEPTED_SNAPSHOT_EVIDENCE = {
  source: {
    commit: "db25c9af2d62c8e9e90f93792a6c6593e6e13698",
    tree: "0ee693d519f9c2bf9159bebbbc37857a56112d97",
    treeAlgorithm: "git-tree-oid-sha1-v1",
    gitObjectType: "tree",
    clean: true,
    detached: true,
  },
  build: {
    command: ["./gradlew", "--no-daemon", "clean", ":modules:refactorkit-daemon:installDist"],
    javaMajor: 21,
    cleanBefore: true,
    cleanAfter: true,
    daemonSha256: "57d90a47dbd8d39cb40e545158d098e7c8addd7aa19c5c2a610783721055e6b4",
    attestationSha256: "c551e2de8051eb7e4023025c2a68123fe3e936e6042cc4c012b64fd8266cb0ed",
  },
  process: {
    controlledNode: true,
    compilerBackend: COMPILER_BACKEND,
    packageScriptCanaryMarkerAbsent: true,
    prohibitedInvocationCount: 0,
  },
  workspaceAudit: {
    scope:
      "sampled non-directory path/content bytes; excludes metadata, empty directories, transient between-checkpoint writes, and syscall-complete claims",
    beforeFingerprint: "d".repeat(64),
    afterFingerprint: "d".repeat(64),
    workspaceLockAbsentAtChecks: true,
  },
} as const;

const COMPILER_ATTESTATION = {
  toolchainProvider: "typescript-lsp-explicit-v1",
  nodeVersion: "22.23.0",
  typeScriptVersion: "5.9.3",
  compilerSha256: "e".repeat(64),
  toolchainEvidenceSha256: "f".repeat(64),
  process: {
    executableSha256: "1".repeat(64),
    argumentsSha256: "2".repeat(64),
    processId: 42,
  },
} as const;

const SOURCE_AUTHORITY_REQUEST = {
  kind: "immutable-editor-overlay",
  documents: [
    {
      path: "src/broken.ts",
      version: 1,
      content: 'const amount: number = "wrong";\n',
    },
  ],
} as const;

const SOURCE_AUTHORITY_RESPONSE = {
  kind: "immutable-editor-overlay",
  baseSnapshotHash: AUTHORITY.projectSnapshotHash,
  overlayHash: "3".repeat(64),
  providerSnapshotHash: AUTHORITY.providerSnapshotHash,
  documents: [
    {
      path: "src/broken.ts",
      version: 1,
      contentSha256: "4".repeat(64),
    },
  ],
} as const;

const DIAGNOSTICS_REQUEST = {
  schemaVersion: SCHEMA_VERSION,
  operation: OPERATION,
  requestId: "desktop-diagnostics:1:1",
  languageId: "typescript",
  workspaceId: AUTHORITY.workspaceId,
  workspaceGeneration: AUTHORITY.workspaceGeneration,
  sessionId: AUTHORITY.sessionId,
  expectedSnapshotHash: AUTHORITY.projectSnapshotHash,
  semanticLease: AUTHORITY.semanticLease,
  sourceAuthority: SOURCE_AUTHORITY_REQUEST,
} as const;

type DiagnosticsRequest = Omit<typeof DIAGNOSTICS_REQUEST, "requestId"> & {
  readonly requestId: string;
};
type DiagnosticsStatus = "ready" | "refused" | "error";

interface DiagnosticsEnvelope {
  readonly schemaVersion: 2;
  readonly operation: typeof OPERATION;
  readonly requestId: string;
  readonly languageId: "typescript";
  readonly status: DiagnosticsStatus;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly sessionId: string;
  readonly provider: {
    readonly name: "refactorkit";
    readonly version: typeof PROVIDER_VERSION;
    readonly apiVersion: "0.2";
  };
  readonly backend: typeof COMPILER_BACKEND;
  readonly semanticLease: string;
  readonly projectSnapshotHash: string;
  readonly providerSnapshotHash: string;
  readonly sourceAuthority: typeof SOURCE_AUTHORITY_RESPONSE;
  readonly rangeEncoding: "utf-16";
  readonly rangeCapability: "exact-utf16-or-explicit-partial";
  readonly runtime: typeof DIAGNOSTICS_RESPONSE_RUNTIME;
  readonly compilerAttestation: typeof COMPILER_ATTESTATION | null;
  readonly failure: { readonly code: string; readonly message: string } | null;
  readonly diagnostics: readonly unknown[];
  readonly diagnosticsTotal: number;
  readonly diagnosticsReturned: number;
  readonly truncated: boolean;
  readonly responseBytes: number;
}

const DIAGNOSTICS_RESPONSE_RUNTIME = {
  ...DIAGNOSTICS_RUNTIME,
  limits: {
    ...DIAGNOSTICS_RUNTIME.limits,
    maxStderrBytes: 65_536,
    compilerHeapMiB: 512,
    maxDiagnostics: 500,
    maxDiagnosticMessageChars: 4_096,
    maxResponseBytes: MAX_RESPONSE_BYTES,
  },
} as const;

function withResponseBytes<T extends Omit<DiagnosticsEnvelope, "responseBytes">>(
  value: T,
): DiagnosticsEnvelope {
  let result = { ...value, responseBytes: 0 } as DiagnosticsEnvelope;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const responseBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    const updated = { ...result, responseBytes } as DiagnosticsEnvelope;
    if (Buffer.byteLength(JSON.stringify(updated), "utf8") === responseBytes) return updated;
    result = updated;
  }
  throw new Error("The diagnostics.v2 fixture response byte count did not converge");
}

function envelope(
  requestId: string,
  status: DiagnosticsStatus,
  options: {
    readonly compilerAttestation: typeof COMPILER_ATTESTATION | null;
    readonly failure: DiagnosticsEnvelope["failure"];
    readonly diagnostics?: readonly unknown[];
    readonly semanticLease?: string;
  },
): DiagnosticsEnvelope {
  const diagnostics = options.diagnostics ?? [];
  return withResponseBytes({
    schemaVersion: SCHEMA_VERSION,
    operation: OPERATION,
    requestId,
    languageId: "typescript",
    status,
    workspaceId: AUTHORITY.workspaceId,
    workspaceGeneration: AUTHORITY.workspaceGeneration,
    sessionId: AUTHORITY.sessionId,
    provider: { name: "refactorkit", version: PROVIDER_VERSION, apiVersion: "0.2" },
    backend: COMPILER_BACKEND,
    semanticLease: options.semanticLease ?? AUTHORITY.semanticLease,
    projectSnapshotHash: AUTHORITY.projectSnapshotHash,
    providerSnapshotHash: AUTHORITY.providerSnapshotHash,
    sourceAuthority: SOURCE_AUTHORITY_RESPONSE,
    rangeEncoding: "utf-16",
    rangeCapability: "exact-utf16-or-explicit-partial",
    runtime: DIAGNOSTICS_RESPONSE_RUNTIME,
    compilerAttestation: options.compilerAttestation,
    failure: options.failure,
    diagnostics,
    diagnosticsTotal: diagnostics.length,
    diagnosticsReturned: diagnostics.length,
    truncated: false,
  });
}

const EXACT_DIAGNOSTIC = {
  severity: "error",
  message: "Type 'string' is not assignable to type 'number'.",
  code: "TS2322",
  evidence: "compiler",
  category: "type-resolution",
  location: {
    kind: "range",
    path: "src/broken.ts",
    encoding: "utf-16",
    range: {
      start: { line: 0, character: 6 },
      end: { line: 0, character: 12 },
    },
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

interface ObservedMonacoMarkers {
  readonly owner: string;
  readonly markers: readonly Readonly<Record<string, unknown>>[];
}

async function flushMicrotasks(rounds = 30): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

const REQUEST_FIELDS = [
  "schemaVersion",
  "operation",
  "requestId",
  "languageId",
  "workspaceId",
  "workspaceGeneration",
  "sessionId",
  "expectedSnapshotHash",
  "semanticLease",
  "sourceAuthority",
] as const;

const RESPONSE_FIELDS = [
  "schemaVersion",
  "operation",
  "requestId",
  "languageId",
  "status",
  "workspaceId",
  "workspaceGeneration",
  "sessionId",
  "provider",
  "backend",
  "semanticLease",
  "projectSnapshotHash",
  "providerSnapshotHash",
  "sourceAuthority",
  "rangeEncoding",
  "rangeCapability",
  "runtime",
  "compilerAttestation",
  "failure",
  "diagnostics",
  "diagnosticsTotal",
  "diagnosticsReturned",
  "truncated",
  "responseBytes",
] as const;

function assertExactFields(value: object, expected: readonly string[], label: string): void {
  const actual = Reflect.ownKeys(value);
  assert.equal(
    actual.every((key) => typeof key === "string"),
    true,
    `${label} has symbol keys`,
  );
  assert.deepEqual(
    actual.map(String).sort(),
    [...expected].sort(),
    `${label} is not a strict closed shape`,
  );
}

/**
 * Deterministic desktop/Tauri-harness boundary for REQ-REFACTORKIT-TS-001 only.
 * It deliberately shares no semantic symbol-navigation state or operation.
 */
export class RefactorKit070SnapshotDiagnosticsFixture {
  readonly #adapter: RefactorKitPort;
  readonly #invocations: FixtureInvocation[] = [];
  readonly #globalDescriptors = new Map<string, PropertyDescriptor | undefined>();
  readonly #dom: StoryDom;
  readonly #statusController: RefactorKitStatusControllerHarness;
  readonly #presentedStates: string[] = [];
  readonly #monacoMarkerCalls: ObservedMonacoMarkers[] = [];
  readonly #diagnosticRequests: DiagnosticsRequest[] = [];
  #surface?: RenderResult;
  #capabilities?: RefactorKitCapabilities;
  #diagnostics?: DiagnosticsEnvelope;
  #refusedDiagnostics?: DiagnosticsEnvelope;
  #errorDiagnostics?: DiagnosticsEnvelope;
  #staleDiagnostics?: DiagnosticsEnvelope;
  #resolveReadyDiagnostics?: (value: unknown) => void;
  #readyDiagnosticsPromise?: Promise<unknown>;
  #nativeSemanticSessionActive = false;
  #disposed = false;

  constructor() {
    this.#dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://desktop.story.invalid",
    });
    const window = this.#dom.window;
    Object.defineProperty(window.document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    Object.defineProperties(window.HTMLElement.prototype, {
      attachEvent: { configurable: true, value: () => undefined },
      detachEvent: { configurable: true, value: () => undefined },
    });
    Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 720,
        height: 720,
        left: 0,
        right: 1280,
        top: 0,
        width: 1280,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    const globals: ReadonlyArray<readonly [string, unknown]> = [
      ["window", window],
      ["document", window.document],
      ["navigator", window.navigator],
      ["Node", window.Node],
      ["Element", window.Element],
      ["HTMLElement", window.HTMLElement],
      ["HTMLButtonElement", window.HTMLButtonElement],
      ["HTMLInputElement", window.HTMLInputElement],
      ["HTMLTextAreaElement", window.HTMLTextAreaElement],
      ["MouseEvent", window.MouseEvent],
      ["KeyboardEvent", window.KeyboardEvent],
      ["Event", window.Event],
      ["CustomEvent", window.CustomEvent],
      ["getComputedStyle", window.getComputedStyle.bind(window)],
      [
        "requestAnimationFrame",
        (callback: FrameRequestCallback) => (queueMicrotask(() => callback(0)), 0),
      ],
      ["cancelAnimationFrame", () => undefined],
      [
        "ResizeObserver",
        class {
          observe(): void {}
          unobserve(): void {}
          disconnect(): void {}
        },
      ],
      [
        "IntersectionObserver",
        class {
          observe(): void {}
          unobserve(): void {}
          disconnect(): void {}
        },
      ],
      ["React", storyReact],
      ["IS_REACT_ACT_ENVIRONMENT", true],
      [
        "__IDE_STORY_MONACO_MARKER_OBSERVER__",
        (owner: string, markers: readonly Readonly<Record<string, unknown>>[]) => {
          this.#monacoMarkerCalls.push({ owner, markers: structuredClone(markers) });
        },
      ],
    ];
    for (const [name, value] of globals) {
      this.#globalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
    Object.defineProperties(window, {
      requestAnimationFrame: {
        configurable: true,
        value: globalThis.requestAnimationFrame,
      },
      cancelAnimationFrame: {
        configurable: true,
        value: globalThis.cancelAnimationFrame,
      },
      matchMedia: {
        configurable: true,
        value: () => ({
          matches: false,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }),
      },
    });

    const internals: TauriInternals = {
      invoke: (command, args) => this.#invoke(command, args),
    };
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
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

  async discoverDiagnosticsV2Capabilities(): Promise<void> {
    assertExactFields(
      SOURCE_BUILT_DIAGNOSTICS_V2_ADVERTISEMENT,
      [
        "name",
        "version",
        "apiVersion",
        "protocol",
        "transport",
        "methods",
        "languageKernel",
        "safety",
      ],
      "source-built server.capabilities",
    );
    assert.deepEqual(SOURCE_BUILT_DIAGNOSTICS_V2_ADVERTISEMENT.methods, [DIAGNOSTICS_V2_METHOD]);
    assert.deepEqual(
      SOURCE_BUILT_DIAGNOSTICS_V2_ADVERTISEMENT.languageKernel.adapters.map(
        ({ languageId, capabilities }) => [languageId, capabilities[0]],
      ),
      [
        ["javascript", { ...DIAGNOSTICS_CAPABILITY, extensions: ["js", "jsx"] }],
        ["typescript", { ...DIAGNOSTICS_CAPABILITY, extensions: ["ts", "tsx"] }],
      ],
    );

    await act(async () => {
      await this.#statusController.result.current.workspaceCollaborator.load(
        AUTHORITY.workspaceGeneration,
      );
    });
    assert.equal(this.#statusController.result.current.isChecking, false);
    assert.equal(this.#statusController.result.current.error, null);
    assert.deepEqual(this.#statusController.result.current.status, READY_REFACTORKIT_STATUS);
    this.#capabilities = this.#statusController.result.current.capabilities ?? undefined;
    assert.ok(this.#capabilities, "Production capability discovery returned no capabilities");
  }

  assertAcceptedSnapshotEvidenceBound(): void {
    assertExactFields(
      ACCEPTED_SNAPSHOT_EVIDENCE,
      ["source", "build", "process", "workspaceAudit"],
      "snapshot evidence",
    );
    assert.deepEqual(ACCEPTED_SNAPSHOT_EVIDENCE.source, {
      commit: "db25c9af2d62c8e9e90f93792a6c6593e6e13698",
      tree: "0ee693d519f9c2bf9159bebbbc37857a56112d97",
      treeAlgorithm: "git-tree-oid-sha1-v1",
      gitObjectType: "tree",
      clean: true,
      detached: true,
    });
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.build.cleanBefore, true);
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.build.cleanAfter, true);
    assert.match(ACCEPTED_SNAPSHOT_EVIDENCE.build.daemonSha256, /^[a-f0-9]{64}$/u);
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.process.compilerBackend, COMPILER_BACKEND);
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.process.prohibitedInvocationCount, 0);
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.process.packageScriptCanaryMarkerAbsent, true);
    assert.equal(
      ACCEPTED_SNAPSHOT_EVIDENCE.workspaceAudit.beforeFingerprint,
      ACCEPTED_SNAPSHOT_EVIDENCE.workspaceAudit.afterFingerprint,
    );
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.workspaceAudit.workspaceLockAbsentAtChecks, true);
  }

  async requestCurrentSnapshotDiagnostics(): Promise<void> {
    assertExactFields(DIAGNOSTICS_REQUEST, REQUEST_FIELDS, "diagnostics.v2 request");
    await this.#startProductionApp();
    await this.#openCurrentTypeScriptDocument();
    await this.#establishProductionSemanticSession();

    const surface = this.#requireSurface();
    fireEvent.click(surface.getByRole("button", { name: /^Settings$/u }));
    const settings = await waitFor(() => surface.getByRole("dialog", { name: "Settings" }));
    fireEvent.click(within(settings).getByRole("tab", { name: /^Languages/u }));
    const languageTooling = within(settings).getByRole("region", { name: "Language tooling" });
    const requestButton = (): HTMLButtonElement =>
      within(languageTooling).getByRole("button", { name: "Request diagnostics" });
    const presented = async (state: DiagnosticsStatus | "checking"): Promise<HTMLElement> =>
      waitFor(() => {
        const element = languageTooling.querySelector(`[data-diagnostics-state="${state}"]`);
        assert.ok(element, `Language Tooling did not present diagnostics state ${state}`);
        return element as HTMLElement;
      });

    fireEvent.click(requestButton());
    const checking = await presented("checking");
    this.#presentedStates.push(`checking:${checking.textContent ?? ""}`);
    await waitFor(() => {
      const stopped = languageTooling.querySelector(
        '[data-diagnostics-state="refused"], [data-diagnostics-state="error"]',
      );
      assert.ok(
        this.#resolveReadyDiagnostics,
        stopped
          ? `The production diagnostics controller stopped at the Tauri adapter boundary: ${stopped.textContent ?? ""}`
          : "The production App did not reach the Tauri adapter",
      );
    });
    await act(async () => {
      this.#resolveReadyDiagnostics!(structuredClone(this.#requireDiagnostics()));
      await this.#readyDiagnosticsPromise;
      await flushMicrotasks();
    });
    const ready = await presented("ready");
    this.#presentedStates.push(`ready:${ready.textContent ?? ""}`);

    fireEvent.click(requestButton());
    const refused = await presented("refused");
    this.#presentedStates.push(`refused:${refused.textContent ?? ""}`);

    fireEvent.click(requestButton());
    const error = await presented("error");
    this.#presentedStates.push(`error:${error.textContent ?? ""}`);

    fireEvent.click(requestButton());
    await waitFor(() =>
      assert.equal(
        this.#invocations.filter(({ command }) => command === "run_refactorkit_diagnostics").length,
        4,
      ),
    );
    const stale = await presented("error");
    this.#presentedStates.push(`stale-rejected:${stale.textContent ?? ""}`);
  }

  assertDiagnosticsV2CapabilityMetadataPreserved(): void {
    const capabilities = this.#requireCapabilities() as RefactorKitCapabilities & {
      readonly methods?: readonly unknown[];
    };
    assert.deepEqual(
      capabilities.methods,
      CURRENT_IDE_METHODS,
      "The IDE did not retain the exact provider method capability metadata",
    );
    assert.equal(capabilities.languageKernel?.available, true);
    if (!capabilities.languageKernel?.available) return;
    for (const advertised of SOURCE_BUILT_DIAGNOSTICS_V2_ADVERTISEMENT.languageKernel.adapters) {
      const observed = capabilities.languageKernel.schema.adapters.find(
        (adapter: RefactorKitLanguageAdapter) => adapter.languageId === advertised.languageId,
      ) as
        | (RefactorKitLanguageAdapter & {
            readonly capabilities: readonly (Record<string, unknown> & { operation: string })[];
          })
        | undefined;
      assert.ok(observed, `The IDE omitted the ${advertised.languageId} diagnostics adapter`);
      assert.deepEqual(
        observed.capabilities.find(({ operation }) => operation === "diagnostics"),
        advertised.capabilities[0],
        `The IDE did not retain all diagnostics.v2 metadata for ${advertised.languageId}`,
      );
    }
  }

  assertSchemaAndCorrelation(): void {
    const response = this.#requireDiagnostics();
    const request = this.#diagnosticRequests[0];
    assert.ok(request, "The production App emitted no diagnostics.v2 request");
    assertExactFields(response, RESPONSE_FIELDS, "diagnostics.v2 ready response");
    assert.equal(response.schemaVersion, request.schemaVersion);
    assert.equal(response.operation, request.operation);
    assert.equal(response.requestId, request.requestId);
  }

  async assertStructuredStatusGate(): Promise<void> {
    const ready = this.#requireDiagnostics();
    const refused = this.#requireRefusedDiagnostics();
    const error = this.#requireErrorDiagnostics();
    this.#assertEnvelope(ready, "ready");
    this.#assertEnvelope(refused, "refused");
    this.#assertEnvelope(error, "error");
    assert.equal(ready.failure, null);
    assert.equal(ready.compilerAttestation !== null, true);
    assert.equal(refused.compilerAttestation, null);
    assert.deepEqual(refused.diagnostics, []);
    assert.deepEqual(error.diagnostics, []);
    assert.deepEqual(
      this.#presentedStates.map((state) => state.split(":", 1)[0]),
      ["checking", "ready", "refused", "error", "stale-rejected"],
    );
  }

  assertExactCompilerBackendAndAttestation(): void {
    const response = this.#requireDiagnostics();
    assert.equal(response.backend, DIAGNOSTICS_CAPABILITY.backend);
    assert.deepEqual(response.compilerAttestation, COMPILER_ATTESTATION);
    assert.match(response.compilerAttestation?.compilerSha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.match(response.compilerAttestation?.toolchainEvidenceSha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.match(response.compilerAttestation?.process.executableSha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.match(response.compilerAttestation?.process.argumentsSha256 ?? "", /^[a-f0-9]{64}$/u);
  }

  assertExactCompilerDiagnosticAndUtf16Range(): void {
    const response = this.#requireDiagnostics();
    assert.deepEqual(response.diagnostics, [EXACT_DIAGNOSTIC]);
    assert.equal(response.rangeEncoding, "utf-16");
    assert.equal(response.rangeCapability, "exact-utf16-or-explicit-partial");
  }

  assertAuthorityCorrelated(): void {
    const response = this.#requireDiagnostics();
    assert.deepEqual(
      {
        workspaceId: response.workspaceId,
        workspaceGeneration: response.workspaceGeneration,
        sessionId: response.sessionId,
        semanticLease: response.semanticLease,
        projectSnapshotHash: response.projectSnapshotHash,
        providerSnapshotHash: response.providerSnapshotHash,
        sourceAuthority: response.sourceAuthority,
      },
      {
        ...AUTHORITY,
        sourceAuthority: SOURCE_AUTHORITY_RESPONSE,
      },
    );
  }

  assertStaleAuthorityRejected(): void {
    const refused = this.#requireRefusedDiagnostics();
    const stale = this.#requireStaleDiagnostics();
    assert.equal(refused.status, "refused");
    assert.equal(refused.failure?.code, "diagnostics.semanticLeaseStale");
    assert.deepEqual(refused.diagnostics, []);
    assert.equal(refused.semanticLease, AUTHORITY.semanticLease);
    assert.equal(stale.status, "refused");
    assert.notEqual(stale.semanticLease, AUTHORITY.semanticLease);
    assert.match(this.#presentedStates.at(-1) ?? "", /^stale-rejected:/u);
    this.#assertProjectedDiagnosticStillVisible();
  }

  assertCompleteBoundedResponse(): void {
    const response = this.#requireDiagnostics();
    assert.deepEqual(response.runtime, DIAGNOSTICS_RESPONSE_RUNTIME);
    assert.equal(response.truncated, false);
    assert.equal(response.diagnosticsReturned, response.diagnosticsTotal);
    assert.equal(response.diagnosticsReturned, response.diagnostics.length);
    assert.equal(response.responseBytes, Buffer.byteLength(JSON.stringify(response), "utf8"));
    assert.ok(response.responseBytes <= response.runtime.limits.maxResponseBytes);
  }

  assertStructuredDiagnosticsAvailableForExistingSurfaces(): void {
    const surface = this.#requireSurface();
    const problemsTab = surface.getByRole("tab", { name: /Problems 1 problem/u });
    fireEvent.click(problemsTab);
    const problems = surface.getByRole("region", { name: "Problems" });
    assert.match(problems.textContent ?? "", /1 problem/u);
    assert.ok(within(problems).getByText("src/broken.ts"));
    assert.ok(within(problems).getByText("refactorkit"));
    const item = within(problems).getByRole("treeitem", {
      name: "error: Type 'string' is not assignable to type 'number'., src/broken.ts, line 1, column 7, provider refactorkit",
    });
    assert.equal(item.getAttribute("data-severity"), "error");
    assert.match(item.textContent ?? "", /compiler\(TS2322\) · 1:7/u);

    assert.ok(
      surface.getByRole("textbox", { name: "Code editor for src/broken.ts" }),
      "The production Monaco surface was not mounted for the current document",
    );
    const markerCall = [...this.#monacoMarkerCalls]
      .reverse()
      .find(
        ({ owner, markers }) => owner === "refactorkit-typescript-compiler" && markers.length > 0,
      );
    assert.ok(
      markerCall,
      "The production Monaco surface received no RefactorKit marker projection",
    );
    assert.deepEqual(markerCall.markers, [
      {
        startLineNumber: 1,
        startColumn: 7,
        endLineNumber: 1,
        endColumn: 13,
        severity: 8,
        message: EXACT_DIAGNOSTIC.message,
        code: EXACT_DIAGNOSTIC.code,
        source: EXACT_DIAGNOSTIC.evidence,
      },
    ]);
  }

  assertLanguageToolingStatesPresentedHonestly(): void {
    const [checking, ready, refused, error, stale] = this.#presentedStates;
    assert.match(checking ?? "", /checking:Checking.*Checking compiler diagnostics/u);
    assert.match(
      ready ?? "",
      /ready:Ready.*1 compiler diagnostic is available in Problems and editor markers/u,
    );
    assert.match(
      refused ?? "",
      /refused:Refused.*Request refused.*Semantic session lease is stale/u,
    );
    assert.match(
      error ?? "",
      /error:Error.*Diagnostics request failed.*Exact compiler diagnostics timed out/u,
    );
    assert.match(
      stale ?? "",
      /stale-rejected:Error.*Diagnostics request failed.*Compiler diagnostics could not be completed for the current source snapshot/u,
    );
  }

  assertReadOnlyExecution(): void {
    assert.equal(DIAGNOSTICS_V2_METHOD.writesWorkspace, false);
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.process.prohibitedInvocationCount, 0);
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.process.packageScriptCanaryMarkerAbsent, true);
    assert.deepEqual(
      this.#invocations.filter(
        ({ command }) =>
          command !== "get_workspace_terminal_capabilities" &&
          /(?:apply|write|script|terminal)/iu.test(command),
      ),
      [],
    );
  }

  assertNoFallbackOutput(): void {
    const response = this.#requireDiagnostics() as DiagnosticsEnvelope & {
      readonly stdout?: unknown;
      readonly fallback?: unknown;
    };
    assert.equal(response.stdout, undefined);
    assert.equal(response.fallback, undefined);
    assertExactFields(response, RESPONSE_FIELDS, "diagnostics.v2 response without fallback");
  }

  assertNoTypeScriptSpecificPanel(): void {
    assert.equal(
      this.#dom.window.document.querySelector(
        '[aria-label*="TypeScript" i][aria-label*="diagnostic" i], [data-typescript-diagnostics-panel]',
      ),
      null,
    );
    assert.equal(
      this.#invocations.some(({ command }) =>
        /typescript.*panel|panel.*typescript/iu.test(command),
      ),
      false,
    );
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#surface?.unmount();
    this.#statusController.unmount();
    await act(async () => flushMicrotasks());
    await new Promise((resolve) => setTimeout(resolve, 650));
    this.#dom.window.close();
    for (const [name, descriptor] of [...this.#globalDescriptors].reverse()) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }

  async #startProductionApp(): Promise<void> {
    assert.equal(this.#surface, undefined, "The production desktop App was already rendered");
    const appUrl = new URL("../../../apps/desktop/src/App.tsx", import.meta.url);
    appUrl.searchParams.set("refactorKitDiagnosticsStoryHarness", "1");
    const appModule = (await import(appUrl.href)) as { App: () => React.ReactNode };
    this.#surface = render(storyReact.createElement(appModule.App, null));
    await waitFor(() =>
      assert.ok(this.#requireSurface().getByText("Workspace: Authorized TypeScript")),
    );
  }

  async #openCurrentTypeScriptDocument(): Promise<void> {
    const surface = this.#requireSurface();
    const file = await waitFor(() => surface.getByRole("treeitem", { name: "broken.ts" }));
    fireEvent.click(file);
    await waitFor(() =>
      assert.ok(surface.getByRole("textbox", { name: "Code editor for src/broken.ts" })),
    );
  }

  async #establishProductionSemanticSession(): Promise<void> {
    const surface = this.#requireSurface();
    fireEvent.click(surface.getByRole("tab", { name: "Search" }));
    const search = await waitFor(() =>
      surface.getByRole("region", { name: "Semantic symbol search" }),
    );
    const user = userEvent.setup({ document: this.#dom.window.document });
    for (const [label, value] of [
      ["Symbol query", "Broken"],
      ["External Node executable path", APPROVED_TOOLCHAIN.nodeExecutable],
      [
        "External typescript-language-server package path",
        APPROVED_TOOLCHAIN.languageServerPackageRoot,
      ],
      ["External TypeScript package path", APPROVED_TOOLCHAIN.typeScriptPackageRoot],
    ] as const) {
      const input = within(search).getByLabelText(label);
      await user.clear(input);
      await user.type(input, value);
    }
    await user.click(
      within(search).getByRole("checkbox", {
        name: "Approve these external toolchain paths for this session",
      }),
    );
    assert.equal(
      (within(search).getByLabelText("Symbol query") as HTMLInputElement).value,
      "Broken",
    );
    assert.equal(
      (
        within(search).getByRole("checkbox", {
          name: "Approve these external toolchain paths for this session",
        }) as HTMLInputElement
      ).checked,
      true,
    );
    const submit = within(search).getByRole("button", { name: "Search workspace symbols" });
    await waitFor(() =>
      assert.equal(
        submit.hasAttribute("disabled"),
        false,
        `Semantic search did not become submittable: ${search.textContent ?? ""}`,
      ),
    );
    fireEvent.click(submit);
    await waitFor(() =>
      assert.ok(
        within(search).getByRole("button", {
          name: "Resolve definition for Broken, VARIABLE",
        }),
      ),
    );
    assert.equal(this.#nativeSemanticSessionActive, true);
  }

  #assertProjectedDiagnosticStillVisible(): void {
    const surface = this.#requireSurface();
    assert.ok(surface.getByRole("tab", { name: /Problems 1 problem/u }));
    assert.ok(
      [...this.#monacoMarkerCalls]
        .reverse()
        .find(
          ({ owner, markers }) =>
            owner === "refactorkit-typescript-compiler" && markers.length === 1,
        ),
      "A stale response replaced the current Monaco diagnostic projection",
    );
  }

  async #invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
    this.#invocations.push(args === undefined ? { command } : { command, args });
    switch (command) {
      case "ensure_current_workspace":
        return {
          id: AUTHORITY.workspaceId,
          name: "Authorized TypeScript",
          rootPath: "/workspace/authorized",
        };
      case "list_workspaces":
        return {
          currentWorkspaceId: AUTHORITY.workspaceId,
          workspaces: [
            {
              id: AUTHORITY.workspaceId,
              name: "Authorized TypeScript",
              rootPath: "/workspace/authorized",
            },
          ],
        };
      case "list_directory":
        return {
          name: "authorized",
          path: "/workspace/authorized",
          type: "directory",
          children: [
            {
              name: "broken.ts",
              path: "/workspace/authorized/src/broken.ts",
              type: "file",
            },
          ],
        };
      case "read_file":
        assert.deepEqual(args, { path: "src/broken.ts" });
        return { content: SOURCE_AUTHORITY_REQUEST.documents[0].content, language: "typescript" };
      case "get_pi_agent_settings":
        return {
          enabled: false,
          provider: "pi",
          preferredIntegration: "rpc",
          fallbackIntegrations: [],
        };
      case "get_pi_agent_status":
        return {
          provider: "pi",
          enabled: false,
          available: false,
          availability: "not-installed",
          preferredIntegration: "rpc",
          fallbackIntegrations: [],
          checkedAt: READY_REFACTORKIT_STATUS.checkedAt,
        };
      case "list_pi_agent_commands":
        return { provider: "pi", integration: "rpc", commands: [] };
      case "list_agent_runs":
      case "poll_java_language_service_events":
      case "list_xcom2_setup_transactions":
      case "poll_xcom2_setup_monitor_events":
      case "poll_xcom2_setup_transaction_events":
        return [];
      case "get_pi_agent_session_messages":
        return {
          workspaceId: AUTHORITY.workspaceId,
          sessionId: "diagnostics-story-session",
          provider: "pi",
          integration: "rpc",
          messages: [],
        };
      case "get_java_language_service_status":
        return {
          available: true,
          lifecycle: "ready",
          provider: "jdtls",
          workspaceId: AUTHORITY.workspaceId,
          workspaceRoot: "/workspace/authorized",
          generation: AUTHORITY.workspaceGeneration,
          gradleImportEnabled: false,
          gradleSettingsConfigured: false,
          activeMavenProfiles: [],
          inactiveMavenProfiles: [],
          capabilities: {
            documentSync: true,
            diagnostics: false,
            completion: false,
            hover: false,
            definition: false,
            references: false,
            documentSymbols: false,
            documentHighlights: false,
            implementation: false,
            workspaceSymbols: false,
            semanticTokens: false,
            rename: false,
            codeActions: false,
            formatting: false,
            signatureHelp: false,
          },
          checkedAt: READY_REFACTORKIT_STATUS.checkedAt,
        };
      case "get_refactorkit_status":
        return structuredClone(READY_REFACTORKIT_STATUS);
      case "get_refactorkit_engine_capabilities":
        return {
          engineDiscovered: false,
          path: null,
          version: null,
          workspaceId: AUTHORITY.workspaceId,
          operations: [],
          managedOperations: [],
          operationalSurface: [],
          rollbackAdvertised: false,
          previewReadOnly: true,
          reason: "No real RefactorKit engine is installed in this deterministic harness.",
        };
      case "get_refactorkit_capabilities":
        return structuredClone(CURRENT_IDE_CAPABILITIES);
      case "start_refactorkit_saved_snapshot_semantic_session": {
        const request = this.#exactRequest(args, command);
        assert.equal(this.#nativeSemanticSessionActive, false);
        this.#nativeSemanticSessionActive = true;
        return {
          languageId: request.languageId,
          workspaceRoot: request.workspaceRoot,
          workspaceId: request.workspaceId,
          workspaceGeneration: request.workspaceGeneration,
          sessionId: AUTHORITY.sessionId,
          providerProjectSnapshotIdentity: AUTHORITY.projectSnapshotHash,
          semanticLease: AUTHORITY.semanticLease,
          startSnapshotHash: AUTHORITY.projectSnapshotHash,
          provider: request.provider,
          providerVersion: request.providerVersion,
          backend: request.backend,
          toolchain: {
            backend: request.backend,
            runtime: request.runtime,
            extensions: request.extensions,
            nodeExecutable: APPROVED_TOOLCHAIN.nodeExecutable,
            languageServerPackageRoot: APPROVED_TOOLCHAIN.languageServerPackageRoot,
            typeScriptPackageRoot: APPROVED_TOOLCHAIN.typeScriptPackageRoot,
          },
          semanticCompleteness: "full-typescript",
          processProvenance: {
            serverName: "typescript-language-server",
            serverVersion: "5.1.3",
            capabilitiesSha256: "5".repeat(64),
            executableSha256: "6".repeat(64),
            argumentsSha256: "7".repeat(64),
            processId: 42,
          },
        };
      }
      case "search_refactorkit_saved_snapshot_symbols": {
        const request = this.#exactRequest(args, command);
        assert.equal(this.#nativeSemanticSessionActive, true);
        return {
          languageId: request.languageId,
          query: request.query,
          workspaceId: request.workspaceId,
          workspaceGeneration: request.workspaceGeneration,
          sessionId: request.sessionId,
          snapshotIdentity: request.snapshotIdentity,
          providerVersion: request.providerVersion,
          backend: request.backend,
          completeness: {
            resultCompleteness: "unknown",
            truncation: "unknown",
            semanticCompleteness: "full-typescript",
            experimentalDisclosure: "shown",
          },
          symbols: [{ id: `lsp-symbol-v1:${"8".repeat(64)}`, name: "Broken", kind: "VARIABLE" }],
        };
      }
      case "stop_refactorkit_saved_snapshot_semantic_session": {
        const request = this.#exactRequest(args, command);
        this.#nativeSemanticSessionActive = false;
        return { ...request, stopped: true };
      }
      case "run_refactorkit_diagnostics":
        return this.#diagnosticsResponse(args);
      case "get_xcom2_setup_monitor_snapshot":
      case "refresh_xcom2_setup_monitor_snapshot":
        return {
          workspaceId: AUTHORITY.workspaceId,
          generation: AUTHORITY.workspaceGeneration,
          steamRoot: { source: "unknown", pathRedacted: true },
          products: [],
          overallState: "not-found",
          canPlanSetup: false,
          canApplySetup: false,
          blockers: ["Required products are not installed."],
          warnings: [],
          checkedAt: READY_REFACTORKIT_STATUS.checkedAt,
        };
      default:
        throw new Error(
          `The RefactorKit 0.7.0-SNAPSHOT diagnostics fixture does not implement Tauri command ${command}`,
        );
    }
  }

  #exactRequest(
    args: Record<string, unknown> | undefined,
    command: string,
  ): Record<string, unknown> {
    const request = args?.request;
    assert.ok(request !== null && typeof request === "object" && !Array.isArray(request));
    assert.deepEqual(
      Object.keys(args ?? {}),
      ["request"],
      `${command} escaped its request envelope`,
    );
    return request as Record<string, unknown>;
  }

  #diagnosticsResponse(args: Record<string, unknown> | undefined): Promise<unknown> | unknown {
    const request = this.#exactRequest(args, "run_refactorkit_diagnostics") as DiagnosticsRequest;
    assertExactFields(request, REQUEST_FIELDS, "diagnostics.v2 Tauri request");
    assert.match(request.requestId, /^desktop-diagnostics:1:[1-9][0-9]*$/u);
    assert.deepEqual(request, { ...DIAGNOSTICS_REQUEST, requestId: request.requestId });
    this.#diagnosticRequests.push(structuredClone(request));

    if (this.#diagnosticRequests.length === 1) {
      this.#diagnostics = envelope(request.requestId, "ready", {
        compilerAttestation: COMPILER_ATTESTATION,
        failure: null,
        diagnostics: [EXACT_DIAGNOSTIC],
      });
      this.#readyDiagnosticsPromise = new Promise((resolve) => {
        this.#resolveReadyDiagnostics = resolve;
      });
      return this.#readyDiagnosticsPromise;
    }
    if (this.#diagnosticRequests.length === 2) {
      this.#refusedDiagnostics = envelope(request.requestId, "refused", {
        compilerAttestation: null,
        failure: {
          code: "diagnostics.semanticLeaseStale",
          message: "Semantic session lease is stale or belongs to another snapshot",
        },
      });
      return structuredClone(this.#refusedDiagnostics);
    }
    if (this.#diagnosticRequests.length === 3) {
      this.#errorDiagnostics = envelope(request.requestId, "error", {
        compilerAttestation: COMPILER_ATTESTATION,
        failure: {
          code: "typescript.compilerDiagnosticsTimeout",
          message: "Exact compiler diagnostics timed out",
        },
      });
      return structuredClone(this.#errorDiagnostics);
    }
    if (this.#diagnosticRequests.length === 4) {
      this.#staleDiagnostics = envelope(request.requestId, "refused", {
        compilerAttestation: null,
        failure: {
          code: "diagnostics.semanticLeaseStale",
          message: "Semantic session lease is stale or belongs to another snapshot",
        },
        semanticLease: "semantic-00000000-0000-4000-8000-000000000000",
      });
      return structuredClone(this.#staleDiagnostics);
    }
    assert.fail("The production App emitted an unexpected extra diagnostics.v2 request");
  }

  #requireSurface(): RenderResult {
    assert.ok(this.#surface, "The production desktop App has not been rendered");
    return this.#surface;
  }

  #assertEnvelope(response: DiagnosticsEnvelope, status: DiagnosticsStatus): void {
    assertExactFields(response, RESPONSE_FIELDS, `diagnostics.v2 ${status} response`);
    assert.equal(response.schemaVersion, SCHEMA_VERSION);
    assert.equal(response.operation, OPERATION);
    assert.equal(response.status, status);
    assert.equal(response.responseBytes, Buffer.byteLength(JSON.stringify(response), "utf8"));
    assert.ok(response.responseBytes <= MAX_RESPONSE_BYTES);
  }

  #requireCapabilities(): RefactorKitCapabilities {
    assert.ok(this.#capabilities, "RefactorKit capabilities were not discovered");
    return this.#capabilities;
  }

  #requireDiagnostics(): DiagnosticsEnvelope {
    assert.ok(this.#diagnostics, "No production diagnostics.v2 response was accepted");
    return this.#diagnostics;
  }

  #requireRefusedDiagnostics(): DiagnosticsEnvelope {
    assert.ok(
      this.#refusedDiagnostics,
      "No production diagnostics.v2 refused response was accepted",
    );
    return this.#refusedDiagnostics;
  }

  #requireErrorDiagnostics(): DiagnosticsEnvelope {
    assert.ok(this.#errorDiagnostics, "No production diagnostics.v2 error response was accepted");
    return this.#errorDiagnostics;
  }

  #requireStaleDiagnostics(): DiagnosticsEnvelope {
    assert.ok(this.#staleDiagnostics, "No stale diagnostics.v2 response reached the controller");
    return this.#staleDiagnostics;
  }
}
