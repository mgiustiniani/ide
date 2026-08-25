// ---------------------------------------------------------------------------
// @ide/contracts – provider-neutral RefactorKit contracts
// ---------------------------------------------------------------------------

/** Runtime availability reported by a concrete RefactorKit adapter/backend. */
export interface RefactorKitStatus {
  available: boolean;
  path?: string;
  version?: string;
  lastError?: string;
  checkedAt?: string;
}

export interface RefactorKitLocation {
  path: string;
  line: number;
  column?: number;
}

export interface RefactorKitCommandResult {
  stdout: string;
  stderr: string;
  locations: RefactorKitLocation[];
  success: boolean;
  code: number;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  command: string[];
}

export type RefactorKitCapabilityStability = "experimental" | "preview" | "stable";

export interface RefactorKitExternalClassImportCapability {
  supported: boolean;
  /** Must be true for the IDE paste workflow. A targetPackage-only API is unsupported. */
  targetDirectory: boolean;
  preview: boolean;
  apply: boolean;
  rollback: boolean;
  stability: RefactorKitCapabilityStability;
}

export type RefactorKitLanguageCapabilityStability =
  "stable" | "experimental" | "structural" | "refused" | "not-applicable";

export type RefactorKitLanguageCapabilityEvidence =
  "compiler" | "language-server" | "native-ast" | "structural-parse" | "lexical" | "none";

export type RefactorKitLanguageMutationAuthority = "managed-stable" | "proposal-only" | "none";
export type RefactorKitLanguageAdapterExecutionMode = "in-process" | "external-process";

/** Nullable resource limits from RefactorKit language-kernel schema v1. */
export interface RefactorKitLanguageAdapterResourceLimits {
  /** Inclusive range 1–300,000 when present. */
  requestTimeoutMillis: number | null;
  /** Inclusive range 1–4 GiB when present. */
  maxInputBytes: number | null;
  /** Inclusive range 1–4 GiB when present. */
  maxOutputBytes: number | null;
  /** Inclusive range 1–64 when present. */
  maxProcesses: number | null;
}

export interface RefactorKitLanguageAdapterRuntime {
  executionMode: RefactorKitLanguageAdapterExecutionMode;
  supportsTimeout: boolean;
  supportsCancellation: boolean;
  usesWorkspaceOverlay: boolean;
  recordsProcessProvenance: boolean;
  limits: RefactorKitLanguageAdapterResourceLimits;
}

/**
 * Exact RefactorKit schema-v1 wire entry from v0.6.2 commit
 * 110b60537009781b44db9b840cf057d5b7f51067; operation metadata is always materialized.
 */
export interface RefactorKitLanguageCapability {
  operation: string;
  stability: RefactorKitLanguageCapabilityStability;
  evidence: RefactorKitLanguageCapabilityEvidence;
  mutationAuthority: RefactorKitLanguageMutationAuthority;
  backend: string;
  runtime: RefactorKitLanguageAdapterRuntime;
  /** Lowercase operation-owned extensions without a leading dot. */
  extensions: string[];
}

export interface RefactorKitLanguageAdapter {
  languageId: string;
  /** Lowercase extensions without a leading dot. */
  extensions: string[];
  backend: string;
  runtime: RefactorKitLanguageAdapterRuntime;
  capabilities: RefactorKitLanguageCapability[];
}

export interface RefactorKitLanguageKernelVocabulary {
  stability: RefactorKitLanguageCapabilityStability[];
  evidence: RefactorKitLanguageCapabilityEvidence[];
  mutationAuthority: RefactorKitLanguageMutationAuthority[];
  executionMode: RefactorKitLanguageAdapterExecutionMode[];
}

/** Exact versioned shape of daemon `server.capabilities.languageKernel` schema v1. */
export interface RefactorKitLanguageKernel {
  schemaVersion: 1;
  adapters: RefactorKitLanguageAdapter[];
  vocabulary: RefactorKitLanguageKernelVocabulary;
}

/** Normalized availability keeps runtimes without a local daemon honest. */
export type RefactorKitLanguageKernelStatus =
  | { available: true; schema: RefactorKitLanguageKernel }
  | { available: false; schema: null; reason: string };

/** Exact safety flags currently advertised by daemon `server.capabilities`. */
export interface RefactorKitSafetyCapabilities {
  previewBeforeApply: boolean;
  snapshotValidation: boolean;
  transactionRollback: boolean;
  workspaceScopedWrites: boolean;
}

export interface RefactorKitDiagnosticsV2MethodFeatures {
  requestCorrelation: true;
  semanticLease: true;
  savedDiskAuthority: true;
  immutableEditorOverlay: true;
  exactUtf16Ranges: true;
  structuredReadiness: true;
  compilerAttestation: true;
  boundedResponse: true;
}

