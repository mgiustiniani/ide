// -----------------------------------------------------------------------------
// tests/story/support/java-language-service.ts
// Characterization Story BDD driver for REQ-IDE-JAVA-LANGUAGE-001
// (features/workspace/java-language-service.feature).
//
// This feature characterizes an ALREADY-IMPLEMENTED operational Java language
// service. The driver drives the REAL production Tauri adapters
//   packages/tauri-adapters/src/language-session-tauri.ts  (LanguageSessionPort + DocumentSyncPort)
//   packages/tauri-adapters/src/java-intelligence-tauri.ts (JavaIntelligencePort)
// through a fake in-process Tauri invoke boundary (window.__TAURI_INTERNALS__.invoke),
// mirroring the existing desktop tauri-harness convention. The adapters run their
// real extract -> delegate -> response pipeline: validation, normalization,
// honest unavailable/cancellation rejection, and versioned document-sync gates.
//
// Evidence boundaries (honest):
//   - honest-unavailable  = the genuine environment path. When no JDT LS / JDK
//     toolchain is discoverable the native boundary reports available=false and
//     the adapter reports state "unavailable" with all capabilities false, and
//     intelligence requests reject with kind "unavailable" — never fabricated
//     success.
//   - ready-path          = deterministic in-process native fixture that proves
//     the adapter lifecycle/document-sync/intelligence pipeline for a ready JDT
//     LS session. It is NOT a live JDT LS spawn; the spawn path is proven
//     separately by the existing Rust unit tests via `cargo test`.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TauriLanguageSessionAdapter } from "../../../packages/tauri-adapters/src/language-session-tauri.js";
import { TauriJavaIntelligenceAdapter } from "../../../packages/tauri-adapters/src/java-intelligence-tauri.js";
import type { LanguageServiceStatus } from "../../../packages/contracts/src/language-service.js";
import type {
  JavaCompletionResponse,
  JavaHoverResponse,
  JavaSignatureHelpResponse,
} from "../../../packages/contracts/src/java-intelligence.js";

export const REQUIREMENT = "REQ-IDE-JAVA-LANGUAGE-001";
export const WORKSPACE_ID = "workspace-java";
export const JAVA_DOCUMENT_PATH = "src/main/java/example/App.java";
export const JAVA_DOCUMENT_URI = "file:///workspace-java/src/main/java/example/App.java";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "../../..");
const WEB_FIRST_LAYERS = ["packages/ui", "packages/web-core", "apps/web"] as const;

const FEATURE_PATH = join(REPO_ROOT, "features/workspace/java-language-service.feature");

const JAVA_SOURCE = `package example;

public final class App {
  public static String helper(String value, int count) {
    return value.repeat(count);
  }
  void run() {
    String text = "hello";
    text.substring(0);
    helper(text, 2);
  }
}
`;

/** The native lifecycle states reported by the fake Rust backend. */
type NativeLifecycle =
  | "stopped"
  | "starting"
  | "ready"
  | "stopping"
  | "unavailable";

interface BoundaryInvocation {
  readonly sequence: number;
  readonly command: string;
  readonly args?: Record<string, unknown>;
}

interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface NativeStatusPayload {
  available: boolean;
  lifecycle: NativeLifecycle;
  provider: "jdtls";
  workspaceId: string;
  workspaceRoot: string;
  generation: number;
  capabilities?: Record<string, boolean>;
  jdtlsVersion?: string;
  jdtlsHome?: string;
  javaExecutable?: string;
  javaVersion?: string;
  checkedAt: string;
}

interface NativeEvent {
  sequence: number;
  generation: number;
  kind: "status" | "progress";
  payload: Record<string, unknown>;
}

type SemanticKind = "completion" | "hover" | "signature";

export interface WebFirstLayerScanResult {
  readonly layer: string;
  readonly platformApiImportCount: number;
}

/** Result of parsing the feature for AC-006 status reconciliation. */
export interface FeatureStatusReconciliation {
  readonly featureStatusTags: readonly string[];
  readonly scenarioStatusTags: readonly string[];
  readonly requirementTags: readonly string[];
}

