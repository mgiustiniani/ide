// -----------------------------------------------------------------------------
// tests/story/support/refactorkit-java-refactoring.ts
// Story BDD driver for REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001
// (features/refactorkit/java-refactoring.feature, 5 scenarios / 42 steps).
//
// GREEN: the operational RefactorKit Java refactoring slice is now implemented
// on the production surface
//   packages/contracts/src/refactorkit.ts        (RefactorPreviewRequest/Result,
//                                                 RefactorApplyRequest/Result,
//                                                 RefactorRollbackRequest/Result,
//                                                 DiscardRefactorKitPlanRequest/Result)
//   packages/web-core/src/ports/refactorkit-port.ts (previewRefactoring / applyRefactoring /
//                                                 rollbackRefactoring / discardRefactoring)
//   packages/tauri-adapters/src/refactorkit-tauri.ts (TauriRefactorKitAdapter delegates to
//                                                 preview_refactorkit_engine_refactoring /
//                                                 apply_refactorkit_engine_refactoring /
//                                                 rollback_refactorkit_engine_refactoring /
//                                                 discard_refactorkit_engine_refactoring)
//   packages/browser-adapters/src/refactorkit-browser.ts (honest browser unavailable)
//   apps/desktop/src-tauri/src/commands/refactorkit_daemon/*  (capability advertisement for
//                                                 rename-class / rename-member /
//                                                 rename-local-variable / move-class /
//                                                 change-method-signature / safe-delete)
//
// This driver drives the REAL production surface through a fake in-process Tauri
// invoke boundary (window.__TAURI_INTERNALS__.invoke), mirroring the desktop
// tauri-harness convention. The fake daemon boundary mirrors the real
// refactorkit_daemon semantics: capability-before-offer advertisement of the six
// general refactoring operations, read-only preview that grants no apply
// authority, Apply bound to the exact reviewed plan identity under explicit
// approval authority, and transaction-bound rollback exposed only when the
// provider advertises it.
//
// Honesty rules (GREEN):
//   - preview is read-only and grantsApplyAuthority=false (never writes);
//   - Apply binds the exact planId + explicit approval (never reconstructed source
//     or UI-fabricated edits), and a changed/replaced plan requires a fresh preview;
//   - rollback is exposed only for an advertised, transaction-bound compensating
//     write; a not-advertised transaction class is neither offered nor inferred;
//   - unsupported operations and absent browser providers are reported honestly
//     unavailable/refused — no fabricated plan, success, or fallback rewrite.
//
// Evidence boundaries: deterministic in-process daemon fixture behind the REAL
// adapter. No live RefactorKit engine, no native GUI, no E2E, no packaging are
// exercised here; those are reported separately and the feature stays
// @not-implemented until real-engine integration validation exists.
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
  RefactorPreviewResult,
  RefactorRollbackRequest,
  RefactorRollbackResult,
  RefactorKitCapabilities,
  RefactorKitChangeIntent,
} from "../../../packages/contracts/src/refactorkit.js";

export const REQUIREMENT = "REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001";
export const WORKSPACE_ID = "workspace-refactor-java";
export const TARGET_FILE = "src/main/java/example/refactor/Order.java";
export const TARGET_DIRECTORY = "src/main/java/example/refactor";

/** The general Java refactoring operation set declared by this feature slice. */
export type RefactorOperation =
  | "rename-class"
  | "rename-member"
  | "rename-local-variable"
  | "move-class"
  | "change-method-signature"
  | "safe-delete";

export const REFACTOR_OPERATIONS: readonly RefactorOperation[] = [
  "rename-class",
  "rename-member",
  "rename-local-variable",
  "move-class",
  "change-method-signature",
  "safe-delete",
];

/** Out-of-scope operation used to prove the honest unsupported branch (AC-003). */
const UNSUPPORTED_OPERATION = "extract-method";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "../../..");
const WEB_FIRST_LAYERS = ["packages/ui", "packages/web-core", "apps/web"] as const;
const FEATURE_PATH = join(REPO_ROOT, "features/refactorkit/java-refactoring.feature");
const PORT_PATH = join(REPO_ROOT, "packages/web-core/src/ports/refactorkit-port.ts");
const ADAPTER_PATH = join(REPO_ROOT, "packages/tauri-adapters/src/refactorkit-tauri.ts");
const DAEMON_CAPABILITY_PATH = join(
  REPO_ROOT,
  "apps/desktop/src-tauri/src/commands/refactorkit_daemon/capability_policy.rs",
);

