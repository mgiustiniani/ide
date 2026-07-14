import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { act, renderHook } from "@testing-library/react";

import { createTauriAdapters } from "../../../apps/desktop/src/adapters/index.js";
import {
  useRefactorKitStatusController,
  type RefactorKitStatusController,
} from "../../../apps/desktop/src/features/refactorkit-status/useRefactorKitStatusController.js";
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

function advertisedScriptAdapter(languageId: "javascript" | "typescript") {
  const extensions = languageId === "typescript" ? ["ts", "tsx"] : ["js", "jsx"];
  return {
    languageId,
    extensions,
    backend: "tree-sitter-jni-0.25.3+typescript-lsp-explicit-v1",
    runtime: QUALIFIED_RUNTIME,
    capabilities: [{ ...DIAGNOSTICS_CAPABILITY, extensions }],
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
        advertisedAdapter.capabilities[0],
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

  #restoreProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
}