function readyCapabilities(): Record<string, boolean> {
  return {
    documentSync: true,
    diagnostics: true,
    completion: true,
    hover: true,
    definition: false,
    references: false,
    documentSymbols: false,
    workspaceSymbols: false,
    rename: false,
    codeActions: false,
    formatting: false,
    signatureHelp: true,
  };
}

function walkSourceFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) {
    return results;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === ".turbo" ||
      entry.name === ".next" ||
      entry.name === "coverage"
    ) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkSourceFiles(full));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/u.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/** Recursively collect `.feature` files under `dir`. */
function walkFeatureFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) {
    return results;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFeatureFiles(full));
    } else if (entry.name.endsWith(".feature")) {
      results.push(full);
    }
  }
  return results;
}

function statusPayload(
  lifecycle: NativeLifecycle,
  generation: number,
  available: boolean,
  capabilities?: Record<string, boolean>,
): NativeStatusPayload {
  return {
    available,
    lifecycle,
    provider: "jdtls",
    workspaceId: WORKSPACE_ID,
    workspaceRoot: "/workspace-java",
    generation,
    ...(capabilities !== undefined ? { capabilities } : {}),
    ...(available
      ? {
          jdtlsVersion: "1.32.0",
          jdtlsHome: "/opt/jdtls",
          javaExecutable: "/usr/bin/java",
          javaVersion: "21",
        }
      : {}),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Deterministic in-process native boundary. It simulates the Rust
 * `commands::java_language` backend behind `window.__TAURI_INTERNALS__.invoke`.
 * The ready path is a deterministic fixture; the honest-unavailable path is a
 * genuine `available=false` discovery outcome.
 */
class JavaLanguageNativeBoundary implements TauriInternals {
  #sequence = 0;
  #generation = 0;
  #lifecycle: NativeLifecycle = "stopped";
  #available = true;
  #events: NativeEvent[] = [];
  #latestSequence = 0;
  #semanticDeferred: { kind: SemanticKind; request: Record<string, unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void } | undefined;
  #cancelPending = false;
  #deferNextCompletion = false;
  readonly invocations: BoundaryInvocation[] = [];
  readonly syncedDocuments: Record<string, unknown>[] = [];

  constructor(private readonly pollLimit: number) {}

  async invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
    const seq = ++this.#sequence;
    this.invocations.push(
      args === undefined ? { sequence: seq, command } : { sequence: seq, command, args },
    );
    switch (command) {
      case "get_java_language_service_status":
        return this.#status();
      case "start_java_language_service":
        this.#generation += 1;
        this.#lifecycle = "ready";
        this.#available = true;
        this.#pushStatusEvent(this.#generation, "ready");
        return this.#status();
      case "restart_java_language_service":
        this.#generation += 1;
        this.#lifecycle = "ready";
        this.#available = true;
        this.#pushStatusEvent(this.#generation, "ready");
        return this.#status();
      case "stop_java_language_service":
        this.#lifecycle = "stopped";
        this.#pushStatusEvent(this.#generation, "stopped");
        return this.#status();
      case "poll_java_language_service_events": {
        const afterSequence = Number(args?.afterSequence ?? 0);
        const limit = Math.min(this.pollLimit, Number(args?.limit ?? this.pollLimit));
        const pending = this.#events.filter((event) => event.sequence > afterSequence).slice(0, limit);
        this.#events = this.#events.filter((event) => event.sequence <= afterSequence);
        this.#latestSequence = Math.max(this.#latestSequence, afterSequence);
        return { events: pending, latestSequence: this.#latestSequence };
      }
      case "open_java_language_document":
      case "change_java_language_document":
      case "save_java_language_document":
      case "close_java_language_document":
        this.syncedDocuments.push((args?.document ?? {}) as Record<string, unknown>);
        return undefined;
      case "request_java_completion":
      case "request_java_hover":
      case "request_java_signature_help": {
        const kind: SemanticKind =
          command === "request_java_completion"
            ? "completion"
            : command === "request_java_hover"
              ? "hover"
              : "signature";
        const request = (args?.request as Record<string, unknown>) ?? {};
        if (this.#available) {
          if (this.#deferNextCompletion && kind === "completion") {
            // Defer the completion so cancellation lands while the request is in flight.
            const deferred: {
              kind: SemanticKind;
              request: Record<string, unknown>;
              resolve: (v: unknown) => void;
              reject: (e: unknown) => void;
            } = {
              kind,
              request,
              resolve: () => undefined,
              reject: () => undefined,
            };
            const promise = new Promise<unknown>((resolveFn, rejectFn) => {
              deferred.resolve = resolveFn;
              deferred.reject = rejectFn;
            });
            this.#semanticDeferred = deferred;
            this.#deferNextCompletion = false;
            return promise;
          }
          return this.#semanticResult(kind, request);
        }
        // Honest-unavailable: discovery found no JDT LS / JDK toolchain.
        return this.#semanticUnavailable(kind, request);
      }
      case "cancel_java_semantic_request":
        // Cancellation is best-effort and idempotent in the real adapter. Mark the
        // pending completion so a later settle resolves it as cancelled.
        this.#cancelPending = true;
        return undefined;
      default:
        throw new Error(`The Java language-service Story boundary does not implement ${command}`);
    }
  }

  /** Defer the next completion so cancellation lands while the request is in flight. */
  setDeferNextCompletion(): void {
    this.#deferNextCompletion = true;
  }

  /** Resolve a deferred in-flight completion as cancelled (AC-003 cancellation). */
  settleCancelledCompletion(): void {
    if (this.#semanticDeferred !== undefined) {
      const deferred = this.#semanticDeferred;
      this.#semanticDeferred = undefined;
      deferred.resolve(this.#semanticCancelled("completion", deferred.request));
    }
  }

  #status(): NativeStatusPayload {
    const ready = this.#available && (this.#lifecycle === "ready" || this.#lifecycle === "starting");
    return statusPayload(
      this.#lifecycle,
      this.#generation,
      this.#available,
      ready ? readyCapabilities() : undefined,
    );
  }

  #pushStatusEvent(generation: number, lifecycle: NativeLifecycle): void {
    this.#events.push({
      sequence: ++this.#sequence,
      generation,
      kind: "status",
      payload: { available: this.#available, lifecycle, capabilities: readyCapabilities() },
    });
  }

  #semanticResult(kind: SemanticKind, request: Record<string, unknown>): Record<string, unknown> {
    const requestId = String(request.requestId);
    const cancellationId = String(request.cancellationId);
    const base = {
      provider: "jdtls",
      providerVersion: "1.32.0",
      workspaceId: String(request.workspaceId),
      generation: Number(request.generation),
      path: String((request.document as Record<string, unknown>).path),
      uri: String((request.document as Record<string, unknown>).uri),
      version: Number((request.document as Record<string, unknown>).version),
      requestId,
      cancellationId,
      cancelled: false,
      timeout: false,
      error: null,
    };
    if (kind === "completion") {
      return {
        ...base,
        result: {
          items: [
            { label: "toString", kind: "method", detail: "String.toString()" },
            { label: "helper", kind: "method", detail: "App.helper(String, int)" },
          ],
          isIncomplete: false,
        },
      };
    }
    if (kind === "hover") {
      return {
        ...base,
        result: {
          contents: [{ format: "markdown", value: "`java.lang.String#toString()`" }],
          isTruncated: false,
          range: { start: { line: 0, character: 10 }, end: { line: 0, character: 18 } },
        },
      };
    }
    return {
      ...base,
      result: {
        signatures: [
          {
            label: "helper(String value, int count)",
            parameters: [
              { label: "String value" },
              { label: "int count" },
            ],
          },
        ],
        isTruncated: false,
        activeSignature: 0,
        activeParameter: 0,
      },
    };
  }

  #semanticUnavailable(_kind: SemanticKind, request: Record<string, unknown>): Record<string, unknown> {
    return {
      provider: "jdtls",
      providerVersion: null,
      workspaceId: String(request.workspaceId),
      generation: Number(request.generation),
      path: String((request.document as Record<string, unknown>).path),
      uri: String((request.document as Record<string, unknown>).uri),
      version: Number((request.document as Record<string, unknown>).version),
      requestId: String(request.requestId),
      cancelled: false,
      timeout: false,
      error: { kind: "unavailable", summary: "Java semantic provider is unavailable", retryable: true },
      result: null,
    };
  }

  #semanticCancelled(_kind: SemanticKind, request: Record<string, unknown>): Record<string, unknown> {
    return {
      provider: "jdtls",
      providerVersion: null,
      workspaceId: String(request.workspaceId),
      generation: Number(request.generation),
      path: String((request.document as Record<string, unknown>).path),
      uri: String((request.document as Record<string, unknown>).uri),
      version: Number((request.document as Record<string, unknown>).version),
      requestId: String(request.requestId),
      cancelled: true,
      timeout: false,
      error: null,
      result: null,
    };
  }

  setUnavailable(): void {
    this.#available = false;
    this.#lifecycle = "stopped";
  }
}