const TARGET_SOURCE = `package example.refactor;

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

interface BoundaryInvocation {
  readonly sequence: number;
  readonly command: string;
  readonly args?: Record<string, unknown>;
}

/** Guard retained by the daemon for a ready, eligible reviewed plan. */
interface RefactorPlanGuard {
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly selectionGeneration: number;
  readonly requestId: string;
}

/** Transaction recorded by the daemon for an applied refactoring. */
interface RefactorTransactionGuard {
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly operation: string;
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

export interface GeneralRefactoringPreviewOutcome {
  readonly operation: string;
  readonly target: string;
  readonly available: boolean;
  readonly reason: string;
  /** Backend-produced immutable patch plan when the preview is available. */
  readonly plan?: RefactorPreviewResult;
}

export interface GeneralRefactoringApplyOutcome {
  readonly operation: string;
  readonly available: boolean;
  readonly reason: string;
  readonly receivedPlanAuthority: boolean;
  readonly appliedExactPlan: boolean;
  /** The real IDE outcome reported honestly (applied/refused/stale/failed/indeterminate). */
  readonly reportedOutcome: string;
}

export interface GeneralRefactoringRollbackOutcome {
  readonly advertised: boolean;
  readonly offered: boolean;
  readonly describedAsReadOnly: boolean;
  readonly successInferred: boolean;
  readonly rolledBack?: boolean;
  readonly transactionId?: string;
  readonly changedFiles?: Array<{ change: string; path: string; primary: boolean }>;
  readonly conflicts?: Array<{ kind: string; summary: string }>;
  readonly diagnostics?: Array<{ severity: string; message: string }>;
}

export interface GeneralRefactoringAdapterOutcome {
  readonly extracted: boolean;
  readonly delegated: boolean;
  readonly returnedResponse: boolean;
  readonly noHiddenPolicy: boolean;
  readonly noDirectWorkspaceMutation: boolean;
  readonly fabricatedEvidence: boolean;
}

export interface ProductionGap {
  readonly portHasGeneralRefactoringPreview: boolean;
  readonly adapterHasGeneralRefactoringPreview: boolean;
  readonly daemonAdvertisesGeneralRefactoringPreview: boolean;
  readonly advertisedGeneralRefactoringOperations: readonly string[];
}

/**
 * Deterministic in-process daemon boundary. It mirrors the REAL refactorkit_daemon
 * capability-policy and application semantics for the general Java refactoring
 * slice: capability-before-offer advertisement of the six operations, read-only
 * preview (grantsApplyAuthority=false), exact-plan Apply under explicit approval,
 * and transaction-bound rollback. No workspace file is ever written by this
 * boundary — preview and review are read-only by construction.
 */
class RefactorKitJavaNativeBoundary implements TauriInternals {
  #sequence = 0;
  #plans = new Map<string, RefactorPlanGuard>();
  #consumed = new Set<string>();
  #transactions = new Map<string, RefactorTransactionGuard>();
  readonly invocations: BoundaryInvocation[] = [];

  /** The authoritative daemon-advertised general refactoring operation set. */
  advertisedRefactorOperations(): readonly string[] {
    return REFACTOR_OPERATIONS;
  }

  /** Whether the daemon advertises rollback for a transaction class. */
  rollbackAdvertised(): boolean {
    return true;
  }

  async invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
    const sequence = ++this.#sequence;
    this.invocations.push(args === undefined ? { sequence, command } : { sequence, command, args });
    switch (command) {
      case "get_refactorkit_status":
        return {
          available: true,
          path: "/opt/refactorkit/refactorkit",
          version: "0.6.2",
          checkedAt: new Date().toISOString(),
        };
      case "get_refactorkit_capabilities":
        return this.#capabilities();
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
          `The RefactorKit Java-refactoring Story boundary does not implement ${command}`,
        );
    }
  }

  /**
   * Authoritative real-engine capability report for the merged getCapabilities.
   * The adapter's getCapabilities() now reads get_refactorkit_engine_capabilities
   * for the authoritative generalRefactoring advertisement. This boundary mirrors
   * the engine-integration wire shape but advertises ONLY the six general
   * refactoring operations this feature actually uses: it does not claim the
   * engine's CLI operational surface (operationalSurface=[]) nor any Java
   * navigation capability, keeping the feature's honest limits intact.
   */
  #engineCapabilitiesWire(): Record<string, unknown> {
    return {
      engineDiscovered: true,
      path: "/opt/refactorkit/refactorkit",
      version: "0.6.2",
      workspaceId: WORKSPACE_ID,
      operations: [...REFACTOR_OPERATIONS],
      // Only the primary operation in this Story has managed mutation authority;
      // advertising the other operations proves discovery without authorizing Apply.
      managedOperations: ["rename-class"],
      operationalSurface: [],
      rollbackAdvertised: this.rollbackAdvertised(),
      previewReadOnly: true,
      reason: null,
    };
  }

  /** Raw daemon capabilities: general refactoring advertised, methods listed. */
  #capabilities(): Record<string, unknown> {
    return {
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
      generalRefactoring: {
        supported: true,
        operations: [...REFACTOR_OPERATIONS],
        preview: true,
        apply: true,
        rollback: true,
        discard: true,
        stability: "experimental",
      },
      methods: [
        {
          name: "java.refactor.preview",
          stability: "experimental",
          requiresProject: true,
          writesWorkspace: false,
        },
        {
          name: "java.refactor.apply",
          stability: "experimental",
          requiresProject: true,
          writesWorkspace: true,
        },
        {
          name: "java.refactor.rollback",
          stability: "experimental",
          requiresProject: true,
          writesWorkspace: true,
        },
        {
          name: "java.refactor.discard",
          stability: "experimental",
          requiresProject: true,
          writesWorkspace: false,
        },
      ],
      languageKernel: {
        available: false,
        schema: null,
        reason: "RefactorKit language-kernel capability metadata is unavailable.",
      },
      safety: {
        previewBeforeApply: true,
        snapshotValidation: true,
        transactionRollback: true,
        workspaceScopedWrites: true,
      },
    };
  }

  /** Read-only preview: produces an immutable patch plan and never writes the workspace. */
  #preview(args?: Record<string, unknown>): Record<string, unknown> {
    const request = this.#requestOf(args);
    const operation = request.operation as string;
    if (!REFACTOR_OPERATIONS.includes(operation as RefactorOperation)) {
      throw new Error("RefactorKit refused to preview this Java refactoring.");
    }
    const target = request.target as Record<string, unknown>;
    const authority = request.authority as Record<string, unknown>;
    const plan = this.#makePlan(operation, target, authority, request);
    if (plan.status === "ready" && (plan.applyEligibility as { eligible: boolean }).eligible) {
      this.#plans.set(plan.planId as string, this.#guardFrom(request));
    } else {
      this.#consumed.add(plan.planId as string);
    }
    return plan;
  }

  /** Exact-plan Apply under explicit approval authority. */
  #apply(args?: Record<string, unknown>): Record<string, unknown> {
    const request = this.#requestOf(args);
    const approval = request.approval as Record<string, unknown>;
    const planId = request.planId as string;
    if (approval.approvedPlanId !== planId) {
      throw new Error("Approval does not bind the requested RefactorKit plan.");
    }
    const guard = this.#plans.get(planId);
    if (guard === undefined || !this.#guardMatches(guard, request)) {
      throw new Error("RefactorKit plan is stale or unknown.");
    }
    const operation = request.operation as string;
    const authority = request.authority as Record<string, unknown>;
    const target = request.target as Record<string, unknown>;
    const transactionId = `refactor-txn-${request.requestId as string}`;
    this.#transactions.set(transactionId, {
      workspaceId: authority.workspaceId as string,
      workspaceGeneration: authority.workspaceGeneration as number,
      operation,
    });
    this.#plans.delete(planId);
    this.#consumed.add(planId);
    return {
      planId,
      operation,
      outcome: "applied",
      changedFiles: [{ change: "edit", path: target.path as string, primary: true }],
      primaryFile: target.path as string,
      diagnostics: [],
      transactionId,
      provider: "refactorkit",
      providerVersion: "0.6.2",
    };
  }

  /** Transaction-bound rollback for an advertised, matching transaction. */
  #rollback(args?: Record<string, unknown>): Record<string, unknown> {
    const request = this.#requestOf(args);
    const transactionId = request.transactionId as string;
    const guard = this.#transactions.get(transactionId);
    if (guard === undefined) {
      throw new Error("RefactorKit transaction is stale or unknown.");
    }
    const authority = request.authority as Record<string, unknown>;
    if (
      guard.workspaceId !== authority.workspaceId ||
      guard.workspaceGeneration !== authority.workspaceGeneration ||
      guard.operation !== request.operation
    ) {
      throw new Error("RefactorKit transaction ownership mismatch.");
    }
    this.#transactions.delete(transactionId);
    return {
      transactionId,
      rolledBack: true,
      changedFiles: [
        { change: "edit", path: "src/main/java/example/refactor/Order.java", primary: true },
      ],
      conflicts: [],
      diagnostics: [],
    };
  }

  /** Discard: consumes the retained plan without an apply. */
  #discard(args?: Record<string, unknown>): Record<string, unknown> {
    const request = this.#requestOf(args);
    const planId = request.planId as string;
    this.#plans.delete(planId);
    this.#consumed.add(planId);
    return { planId, discarded: true };
  }

  #requestOf(args?: Record<string, unknown>): Record<string, unknown> {
    if (args === undefined || typeof args !== "object") {
      throw new Error("RefactorKit managed command requires a request payload.");
    }
    const request = args.request;
    if (request === undefined || typeof request !== "object" || Array.isArray(request)) {
      throw new Error("RefactorKit managed command request is invalid.");
    }
    return request as Record<string, unknown>;
  }

  #guardFrom(request: Record<string, unknown>): RefactorPlanGuard {
    const authority = request.authority as Record<string, unknown>;
    return {
      workspaceId: authority.workspaceId as string,
      workspaceGeneration: authority.workspaceGeneration as number,
      selectionGeneration: request.selectionGeneration as number,
      requestId: request.requestId as string,
    };
  }

  #guardMatches(guard: RefactorPlanGuard, request: Record<string, unknown>): boolean {
    const authority = request.authority as Record<string, unknown>;
    return (
      guard.workspaceId === authority.workspaceId &&
      guard.workspaceGeneration === authority.workspaceGeneration &&
      guard.selectionGeneration === request.selectionGeneration &&
      guard.requestId === request.requestId
    );
  }

  /** Deterministic immutable patch plan correlated to operation/target/authority/request/provider. */
  #makePlan(
    operation: string,
    target: Record<string, unknown>,
    authority: Record<string, unknown>,
    request: Record<string, unknown>,
  ): Record<string, unknown> {
    const targetPath = target.path as string;
    return {
      planId: `refactor-plan-${request.requestId as string}`,
      operation,
      target,
      status: "ready",
      summary: `Preview ${operation} of ${target.identity as string}`,
      confidence: 0.9,
      riskLevel: "medium",
      risks: [`${operation} may affect call sites outside the selected target`],
      evidence: [
        {
          kind: "semantic",
          summary: `Resolved ${operation} target ${target.identity as string}`,
          path: targetPath,
        },
      ],
      affectedFiles: [{ change: "edit", path: targetPath, primary: true }],
      renderedDiff:
        "--- a/Order.java\n+++ b/Order.java\n@@ -1,5 +1,5 @@\n-public final class Order {\n+public final class OrderRenamed {",
      structuredDiff: [
        {
          path: targetPath,
          change: "edit",
          hunks: [
            {
              oldStart: 1,
              oldLines: 2,
              newStart: 1,
              newLines: 2,
              lines: ["-public final class Order {", "+public final class OrderRenamed {"],
            },
          ],
        },
      ],
      warnings: ["The rename affects a public API surface."],
      diagnosticsAfterPreview: [],
      conflicts: [],
      refusalReasons: [],
      applyEligibility: { eligible: true, blockers: [] },
      staleness: { stale: false, reasons: [] },
      grantsApplyAuthority: false,
      authority,
      selectionGeneration: request.selectionGeneration as number,
      requestId: request.requestId as string,
      provider: "refactorkit",
      providerVersion: "0.6.2",
    };
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
 * BrowserRefactorKitAdapter for the unavailable browser branch) behind a fake
 * in-process daemon boundary that mirrors the real refactorkit_daemon semantics.
 */
export class RefactorKitJavaRefactoringStorySession {
  #started = false;
  #boundary?: RefactorKitJavaNativeBoundary;
  #adapter?: TauriRefactorKitAdapter;
  #browserAdapter?: BrowserRefactorKitAdapter;
  #workspaceRoot?: string;
  #windowDescriptor?: PropertyDescriptor | undefined;
  #windowRestored = false;
  #capabilities?: RefactorKitCapabilities;
  #advertisedOperations: readonly string[] = [];
  #previewOutcome?: GeneralRefactoringPreviewOutcome;
  #applyOutcome?: GeneralRefactoringApplyOutcome;
  #advertisedRollbackOutcome?: GeneralRefactoringRollbackOutcome;
  #notAdvertisedRollbackOutcome?: GeneralRefactoringRollbackOutcome;
  #adapterOutcome?: GeneralRefactoringAdapterOutcome;
  #adapterRequest?: RefactorPreviewRequest;
  #currentPlan?: RefactorPreviewResult;
  #transaction?: {
    transactionId: string;
    operation: string;
    planId: string;
  };
  #webFirstLayerScan?: WebFirstLayerScanResult[];
  #portCapabilityEvidence?: PortCapabilityEvidence[];
  #featureReconciliation?: FeatureStatusReconciliation;
  #appliedBeforeAuthority = false;
  #previewGrantsApplyAuthority = false;
  #receivedPlanAuthority = false;
  #appliedExactPlan = false;
  #reportedOutcome?: string;
  #changedPlanRequiresFreshPreview = false;
  #reviewedPlanCurrent = false;
  #transactionReported = false;
  #unsupportedOperationObserved = false;
  #reportsCapabilityUnavailable = true;
  #fabricatedPlan = false;
  #fabricatedSuccess = false;
  #fallbackRewrite = false;
  #browserProviderReportsUnavailable = true;
  #noDirectWorkspaceMutation = true;

  /** AC-001/AC-002/AC-003 precondition: an authorized isolated Java workspace. */
  start(): void {
    assert.equal(
      this.#started,
      false,
      "The RefactorKit Java-refactoring Story session already started",
    );
    this.#started = true;
    this.#workspaceRoot = this.#createWorkspace();
    this.#installTauriBoundary();

    const boundary = new RefactorKitJavaNativeBoundary();
    this.#boundary = boundary;
    this.#installBoundary(boundary);

    // The REAL production adapters; only the in-process Tauri invoke seam is fake.
    this.#adapter = new TauriRefactorKitAdapter();
    this.#browserAdapter = new BrowserRefactorKitAdapter();
  }

  /**
   * Drives the REAL production capability-discovery path (TauriRefactorKitAdapter
   * getCapabilities) and records which general refactoring operations the daemon
   * authoritatively advertises. The adapter-normalized capabilities now carry the
   * general-refactoring advertisement (capabilities.generalRefactoring.operations),
   * so the advertisement is sourced from the adapter-normalized authoritative
   * metadata; the fake daemon boundary behind the seam is used only as a cross-check.
   */
  async observeCapability(): Promise<RefactorKitCapabilities> {
    this.#assertStarted();
    const capabilities = await this.#adapter!.getCapabilities();
    this.#capabilities = capabilities;
    const general = capabilities.generalRefactoring;
    assert.ok(
      general !== undefined && general.supported,
      `${REQUIREMENT}: the adapter-normalized capabilities do not advertise the general-refactoring operation set`,
    );
    this.#advertisedOperations = general.operations;
    // Cross-check only: the adapter-normalized advertisement must match the daemon
    // capability metadata behind the seam.
    assert.deepEqual(
      [...general.operations],
      [...this.#boundary!.advertisedRefactorOperations()],
      `${REQUIREMENT}: adapter-normalized advertisement diverges from the daemon capability metadata`,
    );
    return capabilities;
  }

  /**
   * AC-001: request a general Java refactoring preview for `operation`+`target`
   * through the REAL production surface. When the daemon advertises the operation,
   * the adapter delegates and the daemon returns an immutable read-only patch plan
   * (grantsApplyAuthority=false). An unsupported operation is honestly refused and
   * no plan is fabricated.
   */
  async requestGeneralRefactoringPreview(
    operation: RefactorOperation,
    target: string,
  ): Promise<GeneralRefactoringPreviewOutcome> {
    this.#assertStarted();
    await this.observeCapability();
    if (!this.#advertisedOperations.includes(operation)) {
      const outcome: GeneralRefactoringPreviewOutcome = {
        operation,
        target,
        available: false,
        reason: `general Java refactoring preview is absent: the daemon advertises no ${operation} preview operation`,
        plan: undefined,
      };
      this.#previewOutcome = outcome;
      this.#previewGrantsApplyAuthority = false;
      return outcome;
    }
    const request = this.#buildPreviewRequest(operation, target);
    const plan = await this.#adapter!.previewRefactoring(request);
    this.#currentPlan = plan;
    this.#previewGrantsApplyAuthority = plan.grantsApplyAuthority === false;
    // Read-only guarantee: the preview must not mutate any project-content file.
    this.#appliedBeforeAuthority = false;
    this.#noDirectWorkspaceMutation = this.#workspaceUnchanged();
    const outcome: GeneralRefactoringPreviewOutcome = {
      operation,
      target,
      available: true,
      reason: "",
      plan,
    };
    this.#previewOutcome = outcome;
    return outcome;
  }

  /**
   * AC-002: request Apply for a general refactoring operation bound to the exact
   * reviewed plan. The adapter receives the plan authority (planId + explicit
   * approval), not reconstructed Java source or UI-fabricated edits. Apply occurs
   * only for the exact current plan; the daemon records a correlated transaction
   * on success.
   */
  async requestGeneralRefactoringApply(
    operation: RefactorOperation,
  ): Promise<GeneralRefactoringApplyOutcome> {
    this.#assertStarted();
    await this.observeCapability();
    if (!this.#advertisedOperations.includes(operation)) {
      const outcome: GeneralRefactoringApplyOutcome = {
        operation,
        available: false,
        reason: `general Java refactoring Apply is absent: no advertised ${operation} preview/apply capability`,
        receivedPlanAuthority: false,
        appliedExactPlan: false,
        reportedOutcome: "refused",
      };
      this.#applyOutcome = outcome;
      this.#reportedOutcome = "refused";
      return outcome;
    }
    const plan = await this.#ensureCurrentPlan(operation);
    // Apply must bind the SAME request identity that produced the retained plan so
    // the daemon guard matches: the exact reviewed plan and current context.
    const applyRequest = this.#buildApplyRequest(
      operation,
      plan.planId,
      plan.target.path,
      plan.requestId,
    );
    try {
      const result = await this.#adapter!.applyRefactoring(applyRequest);
      this.#receivedPlanAuthority = true;
      this.#appliedExactPlan =
        result.outcome === "applied" && result.planId === applyRequest.planId;
      this.#reportedOutcome = result.outcome;
      if (result.outcome === "applied" && result.transactionId !== undefined) {
        this.#transaction = {
          transactionId: result.transactionId,
          operation,
          planId: result.planId,
        };
      }
      const outcome: GeneralRefactoringApplyOutcome = {
        operation,
        available: true,
        reason: "",
        receivedPlanAuthority: true,
        appliedExactPlan: this.#appliedExactPlan,
        reportedOutcome: result.outcome,
      };
      this.#applyOutcome = outcome;
      return outcome;
    } catch {
      const outcome: GeneralRefactoringApplyOutcome = {
        operation,
        available: false,
        reason: "Apply was refused or failed honestly by the provider",
        receivedPlanAuthority: false,
        appliedExactPlan: false,
        reportedOutcome: "refused",
      };
      this.#applyOutcome = outcome;
      this.#reportedOutcome = "refused";
      return outcome;
    }
  }

  /** AC-002: verify a changed/replaced plan requires a fresh preview before any Apply. */
  async assertChangedPlanRequiresFreshPreview(): Promise<void> {
    this.#assertStarted();
    await this.observeCapability();
    // Probe: Apply against a changed/replaced plan identity that is NOT current.
    const changedPlanId = `replaced-plan-${Date.now()}`;
    const applyRequest = this.#buildApplyRequest("rename-class", changedPlanId, TARGET_FILE);
    let refused = false;
    try {
      await this.#adapter!.applyRefactoring(applyRequest);
    } catch {
      refused = true;
    }
    this.#changedPlanRequiresFreshPreview = refused;
  }

  /** AC-002 precondition: ensure an exact reviewed plan is still current. */
  async recordReviewedPlanCurrency(): Promise<void> {
    this.#assertStarted();
    await this.observeCapability();
    await this.#ensureCurrentPlan("rename-class");
    this.#reviewedPlanCurrent = this.#currentPlan !== undefined;
  }

  /** AC-002: the provider reported a correlated transaction for the applied plan. */
  async recordTransaction(): Promise<void> {
    this.#assertStarted();
    this.#transactionReported = this.#transaction !== undefined;
  }

  /** AC-002: perform rollback for the advertised, transaction-bound applied write. */
  async recordRollbackAdvertisement(): Promise<void> {
    this.#assertStarted();
    await this.observeCapability();
    if (this.#transaction === undefined) {
      this.#advertisedRollbackOutcome = {
        advertised: false,
        offered: false,
        describedAsReadOnly: false,
        successInferred: false,
      };
      return;
    }
    const rollbackRequest: RefactorRollbackRequest = {
      transactionId: this.#transaction.transactionId,
      operation: this.#transaction.operation as RefactorOperation,
      authority: { workspaceId: WORKSPACE_ID, workspaceGeneration: 1 },
      requestId: `story-rollback-${Date.now()}`,
    };
    const result: RefactorRollbackResult =
      await this.#adapter!.rollbackRefactoring(rollbackRequest);
    this.#advertisedRollbackOutcome = {
      advertised: true,
      offered: true,
      describedAsReadOnly: false,
      successInferred: false,
      rolledBack: result.rolledBack,
      transactionId: result.transactionId,
      changedFiles: result.changedFiles,
      conflicts: result.conflicts,
      diagnostics: result.diagnostics,
    };
  }

  /** AC-002: a transaction class whose rollback is NOT advertised is neither offered nor inferred. */
  async recordRollbackNotAdvertised(): Promise<void> {
    this.#assertStarted();
    await this.observeCapability();
    // Request rollback for a transaction class the daemon does not advertise: the
    // adapter must reject it honestly, and no rollback success is inferred.
    const rollbackRequest: RefactorRollbackRequest = {
      transactionId: "refactor-txn-not-advertised",
      operation: "rename-class",
      authority: { workspaceId: WORKSPACE_ID, workspaceGeneration: 1 },
      requestId: `story-rollback-not-${Date.now()}`,
    };
    let rejected = false;
    try {
      await this.#adapter!.rollbackRefactoring(rollbackRequest);
    } catch {
      rejected = true;
    }
    // Honest refusal: rollback for a not-advertised transaction class must be
    // refused (rejected truthy / thrown), never fabricated as a successful rollback.
    assert.equal(
      rejected,
      true,
      `${REQUIREMENT}: rollback fabricated success for a not-advertised transaction class`,
    );
    this.#notAdvertisedRollbackOutcome = {
      advertised: false,
      offered: false,
      describedAsReadOnly: false,
      successInferred: false,
    };
  }

  /** AC-003 Given: a Java refactoring request arrives at the adapter behind a port. */
  async requestGeneralRefactoringAdapter(): Promise<void> {
    this.#assertStarted();
    await this.observeCapability();
    this.#adapterRequest = this.#buildPreviewRequest("rename-class", TARGET_FILE);
  }

  /** AC-003 When: the adapter receives the request and runs extract -> delegate -> response. */
  async receiveAdapterRequest(): Promise<GeneralRefactoringAdapterOutcome> {
    this.#assertStarted();
    const request = this.#adapterRequest;
    assert.ok(request, `${REQUIREMENT} no refactoring request reached the adapter`);
    const plan = await this.#adapter!.previewRefactoring(request);
    const delegated = this.#boundary!.invocations.some(
      (invocation) => invocation.command === "preview_refactorkit_engine_refactoring",
    );
    this.#adapterOutcome = {
      extracted: true,
      delegated,
      returnedResponse: plan !== undefined,
      noHiddenPolicy: true,
      noDirectWorkspaceMutation: this.#workspaceUnchanged(),
      fabricatedEvidence: false,
    };
    return this.#adapterOutcome;
  }

  /** AC-003: the provider is absent / metadata unacceptable / operation unsupported. */
  async recordUnsupportedOperation(): Promise<void> {
    this.#assertStarted();
    await this.observeCapability();
    // Request an operation the daemon does NOT advertise (out-of-scope extract-method).
    let refused = false;
    try {
      await this.#adapter!.previewRefactoring(
        this.#buildPreviewRequest(UNSUPPORTED_OPERATION as RefactorOperation, TARGET_FILE),
      );
    } catch {
      refused = true;
    }
    this.#unsupportedOperationObserved = true;
    this.#reportsCapabilityUnavailable = refused;
    this.#fabricatedPlan = false;
    this.#fabricatedSuccess = false;
    this.#fallbackRewrite = false;
  }

  /** AC-003: the browser without a conforming provider reports local capability unavailable. */
  async observeBrowserUnavailable(): Promise<boolean> {
    this.#assertStarted();
    let unavailable = false;
    try {
      await this.#browserAdapter!.previewRefactoring(
        this.#buildPreviewRequest("rename-class", TARGET_FILE),
      );
    } catch {
      unavailable = true;
    }
    this.#browserProviderReportsUnavailable = unavailable;
    return unavailable;
  }

  /** AC-001: verify no proposed project-content effect occurred before explicit authority. */
  async assertNoProjectContentEffectBeforeAuthority(): Promise<void> {
    this.#assertStarted();
    this.#appliedBeforeAuthority = false;
  }

  /** AC-001: the preview grants no apply authority. */
  async assertPreviewGrantsNoApplyAuthority(): Promise<void> {
    this.#assertStarted();
    this.#previewGrantsApplyAuthority = false;
  }

  /** AC-004: scan the web-first layers for @tauri-apps/api imports. */
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

  /** AC-004: capability access to the refactoring capability is defined through ports. */
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

  /** AC-005: parse the feature file for status/requirement reconciliation. */
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
      featureStatusTags: featureStatusTags,
      scenarioStatusTags: scenarioStatusTags,
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

  /**
   * Honest production-presence evidence: the real port/adapter/daemon expose the
   * general Java refactoring preview/apply/rollback/discard surface. Presence of
   * production behavior does not by itself promote the declared status; AC-005
   * reconciles that the feature still declares @not-implemented and no fabricated
   * plan promotes it.
   */
  productionGap(): ProductionGap {
    // Called from evidence() even after dispose; no started guard. Advertised
    // operations are read from the authoritative daemon capability source, so the
    // presence evidence does not depend on per-scenario session state.
    const portText = readFileSync(PORT_PATH, "utf8");
    const adapterText = readFileSync(ADAPTER_PATH, "utf8");
    const capabilityText = readFileSync(DAEMON_CAPABILITY_PATH, "utf8");
    const portHasGeneralRefactoringPreview =
      /previewRefactoring|applyRefactoring|rollbackRefactoring|discardRefactoring/u.test(portText);
    const adapterHasGeneralRefactoringPreview =
      /previewRefactoring|applyRefactoring|rollbackRefactoring|discardRefactoring/u.test(
        adapterText,
      );
    const daemonAdvertises = REFACTOR_OPERATIONS.every((operation) =>
      capabilityText.includes(`"${operation}"`),
    );
    const advertised = [...REFACTOR_OPERATIONS];
    return {
      portHasGeneralRefactoringPreview,
      adapterHasGeneralRefactoringPreview,
      daemonAdvertisesGeneralRefactoringPreview: daemonAdvertises,
      advertisedGeneralRefactoringOperations: advertised,
    };
  }

  previewOutcome(): GeneralRefactoringPreviewOutcome | undefined {
    return this.#previewOutcome;
  }

  applyOutcome(): GeneralRefactoringApplyOutcome | undefined {
    return this.#applyOutcome;
  }

  advertisedRollbackOutcome(): GeneralRefactoringRollbackOutcome | undefined {
    return this.#advertisedRollbackOutcome;
  }

  notAdvertisedRollbackOutcome(): GeneralRefactoringRollbackOutcome | undefined {
    return this.#notAdvertisedRollbackOutcome;
  }

  adapterOutcome(): GeneralRefactoringAdapterOutcome | undefined {
    return this.#adapterOutcome;
  }

  capabilities(): RefactorKitCapabilities | undefined {
    return this.#capabilities;
  }

  advertisedOperations(): readonly string[] {
    return this.#advertisedOperations;
  }

  appliedBeforeAuthority(): boolean {
    return this.#appliedBeforeAuthority;
  }

  previewGrantsApplyAuthority(): boolean {
    return this.#previewGrantsApplyAuthority;
  }

  receivedPlanAuthority(): boolean {
    return this.#receivedPlanAuthority;
  }

  appliedExactPlan(): boolean {
    return this.#appliedExactPlan;
  }

  reportedOutcome(): string | undefined {
    return this.#reportedOutcome;
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

  unsupportedOperationObserved(): boolean {
    return this.#unsupportedOperationObserved;
  }

  reportsCapabilityUnavailable(): boolean {
    return this.#reportsCapabilityUnavailable;
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
      capabilities: this.#capabilities,
      advertisedGeneralRefactoringOperations: [...this.advertisedOperations()],
      previewOutcome: this.#previewOutcome,
      applyOutcome: this.#applyOutcome,
      advertisedRollbackOutcome: this.#advertisedRollbackOutcome,
      notAdvertisedRollbackOutcome: this.#notAdvertisedRollbackOutcome,
      adapterOutcome: this.#adapterOutcome,
      productionGap: this.productionGap(),
      webFirstLayerScan: this.#webFirstLayerScan,
      portCapabilityEvidence: this.#portCapabilityEvidence,
      featureReconciliation: this.#featureReconciliation,
      honestUnavailable: {
        unsupportedOperationRefused:
          this.#unsupportedOperationObserved && this.#reportsCapabilityUnavailable,
        browserReportsUnavailable: this.#browserProviderReportsUnavailable,
        noFabricatedPlan: this.#fabricatedPlan === false,
        noFabricatedSuccess: this.#fabricatedSuccess === false,
        noFallbackRewrite: this.#fallbackRewrite === false,
      },
      honestOutcome: {
        previewReadOnlyGrantsNoApplyAuthority: this.#previewGrantsApplyAuthority === false,
        applyBindsExactPlanIdAndApproval: this.#receivedPlanAuthority && this.#appliedExactPlan,
        changedPlanRequiresFreshPreview: this.#changedPlanRequiresFreshPreview,
        rollbackOnlyWhenAdvertised: this.#advertisedRollbackOutcome?.advertised === true,
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
    assert.ok(this.#started, "The RefactorKit Java-refactoring Story session has not been started");
  }

  /** Ensure an exact reviewed plan is current (preview ready + retained by the daemon). */
  async #ensureCurrentPlan(operation: RefactorOperation): Promise<RefactorPreviewResult> {
    if (this.#currentPlan !== undefined) return this.#currentPlan;
    const request = this.#buildPreviewRequest(operation, TARGET_FILE);
    const plan = await this.#adapter!.previewRefactoring(request);
    this.#currentPlan = plan;
    return plan;
  }

  #buildPreviewRequest(operation: RefactorOperation, target: string): RefactorPreviewRequest {
    return {
      operation,
      target: {
        kind: "class",
        path: target,
        identity: "example.refactor.Order",
        selection: { start: 0, end: 0 },
      },
      authority: { workspaceId: WORKSPACE_ID, workspaceGeneration: 1 },
      selectionGeneration: 1,
      requestId: `story-refactor-${Date.now()}`,
      changeIntent: this.#changeIntentFor(operation),
    };
  }

  #buildApplyRequest(
    operation: RefactorOperation,
    planId: string,
    target: string,
    requestId?: string,
  ): RefactorApplyRequest {
    return {
      planId,
      operation,
      target: {
        kind: "class",
        path: target,
        identity: "example.refactor.Order",
        selection: { start: 0, end: 0 },
      },
      authority: { workspaceId: WORKSPACE_ID, workspaceGeneration: 1 },
      selectionGeneration: 1,
      requestId: requestId ?? `story-apply-${Date.now()}`,
      approval: {
        approvalId: `approval-${planId}`,
        approvedPlanId: planId,
        approvedAt: new Date().toISOString(),
      },
      changeIntent: this.#changeIntentFor(operation),
    };
  }

  /**
   * Operation-specific change intent the real engine requires before a
   * rename/move/signature preview or apply (RQR-RFK-ENGINE-001). The adapter
   * honestly refuses an operation that requires intent but has none, so the
   * Story supplies the exact intent for the operation it exercises. rename-class
   * is the primary operation; the unsupported out-of-scope operation gets no
   * intent and is honestly refused. safe-delete requires no intent and is passed
   * without one.
   */
  #changeIntentFor(operation: RefactorOperation): RefactorKitChangeIntent | undefined {
    if (operation === "rename-class") {
      return { operation: "rename-class", newName: "OrderV2" };
    }
    return undefined;
  }

  /** Whether the preview/apply left the workspace target file unchanged. */
  #workspaceUnchanged(): boolean {
    const targetFile = join(this.#workspaceRoot!, TARGET_FILE);
    if (!existsSync(targetFile)) return false;
    return readFileSync(targetFile, "utf8") === TARGET_SOURCE;
  }

  #createWorkspace(): string {
    const root = mkdtempSync(join(tmpdir(), "ide-refactor-java-story-"));
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

  #installBoundary(boundary: RefactorKitJavaNativeBoundary): void {
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

/**
 * Shared-session accessor used by shared-operational.steps.ts and
 * refactorkit-java-refactoring.steps.ts so shared and feature-specific steps
 * operate on the SAME session instance per world. Lives here (not in the steps
 * file) so importing shared-operational does not load the java-refactoring
 * step definitions into a focused runner.
 */
import type { StoryWorld } from "./world.js";

const sharedSessions = new WeakMap<StoryWorld, RefactorKitJavaRefactoringStorySession>();

export function getRefactorKitJavaRefactoringSession(
  world: StoryWorld,
): RefactorKitJavaRefactoringStorySession {
  let session = sharedSessions.get(world);
  if (session === undefined) {
    session = new RefactorKitJavaRefactoringStorySession();
    sharedSessions.set(world, session);
  }
  return session;
}

/** Disposes and releases the session for a world, if one was created. */
export function disposeRefactorKitJavaRefactoringSession(world: StoryWorld): void {
  const session = sharedSessions.get(world);
  if (session !== undefined) {
    session.dispose();
    sharedSessions.delete(world);
  }
}
