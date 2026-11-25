// ---------------------------------------------------------------------------
// @ide/contracts – provider-neutral RefactorKit contracts
// ---------------------------------------------------------------------------

import type {
  JavaProjectOperationContext,
  JavaProjectContextAttestation,
} from "./java-project-context";
import type { JavaFormatterProfile } from "./editor";

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

/** Request for the provider-owned rename planner in the synchronized Java project session. */
export interface MavenModuleRenamePreviewRequest {
  /** Module directory relative to the synchronized Java project root. */
  oldModuleDir: string;
  /** Destination directory relative to the synchronized Java project root. */
  newModuleDir: string;
  newArtifactId?: string;
  expectedSnapshotHash: string;
  expectedContextHash: string;
  workspaceId: string;
  workspaceGeneration: number;
  selectionGeneration: number;
  requestId: string;
}

/** Bounded preview returned by RefactorKit for Maven module rename. */
export interface MavenModuleRenamePreview {
  planId: string;
  operation: "java.renameMavenModule";
  status: "preview";
  summary: string;
  snapshotHash: string;
  affectedFiles: string[];
  renderedDiff: string;
  diffTruncated: boolean;
  diffTruncationReasons: string[];
  provider: string;
  providerVersion: string;
  workspaceId: string;
  workspaceGeneration: number;
  selectionGeneration: number;
  requestId: string;
}

/** Apply the exact retained, reviewed Maven module rename plan. */
export interface MavenModuleRenameApplyRequest {
  planId: string;
  workspaceId: string;
  workspaceGeneration: number;
  selectionGeneration: number;
  requestId: string;
  approval: RefactorKitApprovalEvidence;
}

/** Correlated result from a managed Maven module rename. */
export interface MavenModuleRenameApplyResult {
  planId: string;
  transactionId: string;
  snapshotHash: string;
  changedFiles: RefactorKitAffectedFile[];
  provider: string;
  providerVersion: string;
}

/** Roll back a managed Maven module rename through its retained project session. */
export interface MavenModuleRenameRollbackRequest {
  transactionId: string;
  workspaceId: string;
  workspaceGeneration: number;
  requestId: string;
}

/** Correlated result from a Maven module rename rollback. */
export interface MavenModuleRenameRollbackResult {
  transactionId: string;
  rolledBack: boolean;
  changedFiles: RefactorKitAffectedFile[];
}

export interface MavenModuleRenameDiscardRequest {
  planId: string;
  workspaceId: string;
  workspaceGeneration: number;
  selectionGeneration: number;
  requestId: string;
}

const MAVEN_MODULE_RENAME_METHOD = "java.renameMavenModule";

/** The module-rename UI requires the provider's explicit preview and diff advertisement. */
export function mavenModuleRenamePreviewOffered(
  capabilities: Pick<RefactorKitCapabilities, "methods"> | null | undefined,
  requiresNestedDirectoryMove = false,
): boolean {
  const matches = capabilities?.methods?.filter(
    (method) => method.name === MAVEN_MODULE_RENAME_METHOD,
  );
  if (matches?.length !== 1) return false;
  const [method] = matches;
  return (
    ["experimental", "preview", "stable"].includes(method.stability) &&
    method.requiresProject &&
    !method.writesWorkspace &&
    method.features?.preview === true &&
    method.features.renderedDiff === true &&
    (!requiresNestedDirectoryMove || method.features.nestedModuleDirectoryMove === true)
  );
}

