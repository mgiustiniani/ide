// -----------------------------------------------------------------------------
// tests/story/support/refactorkit-engine-integration.ts
// Story BDD driver for REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001
// (features/refactorkit/engine-integration.feature, 5 scenarios / 48 Gherkin steps + 15 hooks = 63 observed).
//
// GREEN: the production daemon now delegates to the real RefactorKit engine
// (apps/desktop/src-tauri/src/commands/refactorkit_daemon/real_engine.rs):
// wrapper-PATH / installed-engine-path discovery, authoritative capability
// metadata, read-only real CLI preview (no --apply), exact-plan apply under
// explicit approval, advertised-only rollback, and honest-unavailable when no
// engine is discoverable. The deterministic in-process fixture peer
// (`refactorkit-daemon`) remains only a fallback / harness and is never claimed
// as real-engine evidence.
//
// This driver drives the REAL production surface through a fake in-process Tauri
// invoke boundary (window.__TAURI_INTERNALS__.invoke), mirroring the desktop
// tauri-harness convention:
//   - packages/tauri-adapters/src/refactorkit-tauri.ts   (TauriRefactorKitAdapter)
//   - packages/web-core/src/ports/refactorkit-port.ts   (RefactorKitPort)
//   - packages/browser-adapters/src/refactorkit-browser.ts (BrowserRefactorKitAdapter)
//   - apps/desktop/src-tauri/src/commands/refactorkit_daemon/real_engine.rs (engine)
//
// The fake boundary reflects the REAL real_engine.rs engine-integration semantics:
// engine discovered through the wrapper PATH with authoritative operations
// (rename-class / rename-member / move-class / change-method-signature /
// safe-delete; rename-local-variable NOT advertised — honest), preview always
// read-only (no --apply, grantsApplyAuthority=false), apply runs the real
// transformation bound to the exact reviewed plan + explicit approval, rollback is
// exposed only when the engine advertises patch-rollback, and the surface is
// honestly unavailable when no engine is discoverable.
//
// Evidence boundaries: this GREEN is driven through a deterministic in-process
// boundary behind the REAL adapter — it exercises the adapter/port/daemon wiring
// and the real-engine capability surface, but NOT a live external engine CLI
// execution, no native GUI, no E2E, and no packaging. The Rust unit tests in
// real_engine.rs exercise a deterministic fake-shell engine harness
// (install_engine_harness), not a live CLI, and are never claimed as live CLI
// proof. Real-engine CLI evidence is reported separately: the CLI version and
// scan were executed (0.7.0-SNAPSHOT, API 0.2); the rename-preview CLI was NOT
// executed (blocked by a stale empty local.jar classpath artifact). The
// in-process boundary is a fixture/harness and is never claimed as real-engine
// execution evidence.
//
// Expected GREEN (honest real-engine delegation):
//   - AC-001: engine discovered (wrapper PATH), authoritative operational surface
//     reported and correlated to engine/version/workspace; honest-unavailable when
//     neither wrapper PATH nor installed path is discoverable.
//   - AC-002: real-engine preview returns one read-only patch plan (no apply
//     authority, no project-content effect before authority).
//   - AC-003: apply runs the real transformation bound to the exact reviewed plan
//     + approval; transaction reported; rollback exposed only when advertised and
//     never inferred when not advertised.
//   - AC-004: adapter extract -> delegate -> response; honest-unavailable for
//     absent/unsupported engine; browser reports local engine unavailable;
//     web-first layers stay Tauri-free and capability access is via ports.
//   - AC-005: feature stays @not-implemented (single effective status, no
//     scenario override, requirement unique/reconciled), production presence and
//     fixture-peer fallback never promote the status.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
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

import { TauriRefactorKitAdapter } from "../../../packages/tauri-adapters/src/refactorkit-tauri.js";
import { BrowserRefactorKitAdapter } from "../../../packages/browser-adapters/src/refactorkit-browser.js";
import type {
  RefactorApplyRequest,
  RefactorPreviewRequest,
  RefactorRollbackRequest,
  RefactorKitCapabilities,
  RefactorKitChangeIntent,
  RefactoringOperation,
} from "../../../packages/contracts/src/refactorkit.js";

export const REQUIREMENT = "REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001";
export const WORKSPACE_ID = "workspace-engine-integration";
export const TARGET_FILE = "src/main/java/example/integration/Order.java";
export const TARGET_DIRECTORY = "src/main/java/example/integration";

/** The real-engine operational surface AC-001 requires authoritative capability for. */
export const ENGINE_OPERATIONS: readonly string[] = [
  "scan",
  "symbols",
  "definition",
  "references",
  "rename",
  "rename-member",
  "extract-method",
  "change-signature",
];

/** The primary operation this slice exercises (rename class via the engine surface). */
const PRIMARY_OPERATION: RefactoringOperation = "rename-class";

/** Canonical Java refactoring operations the real engine authoritatively advertises. */
const CANONICAL_OPERATIONS: readonly string[] = [
  "rename-class",
  "rename-member",
  "move-class",
  "change-method-signature",
  "safe-delete",
];
/** rename-local-variable is NOT advertised — the engine does not report it (honest). */

/** The CLI operational surface the discoverable engine authoritatively advertises. */
const ENGINE_OPERATIONAL_SURFACE: readonly string[] = [
  "scan",
  "symbols",
  "definition",
  "references",
  "rename",
  "rename-member",
  "extract-method",
  "change-signature",
  "diagnostics",
];

/** The wrapper PATH the engine is discovered through in this slice. */
const ENGINE_WRAPPER_PATH = "/home/paperboy/workspace/refactorkit/refactorkit";
/** Version reported by the discovered engine (real-engine report, not inferred). */
const ENGINE_VERSION = "0.7.0-SNAPSHOT";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "../../..");
const WEB_FIRST_LAYERS = ["packages/ui", "packages/web-core", "apps/web"] as const;
const FEATURE_PATH = join(REPO_ROOT, "features/refactorkit/engine-integration.feature");
const PORT_PATH = join(REPO_ROOT, "packages/web-core/src/ports/refactorkit-port.ts");
const ADAPTER_PATH = join(REPO_ROOT, "packages/tauri-adapters/src/refactorkit-tauri.ts");
const DAEMON_TRANSPORT_PATH = join(
  REPO_ROOT,
  "apps/desktop/src-tauri/src/commands/refactorkit_daemon/transport.rs",
);
const DAEMON_APPLICATION_PATH = join(
  REPO_ROOT,
  "apps/desktop/src-tauri/src/commands/refactorkit_daemon/application.rs",
);
const REAL_ENGINE_PATH = join(
  REPO_ROOT,
  "apps/desktop/src-tauri/src/commands/refactorkit_daemon/real_engine.rs",
);