/** Provider-advertised metadata for one public RefactorKit operation. */
export interface RefactorKitMethodCapability {
  name: string;
  stability: string;
  requiresProject: boolean;
  writesWorkspace: boolean;
  features?: Record<string, boolean>;
}

const METHOD_CAPABILITY_FIELDS = new Set([
  "name",
  "stability",
  "requiresProject",
  "writesWorkspace",
  "features",
]);

const DIAGNOSTICS_V2_FEATURE_NAMES = [
  "requestCorrelation",
  "semanticLease",
  "savedDiskAuthority",
  "immutableEditorOverlay",
  "exactUtf16Ranges",
  "structuredReadiness",
  "compilerAttestation",
  "boundedResponse",
] as const satisfies readonly (keyof RefactorKitDiagnosticsV2MethodFeatures)[];

const INVALID_METHOD_CAPABILITIES = "Invalid RefactorKit method capability metadata";

function isMethodCapabilityRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnField(value: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function rejectMethodCapabilities(): never {
  throw new TypeError(INVALID_METHOD_CAPABILITIES);
}

function normalizeMethodCapabilities(value: unknown): RefactorKitMethodCapability[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return rejectMethodCapabilities();

  const names = new Set<string>();
  return value.map((candidate) => {
    if (!isMethodCapabilityRecord(candidate)) return rejectMethodCapabilities();

    const fields = Reflect.ownKeys(candidate);
    if (
      fields.some((field) => typeof field !== "string" || !METHOD_CAPABILITY_FIELDS.has(field)) ||
      !hasOwnField(candidate, "name") ||
      !hasOwnField(candidate, "stability") ||
      !hasOwnField(candidate, "requiresProject") ||
      !hasOwnField(candidate, "writesWorkspace")
    ) {
      return rejectMethodCapabilities();
    }

    const { name, stability, requiresProject, writesWorkspace } = candidate;
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      typeof stability !== "string" ||
      stability.length === 0 ||
      typeof requiresProject !== "boolean" ||
      typeof writesWorkspace !== "boolean" ||
      names.has(name)
    ) {
      return rejectMethodCapabilities();
    }

    let features: Record<string, boolean> | undefined;
    if (hasOwnField(candidate, "features")) {
      const advertisedFeatures = candidate.features;
      if (!isMethodCapabilityRecord(advertisedFeatures)) return rejectMethodCapabilities();

      const featureFields = Reflect.ownKeys(advertisedFeatures);
      if (
        featureFields.length === 0 ||
        featureFields.some(
          (field) => typeof field !== "string" || typeof advertisedFeatures[field] !== "boolean",
        )
      ) {
        return rejectMethodCapabilities();
      }
      const featureNames = featureFields as string[];
      features = Object.fromEntries(
        featureNames.map((field) => [field, advertisedFeatures[field] as boolean]),
      );
    }

    if (
      name === "diagnostics.v2" &&
      (stability !== "additive-api-0.2" ||
        requiresProject !== true ||
        writesWorkspace !== false ||
        features === undefined ||
        Reflect.ownKeys(features).length !== DIAGNOSTICS_V2_FEATURE_NAMES.length ||
        DIAGNOSTICS_V2_FEATURE_NAMES.some((feature) => features?.[feature] !== true))
    ) {
      return rejectMethodCapabilities();
    }

    names.add(name);
    const normalized: RefactorKitMethodCapability = {
      name,
      stability,
      requiresProject,
      writesWorkspace,
    };
    if (features !== undefined) normalized.features = features;
    return normalized;
  });
}

/** Strictly validates and clones untrusted provider method metadata. */
export function normalizeRefactorKitMethodCapabilities(
  value: unknown,
): RefactorKitMethodCapability[] | undefined {
  try {
    return normalizeMethodCapabilities(value);
  } catch {
    return rejectMethodCapabilities();
  }
}

/** Capabilities are authoritative; the IDE must not infer them from a version number. */
export interface RefactorKitCapabilities {
  api: string;
  apiVersion: string;
  provider: string;
  providerVersion: string | null;
  javaImportExternalClass: RefactorKitExternalClassImportCapability;
  /** Absent for legacy adapters, including RefactorKit 0.6.2. */
  methods?: RefactorKitMethodCapability[];
  /** Absent only for legacy adapters that predate language-kernel discovery. */
  languageKernel?: RefactorKitLanguageKernelStatus;
  safety?: RefactorKitSafetyCapabilities;
}

export interface PreviewExternalJavaImportRequest {
  code: string;
  /** Selected workspace-relative directory. It is not a Java package name. */
  targetDirectory: string;
  sourceKind: "clipboard";
  sourceUrl: null;
  licensePolicy: "warn";
  workspaceId: string;
  workspaceGeneration: number;
  selectionGeneration: number;
  requestId: string;
}