/**
 * Characterization Story driver. It owns the real adapters, the fake native
 * boundary, and the honest evidence boundaries (honest-unavailable vs
 * ready-path deterministic fixture, plus the cargo-test spawn-path evidence).
 */
export class JavaLanguageServiceStorySession {
  #started = false;
  #boundary?: JavaLanguageNativeBoundary;
  #languageSession?: TauriLanguageSessionAdapter;
  #documentSync?: TauriLanguageSessionAdapter;
  #javaIntelligence?: TauriJavaIntelligenceAdapter;
  #workspaceRoot?: string;
  #windowDescriptor?: PropertyDescriptor | undefined;
  #windowRestored = false;
  #status?: LanguageServiceStatus;
  #documentStatus?: LanguageServiceStatus;
  #lifecycleEvents: LanguageServiceStatus[] = [];
  #unsubscribe?: () => void;
  #completionResponse?: JavaCompletionResponse;
  #hoverResponse?: JavaHoverResponse;
  #signatureResponse?: JavaSignatureHelpResponse;
  #unavailableIntelligence?: JavaCompletionResponse;
  #cancelledResponse?: JavaCompletionResponse;
  #cargoTestProof?: string;
  #webBuildProof?: string;
  #webFirstLayerScan?: WebFirstLayerScanResult[];
  #featureReconciliation?: FeatureStatusReconciliation;
  #notReadyDecline?: string;
  #syncInvocations: Record<string, unknown>[] = [];