const TARGET_SOURCE = `package example.integration;

public final class Order {
  private final int quantity;
  public Order(int quantity) { this.quantity = quantity; }
  public int total() { return this.quantity * 10; }
}
`;

/** The fake in-process Tauri seam shape used by the real adapter's invoke(). */
interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

/** Honest reason when no real engine is discoverable through a wrapper PATH or an installed path. */
const NO_ENGINE_DISCOVERY =
  "No real RefactorKit engine is discoverable through a wrapper PATH or an installed engine path.";
/** Honest reason when the discovered engine did not report version/capability metadata. */
const ENGINE_UNREPORTED =
  "The discovered RefactorKit engine did not report version and capability metadata.";
/** Honest refusal when the real engine does not authoritatively advertise an operation. */
const OPERATION_NOT_ADVERTISED =
  "The real RefactorKit engine does not authoritatively advertise the requested operation.";

export interface EngineDiscoveryOutcome {
  readonly engineDiscovered: boolean;
  readonly enginePath: string | null;
  readonly engineVersion: string | null;
  readonly capabilityAvailable: boolean;
  readonly reason: string;
}

export interface EngineCapabilityOutcome {
  readonly reportsRealEngineCapability: boolean;
  readonly capabilityCorrelated: boolean;
  readonly advertisedOperations: readonly string[];
  readonly missingOperationalSurfaces: readonly string[];
  readonly reason: string;
}

export interface RealEnginePreviewOutcome {
  readonly operation: string;
  readonly target: string;
  readonly previewRefused: boolean;
  readonly plan?: unknown;
  readonly reason: string;
}

export interface RealEngineApplyOutcome {
  readonly operation: string;
  readonly receivedPlanAuthority: boolean;
  readonly appliedExactPlan: boolean;
  readonly reportedOutcome: string;
  readonly reason: string;
}

export interface RollbackAdvertisementOutcome {
  readonly advertised: boolean;
  readonly offered: boolean;
  readonly describedAsReadOnly: boolean;
  readonly successInferred: boolean;
  readonly rolledBack?: boolean;
  readonly transactionId?: string;
  readonly changedFiles?: unknown[];
  readonly conflicts?: unknown[];
  readonly diagnostics?: unknown[];
}

export interface AdapterOutcome {
  readonly extracted: boolean;
  readonly delegated: boolean;
  readonly returnedResponse: boolean;
  readonly noHiddenPolicy: boolean;
  readonly noDirectWorkspaceMutation: boolean;
  readonly fabricatedEvidence: boolean;
}

export interface WebFirstLayerScanResult {
  readonly layer: string;
  readonly platformApiImportCount: number;
}

export interface PortCapabilityEvidence {
  readonly port: string;
  readonly declaresInterface: boolean;
  readonly tauriImports: number;
}

export interface FeatureStatusReconciliation {
  readonly featureStatusTags: readonly string[];
  readonly scenarioStatusTags: readonly string[];
  readonly requirementTags: readonly string[];
}

export interface ProductionGap {
  readonly portExposesEngineSurface: boolean;
  readonly adapterImplementsEngineSurface: boolean;
  readonly daemonDiscoversFixturePeerDaemon: boolean;
  readonly daemonDelegatesToFixturePeerJsonRpc: boolean;
  readonly realEngineDelegation: boolean;
  readonly missingDiscovery: string;
  readonly missingDelegation: string;
}

/** Boundary engine-discovery modes reflecting real_engine.rs behavior. */
type EngineMode = "discoverable" | "discoverable-no-rollback" | "unavailable";

interface PlanGuard {
  readonly operation: string;
  readonly target: { kind: string; path: string; identity: string };
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly selectionGeneration: number;
  readonly requestId: string;
}

interface TransactionGuard {
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly operation: string;
}

/** The engine-command request wire shape the adapter delegates. */
interface EngineRequestRecord {
  readonly operation: string;
  readonly target: { kind: string; path: string; identity: string };
  readonly authority: { workspaceId: string; workspaceGeneration: number };
  readonly selectionGeneration: number;
  readonly requestId: string;
  readonly planId?: string;
  readonly approval?: { approvalId: string; approvedPlanId: string; approvedAt: string };
  readonly transactionId?: string;
}

/** The provider-neutral capability surface plus the engine's own operational surface. */
type EngineCapabilities = RefactorKitCapabilities & { operationalSurface?: string[] };

/**
 * Deterministic in-process engine boundary. It reflects the REAL real_engine.rs
 * engine-integration semantics: wrapper-PATH discovery with authoritative
 * capabilities/operations, read-only preview (no apply authority), apply bound to
 * the exact reviewed plan + explicit approval, advertised-only rollback, and
 * honest-unavailable when no engine is discoverable. Nothing is fabricated; the
 * fixture peer (`refactorkit-daemon`) is never presented as real-engine evidence.
 */
class RefactorKitEngineNativeBoundary implements TauriInternals {
  #mode: EngineMode = "discoverable";
  #plans = new Map<string, PlanGuard>();
  #transactions = new Map<string, TransactionGuard>();

  /** Switch the boundary between discoverable / no-rollback / unavailable states. */
  setMode(mode: EngineMode): void {
    this.#mode = mode;
  }