export type RefactorKitPatchPlanStatus = "ready" | "refused" | "stale" | "error";
export type RefactorKitRiskLevel = "low" | "medium" | "high" | "unknown";
export type RefactorKitFileChangeKind = "create" | "edit" | "move" | "delete";

export interface RefactorKitEvidence {
  kind: string;
  summary: string;
  path?: string;
  detail?: string;
}

export interface RefactorKitAffectedFile {
  change: RefactorKitFileChangeKind;
  /** Workspace-relative path after the change, or the deleted path. */
  path: string;
  /** Workspace-relative original path for a move. */
  previousPath?: string;
  primary: boolean;
}

export interface RefactorKitJavaPlacement {
  packageName: string | null;
  sourceRoot: string | null;
  moduleName: string | null;
}

export interface RefactorKitPackageChange {
  /** Workspace-relative path of the changed file. Optional — a package change may describe
   *  an imported unit without a single-file mapping (the UI must not fabricate a path). */
  path?: string;
  fromPackage: string | null;
  toPackage: string | null;
}

export interface RefactorKitStructuredDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface RefactorKitStructuredDiff {
  path: string;
  change: RefactorKitFileChangeKind;
  hunks: RefactorKitStructuredDiffHunk[];
}

export type RefactorKitDiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface RefactorKitPlanDiagnostic {
  severity: RefactorKitDiagnosticSeverity;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  code?: string;
}

export interface RefactorKitProvenance {
  sourceKind: "clipboard";
  sourceUrl: null;
  detectedLicense: string | null;
  licensePolicy: "warn";
  notices: string[];
}

export interface RefactorKitPlanConflict {
  kind: string;
  summary: string;
  path?: string;
}

export interface RefactorKitApplyEligibility {
  eligible: boolean;
  blockers: string[];
}

export interface RefactorKitPlanStaleness {
  stale: boolean;
  reasons: string[];
}

/** Complete, backend-produced preview. Core code treats all Java metadata as opaque evidence. */
export interface RefactorKitPatchPlan {
  planId: string;
  status: RefactorKitPatchPlanStatus;
  summary: string;
  confidence: number;
  riskLevel: RefactorKitRiskLevel;
  evidence: RefactorKitEvidence[];
  affectedFiles: RefactorKitAffectedFile[];
  placement: RefactorKitJavaPlacement;
  packageChanges: RefactorKitPackageChange[];
  renderedDiff: string;
  structuredDiff: RefactorKitStructuredDiff[];
  warnings: string[];
  diagnosticsAfterPreview: RefactorKitPlanDiagnostic[];
  provenance: RefactorKitProvenance;
  unresolvedDependencies: string[];
  conflicts: RefactorKitPlanConflict[];
  refusalReasons: string[];
  applyEligibility: RefactorKitApplyEligibility;
  staleness: RefactorKitPlanStaleness;
  provider: string;
  providerVersion: string | null;
  workspaceId: string;
  workspaceGeneration: number;
  selectionGeneration: number;
  requestId: string;
}

export interface RefactorKitApprovalEvidence {
  approvalId: string;
  approvedPlanId: string;
  approvedAt: string;
}

export interface ApplyRefactorKitPlanRequest {
  planId: string;
  workspaceId: string;
  workspaceGeneration: number;
  selectionGeneration: number;
  requestId: string;
  approval: RefactorKitApprovalEvidence;
}

export interface ApplyRefactorKitPlanResult {
  transactionId: string;
  planId: string;
  changedFiles: RefactorKitAffectedFile[];
  primaryFile: string | null;
  diagnostics: RefactorKitPlanDiagnostic[];
  provider: string;
  providerVersion: string | null;
}

export interface RollbackRefactorKitTransactionRequest {
  transactionId: string;
  workspaceId: string;
  workspaceGeneration: number;
  requestId: string;
}

export interface RollbackRefactorKitTransactionResult {
  transactionId: string;
  rolledBack: boolean;
  changedFiles: RefactorKitAffectedFile[];
  diagnostics: RefactorKitPlanDiagnostic[];
}

// ---------------------------------------------------------------------------
// Discard (refactor.discard)
// ---------------------------------------------------------------------------

export interface DiscardRefactorKitPlanRequest {
  planId: string;
  workspaceId: string;
  workspaceGeneration: number;
  selectionGeneration: number;
  requestId: string;
}

export interface DiscardRefactorKitPlanResult {
  planId: string;
  discarded: boolean;
}