  start(): void {
    assert.equal(this.#started, false, "The Java language-service Story session already started");
    this.#started = true;
    this.#workspaceRoot = this.#createWorkspace();
    this.#installTauriBoundary();

    const boundary = new JavaLanguageNativeBoundary(50);
    this.#boundary = boundary;
    this.#installBoundary(boundary);

    this.#languageSession = new TauriLanguageSessionAdapter({
      pollIntervalMs: 50,
      hiddenPollIntervalMs: 100,
      pollLimit: 20,
    });
    this.#documentSync = this.#languageSession;
    this.#javaIntelligence = new TauriJavaIntelligenceAdapter();
  }

  /**
   * AC-001/AC-002 precondition: a ready, running JDT LS session for the
   * workspace, established through the real adapter + native boundary.
   */
  async startReadySession(): Promise<LanguageServiceStatus> {
    this.#assertStarted();
    const status = await this.#languageSession!.start({ workspaceId: WORKSPACE_ID, requestId: "story-start-1" });
    this.#documentStatus = status;
    assert.equal(status.state, "ready");
    return status;
  }

  async requestStatus(): Promise<LanguageServiceStatus> {
    this.#assertStarted();
    this.#status = await this.#languageSession!.getStatus({ workspaceId: WORKSPACE_ID });
    return this.#status;
  }

  async startService(): Promise<LanguageServiceStatus> {
    this.#assertStarted();
    this.#status = await this.#languageSession!.start({ workspaceId: WORKSPACE_ID, requestId: "story-start-2" });
    return this.#status;
  }

  async restartService(): Promise<LanguageServiceStatus> {
    this.#assertStarted();
    this.#status = await this.#languageSession!.restart({
      workspaceId: WORKSPACE_ID,
      generation: this.#status!.generation,
      requestId: "story-restart-1",
    });
    return this.#status;
  }

  async stopService(): Promise<LanguageServiceStatus> {
    this.#assertStarted();
    this.#status = await this.#languageSession!.stop({
      workspaceId: WORKSPACE_ID,
      generation: this.#status!.generation,
      requestId: "story-stop-1",
    });
    return this.#status;
  }

  /** Subscribe and wait for a polled lifecycle status event (AC-001 poll-events channel). */
  async observePollEvents(): Promise<LanguageServiceStatus[]> {
    this.#assertStarted();
    const collected: LanguageServiceStatus[] = [];
    this.#unsubscribe = this.#languageSession!.subscribe(WORKSPACE_ID, (event) => {
      if (event.type === "status") collected.push(event.status);
    });
    await this.#waitFor(() => collected.length > 0);
    this.#lifecycleEvents = collected;
    this.#unsubscribe();
    this.#unsubscribe = undefined;
    return collected;
  }

  /** Honest-unavailable: discovery finds no JDT LS / JDK toolchain. */
  async markUnavailable(): Promise<LanguageServiceStatus> {
    this.#assertStarted();
    this.#boundary!.setUnavailable();
    this.#status = await this.#languageSession!.getStatus({ workspaceId: WORKSPACE_ID });
    return this.#status;
  }

  /** Honest-unavailable intelligence rejection through the real adapter. */
  async requestUnavailableIntelligence(): Promise<JavaCompletionResponse> {
    this.#assertStarted();
    const response = await this.#javaIntelligence!.completion({
      workspaceId: WORKSPACE_ID,
      generation: this.#status?.generation ?? 0,
      document: { path: JAVA_DOCUMENT_PATH, uri: JAVA_DOCUMENT_URI, version: 1 },
      position: { line: 0, character: 0 },
      requestId: "story-unavailable-1",
      cancellationId: "story-unavailable-cancel-1",
    });
    this.#unavailableIntelligence = response;
    return response;
  }

  async openDocument(): Promise<void> {
    this.#assertStarted();
    await this.#documentSync!.didOpen({
      document: {
        workspaceId: WORKSPACE_ID,
        path: JAVA_DOCUMENT_PATH,
        uri: JAVA_DOCUMENT_URI,
        languageId: "java",
        text: JAVA_SOURCE,
        version: 1,
      },
    });
    this.#syncInvocations = this.#boundary!.syncedDocuments.map((document) => ({ ...document }));
  }

  async changeDocument(): Promise<void> {
    this.#assertStarted();
    await this.#documentSync!.didChange({
      document: {
        workspaceId: WORKSPACE_ID,
        path: JAVA_DOCUMENT_PATH,
        uri: JAVA_DOCUMENT_URI,
        languageId: "java",
        text: `${JAVA_SOURCE}\n// edited\n`,
        version: 2,
      },
    });
    this.#syncInvocations = this.#boundary!.syncedDocuments.map((document) => ({ ...document }));
  }

  async saveDocument(): Promise<void> {
    this.#assertStarted();
    await this.#documentSync!.didSave({
      document: {
        workspaceId: WORKSPACE_ID,
        path: JAVA_DOCUMENT_PATH,
        uri: JAVA_DOCUMENT_URI,
        languageId: "java",
        text: `${JAVA_SOURCE}\n// edited\n`,
        version: 2,
      },
    });
    this.#syncInvocations = this.#boundary!.syncedDocuments.map((document) => ({ ...document }));
  }

  async closeDocument(): Promise<void> {
    this.#assertStarted();
    await this.#documentSync!.didClose({
      document: {
        workspaceId: WORKSPACE_ID,
        path: JAVA_DOCUMENT_PATH,
        uri: JAVA_DOCUMENT_URI,
        version: 2,
      },
    });
    this.#syncInvocations = this.#boundary!.syncedDocuments.map((document) => ({ ...document }));
  }

  /**
   * AC-002 decline: an intelligence-targeted change for a document that was
   * never fully synced (not opened) must be declined, never served.
   */
  async requestChangeForUnsyncedDocument(): Promise<void> {
    this.#assertStarted();
    try {
      await this.#documentSync!.didChange({
        document: {
          workspaceId: WORKSPACE_ID,
          path: "src/main/java/example/Unsynced.java",
          uri: "file:///workspace-java/src/main/java/example/Unsynced.java",
          languageId: "java",
          text: "package example;",
          version: 1,
        },
      });
      this.#notReadyDecline = "accepted";
    } catch (error) {
      this.#notReadyDecline = error instanceof Error ? error.message : String(error);
    }
  }

  async requestCompletion(): Promise<JavaCompletionResponse> {
    this.#assertStarted();
    const response = await this.#javaIntelligence!.completion({
      workspaceId: WORKSPACE_ID,
      generation: this.#documentStatus!.generation,
      document: { path: JAVA_DOCUMENT_PATH, uri: JAVA_DOCUMENT_URI, version: 2 },
      position: { line: 0, character: 0 },
      requestId: "story-completion-1",
      cancellationId: "story-completion-cancel-1",
    });
    this.#completionResponse = response;
    return response;
  }

  async requestHover(): Promise<JavaHoverResponse> {
    this.#assertStarted();
    const response = await this.#javaIntelligence!.hover({
      workspaceId: WORKSPACE_ID,
      generation: this.#documentStatus!.generation,
      document: { path: JAVA_DOCUMENT_PATH, uri: JAVA_DOCUMENT_URI, version: 2 },
      position: { line: 0, character: 10 },
      requestId: "story-hover-1",
      cancellationId: "story-hover-cancel-1",
    });
    this.#hoverResponse = response;
    return response;
  }

  async requestSignatureHelp(): Promise<JavaSignatureHelpResponse> {
    this.#assertStarted();
    const response = await this.#javaIntelligence!.signatureHelp({
      workspaceId: WORKSPACE_ID,
      generation: this.#documentStatus!.generation,
      document: { path: JAVA_DOCUMENT_PATH, uri: JAVA_DOCUMENT_URI, version: 2 },
      position: { line: 0, character: 0 },
      requestId: "story-signature-1",
      cancellationId: "story-signature-cancel-1",
    });
    this.#signatureResponse = response;
    return response;
  }

  /**
   * AC-003 cancellation: start an in-flight completion, cancel it, then settle
   * the native response as cancelled. No cancelled result is delivered.
   */
  async cancelInFlightCompletion(): Promise<void> {
    this.#assertStarted();
    // Defer the native completion response so cancellation lands while in flight.
    this.#boundary!.setDeferNextCompletion();
    const pending = this.#javaIntelligence!.completion({
      workspaceId: WORKSPACE_ID,
      generation: this.#documentStatus!.generation,
      document: { path: JAVA_DOCUMENT_PATH, uri: JAVA_DOCUMENT_URI, version: 2 },
      position: { line: 0, character: 0 },
      requestId: "story-cancel-1",
      cancellationId: "story-cancel-cancel-1",
    });
    await this.#javaIntelligence!.cancel("story-cancel-cancel-1");
    await this.#waitFor(() => this.#boundary!.invocations.some((i) => i.command === "cancel_java_semantic_request"));
    this.#boundary!.settleCancelledCompletion();
    const response = await pending;
    this.#cancelledResponse = response;
  }

  /**
   * AC-004: the adapter extracts only the request payload needed by the delegate
   * and returns the delegated response. This inspects the real invoke envelope.
   */
  adapterEnvelope(): Record<string, unknown> | undefined {
    const invocation = this.#boundary!.invocations.find(
      (i) => i.command === "request_java_completion",
    );
    return invocation?.args?.request as Record<string, unknown> | undefined;
  }

  /** AC-005: scan the web-first layers for @tauri-apps/api imports. */
  scanWebFirstLayers(): WebFirstLayerScanResult[] {
    this.#assertStarted();
    const results: WebFirstLayerScanResult[] = [];
    for (const layer of WEB_FIRST_LAYERS) {
      const layerRoot = join(REPO_ROOT, layer);
      let count = 0;
      for (const file of walkSourceFiles(layerRoot)) {
        const text = readFileSync(file, "utf8");
        if (/@tauri-apps\/api/u.test(text)) count += 1;
      }
      results.push({ layer, platformApiImportCount: count });
    }
    this.#webFirstLayerScan = results;
    return results;
  }

  /** AC-005: capability access to the Java language service is defined through ports. */
  portCapabilityEvidence(): { port: string; declaresInterface: boolean; tauriImports: number }[] {
    this.#assertStarted();
    const ports = [
      "packages/web-core/src/ports/language-session-port.ts",
      "packages/web-core/src/ports/document-sync-port.ts",
      "packages/web-core/src/ports/java-intelligence-port.ts",
    ] as const;
    return ports.map((port) => {
      const text = readFileSync(join(REPO_ROOT, port), "utf8");
      const declaresInterface = /interface\s+(LanguageSessionPort|DocumentSyncPort|JavaIntelligencePort)/u.test(text);
      const tauriImports = /@tauri-apps\/api/u.test(text) ? 1 : 0;
      return { port, declaresInterface, tauriImports };
    });
  }

  /** AC-006: parse the feature file for status/requirement reconciliation. */
  reconcileFeatureStatus(): FeatureStatusReconciliation {
    this.#assertStarted();
    const text = readFileSync(FEATURE_PATH, "utf8");
    // Only declared tag lines carry an effective status; step text that merely
    // mentions "@not-implemented" is not a declaration.
    const tagLines = text.split("\n").filter((line) => /^\s*@/u.test(line));
    const statusTags = [
      "@not-implemented",
      "@implemented-and-validated",
      "@implemented-not-e2e-validated",
      "@partial",
      "@config-only",
      "@placeholder",
      "@absent",
    ] as const;
    const declaredStatuses = tagLines.flatMap((line) =>
      statusTags.filter((tag) => line.includes(tag)),
    );
    const requirementTags = [...text.matchAll(/@(REQ-[A-Z0-9-]+)/gu)].map((match) => match[0]);
    this.#featureReconciliation = {
      featureStatusTags: declaredStatuses,
      scenarioStatusTags: declaredStatuses,
      requirementTags: requirementTags,
    };
    return this.#featureReconciliation;
  }

  /** Repository-unique requirement check: the REQ lives in exactly one feature. */
  requirementOccurrences(): { unique: boolean; occurrences: number } {
    this.#assertStarted();
    const featureRoot = join(REPO_ROOT, "features");
    const files = walkFeatureFiles(featureRoot);
    const re = new RegExp(`@${REQUIREMENT}`, "gu");
    let occurrences = 0;
    let filesWithRequirement = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const count = [...text.matchAll(re)].length;
      occurrences += count;
      if (count > 0) filesWithRequirement += 1;
    }
    return { unique: filesWithRequirement === 1, occurrences };
  }

  /** Spawn-path complementary evidence: run the existing Rust java_language unit tests. */
  async proveSpawnPath(): Promise<void> {
    this.#assertStarted();
    try {
      execFileSync("cargo", ["test", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml", "commands::java_language"], {
        cwd: REPO_ROOT,
        timeout: 240_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.#cargoTestProof = "passed";
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`cargo test commands::java_language failed: ${detail}`);
    }
  }

  /** AC-005: the standalone web frontend builds without Tauri. */
  async proveWebBuild(): Promise<void> {
    this.#assertStarted();
    try {
      execFileSync("pnpm", ["--filter", "@ide/web", "build"], {
        cwd: REPO_ROOT,
        timeout: 300_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.#webBuildProof = "passed";
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`web build failed: ${detail}`);
    }
  }

  status(): LanguageServiceStatus | undefined {
    return this.#status;
  }

  documentStatus(): LanguageServiceStatus | undefined {
    return this.#documentStatus;
  }

  lifecycleEvents(): readonly LanguageServiceStatus[] {
    return this.#lifecycleEvents;
  }

  completionResponse(): JavaCompletionResponse | undefined {
    return this.#completionResponse;
  }

  hoverResponse(): JavaHoverResponse | undefined {
    return this.#hoverResponse;
  }

  signatureResponse(): JavaSignatureHelpResponse | undefined {
    return this.#signatureResponse;
  }

  unavailableIntelligence(): JavaCompletionResponse | undefined {
    return this.#unavailableIntelligence;
  }

  cancelledResponse(): JavaCompletionResponse | undefined {
    return this.#cancelledResponse;
  }

  notReadyDecline(): string | undefined {
    return this.#notReadyDecline;
  }

  syncInvocations(): readonly Record<string, unknown>[] {
    return this.#syncInvocations;
  }

  webFirstLayerScan(): readonly WebFirstLayerScanResult[] | undefined {
    return this.#webFirstLayerScan;
  }

  featureReconciliation(): FeatureStatusReconciliation | undefined {
    return this.#featureReconciliation;
  }

  cargoTestProof(): string | undefined {
    return this.#cargoTestProof;
  }

  webBuildProof(): string | undefined {
    return this.#webBuildProof;
  }

  evidence(): Record<string, unknown> {
    return {
      requirement: REQUIREMENT,
      phase: "characterization-green",
      declaredStatus: "@not-implemented",
      evidenceKind: "tauri-harness",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
      honestUnavailablePath: this.#status?.state === "unavailable" ? this.#status : undefined,
      readyPath: this.#documentStatus?.state === "ready" ? this.#documentStatus : undefined,
      lifecycleEvents: this.#lifecycleEvents.map((s) => ({ state: s.state, generation: s.generation })),
      spawnPathEvidence: this.#cargoTestProof,
      webBuildEvidence: this.#webBuildProof,
      webFirstLayerScan: this.#webFirstLayerScan,
      featureReconciliation: this.#featureReconciliation,
      notReadyDecline: this.#notReadyDecline,
      adapterEnvelope: this.adapterEnvelope(),
      syncInvocationCount: this.#syncInvocations.length,
    };
  }

  dispose(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#restoreTauriBoundary();
    if (this.#workspaceRoot) {
      rmSync(this.#workspaceRoot, { recursive: true, force: true });
      this.#workspaceRoot = undefined;
    }
  }

  #assertStarted(): void {
    assert.ok(this.#started, "The Java language-service Story session has not been started");
  }

  #createWorkspace(): string {
    const root = mkdtempSync(join(tmpdir(), "ide-java-language-story-"));
    const javaFile = join(root, JAVA_DOCUMENT_PATH);
    mkdirSync(dirname(javaFile), { recursive: true });
    writeFileSync(javaFile, JAVA_SOURCE, "utf8");
    writeFileSync(join(root, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion><artifactId>app</artifactId></project>\n", "utf8");
    return root;
  }

  #installTauriBoundary(): void {
    // Ensure a window global exists so @tauri-apps/api/core.invoke can read it.
    const window = (globalThis as Record<string, unknown>).window;
    if (window === undefined) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {},
      });
    }
  }

  #installBoundary(boundary: JavaLanguageNativeBoundary): void {
    const window = (globalThis as Record<string, unknown>).window as Record<string, unknown>;
    const internals: TauriInternals = { invoke: (command, args) => boundary.invoke(command, args) };
    this.#windowDescriptor = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: internals,
    });
    this.#windowRestored = false;
  }

  #restoreTauriBoundary(): void {
    const window = (globalThis as Record<string, unknown>).window as Record<string, unknown>;
    if (window === undefined || this.#windowRestored) return;
    const descriptor = this.#windowDescriptor;
    if (descriptor !== undefined) Object.defineProperty(window, "__TAURI_INTERNALS__", descriptor);
    else Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    this.#windowRestored = true;
  }

  async #waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (!predicate()) {
      if (Date.now() > deadline) {
        throw new Error(`${REQUIREMENT} timed out waiting for a polled native event`);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
  }
}