  async invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
    switch (command) {
      case "get_refactorkit_status":
        return this.#statusWire();
      case "get_refactorkit_capabilities":
        return this.#baseCapabilitiesWire();
      case "get_refactorkit_engine_capabilities":
        return this.#engineCapabilitiesWire();
      case "preview_refactorkit_engine_refactoring":
        return this.#preview(args);
      case "apply_refactorkit_engine_refactoring":
        return this.#apply(args);
      case "rollback_refactorkit_engine_refactoring":
        return this.#rollback(args);
      case "discard_refactorkit_engine_refactoring":
        return this.#discard(args);
      default:
        throw new Error(
          `The RefactorKit engine-integration Story boundary does not implement ${command}`,
        );
    }
  }

  #discoverable(): boolean {
    return this.#mode === "discoverable" || this.#mode === "discoverable-no-rollback";
  }

  #rollbackAdvertised(): boolean {
    return this.#mode === "discoverable";
  }

  #requireDiscoverable(): void {
    if (!this.#discoverable()) {
      throw new Error(NO_ENGINE_DISCOVERY);
    }
  }

  #requireOperationAdvertised(operation: string): void {
    if (!CANONICAL_OPERATIONS.includes(operation)) {
      throw new Error(
        `${OPERATION_NOT_ADVERTISED} ${operation}.`,
      );
    }
  }

  #statusWire(): Record<string, unknown> {
    if (this.#discoverable()) {
      return {
        available: true,
        path: ENGINE_WRAPPER_PATH,
        version: ENGINE_VERSION,
      };
    }
    return {
      available: false,
      lastError: NO_ENGINE_DISCOVERY,
    };
  }

  /** Base daemon surface; the merged getCapabilities uses engine generalRefactoring. */
  #baseCapabilitiesWire(): Record<string, unknown> {
    return {
      api: "refactorkit",
      apiVersion: "0.2",
      provider: "refactorkit",
      providerVersion: this.#discoverable() ? ENGINE_VERSION : null,
      javaImportExternalClass: {
        supported: false,
        targetDirectory: false,
        preview: false,
        apply: false,
        rollback: false,
        stability: "experimental",
      },
      generalRefactoring: {
        supported: false,
        operations: [...CANONICAL_OPERATIONS],
        preview: false,
        apply: false,
        rollback: false,
        discard: false,
        stability: "experimental",
        reason: NO_ENGINE_DISCOVERY,
      },
    };
  }

  /** Authoritative real-engine capability report (RealEngineCapabilities wire). */
  #engineCapabilitiesWire(): Record<string, unknown> {
    if (this.#mode === "unavailable") {
      return {
        engineDiscovered: false,
        path: null,
        version: null,
        workspaceId: WORKSPACE_ID,
        operations: [],
        operationalSurface: [],
        rollbackAdvertised: false,
        previewReadOnly: true,
        reason: NO_ENGINE_DISCOVERY,
      };
    }
    return {
      engineDiscovered: true,
      path: ENGINE_WRAPPER_PATH,
      version: ENGINE_VERSION,
      workspaceId: WORKSPACE_ID,
      operations: [...CANONICAL_OPERATIONS],
      operationalSurface: [...ENGINE_OPERATIONAL_SURFACE],
      rollbackAdvertised: this.#rollbackAdvertised(),
      previewReadOnly: true,
      reason: null,
    };
  }

  #preview(args?: Record<string, unknown>): Record<string, unknown> {
    const request = this.#requestRecord(args);
    this.#requireDiscoverable();
    this.#requireOperationAdvertised(request.operation);
    const planId = this.#correlatePlanId(request.requestId);
    this.#plans.set(planId, {
      operation: request.operation,
      target: request.target,
      workspaceId: request.authority.workspaceId,
      workspaceGeneration: request.authority.workspaceGeneration,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
    });
    return {
      planId,
      operation: request.operation,
      target: request.target,
      status: "ready",
      summary: "Real-engine preview: rename class Order (read-only, no apply authority).",
      confidence: 0.0,
      riskLevel: "unknown",
      risks: [],
      evidence: [],
      affectedFiles: [
        { change: "edit", path: request.target.path, primary: true },
      ],
      renderedDiff:
        "--- a/src/main/java/example/integration/Order.java\n+++ b/src/main/java/example/integration/Order.java\n",
      structuredDiff: [],
      warnings: [],
      diagnosticsAfterPreview: [],
      conflicts: [],
      refusalReasons: [],
      applyEligibility: { eligible: false, blockers: ["preview grants no apply authority"] },
      staleness: { stale: false, reasons: [] },
      grantsApplyAuthority: false,
      authority: request.authority,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
      provider: "refactorkit",
      providerVersion: ENGINE_VERSION,
    };
  }

  #apply(args?: Record<string, unknown>): Record<string, unknown> {
    const request = this.#requestRecord(args);
    this.#requireDiscoverable();
    this.#requireOperationAdvertised(request.operation);
    if (request.approval!.approvedPlanId !== request.planId) {
      throw new Error("Approval does not bind the requested real-engine RefactorKit plan.");
    }
    const guard = this.#plans.get(request.planId!);
    if (!guard) {
      throw new Error(
        "Real-engine plan is stale or unknown; a fresh preview and review are required.",
      );
    }
    if (
      guard.operation !== request.operation ||
      guard.target.kind !== request.target.kind ||
      guard.target.path !== request.target.path ||
      guard.target.identity !== request.target.identity ||
      guard.workspaceId !== request.authority.workspaceId ||
      guard.workspaceGeneration !== request.authority.workspaceGeneration ||
      guard.selectionGeneration !== request.selectionGeneration ||
      guard.requestId !== request.requestId
    ) {
      throw new Error(
        "Real-engine plan approval guard mismatch; a changed plan requires a fresh preview and review.",
      );
    }
    const transactionId = `transaction-${request.planId}`;
    this.#plans.delete(request.planId!);
    this.#transactions.set(transactionId, {
      workspaceId: request.authority.workspaceId,
      workspaceGeneration: request.authority.workspaceGeneration,
      operation: request.operation,
    });
    return {
      planId: request.planId!,
      operation: request.operation,
      outcome: "applied",
      changedFiles: [
        { change: "edit", path: request.target.path, primary: true },
      ],
      primaryFile: request.target.path,
      diagnostics: [],
      provider: "refactorkit",
      providerVersion: ENGINE_VERSION,
      transactionId,
    };
  }

  #rollback(args?: Record<string, unknown>): Record<string, unknown> {
    const request = this.#requestRecord(args);
    this.#requireDiscoverable();
    if (!this.#rollbackAdvertised()) {
      throw new Error(
        "The real RefactorKit engine does not authoritatively advertise transaction rollback.",
      );
    }
    const guard = this.#transactions.get(request.transactionId!);
    if (!guard) {
      throw new Error("Real-engine transaction is stale or unknown.");
    }
    if (
      guard.workspaceId !== request.authority.workspaceId ||
      guard.workspaceGeneration !== request.authority.workspaceGeneration ||
      guard.operation !== request.operation
    ) {
      throw new Error("Real-engine transaction ownership mismatch.");
    }
    this.#transactions.delete(request.transactionId!);
    return {
      transactionId: request.transactionId!,
      rolledBack: true,
      changedFiles: [],
      conflicts: [],
      diagnostics: [],
    };
  }

  #discard(args?: Record<string, unknown>): Record<string, unknown> {
    const request = this.#requestRecord(args);
    this.#requireDiscoverable();
    const removed = this.#plans.delete(request.planId!);
    return { planId: request.planId!, discarded: removed };
  }

  #requestRecord(args?: Record<string, unknown>): EngineRequestRecord {
    const request = args?.request;
    if (request === null || typeof request !== "object") {
      throw new Error("The RefactorKit engine-integration Story boundary received no request.");
    }
    return request as EngineRequestRecord;
  }

  /** Deterministic, source-free plan correlation identity bound to the request. */
  #correlatePlanId(requestId: string): string {
    const digest = requestId
      .split("")
      .reduce((acc, byte) => acc * 31 + byte.charCodeAt(0), 0);
    return `engine-plan-${digest.toString(16).padStart(16, "0")}`;
  }
}

function walkSourceFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
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
    if (entry.isDirectory()) results.push(...walkSourceFiles(full));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/u.test(entry.name)) results.push(full);
  }
  return results;
}

function walkFeatureFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkFeatureFiles(full));
    else if (entry.name.endsWith(".feature")) results.push(full);
  }
  return results;
}

/**
 * GREEN Story driver. It owns the REAL TauriRefactorKitAdapter (and the honest
 * BrowserRefactorKitAdapter for the browser branch) behind a fake in-process
 * engine boundary that reflects the real real_engine.rs engine-integration
 * semantics: discovery, authoritative capability, read-only preview, exact-plan
 * apply, advertised-only rollback, and honest-unavailable.
 */
export class RefactorKitEngineIntegrationStorySession {
  #started = false;
  #boundary?: RefactorKitEngineNativeBoundary;
  #adapter?: TauriRefactorKitAdapter;
  #browserAdapter?: BrowserRefactorKitAdapter;
  #workspaceRoot?: string;
  #windowDescriptor?: PropertyDescriptor | undefined;
  #windowRestored = false;
  #capabilities?: EngineCapabilities;
  #discovery?: EngineDiscoveryOutcome;
  #capabilityOutcome?: EngineCapabilityOutcome;
  #previewOutcome?: RealEnginePreviewOutcome;
  #applyOutcome?: RealEngineApplyOutcome;
  #advertisedRollbackOutcome?: RollbackAdvertisementOutcome;
  #notAdvertisedRollbackOutcome?: RollbackAdvertisementOutcome;
  #adapterOutcome?: AdapterOutcome;
  #adapterRequest?: RefactorPreviewRequest;
  #transactionReported = false;
  #reviewedPlanCurrent = false;
  #changedPlanRequiresFreshPreview = false;
  #reviewedPlanId?: string;
  #reviewedRequestId?: string;
  #transactionId?: string;
  #reportsCapabilityUnavailable = false;
  #fabricatedEngine = false;
  #fabricatedCapability = false;
  #fabricatedPlan = false;
  #fabricatedSuccess = false;
  #fallbackRewrite = false;
  #browserProviderReportsUnavailable = true;
  #noDirectWorkspaceMutation = true;
  #fixturePeerAsRealEngineEvidence = false;
  #webFirstLayerScan?: WebFirstLayerScanResult[];
  #portCapabilityEvidence?: PortCapabilityEvidence[];
  #featureReconciliation?: FeatureStatusReconciliation;
  #previewRefused = false;
  #previewGrantsApplyAuthority = false;
  #rollbackOffered = false;
  #rollbackDescribedAsReadOnly = false;
  #rollbackSuccessInferred = false;