// ---------------------------------------------------------------------------
// General Java refactoring (rename / move / change-method-signature / safe-delete)
// ---------------------------------------------------------------------------
// Provider-neutral request/result contracts for the operational RefactorKit
// Java refactoring slice (REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001). These
// types reuse the shared review-evidence types above (RefactorKitAffectedFile,
// RefactorKitStructuredDiff, RefactorKitPlanDiagnostic, RefactorKitPlanConflict,
// RefactorKitApplyEligibility, RefactorKitPlanStaleness, RefactorKitEvidence,
// RefactorKitApprovalEvidence) rather than redefining import-only shapes.
//
// A preview is always read-only and grants no apply authority. Apply binds to
// the exact reviewed plan identity under explicit authority. Rollback is exposed
// only when the provider advertises the relevant transaction class.
// ---------------------------------------------------------------------------

/** The general Java refactoring operation set declared by this slice. */
export type RefactoringOperation =
  | "rename-class"
  | "rename-member"
  | "rename-local-variable"
  | "move-class"
  | "change-method-signature"
  | "safe-delete";

/** An exact semantic Java target bound by the IDE for a refactoring request. */
export interface RefactoringTarget {
  /** Java element kind: class, member, or local binding. */
  kind: "class" | "member" | "local-binding";
  /** Workspace-relative path of the containing source file. */
  path: string;
  /** Stable semantic identity of the element (e.g. FQN for a class, signature for a member). */
  identity: string;
  /** Selection in UTF-16 offsets when the request is selection-bound. */
  selection?: {
    start: number;
    end: number;
  };
}

/** Workspace authority carried by every general refactoring request/result. */
export interface RefactorWorkspaceAuthority {
  workspaceId: string;
  workspaceGeneration: number;
}

/** Request one read-only Java refactoring preview for an exact operation + target. */
export interface RefactorPreviewRequest {
  operation: RefactoringOperation;
  target: RefactoringTarget;
  authority: RefactorWorkspaceAuthority;
  selectionGeneration: number;
  requestId: string;
}

/**
 * Backend-produced immutable patch plan for a general Java refactoring preview.
 * Correlated to the operation, target, workspace authority, selection/request,
 * and provider. Review evidence reuses the shared RefactorKit types; no
 * project-content effect occurs before explicit authority, and the preview
 * grants no apply authority.
 */
export interface RefactorPreviewResult {
  planId: string;
  operation: RefactoringOperation;
  target: RefactoringTarget;
  status: RefactorKitPatchPlanStatus;
  summary: string;
  confidence: number;
  riskLevel: RefactorKitRiskLevel;
  /** Explicit risk evidence detail (riskLevel remains the coarse level). */
  risks: string[];
  evidence: RefactorKitEvidence[];
  /** Proposed effects: create, edit, move, or delete. */
  affectedFiles: RefactorKitAffectedFile[];
  renderedDiff: string;
  structuredDiff: RefactorKitStructuredDiff[];
  warnings: string[];
  diagnosticsAfterPreview: RefactorKitPlanDiagnostic[];
  conflicts: RefactorKitPlanConflict[];
  refusalReasons: string[];
  applyEligibility: RefactorKitApplyEligibility;
  staleness: RefactorKitPlanStaleness;
  /** The preview is always read-only and grants no apply authority. */
  grantsApplyAuthority: false;
  authority: RefactorWorkspaceAuthority;
  selectionGeneration: number;
  requestId: string;
  provider: string;
  providerVersion: string | null;
}

/**
 * Explicit IDE authority binding to the exact reviewed plan. Reuses
 * RefactorKitApprovalEvidence: the approval references the reviewed plan ID and
 * timestamp, so Apply never reconstructs Java source or UI-fabricated edits.
 */
export interface RefactorApplyRequest {
  /** Identity of the exact reviewed plan being applied. */
  planId: string;
  operation: RefactoringOperation;
  target: RefactoringTarget;
  authority: RefactorWorkspaceAuthority;
  selectionGeneration: number;
  requestId: string;
  approval: RefactorKitApprovalEvidence;
}

/** Honest outcome reported after an Apply attempt. */
export type RefactorApplyOutcome =
  | "applied"
  | "refused"
  | "stale"
  | "failed"
  | "indeterminate";

export interface RefactorApplyResult {
  planId: string;
  operation: RefactoringOperation;
  outcome: RefactorApplyOutcome;
  changedFiles: RefactorKitAffectedFile[];
  primaryFile: string | null;
  diagnostics: RefactorKitPlanDiagnostic[];
  /** Present only when the provider supplies a correlated transaction identity. */
  transactionId?: string;
  provider: string;
  providerVersion: string | null;
}

/** Request rollback for an advertised, transaction-bound compensating write. */
export interface RefactorRollbackRequest {
  transactionId: string;
  operation: RefactoringOperation;
  authority: RefactorWorkspaceAuthority;
  requestId: string;
}

export interface RefactorRollbackResult {
  transactionId: string;
  rolledBack: boolean;
  changedFiles: RefactorKitAffectedFile[];
  conflicts: RefactorKitPlanConflict[];
  diagnostics: RefactorKitPlanDiagnostic[];
}
