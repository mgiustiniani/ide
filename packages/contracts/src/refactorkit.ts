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

export type RefactorKitCapabilityStability = 'experimental' | 'preview' | 'stable';

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
  | 'stable'
  | 'experimental'
  | 'structural'
  | 'refused'
  | 'not-applicable';

export type RefactorKitLanguageCapabilityEvidence =
  | 'compiler'
  | 'language-server'
  | 'native-ast'
  | 'structural-parse'
  | 'lexical'
  | 'none';

export type RefactorKitLanguageMutationAuthority = 'managed-stable' | 'proposal-only' | 'none';
export type RefactorKitLanguageAdapterExecutionMode = 'in-process' | 'external-process';

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

export interface RefactorKitLanguageCapability {
  operation: string;
  stability: RefactorKitLanguageCapabilityStability;
  evidence: RefactorKitLanguageCapabilityEvidence;
  mutationAuthority: RefactorKitLanguageMutationAuthority;
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

/** Capabilities are authoritative; the IDE must not infer them from a version number. */
export interface RefactorKitCapabilities {
  api: string;
  apiVersion: string;
  provider: string;
  providerVersion: string | null;
  javaImportExternalClass: RefactorKitExternalClassImportCapability;
  /** Absent only for legacy adapters that predate language-kernel discovery. */
  languageKernel?: RefactorKitLanguageKernelStatus;
  safety?: RefactorKitSafetyCapabilities;
}

export interface PreviewExternalJavaImportRequest {
  code: string;
  /** Selected workspace-relative directory. It is not a Java package name. */
  targetDirectory: string;
  sourceKind: 'clipboard';
  sourceUrl: null;
  licensePolicy: 'warn';
  workspaceId: string;
  workspaceGeneration: number;
  selectionGeneration: number;
  requestId: string;
}

export type RefactorKitPatchPlanStatus = 'ready' | 'refused' | 'stale' | 'error';
export type RefactorKitRiskLevel = 'low' | 'medium' | 'high' | 'unknown';
export type RefactorKitFileChangeKind = 'create' | 'edit' | 'move' | 'delete';

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

export type RefactorKitDiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface RefactorKitPlanDiagnostic {
  severity: RefactorKitDiagnosticSeverity;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  code?: string;
}

export interface RefactorKitProvenance {
  sourceKind: 'clipboard';
  sourceUrl: null;
  detectedLicense: string | null;
  licensePolicy: 'warn';
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