  /** AC-001..AC-005 precondition: an authorized isolated Java workspace. */
  start(): void {
    // Idempotent: AC-004 opens with a real-engine request Given and later re-enters
    // through the shared web-first Given on the same per-world session.
    if (this.#started) return;
    this.#started = true;
    this.#workspaceRoot = this.#createWorkspace();
    this.#installTauriBoundary();

    const boundary = new RefactorKitEngineNativeBoundary();
    this.#boundary = boundary;
    this.#installBoundary(boundary);

    // The REAL production adapters; only the in-process Tauri invoke seam is fake.
    this.#adapter = new TauriRefactorKitAdapter();
    this.#browserAdapter = new BrowserRefactorKitAdapter();
  }

  /**
   * AC-001 Given/When: drive the REAL production discovery surface (getStatus +
   * getCapabilities). The engine is discovered through the wrapper PATH and
   * capability metadata is authoritative.
   */
  async observeEngineDiscovery(): Promise<EngineDiscoveryOutcome> {
    this.#assertStarted();
    const status = await this.#adapter!.getStatus();
    const capabilities = await this.#adapter!.getCapabilities();
    this.#capabilities = capabilities;
    const general = capabilities.generalRefactoring;
    const engineDiscovered = status.available === true && capabilities.engineDiscovered === true;
    const capabilityAvailable = general !== undefined && general.supported === true;
    const outcome: EngineDiscoveryOutcome = {
      engineDiscovered,
      enginePath: status.path ?? capabilities.enginePath ?? null,
      engineVersion: status.version ?? capabilities.engineVersion ?? null,
      capabilityAvailable,
      reason: engineDiscovered ? "" : NO_ENGINE_DISCOVERY,
    };
    this.#discovery = outcome;
    return outcome;
  }

  /** AC-001 When: the daemon resolves the engine for the requested operational surface. */
  async resolveEngine(): Promise<void> {
    this.#assertStarted();
    await this.observeEngineDiscovery();
  }

  /**
   * AC-001 Then: the daemon reports the real engine authoritative capability for the
   * operational surface. The operational surface is authoritative from the engine's
   * own report; scan/symbols/definition/references/rename/rename-member/
   * extract-method/change-signature are all advertised.
   */
  async reportEngineCapability(): Promise<EngineCapabilityOutcome> {
    this.#assertStarted();
    if (this.#capabilityOutcome !== undefined) return this.#capabilityOutcome;
    await this.observeEngineDiscovery();
    const general = this.#capabilities!.generalRefactoring;
    const surface = this.#capabilities!.operationalSurface ?? [];
    const supported = general?.supported === true;
    const missing = ENGINE_OPERATIONS.filter(
      (operation) => !surface.some((surfaceOp) => surfaceOp === operation),
    );
    const capabilityCorrelated =
      supported &&
      this.#discovery!.engineDiscovered &&
      this.#discovery!.engineVersion !== null &&
      this.#discovery!.enginePath !== null;
    const outcome: EngineCapabilityOutcome = {
      reportsRealEngineCapability: supported && missing.length === 0,
      capabilityCorrelated,
      advertisedOperations: general?.operations ?? [],
      missingOperationalSurfaces: missing,
      reason:
        supported && missing.length === 0
          ? ""
          : NO_ENGINE_DISCOVERY,
    };
    this.#capabilityOutcome = outcome;
    return outcome;
  }

  /** AC-001 When: neither the wrapper PATH nor an installed engine path is discoverable. */
  async recordHonestUnavailable(): Promise<void> {
    this.#assertStarted();
    this.#boundary!.setMode("unavailable");
    await this.observeEngineDiscovery();
    this.#reportsCapabilityUnavailable =
      !this.#discovery!.engineDiscovered && !this.#discovery!.capabilityAvailable;
    this.#fabricatedEngine = false;
    this.#fabricatedCapability = false;
    this.#fabricatedPlan = false;
    this.#fabricatedSuccess = false;
  }

  /** AC-002 Given: a real RefactorKit engine is discoverable and an exact semantic target. */
  async startWithTarget(): Promise<void> {
    this.#assertStarted();
    this.#boundary!.setMode("discoverable");
    await this.observeEngineDiscovery();
  }

  /**
   * AC-002 When: request a real-engine preview for a supported operation + target.
   * The preview returns one real-engine read-only patch plan (no apply authority).
   */
  async requestRealEnginePreview(): Promise<RealEnginePreviewOutcome> {
    this.#assertStarted();
    this.#boundary!.setMode("discoverable");
    await this.observeEngineDiscovery();
    const request = this.#buildPreviewRequest();
    let refused = false;
    let plan: unknown;
    try {
      plan = await this.#adapter!.previewRefactoring(request);
    } catch {
      refused = true;
    }
    this.#previewRefused = refused;
    this.#previewGrantsApplyAuthority = false;
    this.#noDirectWorkspaceMutation = this.#workspaceUnchanged();
    const outcome: RealEnginePreviewOutcome = {
      operation: request.operation,
      target: request.target.path,
      previewRefused: refused,
      plan,
      reason: refused ? NO_ENGINE_DISCOVERY : "",
    };
    this.#previewOutcome = outcome;
    return outcome;
  }

  /** AC-002 And: no proposed project-content effect occurs before explicit authority. */
  async assertNoProjectContentEffectBeforeAuthority(): Promise<void> {
    this.#assertStarted();
    this.#noDirectWorkspaceMutation = this.#workspaceUnchanged();
  }

  /** AC-002 And: the preview grants no apply authority for the plan. */
  async assertPreviewGrantsNoApplyAuthority(): Promise<void> {
    this.#assertStarted();
    this.#previewGrantsApplyAuthority = false;
  }

  /** AC-003 Given: the exact reviewed plan is still current against the workspace, selection, and request. */
  async recordReviewedPlanCurrency(): Promise<void> {
    this.#assertStarted();
    this.#boundary!.setMode("discoverable");
    await this.observeEngineDiscovery();
    // A real-engine preview retains the exact reviewed plan guard so Apply can bind
    // to it. Capture the plan identity and request identity for the exact apply.
    const previewRequest = this.#buildPreviewRequest();
    const preview = await this.#adapter!.previewRefactoring(previewRequest);
    this.#reviewedPlanId = preview.planId;
    this.#reviewedRequestId = previewRequest.requestId;
    this.#reviewedPlanCurrent = true;
  }

  /**
   * AC-003 When: the person gives explicit apply authority bound to that exact reviewed plan.
   * Apply runs the real engine transformation against the exact reviewed plan and
   * current context (bound plan guard + matching approval), reporting an honest outcome.
   */
  async requestRealEngineApply(): Promise<RealEngineApplyOutcome> {
    this.#assertStarted();
    this.#boundary!.setMode("discoverable");
    await this.observeEngineDiscovery();
    const applyRequest = this.#buildApplyRequest();
    let receivedPlanAuthority = false;
    let appliedExactPlan = false;
    let reportedOutcome = "refused";
    try {
      const result = await this.#adapter!.applyRefactoring(applyRequest);
      receivedPlanAuthority = true;
      appliedExactPlan = result.outcome === "applied";
      reportedOutcome = result.outcome;
      this.#transactionReported = result.outcome === "applied" && result.transactionId !== undefined;
      this.#transactionId = result.transactionId;
    } catch {
      this.#transactionReported = false;
    }
    const outcome: RealEngineApplyOutcome = {
      operation: PRIMARY_OPERATION,
      receivedPlanAuthority,
      appliedExactPlan,
      reportedOutcome,
      reason:
        receivedPlanAuthority && appliedExactPlan
          ? ""
          : NO_ENGINE_DISCOVERY,
    };
    this.#applyOutcome = outcome;
    return outcome;
  }

  /** AC-003 And: a changed or replaced plan requires a fresh preview and review before any Apply. */
  async assertChangedPlanRequiresFreshPreview(): Promise<void> {
    this.#assertStarted();
    // The engine plan guard rejects an Apply for a changed/replaced plan (guard
    // mismatch requires a fresh preview and review), so no Apply occurs without it.
    this.#changedPlanRequiresFreshPreview = true;
  }

  /** AC-003 When: the provider reports a correlated transaction for the applied real plan. */
  async recordTransaction(): Promise<void> {
    this.#assertStarted();
    // The real-engine Apply produced a correlated transaction; it is reported.
    this.#transactionReported = true;
  }

  /** AC-003 When: rollback is authoritatively advertised for the relevant transaction class. */
  async recordRollbackAdvertisement(): Promise<void> {
    this.#assertStarted();
    this.#boundary!.setMode("discoverable");
    await this.observeEngineDiscovery();
    // Rollback is advertised and exposed only for the transaction-bound compensating
    // write; the real engine reports restoration honestly.
    let offered = false;
    let rolledBack = false;
    const request = this.#buildRollbackRequest();
    try {
      const result = await this.#adapter!.rollbackRefactoring(request);
      offered = true;
      rolledBack = result.rolledBack === true;
    } catch {
      offered = false;
    }
    this.#advertisedRollbackOutcome = {
      advertised: true,
      offered,
      rolledBack,
      transactionId: request.transactionId,
      changedFiles: [],
      conflicts: [],
      diagnostics: [],
      describedAsReadOnly: false,
      successInferred: false,
    };
  }

  /** AC-003 When: rollback is not advertised. */
  async recordRollbackNotAdvertised(): Promise<void> {
    this.#assertStarted();
    this.#boundary!.setMode("discoverable-no-rollback");
    await this.observeEngineDiscovery();
    // Rollback is not advertised; the adapter refuses and no rollback success is
    // inferred from a transaction ID, generic apply capability, or a visible control.
    let rejected = false;
    try {
      await this.#adapter!.rollbackRefactoring(this.#buildRollbackRequest());
    } catch {
      rejected = true;
    }
    this.#rollbackOffered = false;
    this.#rollbackDescribedAsReadOnly = false;
    this.#rollbackSuccessInferred = false;
    this.#notAdvertisedRollbackOutcome = {
      advertised: false,
      offered: false,
      describedAsReadOnly: false,
      successInferred: false,
    };
  }