/** Managed Apply is offered only when the provider advertises both mutation and rollback. */
export function mavenModuleRenameApplyOffered(
  capabilities: Pick<RefactorKitCapabilities, "methods"> | null | undefined,
): boolean {
  const matches = capabilities?.methods?.filter(
    (method) => method.name === MAVEN_MODULE_RENAME_METHOD,
  );
  if (matches?.length !== 1) return false;
  const [method] = matches;
  return (
    ["experimental", "preview", "stable"].includes(method.stability) &&
    method.requiresProject &&
    !method.writesWorkspace &&
    method.features?.preview === true &&
    method.features?.renderedDiff === true &&
    method.features?.apply === true &&
    method.features?.rollback === true
  );
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

/**
 * Capability-before-offer shape mirroring the daemon `generalRefactoring`
 * advertisement (GeneralRefactoringCapability). The IDE must surface this
 * authoritative advertisement; support is never inferred from a version number,
 * a generic apply button, or the import API. When the daemon does not advertise
 * the general-refactoring operation set, `supported` is false and the canonical
 * operation set is still listed (preview/apply/rollback/discard all false).
 */
export interface RefactorKitGeneralRefactoringCapability {
  supported: boolean;
  /** The canonical general Java refactoring operation set the daemon advertises. */
  operations: RefactoringOperation[];
  preview: boolean;
  apply: boolean;
  rollback: boolean;
  discard: boolean;
  stability: RefactorKitCapabilityStability;
  /** Honest unavailable reason when `supported` is false. */
  reason?: string;
  updateGuidance?: string;
}

/** Capabilities are authoritative; the IDE must not infer them from a version number. */
export interface RefactorKitCapabilities {
  api: string;
  apiVersion: string;
  provider: string;
  providerVersion: string | null;
  javaImportExternalClass: RefactorKitExternalClassImportCapability;
  /** Engine-advertised operations with stable managed Apply authority, independent of the daemon language-kernel surface. */
  managedJavaMutationOperations?: RefactoringOperation[];
  /** The daemon's general Java refactoring advertisement (capability-before-offer). */
  generalRefactoring?: RefactorKitGeneralRefactoringCapability;
  /**
   * Safe delete may be applied only when RefactorKit searches the complete project,
   * including build and resource files, for references to the target.
   */
  safeDeleteReferenceAnalysis?: "complete-project";
  /** Explicit saved-source SDK admission; unrelated to legacy CLI capabilities. */
  javaContextRefactoring?: {
    schemaVersion: 1;
    operations: string[];
    requiresExplicitContext: true;
    sourceAuthority: "saved-snapshot";
    rollbackAuthority: boolean;
    renderedDiff?: boolean;
    editorSelectionSchemaVersion?: string;
    dirtyEditorPreview?: boolean;
    editorPreviewMethod?: string;
    editorPreviewSchemaVersion?: string;
    editorPreviewOperations?: string[];
    dirtyEditorMutationAuthority?: boolean;
    durableEditorRecovery?: boolean;
    editorTransactionSchemaVersion?: string;
    editorMutationOperations?: string[];
    selectionQueryKind?: string;
    selectionSchemaVersion?: string;
    /** Per-operation provider attestations, separate from shared project-context authority. */
    operationCapabilities?: Array<{
      operation: string;
      features?: { thisMethodReferenceMigration?: true; formatterProfile?: true };
      /** Read-only workspace text-scan evidence for safe-delete previews. */
      referenceAnalysis?: {
        schemaVersion: "java-safe-delete-reference-analysis-v1";
        scope: "workspace-text-v1";
        resultField: "referenceAnalysis";
        statusValues: ["complete", "incomplete"];
        managedApplyAuthority: "none";
        completeProject: false;
      };
      /** Exact attestation for selecting a new move-class destination module. */
      targetModuleSelection?: {
        schemaVersion: "java-move-class-target-module-v1";
        argument: "targetModuleId";
        identity: "module-id-within-source-provider";
        requiresAvailableContext: true;
        sourceSetKind: "main";
        requiresUniqueNonGeneratedRoot: true;
      };
    }>;
  };
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

/** Reviewed Java semantic refactorings and whole-file transformations. */
export type RefactoringOperation =
  | "create-maven-module"
  | "create-gradle-module"
  | "rename-gradle-module"
  | "rename-class"
  | "rename-member"
  | "rename-local-variable"
  | "move-class"
  | "move-package"
  | "move-source-root"
  | "change-method-signature"
  | "change-method-parameter-type"
  | "add-method-parameter"
  | "remove-method-parameter"
  | "reorder-method-parameters"
  | "make-static"
  | "make-public"
  | "change-field-type"
  | "inline-variable"
  | "inline-method"
  | "introduce-parameter-object"
  | "extract-delegate"
  | "inline-constant"
  | "extract-constant"
  | "extract-variable"
  | "extract-method"
  | "extract-parameter"
  | "extract-field"
  | "extract-interface"
  | "extract-superclass"
  | "pull-up-member"
  | "push-down-member"
  | "move-member"
  | "encapsulate-field"
  | "safe-delete"
  | "format-file"
  | "organize-imports"
  | "batch-cleanup";

/** An exact Java semantic element, saved file/project descriptor, or whole source root. */
export interface RefactoringTarget {
  /** Semantic element kind, compilation unit, or source root for a root move. */
  kind: "class" | "member" | "local-binding" | "file" | "source-root" | "package";
  /** Workspace-relative path of the containing source file. */
  path: string;
  /** Semantic element identity; file operations use the exact workspace-relative path. */
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

/**
 * Operation-specific mutation intent required by the real engine before a
 * rename/move/signature preview or apply can execute. The intent is optional on
 * the request but validated: an operation that requires intent but has none is
 * honestly refused (never fabricated). The `operation` discriminator must match
 * the request `operation`. File operations and bounded no-parameter actions such as
 * Make Static, Make Public, Inline Variable, Inline Method, Inline Constant, Safe Delete and Encapsulate Field require no intent.
 * Inline operations bind their selected identifier through the target. Field names
 * mirror the engine change descriptor (newName/fromName/newPackage/to/oldParameter/
 * newParameter/parameterName/newType).
 */
export interface JavaCleanupAction {
  operation: "format-file" | "organize-imports";
  /** Exact workspace-relative saved Java source path. */
  path: string;
}

export type RefactorKitChangeIntent =
  | { operation: "change-field-type"; newType: string }
  | { operation: "introduce-parameter-object"; typeName: string; parameters: [string, string] }
  | { operation: "extract-delegate"; typeName: string; members: string[] }
  | { operation: "batch-cleanup"; actions: JavaCleanupAction[] }
  | { operation: "create-maven-module"; moduleName: string }
  | { operation: "create-gradle-module"; buildRoot: string; projectPath: string }
  | { operation: "rename-gradle-module"; buildRoot: string; oldProjectPath: string; newProjectPath: string }
  | { operation: "rename-class"; newName: string }
  | { operation: "rename-member"; newName: string }
  | {
      operation: "rename-local-variable";
      /** Current local binding name (engine requires fromName + newName). */
      fromName: string;
      newName: string;
    }
  | {
      operation: "move-class";
      newPackage: string;
      /** Optional workspace-relative source file path for the move. */
      sourcePath?: string;
      /** Optional workspace-relative target file path for the move. */
      targetPath?: string;
      /** Destination module ID scoped to the source provider's synchronized context. */
      targetModuleId?: string;
    }
  | { operation: "move-package"; fromPackage: string; toPackage: string }
  | { operation: "move-source-root"; to: string }
  | {
      operation: "change-method-signature";
      oldParameter: string;
      newParameter: string;
    }
  | {
      operation: "change-method-parameter-type";
      parameterName: string;
      newType: string;
      includeHierarchy?: boolean;
      acceptExternalConsumerRisk?: boolean;
    }
  | {
      operation: "add-method-parameter";
      parameterType: string;
      parameterName: string;
      defaultExpression: string;
      migrateFunctionalReferences?: boolean;
      includeHierarchy?: boolean;
      acceptExternalConsumerRisk?: boolean;
    }
  | { operation: "remove-method-parameter"; parameterName: string; includeHierarchy?: boolean; acceptExternalConsumerRisk?: boolean }
  | { operation: "reorder-method-parameters"; newOrder: string; includeHierarchy?: boolean; acceptExternalConsumerRisk?: boolean }
  | { operation: "extract-constant"; name: string }
  | { operation: "extract-variable"; name: string }
  | { operation: "extract-method"; methodName: string }
  | { operation: "extract-parameter"; name: string }
  | { operation: "extract-field"; name: string }
  | { operation: "extract-interface"; interfaceName: string; methodName: string }
  | { operation: "extract-superclass"; superclassName: string; methodName: string }
  | { operation: "pull-up-member"; targetType: string }
  | { operation: "push-down-member"; targetType: string }
  | {
      operation: "move-member";
      targetType: string;
      /** Workspace-relative location of the selected destination type. */
      targetPath: string;
      /** Zero-based UTF-16 position inside the destination type, from JDT LS. */
      targetPosition: { line: number; character: number };
    }
  | { operation: "safe-delete" };

/** True when the operation requires operation-specific change intent to execute. */
export function refactorOperationRequiresIntent(operation: RefactoringOperation): boolean {
  return ![
    "safe-delete",
    "format-file",
    "organize-imports",
    "make-static",
    "make-public",
    "inline-variable",
    "inline-method",
    "inline-constant",
    "encapsulate-field",
  ].includes(operation);
}

/** True when a string is empty or whitespace-only (leading/trailing whitespace trimmed). */
function isWhitespaceOnly(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * True when a path is a safe, non-empty workspace-relative path: no traversal
 * (`.`/`..` segments), no backslash, no absolute or drive-letter prefix, and no
 * surrounding whitespace. Used to validate move-class source/target paths.
 */
function isSafeWorkspacePath(path: string): boolean {
  if (isWhitespaceOnly(path)) return false;
  if (path !== path.trim()) return false;
  if (path.includes("\\")) return false;
  if (path.startsWith("/")) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment.length === 0)) {
    return false;
  }
  return true;
}

function isSafeGradleProjectPath(path: string): boolean {
  if (
    path.length === 0 ||
    path.length > 2048 ||
    path !== path.trim() ||
    !path.startsWith(":") ||
    /[\u0000-\u001f\u007f-\u009f/\\]/u.test(path)
  )
    return false;
  const segments = path.slice(1).split(":");
  return (
    segments.length > 0 &&
    segments.length <= 32 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment.length <= 255 &&
        segment !== "." &&
        segment !== ".." &&
        /^[A-Za-z0-9_.-]+$/u.test(segment),
    )
  );
}

function isSafeGradleBuildRoot(path: string): boolean {
  return (
    path === "." ||
    (path.length <= 4096 &&
      path === path.trim() &&
      !path.includes(":") &&
      !/[\u0000-\u001f\u007f-\u009f]/u.test(path) &&
      isSafeWorkspacePath(path))
  );
}

/** Whether the requested saved-source operation includes Java formatting. */
export function javaRefactoringFormatsFiles(
  operation: RefactoringOperation,
  intent?: RefactorKitChangeIntent,
): boolean {
  return operation === "format-file" || (operation === "batch-cleanup" &&
    intent?.operation === "batch-cleanup" && intent.actions.some((action) => action.operation === "format-file"));
}

/**
 * Validates an optional change intent against the request operation. Returns a
 * refusal reason when the operation requires intent that is absent, mismatched,
 * or incomplete; returns undefined when the intent is executable. Never
 * fabricates missing intent — an operation that requires intent but has none is
 * honestly refused. Field values are trimmed so whitespace-only input is
 * rejected, and move-class source/target paths are validated when supplied.
 * `safe-delete` requires no intent and rejects any supplied intent.
 */
export function validateRefactorChangeIntent(
  operation: RefactoringOperation,
  intent: RefactorKitChangeIntent | undefined,
): string | undefined {
  if (!refactorOperationRequiresIntent(operation)) {
    // Deletion and file operations accept no additional mutation parameters.
    if (intent !== undefined) {
      return `${operation} does not accept any change intent`;
    }
    return undefined;
  }
  if (intent === undefined) {
    return `${operation} requires operation-specific change intent but none was provided`;
  }
  if (intent.operation !== operation) {
    return `change intent operation ${intent.operation} does not match request operation ${operation}`;
  }
  if (intent.operation !== "introduce-parameter-object" &&
      ("parameters" in intent || ("typeName" in intent && intent.operation !== "extract-delegate")))
    return "Unexpected parameter object fields.";
  if (intent.operation !== "extract-delegate" && "members" in intent)
    return "Only Extract Delegate accepts a group of members.";
  const migration: unknown = Reflect.get(intent, "migrateFunctionalReferences");
  if (migration !== undefined && intent.operation !== "add-method-parameter")
    return "Only Add Parameter supports static method-reference migration.";
  if (migration !== undefined && typeof migration !== "boolean")
    return "Method and constructor reference adaptation must be boolean.";
  if (migration === true && Reflect.get(intent, "includeHierarchy") === true)
    return "Method and constructor reference adaptation cannot be combined with hierarchy changes.";
  const signatureScope = ["add-method-parameter", "remove-method-parameter", "reorder-method-parameters", "change-method-parameter-type"].includes(intent.operation);
  if (!signatureScope && ("includeHierarchy" in intent || "acceptExternalConsumerRisk" in intent))
    return "Only parameter signature changes accept hierarchy and external-consumer risk options.";
  if (signatureScope) {
    const hierarchy: unknown = Reflect.get(intent, "includeHierarchy");
    const risk: unknown = Reflect.get(intent, "acceptExternalConsumerRisk");
    if ([hierarchy, risk].some(value => value !== undefined && typeof value !== "boolean"))
      return "Signature hierarchy and external-consumer risk options must be boolean.";
    if (hierarchy === true && risk !== true)
      return "Hierarchy changes require explicit acceptance of external-consumer risk.";
  }
  const validName = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= 256 &&
    !/[\s\p{Cc}]/u.test(value);
  switch (intent.operation) {
    case "extract-delegate": {
      if (
        Object.keys(intent).some((key) => !["operation", "typeName", "members"].includes(key)) ||
        !validName(intent.typeName) ||
        !Array.isArray(intent.members) ||
        intent.members.length < 2 ||
        !intent.members.every(validName) ||
        new Set(intent.members).size !== intent.members.length
      )
        return "Enter a delegate type name and at least two distinct member names.";
      return undefined;
    }
    case "introduce-parameter-object": {
      if (
        Object.keys(intent).some((key) => !["operation", "typeName", "parameters"].includes(key)) ||
        !validName(intent.typeName) ||
        !Array.isArray(intent.parameters) ||
        intent.parameters.length !== 2 ||
        !validName(intent.parameters[0]) ||
        !validName(intent.parameters[1]) ||
        intent.parameters[0] === intent.parameters[1]
      )
        return "Enter a type name and two different parameter names in declaration order.";
      return undefined;
    }
    case "batch-cleanup": {
      const actions = intent.actions;
      if (Object.keys(intent).some((key) => key !== "operation" && key !== "actions") ||
          !Array.isArray(actions) || actions.length < 2 || actions.length > 16)
        return "batch-cleanup requires 2–16 explicit actions on distinct saved Java files";
      const paths = new Set<string>();
      for (const action of actions) {
        if (!action || typeof action !== "object" ||
            Object.keys(action).some((key) => key !== "operation" && key !== "path") ||
            !["format-file", "organize-imports"].includes(action.operation) ||
            typeof action.path !== "string" || action.path.length > 4096 ||
            /[\u0000-\u001f\u007f-\u009f]/u.test(action.path) ||
            !isSafeWorkspacePath(action.path) || !action.path.endsWith(".java") ||
            paths.has(action.path))
          return "batch-cleanup requires supported actions on distinct normalized Java source paths";
        paths.add(action.path);
      }
      return undefined;
    }
    case "create-maven-module":
      return isWhitespaceOnly(intent.moduleName) ||
        intent.moduleName.length > 256 ||
        /[\u0000-\u001f\u007f-\u009f/\\]/u.test(intent.moduleName)
        ? "create-maven-module requires a bounded moduleName without path separators or control characters"
        : undefined;
    case "rename-gradle-module":
      return !isSafeGradleBuildRoot(intent.buildRoot) || !isSafeGradleProjectPath(intent.oldProjectPath) ||
        !isSafeGradleProjectPath(intent.newProjectPath) || intent.oldProjectPath === intent.newProjectPath
        ? "rename-gradle-module requires a workspace-relative buildRoot and two different canonical project paths"
        : undefined;
    case "create-gradle-module":
      return !isSafeGradleBuildRoot(intent.buildRoot) ||
        !isSafeGradleProjectPath(intent.projectPath)
        ? "create-gradle-module requires a workspace-relative buildRoot and canonical nested projectPath such as :library or :services:catalog"
        : undefined;
    case "rename-class":
    case "rename-member":
      return isWhitespaceOnly(intent.newName)
        ? `${intent.operation} requires a non-empty newName`
        : undefined;
    case "rename-local-variable":
      return isWhitespaceOnly(intent.fromName) || isWhitespaceOnly(intent.newName)
        ? "rename-local-variable requires non-empty fromName and newName"
        : undefined;
    case "move-class": {
      if (isWhitespaceOnly(intent.newPackage)) {
        return "move-class requires a non-empty newPackage";
      }
      if (intent.sourcePath !== undefined && !isSafeWorkspacePath(intent.sourcePath)) {
        return "move-class requires a safe, non-empty workspace-relative sourcePath when supplied";
      }
      if (intent.targetPath !== undefined && !isSafeWorkspacePath(intent.targetPath)) {
        return "move-class requires a safe, non-empty workspace-relative targetPath when supplied";
      }
      if (
        intent.targetModuleId !== undefined &&
        (isWhitespaceOnly(intent.targetModuleId) ||
          intent.targetModuleId.length > 1024 ||
          /[\u0000-\u001f\u007f-\u009f]/u.test(intent.targetModuleId))
      ) {
        return "move-class requires a bounded, non-empty targetModuleId without control characters when supplied";
      }
      return undefined;
    }
    case "move-package":
      return isWhitespaceOnly(intent.fromPackage) || isWhitespaceOnly(intent.toPackage)
        ? "move-package requires non-empty fromPackage and toPackage"
        : undefined;
    case "move-source-root":
      return isSafeWorkspacePath(intent.to)
        ? undefined
        : "move-source-root requires a safe, non-empty project-relative destination path";
    case "change-method-signature":
      return isWhitespaceOnly(intent.oldParameter) || isWhitespaceOnly(intent.newParameter)
        ? "change-method-signature requires non-empty oldParameter and newParameter"
        : undefined;
    case "change-field-type":
      return isWhitespaceOnly(intent.newType) || intent.newType.length > 4096 || intent.newType.includes("\0")
        ? "change-field-type requires a non-empty, bounded newType"
        : undefined;
    case "change-method-parameter-type":
      return [intent.parameterName, intent.newType].some(
        (value) => isWhitespaceOnly(value) || value.length > 4096 || value.includes("\0"),
      )
        ? "change-method-parameter-type requires non-empty, bounded parameterName and newType"
        : undefined;
    case "add-method-parameter":
      return [intent.parameterType, intent.parameterName, intent.defaultExpression].some(
        (value) => isWhitespaceOnly(value) || value.length > 4096 || value.includes("\0"),
      )
        ? "add-method-parameter requires non-empty, bounded parameterType, parameterName, and defaultExpression"
        : undefined;
    case "remove-method-parameter":
      return isWhitespaceOnly(intent.parameterName) ||
        intent.parameterName.length > 4096 ||
        intent.parameterName.includes("\0")
        ? "remove-method-parameter requires a non-empty, bounded parameterName"
        : undefined;
    case "reorder-method-parameters": {
      if (
        isWhitespaceOnly(intent.newOrder) ||
        intent.newOrder.length > 4096 ||
        intent.newOrder.includes("\0")
      )
        return "reorder-method-parameters requires a non-empty, bounded newOrder";
      const names = intent.newOrder.split(",").map((name) => name.trim());
      return names.length < 2 ||
        names.some((name) => name.length === 0) ||
        new Set(names).size !== names.length
        ? "reorder-method-parameters requires at least two distinct parameter names in newOrder"
        : undefined;
    }
    case "extract-constant":
      return isWhitespaceOnly(intent.name)
        ? "extract-constant requires a non-empty name"
        : undefined;
    case "extract-variable":
      return isWhitespaceOnly(intent.name)
        ? "extract-variable requires a non-empty name"
        : undefined;
    case "extract-method":
      return isWhitespaceOnly(intent.methodName) ||
        intent.methodName.length > 256 ||
        intent.methodName.includes("\0")
        ? "extract-method requires a non-empty, bounded methodName"
        : undefined;
    case "extract-parameter":
      return isWhitespaceOnly(intent.name)
        ? "extract-parameter requires a non-empty name"
        : undefined;
    case "extract-field":
      return isWhitespaceOnly(intent.name) ? "extract-field requires a non-empty name" : undefined;
    case "extract-interface":
      return isWhitespaceOnly(intent.interfaceName) ||
        intent.interfaceName.length > 256 ||
        intent.interfaceName.includes("\0") ||
        isWhitespaceOnly(intent.methodName) ||
        intent.methodName.length > 256 ||
        intent.methodName.includes("\0")
        ? "extract-interface requires bounded, non-empty interfaceName and methodName"
        : undefined;
    case "extract-superclass":
      return isWhitespaceOnly(intent.superclassName) ||
        intent.superclassName.length > 256 ||
        intent.superclassName.includes("\0") ||
        isWhitespaceOnly(intent.methodName) ||
        intent.methodName.length > 256 ||
        intent.methodName.includes("\0")
        ? "extract-superclass requires bounded, non-empty superclassName and methodName"
        : undefined;
    case "pull-up-member":
      return isWhitespaceOnly(intent.targetType) ||
        intent.targetType.length > 4096 ||
        intent.targetType.includes("\0")
        ? "pull-up-member requires a non-empty, bounded targetType"
        : undefined;
    case "push-down-member":
      return isWhitespaceOnly(intent.targetType) ||
        intent.targetType.length > 4096 ||
        intent.targetType.includes("\0")
        ? "push-down-member requires a non-empty, bounded targetType"
        : undefined;
    case "move-member":
      return isWhitespaceOnly(intent.targetType) ||
        intent.targetType.length > 4096 ||
        intent.targetType.includes("\0") ||
        !isSafeWorkspacePath(intent.targetPath) ||
        !Number.isSafeInteger(intent.targetPosition.line) ||
        intent.targetPosition.line < 0 ||
        !Number.isSafeInteger(intent.targetPosition.character) ||
        intent.targetPosition.character < 0
        ? "move-member requires a bounded target type and a safe destination source selection"
        : undefined;
    case "safe-delete":
      // Unreachable: safe-delete is refused before the switch, and a mismatched
      // intent was already rejected. Guard for exhaustiveness.
      return "safe-delete does not accept any change intent";
  }
}

/** Request one read-only Java refactoring preview for an exact operation + target. */
export interface RefactorPreviewRequest {
  editorMutationMode?: "durable-editor-owned";
  /** Read-only draft review; every affected existing Java source must be captured. */
  editorOverlay?: {
    documents: { path: string; text: string; version: number }[];
    position: { line: number; character: number };
  };
  /** Selected provider-owned Java context; an SDK request must never use a legacy CLI fallback. */
  projectContext?: JavaProjectOperationContext;
  /** Selected workspace Eclipse formatter profile; native code reads and validates its XML. */
  formatterProfile?: JavaFormatterProfile;
  operation: RefactoringOperation;
  target: RefactoringTarget;
  authority: RefactorWorkspaceAuthority;
  selectionGeneration: number;
  requestId: string;
  /**
   * Operation-specific mutation intent the real engine needs to execute a
   * rename/move/signature preview. Optional but validated: an operation that
   * requires intent but has none is honestly refused, never fabricated.
   */
  changeIntent?: RefactorKitChangeIntent;
}

export interface RefactorKitSafeDeleteReferenceAnalysis {
  schemaVersion: "java-safe-delete-reference-analysis-v1";
  operation: "safeDelete";
  scope: "workspace-text-v1";
  status: "complete" | "incomplete";
  inputCount: number | null;
  verifiedBytes: number | null;
  snapshotHash: string;
  managedApplyAuthority: "none";
  completeProject: false;
  referenceClosure: "incomplete";
}

export interface RefactorKitTypedReferenceLocation {
  path: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface RefactorKitTypedReference {
  languageId: string;
  kind: "symbol" | "framework.entity-property" | "configuration.value";
  targetOwner: string;
  targetMember: string;
  location: RefactorKitTypedReferenceLocation;
  resourceKind:
    | "source"
    | "java.annotation-string"
    | "xml"
    | "yaml"
    | "properties"
    | "build-descriptor"
    | "generated-source"
    | "other";
  provenance: string;
  completeness: "COMPLETE" | "INCOMPLETE" | "UNRESOLVED";
}

/** Typed references contributed to a plan; completeness is scoped, never implied project-wide. */
export interface RefactorKitTypedReferenceAnalysis {
  schemaVersion: "refactorkit-reference-analysis-v1";
  scope: string;
  completeness: "COMPLETE" | "INCOMPLETE" | "UNRESOLVED";
  completeProject: boolean;
  managedWriteAuthority: "none" | "managed-stable";
  references: RefactorKitTypedReference[];
  warnings: string[];
}

/**
 * Backend-produced immutable patch plan for a general Java refactoring preview.
 * Correlated to the operation, target, workspace authority, selection/request,
 * and provider. Review evidence reuses the shared RefactorKit types; no
 * project-content effect occurs before explicit authority, and the preview
 * grants no apply authority.
 */
export interface RefactorPreviewResult {
  /** Provider-produced reference evidence; neither variant grants Apply authority. */
  referenceAnalysis?: RefactorKitSafeDeleteReferenceAnalysis | RefactorKitTypedReferenceAnalysis;
  /** Provider attestation for the exact formatter profile used by format-file. */
  formatterProfilePath?: string;
  formatterProfileName?: string;
  formatterProfileSha256?: string;
  /** Editor plans cannot be submitted to the saved-source Apply route. */
  editorPreview?: {
    mutationMode?: "durable-editor-owned";
    symbolId?: string;
    planHash: string;
    selectionHash?: string;
    baseSnapshotHash: string;
    providerSnapshotHash: string;
    expectedProviderSnapshotHash: string;
    overlayHash: string;
    documents: { path: string; version: number; contentSha256: string }[];
  };
  /** Required for a preview produced with an explicit project SDK. */
  projectContext?: JavaProjectContextAttestation;
  /** An incomplete provider diff cannot be approved for a managed write. */
  diffTruncated?: boolean;
  diffTruncationReasons?: string[];
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
  /** The same settings and provider hashes used by the reviewed preview. */
  projectContext?: JavaProjectOperationContext;
  /** Must match the profile selected for the reviewed format-file preview. */
  formatterProfile?: JavaFormatterProfile;
  formatterProfileSha256?: string;
  /** Identity of the exact reviewed plan being applied. */
  planId: string;
  operation: RefactoringOperation;
  target: RefactoringTarget;
  authority: RefactorWorkspaceAuthority;
  selectionGeneration: number;
  requestId: string;
  approval: RefactorKitApprovalEvidence;
  /**
   * Operation-specific mutation intent the real engine needs to execute a
   * rename/move/signature apply. Optional but validated: an operation that
   * requires intent but has none is honestly refused, never fabricated.
   */
  changeIntent?: RefactorKitChangeIntent;
}

/** Honest outcome reported after an Apply attempt. */
export type RefactorApplyOutcome = "applied" | "refused" | "stale" | "failed" | "indeterminate";

export interface RefactorApplyResult {
  /** Provider confirmation of the context used by a successful SDK-bound write. */
  appliedContextHash?: string;
  /** Saved-source snapshot reported after the confirmed write; binds a later rollback. */
  appliedSnapshotHash?: string;
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
  /** Original SDK context and the post-apply snapshot bind a protected rollback. */
  projectContext?: JavaProjectOperationContext;
  expectedSnapshotHash?: string;
  transactionId: string;
  operation: RefactoringOperation;
  authority: RefactorWorkspaceAuthority;
  requestId: string;
}

export interface RefactorRollbackResult {
  rolledBackContextHash?: string;
  restoredSnapshotHash?: string;
  transactionId: string;
  rolledBack: boolean;
  changedFiles: RefactorKitAffectedFile[];
  conflicts: RefactorKitPlanConflict[];
  diagnostics: RefactorKitPlanDiagnostic[];
}