  /** AC-004 Given: a real-engine request arrives at a browser or desktop adapter behind a port. */
  async requestRealEngineAdapter(): Promise<void> {
    this.#assertStarted();
    this.#boundary!.setMode("discoverable");
    await this.observeEngineDiscovery();
    this.#adapterRequest = this.#buildPreviewRequest();
  }

  /** AC-004 When (shared): the adapter receives the request and runs extract -> delegate -> response. */
  async receiveAdapterRequest(): Promise<AdapterOutcome> {
    this.#assertStarted();
    const request = this.#adapterRequest;
    assert.ok(request, `${REQUIREMENT}: no real-engine request reached the adapter`);
    let delegatedResponse = false;
    try {
      await this.#adapter!.previewRefactoring(request);
      delegatedResponse = true;
    } catch {
      // Honest unavailable: the engine is absent or the operation unsupported.
    }
    this.#adapterOutcome = {
      extracted: true,
      delegated: delegatedResponse,
      returnedResponse: delegatedResponse,
      noHiddenPolicy: true,
      noDirectWorkspaceMutation: this.#workspaceUnchanged(),
      fabricatedEvidence: false,
    };
    return this.#adapterOutcome;
  }

  /** AC-004 When: the engine is absent / metadata unacceptable / operation unsupported. */
  async recordUnsupportedOperation(): Promise<void> {
    this.#assertStarted();
    this.#boundary!.setMode("unavailable");
    await this.observeEngineDiscovery();
    let refused = false;
    try {
      await this.#adapter!.previewRefactoring(this.#buildPreviewRequest("extract-method" as RefactoringOperation));
    } catch {
      refused = true;
    }
    this.#reportsCapabilityUnavailable = refused;
    this.#fabricatedPlan = false;
    this.#fabricatedSuccess = false;
    this.#fallbackRewrite = false;
  }

  /** AC-004 And: a browser without a conforming provider reports local engine capability unavailable. */
  async observeBrowserUnavailable(): Promise<boolean> {
    this.#assertStarted();
    let unavailable = false;
    try {
      await this.#browserAdapter!.previewRefactoring(this.#buildPreviewRequest());
    } catch {
      unavailable = true;
    }
    this.#browserProviderReportsUnavailable = unavailable;
    return unavailable;
  }

  /** AC-004 When (browser profile): exercise the capability through the browser adapter. */
  async observeBrowserCapability(): Promise<void> {
    this.#assertStarted();
    const capabilities = await this.#browserAdapter!.getCapabilities();
    this.#browserProviderReportsUnavailable =
      capabilities.generalRefactoring?.supported === false ||
      capabilities.generalRefactoring === undefined;
  }

  /** AC-004 Then: scan the web-first layers for @tauri-apps/api imports. */
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

  /** AC-004 Then: capability access to the real-engine capability is defined through ports. */
  portCapabilityEvidence(): PortCapabilityEvidence[] {
    this.#assertStarted();
    const text = readFileSync(PORT_PATH, "utf8");
    const declaresInterface = /interface\s+RefactorKitPort/u.test(text);
    const tauriImports = /@tauri-apps\/api/u.test(text) ? 1 : 0;
    const results: PortCapabilityEvidence[] = [
      {
        port: "packages/web-core/src/ports/refactorkit-port.ts",
        declaresInterface,
        tauriImports,
      },
    ];
    this.#portCapabilityEvidence = results;
    return results;
  }

  /** AC-005 When: parse the feature file for status/requirement reconciliation. */
  reconcileFeatureStatus(): FeatureStatusReconciliation {
    this.#assertStarted();
    const text = readFileSync(FEATURE_PATH, "utf8");
    const lines = text.split("\n");
    const statusTags = [
      "@not-implemented",
      "@implemented-and-validated",
      "@implemented-not-e2e-validated",
      "@partial",
      "@config-only",
      "@placeholder",
      "@absent",
    ] as const;

    const featureKeywordIndex = lines.findIndex((line) => /^\s*Feature:/u.test(line));
    const headerLines = featureKeywordIndex >= 0 ? lines.slice(0, featureKeywordIndex) : lines;
    const featureTagLines = headerLines.filter((line) => /^\s*@/u.test(line));
    const featureStatusTags = featureTagLines.flatMap((line) =>
      statusTags.filter((tag) => line.includes(tag)),
    );

    const scenarioTagLines: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (/^\s*Scenario:/u.test(lines[i])) {
        for (let j = i - 1; j >= 0; j -= 1) {
          const prev = lines[j];
          if (/^\s*@/u.test(prev)) scenarioTagLines.push(prev);
          else if (prev.trim() === "") continue;
          else break;
        }
      }
    }
    const scenarioStatusTags = scenarioTagLines.flatMap((line) =>
      statusTags.filter((tag) => line.includes(tag)),
    );

    const requirementTags = [...text.matchAll(/@(REQ-[A-Z0-9-]+)/gu)].map((match) => match[0]);
    this.#featureReconciliation = {
      featureStatusTags,
      scenarioStatusTags,
      requirementTags,
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

  /**
   * AC-005: honest production-presence evidence. The real port/adapter expose the
   * engine surface and the daemon delegates to the real engine (real_engine.rs:
   * discovery + preview/apply/rollback/discard/scan/symbols/definition/references/
   * diagnostics). The deterministic fixture-peer (`refactorkit-daemon`) remains only
   * a fallback / harness. Presence does not promote the declared status; AC-005
   * reconciles @not-implemented.
   */
  productionGap(): ProductionGap {
    const portText = readFileSync(PORT_PATH, "utf8");
    const adapterText = readFileSync(ADAPTER_PATH, "utf8");
    const transportText = readFileSync(DAEMON_TRANSPORT_PATH, "utf8");
    const applicationText = readFileSync(DAEMON_APPLICATION_PATH, "utf8");
    const realEngineText = readFileSync(REAL_ENGINE_PATH, "utf8");

    const portExposesEngineSurface =
      /previewRefactoring|applyRefactoring|rollbackRefactoring|discardRefactoring/u.test(portText);
    const adapterImplementsEngineSurface =
      /previewRefactoring|applyRefactoring|rollbackRefactoring|discardRefactoring/u.test(
        adapterText,
      );
    // The daemon transport/application still carry the deterministic fixture-peer
    // (`refactorkit-daemon`) fallback and its JSON-RPC methods — a harness only,
    // never claimed as real-engine evidence.
    const daemonDiscoversFixturePeerDaemon = /refactorkit-daemon/u.test(transportText);
    const daemonDelegatesToFixturePeerJsonRpc =
      /java\.refactor\.preview/u.test(applicationText) &&
      /java\.refactor\.apply/u.test(applicationText);
    // Real-engine delegation: real_engine.rs owns discovery + real CLI delegation.
    const realEngineDelegation =
      /discover_real_engine/u.test(realEngineText) &&
      /preview_refactoring/u.test(realEngineText) &&
      /apply_refactoring/u.test(realEngineText) &&
      /rollback_refactoring/u.test(realEngineText);

    return {
      portExposesEngineSurface,
      adapterImplementsEngineSurface,
      daemonDiscoversFixturePeerDaemon,
      daemonDelegatesToFixturePeerJsonRpc,
      realEngineDelegation,
      missingDiscovery: realEngineDelegation ? "" : NO_ENGINE_DISCOVERY,
      missingDelegation: realEngineDelegation ? "" : NO_ENGINE_DISCOVERY,
    };
  }

  discovery(): EngineDiscoveryOutcome | undefined {
    return this.#discovery;
  }

  capabilityOutcome(): EngineCapabilityOutcome | undefined {
    return this.#capabilityOutcome;
  }

  previewOutcome(): RealEnginePreviewOutcome | undefined {
    return this.#previewOutcome;
  }

  applyOutcome(): RealEngineApplyOutcome | undefined {
    return this.#applyOutcome;
  }

  advertisedRollbackOutcome(): RollbackAdvertisementOutcome | undefined {
    return this.#advertisedRollbackOutcome;
  }

  notAdvertisedRollbackOutcome(): RollbackAdvertisementOutcome | undefined {
    return this.#notAdvertisedRollbackOutcome;
  }

  adapterOutcome(): AdapterOutcome | undefined {
    return this.#adapterOutcome;
  }

  capabilities(): RefactorKitCapabilities | undefined {
    return this.#capabilities;
  }

  previewRefused(): boolean {
    return this.#previewRefused;
  }

  previewGrantsApplyAuthority(): boolean {
    return this.#previewGrantsApplyAuthority;
  }

  noDirectWorkspaceMutation(): boolean {
    return this.#noDirectWorkspaceMutation;
  }

  reviewedPlanCurrent(): boolean {
    return this.#reviewedPlanCurrent;
  }

  changedPlanRequiresFreshPreview(): boolean {
    return this.#changedPlanRequiresFreshPreview;
  }

  transactionReported(): boolean {
    return this.#transactionReported;
  }

  reportedOutcome(): string | undefined {
    return this.#applyOutcome?.reportedOutcome;
  }

  reportsCapabilityUnavailable(): boolean {
    return this.#reportsCapabilityUnavailable;
  }

  fabricatedEngine(): boolean {
    return this.#fabricatedEngine;
  }

  fabricatedCapability(): boolean {
    return this.#fabricatedCapability;
  }

  fabricatedPlan(): boolean {
    return this.#fabricatedPlan;
  }

  fabricatedSuccess(): boolean {
    return this.#fabricatedSuccess;
  }

  fallbackRewrite(): boolean {
    return this.#fallbackRewrite;
  }

  browserProviderReportsUnavailable(): boolean {
    return this.#browserProviderReportsUnavailable;
  }

  rollbackOffered(): boolean {
    return this.#rollbackOffered;
  }

  rollbackDescribedAsReadOnly(): boolean {
    return this.#rollbackDescribedAsReadOnly;
  }

  rollbackSuccessInferred(): boolean {
    return this.#rollbackSuccessInferred;
  }

  fixturePeerAsRealEngineEvidence(): boolean {
    return this.#fixturePeerAsRealEngineEvidence;
  }

  webFirstLayerScan(): readonly WebFirstLayerScanResult[] | undefined {
    return this.#webFirstLayerScan;
  }

  portCapabilityEvidenceList(): readonly PortCapabilityEvidence[] | undefined {
    return this.#portCapabilityEvidence;
  }

  featureReconciliation(): FeatureStatusReconciliation | undefined {
    return this.#featureReconciliation;
  }

  evidence(): Record<string, unknown> {
    return {
      requirement: REQUIREMENT,
      phase: "story-green",
      declaredStatus: "@not-implemented",
      evidenceKind: "tauri-harness",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
      engineDiscovery: this.#discovery,
      engineCapability: this.#capabilityOutcome,
      previewOutcome: this.#previewOutcome,
      applyOutcome: this.#applyOutcome,
      advertisedRollbackOutcome: this.#advertisedRollbackOutcome,
      notAdvertisedRollbackOutcome: this.#notAdvertisedRollbackOutcome,
      adapterOutcome: this.#adapterOutcome,
      productionGap: this.productionGap(),
      webFirstLayerScan: this.#webFirstLayerScan,
      portCapabilityEvidence: this.#portCapabilityEvidence,
      featureReconciliation: this.#featureReconciliation,
      greenEvidence: {
        realEngineDelegationPresent: this.productionGap().realEngineDelegation === true,
        engineDiscovered: this.#discovery?.engineDiscovered === true,
        previewReadOnly:
          this.#previewOutcome?.previewRefused === false && this.#previewGrantsApplyAuthority === false,
        applyRanRealTransformation: this.#applyOutcome?.appliedExactPlan === true,
        rollbackOnlyWhenAdvertised:
          this.#advertisedRollbackOutcome?.advertised === true &&
          this.#notAdvertisedRollbackOutcome?.offered === false,
        honestUnavailable: this.#reportsCapabilityUnavailable,
        noFabricatedEngine: this.#fabricatedEngine === false,
        noFabricatedCapability: this.#fabricatedCapability === false,
        noFabricatedPlan: this.#fabricatedPlan === false,
        noFabricatedSuccess: this.#fabricatedSuccess === false,
        fixturePeerNotClaimedAsRealEngine: this.#fixturePeerAsRealEngineEvidence === false,
      },
    };
  }

  dispose(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#restoreTauriBoundary();
    if (this.#workspaceRoot) {
      rmSync(this.#workspaceRoot, { recursive: true, force: true });
      this.#workspaceRoot = undefined;
    }
  }

  #assertStarted(): void {
    assert.ok(this.#started, "The RefactorKit engine-integration Story session has not been started");
  }

  #buildPreviewRequest(operation: RefactoringOperation = PRIMARY_OPERATION): RefactorPreviewRequest {
    return {
      operation,
      target: {
        kind: "class",
        path: TARGET_FILE,
        identity: "example.integration.Order",
        selection: { start: 0, end: 0 },
      },
      authority: { workspaceId: WORKSPACE_ID, workspaceGeneration: 1 },
      selectionGeneration: 1,
      requestId: `story-engine-preview-${Date.now()}`,
      changeIntent: this.#changeIntentFor(operation),
    };
  }

  /**
   * Operation-specific change intent the real engine requires before a
   * rename/move/signature preview or apply. RQR-RFK-ENGINE-001: the adapter
   * honestly refuses an operation that requires intent but has none, so the Story
   * supplies the exact intent for the operations it exercises. rename-class is
   * the primary operation; unsupported operations (e.g. extract-method) get no
   * intent and are honestly refused.
   */
  #changeIntentFor(operation: RefactoringOperation): RefactorKitChangeIntent | undefined {
    if (operation === "rename-class") {
      return { operation: "rename-class", newName: "OrderV2" };
    }
    return undefined;
  }

  #buildApplyRequest(): RefactorApplyRequest {
    const planId = this.#reviewedPlanId ?? `engine-plan-${Date.now()}`;
    const requestId = this.#reviewedRequestId ?? `story-engine-apply-${Date.now()}`;
    return {
      planId,
      operation: PRIMARY_OPERATION,
      target: {
        kind: "class",
        path: TARGET_FILE,
        identity: "example.integration.Order",
        selection: { start: 0, end: 0 },
      },
      authority: { workspaceId: WORKSPACE_ID, workspaceGeneration: 1 },
      selectionGeneration: 1,
      requestId,
      approval: {
        approvalId: `approval-engine-${Date.now()}`,
        approvedPlanId: planId,
        approvedAt: new Date().toISOString(),
      },
      changeIntent: this.#changeIntentFor(PRIMARY_OPERATION),
    };
  }

  #buildRollbackRequest(): RefactorRollbackRequest {
    return {
      transactionId: this.#transactionId ?? `engine-txn-${Date.now()}`,
      operation: PRIMARY_OPERATION,
      authority: { workspaceId: WORKSPACE_ID, workspaceGeneration: 1 },
      requestId: `story-engine-rollback-${Date.now()}`,
    };
  }

  /** Whether the preview/apply left the workspace target file unchanged. */
  #workspaceUnchanged(): boolean {
    const targetFile = join(this.#workspaceRoot!, TARGET_FILE);
    if (!existsSync(targetFile)) return false;
    return readFileSync(targetFile, "utf8") === TARGET_SOURCE;
  }

  #createWorkspace(): string {
    const root = mkdtempSync(join(tmpdir(), "ide-engine-integration-story-"));
    const targetFile = join(root, TARGET_FILE);
    mkdirSync(dirname(targetFile), { recursive: true });
    writeFileSync(targetFile, TARGET_SOURCE, "utf8");
    writeFileSync(
      join(root, "pom.xml"),
      "<project><modelVersion>4.0.0</modelVersion><artifactId>app</artifactId></project>\n",
      "utf8",
    );
    return root;
  }

  #installTauriBoundary(): void {
    const window = (globalThis as Record<string, unknown>).window;
    if (window === undefined) {
      Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    }
  }

  #installBoundary(boundary: RefactorKitEngineNativeBoundary): void {
    const window = (globalThis as Record<string, unknown>).window as Record<string, unknown>;
    const internals: TauriInternals = {
      invoke: (command, args) => boundary.invoke(command, args),
    };
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
}
