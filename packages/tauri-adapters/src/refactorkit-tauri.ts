import { JavaProjectContextRetiredError, RefactorRollbackNotStartedError } from "@ide/web-core";
import { invoke } from "@tauri-apps/api/core";
import { invokeJavaEditorTransaction } from "./java-editor-transaction-tauri";
import {
  javaEditorPreviewWire,
  normalizeJavaEditorPreviewAuthority,
  verifyJavaEditorPreview,
} from "./java-editor-refactoring-tauri";
import {
  normalizeRefactorKitMethodCapabilities,
  mavenModuleRenameApplyOffered,
  mavenModuleRenamePreviewOffered,
  normalizeSavedSnapshotDefinitionResult,
  normalizeSavedSnapshotSemanticSessionStartResult,
  normalizeSavedSnapshotSemanticSessionStopResult,
  normalizeSavedSnapshotSymbolSearchResult,
  normalizeTypeScriptDiagnosticsResponse,
  validateRefactorChangeIntent,
  javaRefactoringFormatsFiles,
  isJavaProjectOperationContext,
  javaContextRefactoringOffered,
  javaRefactoringMutationAuthorized,
  javaEditorRefactoringPreviewOffered,
  javaEditorMutationOffered,
  javaProjectContextAttestationMatches,
} from "@ide/contracts";
import type {
  JavaEditorTransactionRequest,
  JavaEditorTransactionResult,
  ApplyRefactorKitPlanRequest,
  ApplyRefactorKitPlanResult,
  DiscardRefactorKitPlanRequest,
  DiscardRefactorKitPlanResult,
  PreviewExternalJavaImportRequest,
  MavenModuleRenameApplyRequest,
  MavenModuleRenameApplyResult,
  MavenModuleRenameDiscardRequest,
  MavenModuleRenamePreview,
  MavenModuleRenamePreviewRequest,
  MavenModuleRenameRollbackRequest,
  MavenModuleRenameRollbackResult,
  RefactorApplyRequest,
  RefactorApplyResult,
  RefactorPreviewRequest,
  RefactorPreviewResult,
  RefactorRollbackRequest,
  RefactorRollbackResult,
  RefactoringTarget,
  RefactorWorkspaceAuthority,
  RefactorKitAffectedFile,
  RefactorKitCapabilities,
  RefactorKitCommandResult,
  RefactorKitEvidence,
  RefactorKitGeneralRefactoringCapability,
  RefactorKitLanguageAdapter,
  RefactorKitLanguageAdapterResourceLimits,
  RefactorKitLanguageAdapterRuntime,
  RefactorKitLanguageCapability,
  RefactorKitLanguageKernel,
  RefactorKitMethodCapability,
  RefactorKitPatchPlan,
  RefactorKitSafetyCapabilities,
  RefactorKitPlanDiagnostic,
  RefactorKitPlanConflict,
  RefactorKitSafeDeleteReferenceAnalysis,
  RefactorKitTypedReference,
  RefactorKitTypedReferenceAnalysis,
  RefactorKitStatus,
  RefactoringOperation,
  JavaFormatterProfile,
  RollbackRefactorKitTransactionRequest,
  RollbackRefactorKitTransactionResult,
  SavedSnapshotDefinitionRequest,
  SavedSnapshotDefinitionResult,
  SavedSnapshotDefinitionResultCandidate,
  SavedSnapshotSemanticSessionStartRequest,
  SavedSnapshotSemanticSessionStartResult,
  SavedSnapshotSemanticSessionStartResultCandidate,
  SavedSnapshotSemanticSessionStopRequest,
  SavedSnapshotSemanticSessionStopResult,
  SavedSnapshotSemanticSessionStopResultCandidate,
  SavedSnapshotSymbolSearchRequest,
  SavedSnapshotSymbolSearchResult,
  SavedSnapshotSymbolSearchResultCandidate,
  SavedSnapshotWorkspaceSymbol,
  TypeScriptDiagnosticsCompilerAttestation,
  TypeScriptDiagnosticsRequest,
  TypeScriptDiagnosticsResponse,
  TypeScriptDiagnosticsResponseNormalizationInput,
  TypeScriptDiagnosticsResponseRejectionReason,
  TypeScriptDiagnosticsResponseRuntime,
  TypeScriptJavaScriptLanguageId,
} from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core/ports";
import { TauriAdapterError, invokeTauri } from "./errors";

const MAX_TEXT = 65_536;
const MAX_DIFF = 2 * 1024 * 1024;
const MAX_ARRAY = 10_000;
const MAX_PATH = 4_096;
const MAX_ID = 256;
const MAX_SOURCE = 2 * 1024 * 1024;
const MAX_LANGUAGE_ADAPTERS = 64;
const MAX_LANGUAGE_EXTENSIONS = 64;
const MAX_LANGUAGE_CAPABILITIES = 512;
const MAX_LANGUAGE_STRING_BYTES = 256;
const MAX_RUNTIME_TIMEOUT_MILLIS = 300_000;
const MAX_RUNTIME_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_RUNTIME_PROCESSES = 64;
const MAX_SAVED_SNAPSHOT_SYMBOLS = 200;
const MAX_SAVED_SNAPSHOT_QUERY = 1_024;
const MAX_SAVED_SNAPSHOT_IDENTITY = 512;
const MAX_SAVED_SNAPSHOT_METADATA = 256;
const OPAQUE_SAVED_SNAPSHOT_SYMBOL_ID = /^lsp-symbol-v1:[a-f0-9]{64}$/u;
const OPAQUE_SEMANTIC_SESSION_ID = /^refactorkit-semantic-session-v1:[a-f0-9]{64}$/u;
const OPAQUE_SEMANTIC_LEASE = /^semantic-[a-f0-9-]{36}$/u;
const SHA256_IDENTITY = /^sha256:[a-f0-9]{64}$/u;
const SHA256_DIGEST = /^[a-f0-9]{64}$/u;
const SOURCE_EXTENSION = /^[a-z0-9]+$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const LANGUAGE_STABILITY = [
  "stable",
  "experimental",
  "structural",
  "refused",
  "not-applicable",
] as const;
const LANGUAGE_EVIDENCE = [
  "compiler",
  "language-server",
  "native-ast",
  "structural-parse",
  "lexical",
  "none",
] as const;
const LANGUAGE_MUTATION_AUTHORITY = ["managed-stable", "proposal-only", "none"] as const;
const LANGUAGE_EXECUTION_MODE = ["in-process", "external-process"] as const;
const DIAGNOSTIC_SNAPSHOT_MODE_VOCABULARY = ["saved-disk", "immutable-editor-overlay"] as const;
const DIAGNOSTIC_OPERATION_SNAPSHOT_MODES = ["immutable-editor-overlay", "saved-disk"] as const;
const DIAGNOSTIC_RANGE_CAPABILITY = "exact-utf16-or-explicit-partial" as const;
const DIAGNOSTIC_RANGE_CAPABILITY_VOCABULARY = [DIAGNOSTIC_RANGE_CAPABILITY] as const;
const DIAGNOSTICS_V2_METHOD = "diagnostics.v2" as const;
const DIAGNOSTICS_OPERATION = "diagnostics" as const;
const DIAGNOSTICS_V2_BACKEND = "typescript-compiler-exact-v1" as const;
const REFACTORING_OPERATIONS = [
  "rename-class",
  "rename-member",
  "rename-local-variable",
  "move-class",
  "move-member",
  "move-package",
  "move-source-root",
  "change-method-signature",
  "reorder-method-parameters",
  "make-static",
  "inline-variable",
  "inline-constant",
  "extract-constant",
  "extract-variable",
  "extract-parameter",
  "extract-field",
  "pull-up-member",
  "push-down-member",
  "encapsulate-field",
  "safe-delete",
  "format-file",
  "organize-imports",
] as const;
// Add Parameter is available only through the saved Java project-context route.
// Keep it out of the older general CLI capability surface.
const PROJECT_CONTEXT_REFACTORING_OPERATIONS = [
  "batch-cleanup",
  ...REFACTORING_OPERATIONS,
  "create-maven-module",
  "create-gradle-module",
  "rename-gradle-module",
  "add-method-parameter",
  "remove-method-parameter",
  "make-public",
  "change-field-type",
  "change-method-parameter-type",
  "extract-method",
  "inline-method",
  "introduce-parameter-object",
  "extract-delegate",
  "extract-interface",
  "extract-superclass",
  "push-down-member",
] as const;
const JAVA_NAVIGATION_OPERATIONS = ["definition", "references"] as const;
const REFACTOR_TARGET_KINDS = [
  "class",
  "member",
  "local-binding",
  "file",
  "source-root",
  "package",
] as const;
const REFACTOR_APPLY_OUTCOMES = ["applied", "refused", "stale", "failed", "indeterminate"] as const;
const UTF8_ENCODER = new TextEncoder();
const UPDATE_REQUIRED =
  "This RefactorKit operation requires an updated managed backend with targetDirectory preview, apply, discard, and rollback support.";

export type TauriRefactorKitManagedErrorCode =
  | "REFACTORKIT_UPDATE_REQUIRED"
  | "REFACTORKIT_PREVIEW_REFUSED"
  | "REFACTORKIT_PREVIEW_FAILED"
  | "REFACTORKIT_PREVIEW_SESSION_FAILED"
  | "REFACTORKIT_PREVIEW_PROTOCOL_FAILED"
  | "REFACTORKIT_PREVIEW_REQUEST_TOO_LARGE"
  | "REFACTORKIT_PREVIEW_CONTEXT_UNATTESTED"
  | "REFACTORKIT_PREVIEW_STALE_CONTEXT"
  | "REFACTORKIT_APPLY_STALE"
  | "REFACTORKIT_APPLY_REFUSED"
  | "REFACTORKIT_APPLY_FAILED"
  | "REFACTORKIT_DISCARD_FAILED"
  | "REFACTORKIT_ROLLBACK_CONFLICT"
  | "REFACTORKIT_ROLLBACK_FAILED"
  | "REFACTORKIT_ROLLBACK_INPUTS_CHANGED"
  | "REFACTORKIT_ROLLBACK_OUTCOME_UNKNOWN";

type RecordValue = Record<string, unknown>;
type DiagnosticSnapshotMode = (typeof DIAGNOSTIC_SNAPSHOT_MODE_VOCABULARY)[number];
type DiagnosticRangeCapability = typeof DIAGNOSTIC_RANGE_CAPABILITY;

interface NormalizedLanguageCapability extends RefactorKitLanguageCapability {
  diagnosticSnapshotModes?: DiagnosticSnapshotMode[];
  diagnosticRangeCapability?: DiagnosticRangeCapability;
}

interface NormalizedLanguageAdapter extends RefactorKitLanguageAdapter {
  capabilities: NormalizedLanguageCapability[];
}

interface NormalizedLanguageKernel extends RefactorKitLanguageKernel {
  adapters: NormalizedLanguageAdapter[];
  vocabulary: RefactorKitLanguageKernel["vocabulary"] & {
    diagnosticSnapshotMode?: DiagnosticSnapshotMode[];
    diagnosticRangeCapability?: DiagnosticRangeCapability[];
  };
}

type NormalizedLanguageKernelStatus =
  | { available: true; schema: NormalizedLanguageKernel }
  | { available: false; schema: null; reason: string };

export class TauriRefactorKitManagedCommandError extends TauriAdapterError {
  constructor(
    command: string,
    public readonly code: TauriRefactorKitManagedErrorCode,
    message: string,
  ) {
    super(command, message);
    // Keep command identity on the error for diagnostics, not in user guidance.
    this.message = message;
    this.name = "TauriRefactorKitManagedCommandError";
  }
}

export class TauriRefactorKitUpdateRequiredError extends TauriRefactorKitManagedCommandError {
  constructor(command: string) {
    super(command, "REFACTORKIT_UPDATE_REQUIRED", UPDATE_REQUIRED);
    this.name = "TauriRefactorKitUpdateRequiredError";
  }
}

export type TauriRefactorKitSymbolNavigationErrorCode =
  | "REFACTORKIT_SYMBOL_SEARCH_FAILED"
  | "REFACTORKIT_DEFINITION_FAILED"
  | "REFACTORKIT_SYMBOL_SEARCH_RESPONSE_REJECTED"
  | "REFACTORKIT_DEFINITION_RESPONSE_REJECTED";

/** Source-safe failure for the experimental saved-snapshot native protocol. */
export class TauriRefactorKitSymbolNavigationError extends TauriAdapterError {
  constructor(
    command: string,
    public readonly code: TauriRefactorKitSymbolNavigationErrorCode,
    message: string,
  ) {
    super(command, message);
    this.name = "TauriRefactorKitSymbolNavigationError";
  }
}

export type TauriRefactorKitSemanticSessionErrorCode =
  | "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED"
  | "REFACTORKIT_SEMANTIC_SESSION_START_FAILED"
  | "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED"
  | "REFACTORKIT_SEMANTIC_SESSION_STOP_REQUEST_REJECTED"
  | "REFACTORKIT_SEMANTIC_SESSION_STOP_FAILED"
  | "REFACTORKIT_SEMANTIC_SESSION_STOP_RESPONSE_REJECTED";

/** Sanitized failure for the native semantic-session lifecycle boundary. */
export class TauriRefactorKitSemanticSessionError extends TauriAdapterError {
  constructor(
    command: string,
    public readonly code: TauriRefactorKitSemanticSessionErrorCode,
    message: string,
  ) {
    super(command, message);
    this.name = "TauriRefactorKitSemanticSessionError";
  }
}

export class TauriRefactorKitDiagnosticsResponseError extends TauriAdapterError {
  readonly code = "REFACTORKIT_TYPESCRIPT_DIAGNOSTICS_RESPONSE_REJECTED" as const;

  constructor(
    command: string,
    public readonly reason: TypeScriptDiagnosticsResponseRejectionReason,
  ) {
    super(command, "The RefactorKit TypeScript diagnostics response was rejected.");
    this.name = "TauriRefactorKitDiagnosticsResponseError";
  }
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTypeScriptDiagnosticsResponseRuntime(
  value: unknown,
): value is TypeScriptDiagnosticsResponseRuntime {
  if (!isRecord(value) || !isRecord(value.limits)) return false;
  const limits = value.limits;
  return (
    (value.executionMode === "in-process" || value.executionMode === "external-process") &&
    typeof value.supportsTimeout === "boolean" &&
    typeof value.supportsCancellation === "boolean" &&
    typeof value.usesWorkspaceOverlay === "boolean" &&
    typeof value.recordsProcessProvenance === "boolean" &&
    typeof limits.requestTimeoutMillis === "number" &&
    typeof limits.maxInputBytes === "number" &&
    typeof limits.maxOutputBytes === "number" &&
    typeof limits.maxProcesses === "number" &&
    typeof limits.maxStderrBytes === "number" &&
    typeof limits.compilerHeapMiB === "number" &&
    typeof limits.maxDiagnostics === "number" &&
    typeof limits.maxDiagnosticMessageChars === "number" &&
    typeof limits.maxResponseBytes === "number"
  );
}

function isTypeScriptDiagnosticsCompilerAttestation(
  value: unknown,
): value is TypeScriptDiagnosticsCompilerAttestation {
  if (!isRecord(value) || !isRecord(value.process)) return false;
  return (
    typeof value.toolchainProvider === "string" &&
    typeof value.nodeVersion === "string" &&
    typeof value.typeScriptVersion === "string" &&
    typeof value.compilerSha256 === "string" &&
    typeof value.toolchainEvidenceSha256 === "string" &&
    typeof value.process.executableSha256 === "string" &&
    typeof value.process.argumentsSha256 === "string" &&
    typeof value.process.processId === "number"
  );
}

function diagnosticsResponseError(
  command: string,
  reason: TypeScriptDiagnosticsResponseRejectionReason,
): TauriRefactorKitDiagnosticsResponseError {
  return new TauriRefactorKitDiagnosticsResponseError(command, reason);
}

function diagnosticsNormalizationInput(
  command: string,
  request: Readonly<TypeScriptDiagnosticsRequest>,
  candidate: unknown,
): TypeScriptDiagnosticsResponseNormalizationInput {
  return {
    request,
    candidate,
    get advertisedRuntime(): Readonly<TypeScriptDiagnosticsResponseRuntime> {
      const runtime = isRecord(candidate) ? candidate.runtime : undefined;
      if (!isTypeScriptDiagnosticsResponseRuntime(runtime)) {
        throw diagnosticsResponseError(command, "response-schema-invalid");
      }
      return runtime;
    },
    get acceptedCompilerAttestation(): Readonly<TypeScriptDiagnosticsCompilerAttestation> {
      const attestation = isRecord(candidate) ? candidate.compilerAttestation : undefined;
      if (!isTypeScriptDiagnosticsCompilerAttestation(attestation)) {
        throw diagnosticsResponseError(command, "response-attestation-mismatch");
      }
      return attestation;
    },
  };
}

// Legacy command responses cannot contain preview source, so retain their cause for compatibility.
function invalidShape(command: string, message: string, response: unknown): TauriAdapterError {
  return new TauriAdapterError(command, `Invalid ${command} response: ${message}`, response);
}

// Managed-protocol payloads may contain source/diffs. Never attach or stringify the payload.
function invalidProtocolShape(command: string, message: string): TauriAdapterError {
  return new TauriAdapterError(command, `Invalid ${command} response: ${message}`);
}

function protocolRecord(command: string, value: unknown, field = "response"): RecordValue {
  if (!isRecord(value)) throw invalidProtocolShape(command, `expected object ${field}`);
  return value;
}

function protocolString(
  command: string,
  record: RecordValue,
  field: string,
  max = MAX_TEXT,
  allowEmpty = true,
): string {
  const value = record[field];
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowEmpty && value.length === 0) ||
    (field !== "renderedDiff" && value.includes("\0"))
  ) {
    throw invalidProtocolShape(command, `invalid string ${field}`);
  }
  return value;
}

function nullableString(command: string, record: RecordValue, field: string): string | null {
  if (record[field] === null) return null;
  return protocolString(command, record, field, MAX_TEXT, false);
}

function protocolBoolean(command: string, record: RecordValue, field: string): boolean {
  if (typeof record[field] !== "boolean")
    throw invalidProtocolShape(command, `invalid boolean ${field}`);
  return record[field];
}

function integer(command: string, record: RecordValue, field: string, minimum = 0): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw invalidProtocolShape(command, `invalid integer ${field}`);
  }
  return value;
}

function enumValue<T extends string>(
  command: string,
  record: RecordValue,
  field: string,
  values: readonly T[],
): T {
  const value = record[field];
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw invalidProtocolShape(command, `invalid ${field}`);
  }
  return value as T;
}

function array<T>(
  command: string,
  value: unknown,
  field: string,
  normalize: (record: RecordValue, index: number) => T,
): T[] {
  if (!Array.isArray(value) || value.length > MAX_ARRAY) {
    throw invalidProtocolShape(command, `invalid array ${field}`);
  }
  return value.map((item, index) =>
    normalize(protocolRecord(command, item, `${field}[${index}]`), index),
  );
}

function strings(command: string, value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_ARRAY) {
    throw invalidProtocolShape(command, `invalid string array ${field}`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.length > MAX_TEXT || item.includes("\0")) {
      throw invalidProtocolShape(command, `invalid string ${field}[${index}]`);
    }
    return item;
  });
}

function optionalProtocolString(
  command: string,
  record: RecordValue,
  field: string,
  path = false,
): string | undefined {
  if (record[field] === undefined || record[field] === null) return undefined;
  const value = protocolString(command, record, field, path ? MAX_PATH : MAX_TEXT, false);
  if (path) validatePath(command, value, field);
  return value;
}

function validatePath(command: string, path: string, field: string): string {
  const segments = path.split("/");
  if (
    path.length === 0 ||
    path.length > MAX_PATH ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("\\") ||
    /^[A-Za-z]:/.test(path) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) ||
    segments.some(
      (part) =>
        part.length === 0 || part === "." || part === ".." || /[\u0000-\u001f\u007f]/.test(part),
    )
  ) {
    throw invalidProtocolShape(command, `invalid workspace-relative path ${field}`);
  }
  return path;
}

function validateFormatterProfileSelection(
  value: JavaFormatterProfile,
  command: string,
): JavaFormatterProfile {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TauriAdapterError(command, "Invalid Eclipse formatter profile selection.");
  const record = value as unknown as RecordValue;
  if (Object.keys(record).some((key) => !["path", "profileName"].includes(key)))
    throw new TauriAdapterError(command, "Invalid Eclipse formatter profile selection.");
  const path = validatePath(
    command,
    protocolString(command, record, "path", MAX_PATH, false),
    "formatterProfile.path",
  );
  const profileName = protocolString(command, record, "profileName", 256, false);
  if (
    !path.toLowerCase().endsWith(".xml") ||
    !profileName.trim() ||
    profileName.trim() !== profileName ||
    /[\u0000-\u001f\u007f]/.test(profileName)
  )
    throw new TauriAdapterError(command, "Invalid Eclipse formatter profile selection.");
  return { path, profileName };
}

function verifyFormatterProfileAttestation(
  command: string,
  selected: JavaFormatterProfile | undefined,
  result: RefactorPreviewResult,
): void {
  const hasAttestation =
    result.formatterProfilePath !== undefined ||
    result.formatterProfileName !== undefined ||
    result.formatterProfileSha256 !== undefined;
  if (!selected) {
    if (hasAttestation)
      throw invalidProtocolShape(command, "unexpected Eclipse formatter profile attestation");
    return;
  }
  if (
    result.formatterProfilePath !== selected.path ||
    result.formatterProfileName !== selected.profileName ||
    !result.formatterProfileSha256
  )
    throw invalidProtocolShape(command, "the selected Eclipse formatter profile was not attested");
}

function protocolId(command: string, record: RecordValue, field: string): string {
  const value = protocolString(command, record, field, MAX_ID, false);
  if (!/^[A-Za-z0-9_.:-]+$/.test(value))
    throw invalidProtocolShape(command, `invalid identifier ${field}`);
  return value;
}

function requestId(value: string, command: string, field: string): void {
  if (value.length === 0 || value.length > MAX_ID || !/^[A-Za-z0-9_.:-]+$/.test(value)) {
    throw new TauriAdapterError(command, `Invalid RefactorKit ${field}`);
  }
}

function requestGeneration(value: number, command: string, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TauriAdapterError(command, `Invalid RefactorKit ${field}`);
}

function validatePreviewRequest(request: PreviewExternalJavaImportRequest, command: string): void {
  if (request.code.length === 0 || request.code.length > MAX_SOURCE) {
    throw new TauriAdapterError(command, "Invalid external Java source");
  }
  // Use the same strict canonical form expected from every response path.
  validatePath(command, request.targetDirectory, "targetDirectory");
  requestId(request.workspaceId, command, "workspaceId");
  requestId(request.requestId, command, "requestId");
  requestGeneration(request.workspaceGeneration, command, "workspaceGeneration");
  requestGeneration(request.selectionGeneration, command, "selectionGeneration");
  if (
    request.sourceKind !== "clipboard" ||
    request.sourceUrl !== null ||
    request.licensePolicy !== "warn"
  ) {
    throw new TauriAdapterError(command, "Invalid external Java provenance");
  }
}

function validateMavenModuleRenamePreviewRequest(
  request: MavenModuleRenamePreviewRequest,
  command: string,
): MavenModuleRenamePreviewRequest {
  validatePath(command, request.oldModuleDir, "oldModuleDir");
  validatePath(command, request.newModuleDir, "newModuleDir");
  requestId(request.workspaceId, command, "workspaceId");
  requestId(request.requestId, command, "requestId");
  requestGeneration(request.workspaceGeneration, command, "workspaceGeneration");
  requestGeneration(request.selectionGeneration, command, "selectionGeneration");
  if (
    !/^[a-f0-9]{64}$/u.test(request.expectedSnapshotHash) ||
    !/^[a-f0-9]{64}$/u.test(request.expectedContextHash)
  )
    throw new TauriAdapterError(command, "Missing synchronized Java project hashes");
  if (
    request.newArtifactId !== undefined &&
    (request.newArtifactId.trim() !== request.newArtifactId ||
      request.newArtifactId.length === 0 ||
      request.newArtifactId.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(request.newArtifactId))
  )
    throw new TauriAdapterError(command, "Invalid Maven module artifact ID");
  return {
    oldModuleDir: request.oldModuleDir,
    newModuleDir: request.newModuleDir,
    ...(request.newArtifactId === undefined ? {} : { newArtifactId: request.newArtifactId }),
    expectedSnapshotHash: request.expectedSnapshotHash,
    expectedContextHash: request.expectedContextHash,
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    selectionGeneration: request.selectionGeneration,
    requestId: request.requestId,
  };
}

function normalizeMavenModuleRenamePreview(
  command: string,
  response: unknown,
): MavenModuleRenamePreview {
  const record = protocolRecord(command, response);
  if (record.operation !== "java.renameMavenModule" || record.status !== "preview")
    throw invalidProtocolShape(command, "invalid Maven module rename operation or status");
  const snapshotHash = protocolString(command, record, "snapshotHash", 64, false);
  if (!/^[a-f0-9]{64}$/u.test(snapshotHash))
    throw invalidProtocolShape(command, "invalid snapshotHash");
  return {
    planId: protocolId(command, record, "planId"),
    operation: "java.renameMavenModule",
    status: "preview",
    summary: protocolString(command, record, "summary", MAX_TEXT, false),
    snapshotHash,
    affectedFiles: strings(command, record.affectedFiles, "affectedFiles").map((path, index) =>
      validatePath(command, path, `affectedFiles[${index}]`),
    ),
    renderedDiff: protocolString(command, record, "renderedDiff", MAX_DIFF),
    diffTruncated: protocolBoolean(command, record, "diffTruncated"),
    diffTruncationReasons: strings(command, record.diffTruncationReasons, "diffTruncationReasons"),
    provider: protocolString(command, record, "provider", 256, false),
    providerVersion: protocolString(command, record, "providerVersion", 256, false),
    workspaceId: protocolId(command, record, "workspaceId"),
    workspaceGeneration: integer(command, record, "workspaceGeneration", 1),
    selectionGeneration: integer(command, record, "selectionGeneration", 1),
    requestId: protocolId(command, record, "requestId"),
  };
}

function normalizeMavenModuleRenameApply(
  command: string,
  response: unknown,
): MavenModuleRenameApplyResult {
  const record = protocolRecord(command, response);
  if (record.status !== "applied")
    throw invalidProtocolShape(command, "invalid Maven module rename Apply status");
  const snapshotHash = protocolString(command, record, "snapshotHash", 64, false);
  if (!/^[a-f0-9]{64}$/u.test(snapshotHash))
    throw invalidProtocolShape(command, "invalid post-Apply snapshot hash");
  return {
    planId: protocolId(command, record, "planId"),
    transactionId: protocolId(command, record, "transactionId"),
    snapshotHash,
    changedFiles: affectedFiles(command, record.changedFiles, "changedFiles"),
    provider: protocolString(command, record, "provider", 256, false),
    providerVersion: protocolString(command, record, "providerVersion", 256, false),
  };
}

function normalizeMavenModuleRenameRollback(
  command: string,
  response: unknown,
): MavenModuleRenameRollbackResult {
  const record = protocolRecord(command, response);
  if (record.rolledBack !== true)
    throw invalidProtocolShape(command, "Maven module rename was not rolled back");
  return {
    transactionId: protocolId(command, record, "transactionId"),
    rolledBack: true,
    changedFiles: affectedFiles(command, record.changedFiles, "changedFiles"),
  };
}

function validateApplyRequest(request: ApplyRefactorKitPlanRequest, command: string): void {
  requestId(request.planId, command, "planId");
  requestId(request.workspaceId, command, "workspaceId");
  requestId(request.requestId, command, "requestId");
  requestId(request.approval.approvalId, command, "approvalId");
  requestId(request.approval.approvedPlanId, command, "approvedPlanId");
  requestGeneration(request.workspaceGeneration, command, "workspaceGeneration");
  requestGeneration(request.selectionGeneration, command, "selectionGeneration");
  if (request.approval.approvedPlanId !== request.planId) {
    throw new TauriAdapterError(command, "Approval does not bind the requested RefactorKit plan");
  }
  const timestamp = request.approval.approvedAt;
  if (
    timestamp.length > MAX_ID ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw new TauriAdapterError(command, "Invalid RefactorKit approvedAt timestamp");
  }
}

function validateDiscardRequest(request: DiscardRefactorKitPlanRequest, command: string): void {
  requestId(request.planId, command, "planId");
  requestId(request.workspaceId, command, "workspaceId");
  requestId(request.requestId, command, "requestId");
  requestGeneration(request.workspaceGeneration, command, "workspaceGeneration");
  requestGeneration(request.selectionGeneration, command, "selectionGeneration");
}

function validateRollbackRequest(
  request: RollbackRefactorKitTransactionRequest,
  command: string,
): void {
  requestId(request.transactionId, command, "transactionId");
  requestId(request.workspaceId, command, "workspaceId");
  requestId(request.requestId, command, "requestId");
  requestGeneration(request.workspaceGeneration, command, "workspaceGeneration");
}

function invalidSymbolNavigationRequest(command: string): TauriAdapterError {
  return new TauriAdapterError(command, "Invalid saved-snapshot symbol navigation request");
}

function symbolNavigationError(
  command: string,
  code: TauriRefactorKitSymbolNavigationErrorCode,
): TauriRefactorKitSymbolNavigationError {
  const messages: Record<TauriRefactorKitSymbolNavigationErrorCode, string> = {
    REFACTORKIT_SYMBOL_SEARCH_FAILED: "RefactorKit could not search the authorized saved snapshot.",
    REFACTORKIT_DEFINITION_FAILED:
      "RefactorKit could not resolve the selected saved-snapshot definition.",
    REFACTORKIT_SYMBOL_SEARCH_RESPONSE_REJECTED:
      "The RefactorKit saved-snapshot symbol search response was rejected.",
    REFACTORKIT_DEFINITION_RESPONSE_REJECTED:
      "The RefactorKit saved-snapshot definition response was rejected.",
  };
  return new TauriRefactorKitSymbolNavigationError(command, code, messages[code]);
}

function symbolNavigationRequestRecord(command: string, value: unknown): RecordValue {
  if (!isRecord(value) || !plainRecord(value)) throw invalidSymbolNavigationRequest(command);
  return value;
}

function plainRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactNavigationFields(
  command: string,
  record: RecordValue,
  expected: readonly string[],
  responseCode?: TauriRefactorKitSymbolNavigationErrorCode,
): void {
  const actual = Reflect.ownKeys(record);
  if (
    actual.length !== expected.length ||
    actual.some((key) => typeof key !== "string") ||
    expected.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
  ) {
    if (responseCode) throw symbolNavigationError(command, responseCode);
    throw invalidSymbolNavigationRequest(command);
  }
}

function validNavigationString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    !CONTROL_CHARACTERS.test(value)
  );
}

function validSavedSnapshotQuery(value: unknown): value is string {
  return validNavigationString(value, MAX_SAVED_SNAPSHOT_QUERY);
}

function validSavedSnapshotIdentity(value: unknown): value is string {
  return validNavigationString(value, MAX_SAVED_SNAPSHOT_IDENTITY);
}

function validSavedSnapshotMetadata(value: unknown): value is string {
  return validNavigationString(value, MAX_SAVED_SNAPSHOT_METADATA);
}

function validExternalToolchainPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH ||
    value.trim() !== value ||
    CONTROL_CHARACTERS.test(value)
  ) {
    return false;
  }
  const normalized = value.replaceAll("\\", "/");
  if (
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:\//u.test(normalized) &&
    !/^\/\/[^/]+\/[^/]+/u.test(normalized)
  ) {
    return false;
  }
  const pathWithoutRoot = normalized.replace(/^(?:[A-Za-z]:)?\/+/, "");
  return pathWithoutRoot
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function validOpaqueSymbolId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_SAVED_SNAPSHOT_SYMBOL_ID.test(value);
}

function validOpaqueSemanticSessionId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_SEMANTIC_SESSION_ID.test(value);
}

function validOpaqueSemanticLease(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_SEMANTIC_LEASE.test(value);
}

function validSha256Identity(value: unknown): value is string {
  return typeof value === "string" && SHA256_IDENTITY.test(value);
}

function semanticSessionError(
  command: string,
  code: TauriRefactorKitSemanticSessionErrorCode,
): TauriRefactorKitSemanticSessionError {
  const messages: Record<TauriRefactorKitSemanticSessionErrorCode, string> = {
    REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED:
      "The RefactorKit semantic-session start request was rejected.",
    REFACTORKIT_SEMANTIC_SESSION_START_FAILED:
      "RefactorKit could not start the saved-snapshot semantic session.",
    REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED:
      "The RefactorKit semantic-session start response was rejected.",
    REFACTORKIT_SEMANTIC_SESSION_STOP_REQUEST_REJECTED:
      "The RefactorKit semantic-session stop request was rejected.",
    REFACTORKIT_SEMANTIC_SESSION_STOP_FAILED:
      "RefactorKit could not stop the saved-snapshot semantic session.",
    REFACTORKIT_SEMANTIC_SESSION_STOP_RESPONSE_REJECTED:
      "The RefactorKit semantic-session stop response was rejected.",
  };
  return new TauriRefactorKitSemanticSessionError(command, code, messages[code]);
}

function semanticSessionRecord(
  command: string,
  value: unknown,
  code: TauriRefactorKitSemanticSessionErrorCode,
): RecordValue {
  if (!isRecord(value) || !plainRecord(value)) throw semanticSessionError(command, code);
  return value;
}

function exactSemanticSessionFields(
  command: string,
  record: RecordValue,
  expected: readonly string[],
  code: TauriRefactorKitSemanticSessionErrorCode,
): void {
  const actual = Reflect.ownKeys(record);
  if (
    actual.length !== expected.length ||
    actual.some((key) => typeof key !== "string") ||
    expected.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
  ) {
    throw semanticSessionError(command, code);
  }
}

function positiveBoundedInteger(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function parseSemanticSessionRuntime(
  command: string,
  value: unknown,
  code: TauriRefactorKitSemanticSessionErrorCode,
): RefactorKitLanguageAdapterRuntime {
  const runtime = semanticSessionRecord(command, value, code);
  exactSemanticSessionFields(
    command,
    runtime,
    [
      "executionMode",
      "supportsTimeout",
      "supportsCancellation",
      "usesWorkspaceOverlay",
      "recordsProcessProvenance",
      "limits",
    ],
    code,
  );
  const limits = semanticSessionRecord(command, runtime.limits, code);
  exactSemanticSessionFields(
    command,
    limits,
    ["requestTimeoutMillis", "maxInputBytes", "maxOutputBytes", "maxProcesses"],
    code,
  );
  if (
    runtime.executionMode !== "external-process" ||
    runtime.supportsTimeout !== true ||
    runtime.supportsCancellation !== true ||
    runtime.usesWorkspaceOverlay !== true ||
    runtime.recordsProcessProvenance !== true ||
    !positiveBoundedInteger(limits.requestTimeoutMillis, MAX_RUNTIME_TIMEOUT_MILLIS) ||
    !positiveBoundedInteger(limits.maxInputBytes, MAX_RUNTIME_BYTES) ||
    !positiveBoundedInteger(limits.maxOutputBytes, MAX_RUNTIME_BYTES) ||
    !positiveBoundedInteger(limits.maxProcesses, MAX_RUNTIME_PROCESSES)
  ) {
    throw semanticSessionError(command, code);
  }
  return Object.freeze({
    executionMode: "external-process",
    supportsTimeout: true,
    supportsCancellation: true,
    usesWorkspaceOverlay: true,
    recordsProcessProvenance: true,
    limits: Object.freeze({
      requestTimeoutMillis: limits.requestTimeoutMillis,
      maxInputBytes: limits.maxInputBytes,
      maxOutputBytes: limits.maxOutputBytes,
      maxProcesses: limits.maxProcesses,
    }),
  });
}

function isExactDenseArray(value: unknown, minimum: number, maximum: number): value is unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return false;
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === value.length + 1 &&
    actual.every((key) => typeof key === "string") &&
    Object.prototype.hasOwnProperty.call(value, "length") &&
    Array.from({ length: value.length }, (_, index) => String(index)).every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

function parseSemanticSessionExtensions(
  command: string,
  value: unknown,
  code: TauriRefactorKitSemanticSessionErrorCode,
): readonly string[] {
  if (!isExactDenseArray(value, 1, MAX_LANGUAGE_EXTENSIONS)) {
    throw semanticSessionError(command, code);
  }
  const extensions = value.map((extension) => {
    if (typeof extension !== "string" || !SOURCE_EXTENSION.test(extension)) {
      throw semanticSessionError(command, code);
    }
    return extension;
  });
  if (new Set(extensions).size !== extensions.length) throw semanticSessionError(command, code);
  return Object.freeze(extensions);
}

function comparableSemanticPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return /^(?:[A-Za-z]:\/|\/\/)/u.test(normalized) ? normalized.toLowerCase() : normalized;
}

function externalToWorkspace(path: string, workspaceRoot: string): boolean {
  const candidate = comparableSemanticPath(path);
  const root = comparableSemanticPath(workspaceRoot);
  return candidate !== root && !candidate.startsWith(`${root}/`);
}

function validateSemanticSessionStartRequest(
  request: SavedSnapshotSemanticSessionStartRequest,
  command: string,
): SavedSnapshotSemanticSessionStartRequest {
  const code = "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED" as const;
  const record = semanticSessionRecord(command, request, code);
  exactSemanticSessionFields(
    command,
    record,
    [
      "languageId",
      "workspaceRoot",
      "workspaceId",
      "workspaceGeneration",
      "provider",
      "providerVersion",
      "backend",
      "runtime",
      "extensions",
      "toolchain",
      "acceptedSemanticCompleteness",
    ],
    code,
  );
  if (
    !validSavedSnapshotLanguage(record.languageId) ||
    !validExternalToolchainPath(record.workspaceRoot) ||
    !validSavedSnapshotIdentity(record.workspaceId) ||
    !positiveBoundedInteger(record.workspaceGeneration, Number.MAX_SAFE_INTEGER) ||
    !validSavedSnapshotMetadata(record.provider) ||
    !validSavedSnapshotMetadata(record.providerVersion) ||
    !validSavedSnapshotMetadata(record.backend)
  ) {
    throw semanticSessionError(command, code);
  }
  const runtime = parseSemanticSessionRuntime(command, record.runtime, code);
  const extensions = parseSemanticSessionExtensions(command, record.extensions, code);
  const toolchain = semanticSessionRecord(command, record.toolchain, code);
  exactSemanticSessionFields(
    command,
    toolchain,
    [
      "nodeExecutable",
      "languageServerPackageRoot",
      "typeScriptPackageRoot",
      "allowPathNodeDiscovery",
      "allowWorkspaceLocalToolchain",
    ],
    code,
  );
  const toolchainPaths = [
    toolchain.nodeExecutable,
    toolchain.languageServerPackageRoot,
    toolchain.typeScriptPackageRoot,
  ];
  if (
    toolchainPaths.some(
      (path) =>
        !validExternalToolchainPath(path) ||
        !externalToWorkspace(path, record.workspaceRoot as string),
    ) ||
    toolchain.allowPathNodeDiscovery !== false ||
    toolchain.allowWorkspaceLocalToolchain !== false
  ) {
    throw semanticSessionError(command, code);
  }
  const acceptedSemanticCompleteness = record.acceptedSemanticCompleteness;
  if (
    !isExactDenseArray(acceptedSemanticCompleteness, 1, 2) ||
    (record.languageId === "typescript"
      ? acceptedSemanticCompleteness.length !== 1 ||
        acceptedSemanticCompleteness[0] !== "full-typescript"
      : !(
          (acceptedSemanticCompleteness.length === 1 &&
            acceptedSemanticCompleteness[0] === "checked-javascript") ||
          (acceptedSemanticCompleteness.length === 2 &&
            acceptedSemanticCompleteness[0] === "dynamic-javascript" &&
            acceptedSemanticCompleteness[1] === "mixed-javascript")
        ))
  ) {
    throw semanticSessionError(command, code);
  }
  const exactAcceptedSemanticCompleteness = Object.freeze(
    record.languageId === "typescript"
      ? (["full-typescript"] as const)
      : acceptedSemanticCompleteness[0] === "checked-javascript"
        ? (["checked-javascript"] as const)
        : (["dynamic-javascript", "mixed-javascript"] as const),
  );
  return Object.freeze({
    languageId: record.languageId,
    workspaceRoot: record.workspaceRoot,
    workspaceId: record.workspaceId,
    workspaceGeneration: record.workspaceGeneration,
    provider: record.provider,
    providerVersion: record.providerVersion,
    backend: record.backend,
    runtime,
    extensions,
    toolchain: Object.freeze({
      nodeExecutable: toolchain.nodeExecutable as string,
      languageServerPackageRoot: toolchain.languageServerPackageRoot as string,
      typeScriptPackageRoot: toolchain.typeScriptPackageRoot as string,
      allowPathNodeDiscovery: false,
      allowWorkspaceLocalToolchain: false,
    }),
    acceptedSemanticCompleteness: exactAcceptedSemanticCompleteness,
  });
}

function parseSemanticSessionStartCandidate(
  command: string,
  response: unknown,
): SavedSnapshotSemanticSessionStartResultCandidate {
  const code = "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED" as const;
  const record = semanticSessionRecord(command, response, code);
  exactSemanticSessionFields(
    command,
    record,
    [
      "languageId",
      "workspaceRoot",
      "workspaceId",
      "workspaceGeneration",
      "sessionId",
      "providerProjectSnapshotIdentity",
      "semanticLease",
      "startSnapshotHash",
      "provider",
      "providerVersion",
      "backend",
      "toolchain",
      "semanticCompleteness",
      "processProvenance",
    ],
    code,
  );
  if (
    !validSavedSnapshotLanguage(record.languageId) ||
    !validExternalToolchainPath(record.workspaceRoot) ||
    !validSavedSnapshotIdentity(record.workspaceId) ||
    !positiveBoundedInteger(record.workspaceGeneration, Number.MAX_SAFE_INTEGER) ||
    !validOpaqueSemanticSessionId(record.sessionId) ||
    !validSha256Identity(record.providerProjectSnapshotIdentity) ||
    !validOpaqueSemanticLease(record.semanticLease) ||
    !validSha256Identity(record.startSnapshotHash) ||
    !validSavedSnapshotMetadata(record.provider) ||
    !validSavedSnapshotMetadata(record.providerVersion) ||
    !validSavedSnapshotMetadata(record.backend) ||
    !["full-typescript", "checked-javascript", "dynamic-javascript", "mixed-javascript"].includes(
      record.semanticCompleteness as string,
    )
  ) {
    throw semanticSessionError(command, code);
  }
  const toolchain = semanticSessionRecord(command, record.toolchain, code);
  exactSemanticSessionFields(
    command,
    toolchain,
    [
      "backend",
      "runtime",
      "extensions",
      "nodeExecutable",
      "languageServerPackageRoot",
      "typeScriptPackageRoot",
    ],
    code,
  );
  const runtime = parseSemanticSessionRuntime(command, toolchain.runtime, code);
  const extensions = parseSemanticSessionExtensions(command, toolchain.extensions, code);
  const toolchainPaths = [
    toolchain.nodeExecutable,
    toolchain.languageServerPackageRoot,
    toolchain.typeScriptPackageRoot,
  ];
  if (
    !validSavedSnapshotMetadata(toolchain.backend) ||
    toolchainPaths.some(
      (path) =>
        !validExternalToolchainPath(path) ||
        !externalToWorkspace(path, record.workspaceRoot as string),
    )
  ) {
    throw semanticSessionError(command, code);
  }
  const processProvenance = semanticSessionRecord(command, record.processProvenance, code);
  exactSemanticSessionFields(
    command,
    processProvenance,
    [
      "serverName",
      "serverVersion",
      "capabilitiesSha256",
      "executableSha256",
      "argumentsSha256",
      "processId",
    ],
    code,
  );
  if (
    !(
      processProvenance.serverName === null ||
      validSavedSnapshotMetadata(processProvenance.serverName)
    ) ||
    !(
      processProvenance.serverVersion === null ||
      validSavedSnapshotMetadata(processProvenance.serverVersion)
    ) ||
    typeof processProvenance.capabilitiesSha256 !== "string" ||
    !SHA256_DIGEST.test(processProvenance.capabilitiesSha256) ||
    typeof processProvenance.executableSha256 !== "string" ||
    !SHA256_DIGEST.test(processProvenance.executableSha256) ||
    typeof processProvenance.argumentsSha256 !== "string" ||
    !SHA256_DIGEST.test(processProvenance.argumentsSha256) ||
    !positiveBoundedInteger(processProvenance.processId, Number.MAX_SAFE_INTEGER)
  ) {
    throw semanticSessionError(command, code);
  }
  return {
    languageId: record.languageId,
    workspaceRoot: record.workspaceRoot,
    workspaceId: record.workspaceId,
    workspaceGeneration: record.workspaceGeneration,
    sessionId: record.sessionId,
    providerProjectSnapshotIdentity: record.providerProjectSnapshotIdentity,
    semanticLease: record.semanticLease,
    startSnapshotHash: record.startSnapshotHash,
    provider: record.provider,
    providerVersion: record.providerVersion,
    backend: record.backend,
    toolchain: {
      backend: toolchain.backend as string,
      runtime,
      extensions: [...extensions],
      nodeExecutable: toolchain.nodeExecutable as string,
      languageServerPackageRoot: toolchain.languageServerPackageRoot as string,
      typeScriptPackageRoot: toolchain.typeScriptPackageRoot as string,
    },
    semanticCompleteness: record.semanticCompleteness as
      "full-typescript" | "checked-javascript" | "dynamic-javascript" | "mixed-javascript",
    processProvenance: {
      serverName: processProvenance.serverName as string | null,
      serverVersion: processProvenance.serverVersion as string | null,
      capabilitiesSha256: processProvenance.capabilitiesSha256,
      executableSha256: processProvenance.executableSha256,
      argumentsSha256: processProvenance.argumentsSha256,
      processId: processProvenance.processId,
    },
  };
}

function validateSemanticSessionStopRequest(
  request: SavedSnapshotSemanticSessionStopRequest,
  command: string,
): SavedSnapshotSemanticSessionStopRequest {
  const code = "REFACTORKIT_SEMANTIC_SESSION_STOP_REQUEST_REJECTED" as const;
  const record = semanticSessionRecord(command, request, code);
  exactSemanticSessionFields(
    command,
    record,
    ["languageId", "workspaceId", "workspaceGeneration", "sessionId"],
    code,
  );
  if (
    !validSavedSnapshotLanguage(record.languageId) ||
    !validSavedSnapshotIdentity(record.workspaceId) ||
    !positiveBoundedInteger(record.workspaceGeneration, Number.MAX_SAFE_INTEGER) ||
    !validOpaqueSemanticSessionId(record.sessionId)
  ) {
    throw semanticSessionError(command, code);
  }
  return Object.freeze({
    languageId: record.languageId,
    workspaceId: record.workspaceId,
    workspaceGeneration: record.workspaceGeneration,
    sessionId: record.sessionId,
  });
}

function parseSemanticSessionStopCandidate(
  command: string,
  response: unknown,
): SavedSnapshotSemanticSessionStopResultCandidate {
  const code = "REFACTORKIT_SEMANTIC_SESSION_STOP_RESPONSE_REJECTED" as const;
  const record = semanticSessionRecord(command, response, code);
  exactSemanticSessionFields(
    command,
    record,
    ["languageId", "workspaceId", "workspaceGeneration", "sessionId", "stopped"],
    code,
  );
  if (
    !validSavedSnapshotLanguage(record.languageId) ||
    !validSavedSnapshotIdentity(record.workspaceId) ||
    !positiveBoundedInteger(record.workspaceGeneration, Number.MAX_SAFE_INTEGER) ||
    !validOpaqueSemanticSessionId(record.sessionId) ||
    typeof record.stopped !== "boolean"
  ) {
    throw semanticSessionError(command, code);
  }
  return {
    languageId: record.languageId,
    workspaceId: record.workspaceId,
    workspaceGeneration: record.workspaceGeneration,
    sessionId: record.sessionId,
    stopped: record.stopped,
  };
}

async function invokeSemanticSession(
  command: string,
  request: object,
  failureCode:
    "REFACTORKIT_SEMANTIC_SESSION_START_FAILED" | "REFACTORKIT_SEMANTIC_SESSION_STOP_FAILED",
): Promise<unknown> {
  try {
    return await invoke<unknown>(command, { request });
  } catch {
    throw semanticSessionError(command, failureCode);
  }
}

function enforceSemanticSessionBoundary<T>(
  command: string,
  code: TauriRefactorKitSemanticSessionErrorCode,
  enforce: () => T,
): T {
  try {
    return enforce();
  } catch {
    throw semanticSessionError(command, code);
  }
}

function validSavedSnapshotLanguage(value: unknown): value is TypeScriptJavaScriptLanguageId {
  return value === "typescript" || value === "javascript";
}

function validateSearchRequest(
  request: SavedSnapshotSymbolSearchRequest,
  command: string,
): SavedSnapshotSymbolSearchRequest {
  const record = symbolNavigationRequestRecord(command, request);
  exactNavigationFields(command, record, [
    "languageId",
    "query",
    "workspaceId",
    "workspaceGeneration",
    "sessionId",
    "semanticLease",
    "snapshotIdentity",
    "providerVersion",
    "backend",
    "toolchain",
  ]);
  if (
    !validSavedSnapshotLanguage(record.languageId) ||
    !validSavedSnapshotQuery(record.query) ||
    !validSavedSnapshotIdentity(record.workspaceId) ||
    !validOpaqueSemanticSessionId(record.sessionId) ||
    !validOpaqueSemanticLease(record.semanticLease) ||
    !validSha256Identity(record.snapshotIdentity) ||
    !validSavedSnapshotMetadata(record.providerVersion) ||
    !validSavedSnapshotMetadata(record.backend) ||
    typeof record.workspaceGeneration !== "number" ||
    !Number.isSafeInteger(record.workspaceGeneration) ||
    record.workspaceGeneration <= 0
  ) {
    throw invalidSymbolNavigationRequest(command);
  }
  const toolchain = symbolNavigationRequestRecord(command, record.toolchain);
  exactNavigationFields(command, toolchain, [
    "nodeExecutable",
    "languageServerPackageRoot",
    "typeScriptPackageRoot",
    "allowPathNodeDiscovery",
    "allowWorkspaceLocalToolchain",
  ]);
  if (
    !validExternalToolchainPath(toolchain.nodeExecutable) ||
    !validExternalToolchainPath(toolchain.languageServerPackageRoot) ||
    !validExternalToolchainPath(toolchain.typeScriptPackageRoot) ||
    toolchain.allowPathNodeDiscovery !== false ||
    toolchain.allowWorkspaceLocalToolchain !== false
  ) {
    throw invalidSymbolNavigationRequest(command);
  }
  return Object.freeze({
    languageId: record.languageId,
    query: record.query,
    workspaceId: record.workspaceId,
    workspaceGeneration: record.workspaceGeneration,
    sessionId: record.sessionId,
    semanticLease: record.semanticLease,
    snapshotIdentity: record.snapshotIdentity,
    providerVersion: record.providerVersion,
    backend: record.backend,
    toolchain: Object.freeze({
      nodeExecutable: toolchain.nodeExecutable,
      languageServerPackageRoot: toolchain.languageServerPackageRoot,
      typeScriptPackageRoot: toolchain.typeScriptPackageRoot,
      allowPathNodeDiscovery: false,
      allowWorkspaceLocalToolchain: false,
    }),
  });
}

function validateDefinitionRequest(
  request: SavedSnapshotDefinitionRequest,
  command: string,
): SavedSnapshotDefinitionRequest {
  const record = symbolNavigationRequestRecord(command, request);
  exactNavigationFields(command, record, [
    "languageId",
    "symbolId",
    "workspaceId",
    "workspaceGeneration",
    "sessionId",
    "semanticLease",
    "snapshotIdentity",
    "providerVersion",
    "backend",
  ]);
  if (
    !validSavedSnapshotLanguage(record.languageId) ||
    !validOpaqueSymbolId(record.symbolId) ||
    !validSavedSnapshotIdentity(record.workspaceId) ||
    !validOpaqueSemanticSessionId(record.sessionId) ||
    !validOpaqueSemanticLease(record.semanticLease) ||
    !validSha256Identity(record.snapshotIdentity) ||
    !validSavedSnapshotMetadata(record.providerVersion) ||
    !validSavedSnapshotMetadata(record.backend) ||
    typeof record.workspaceGeneration !== "number" ||
    !Number.isSafeInteger(record.workspaceGeneration) ||
    record.workspaceGeneration <= 0
  ) {
    throw invalidSymbolNavigationRequest(command);
  }
  return Object.freeze({
    languageId: record.languageId,
    symbolId: record.symbolId,
    workspaceId: record.workspaceId,
    workspaceGeneration: record.workspaceGeneration,
    sessionId: record.sessionId,
    semanticLease: record.semanticLease,
    snapshotIdentity: record.snapshotIdentity,
    providerVersion: record.providerVersion,
    backend: record.backend,
  });
}

function navigationResponseRecord(
  command: string,
  value: unknown,
  code: TauriRefactorKitSymbolNavigationErrorCode,
): RecordValue {
  if (!isRecord(value) || !plainRecord(value)) throw symbolNavigationError(command, code);
  return value;
}

function parseNavigationSymbol(
  command: string,
  value: unknown,
  code: TauriRefactorKitSymbolNavigationErrorCode,
): SavedSnapshotWorkspaceSymbol {
  const record = navigationResponseRecord(command, value, code);
  exactNavigationFields(command, record, ["id", "name", "kind"], code);
  if (
    !validOpaqueSymbolId(record.id) ||
    !validSavedSnapshotMetadata(record.name) ||
    !validSavedSnapshotMetadata(record.kind)
  ) {
    throw symbolNavigationError(command, code);
  }
  return { id: record.id, name: record.name, kind: record.kind };
}

function parseSearchCandidate(
  command: string,
  response: unknown,
): SavedSnapshotSymbolSearchResultCandidate {
  const code = "REFACTORKIT_SYMBOL_SEARCH_RESPONSE_REJECTED" as const;
  const record = navigationResponseRecord(command, response, code);
  exactNavigationFields(
    command,
    record,
    [
      "languageId",
      "query",
      "workspaceId",
      "workspaceGeneration",
      "sessionId",
      "snapshotIdentity",
      "providerVersion",
      "backend",
      "completeness",
      "symbols",
    ],
    code,
  );
  if (
    !validSavedSnapshotLanguage(record.languageId) ||
    !validSavedSnapshotQuery(record.query) ||
    !validSavedSnapshotIdentity(record.workspaceId) ||
    !validSavedSnapshotIdentity(record.sessionId) ||
    !validSavedSnapshotIdentity(record.snapshotIdentity) ||
    !validSavedSnapshotMetadata(record.providerVersion) ||
    !validSavedSnapshotMetadata(record.backend) ||
    typeof record.workspaceGeneration !== "number" ||
    !Number.isSafeInteger(record.workspaceGeneration) ||
    record.workspaceGeneration <= 0
  ) {
    throw symbolNavigationError(command, code);
  }
  const completeness = navigationResponseRecord(command, record.completeness, code);
  exactNavigationFields(
    command,
    completeness,
    ["resultCompleteness", "truncation", "semanticCompleteness", "experimentalDisclosure"],
    code,
  );
  if (
    completeness.resultCompleteness !== "unknown" ||
    completeness.truncation !== "unknown" ||
    !["full-typescript", "checked-javascript", "dynamic-javascript", "mixed-javascript"].includes(
      completeness.semanticCompleteness as string,
    ) ||
    (completeness.experimentalDisclosure !== "shown" &&
      completeness.experimentalDisclosure !== "not-shown") ||
    !Array.isArray(record.symbols) ||
    record.symbols.length > MAX_SAVED_SNAPSHOT_SYMBOLS ||
    !Array.from({ length: record.symbols.length }, (_, index) => index).every((index) =>
      Object.prototype.hasOwnProperty.call(record.symbols, index),
    )
  ) {
    throw symbolNavigationError(command, code);
  }
  const symbolIds = new Set<string>();
  const symbols = record.symbols.map((value) => {
    const symbol = parseNavigationSymbol(command, value, code);
    if (symbolIds.has(symbol.id)) throw symbolNavigationError(command, code);
    symbolIds.add(symbol.id);
    return symbol;
  });
  return {
    languageId: record.languageId,
    query: record.query,
    workspaceId: record.workspaceId,
    workspaceGeneration: record.workspaceGeneration,
    sessionId: record.sessionId,
    snapshotIdentity: record.snapshotIdentity,
    providerVersion: record.providerVersion,
    backend: record.backend,
    completeness: {
      resultCompleteness: "unknown",
      truncation: "unknown",
      semanticCompleteness: completeness.semanticCompleteness as
        "full-typescript" | "checked-javascript" | "dynamic-javascript" | "mixed-javascript",
      experimentalDisclosure: completeness.experimentalDisclosure,
    },
    symbols,
  };
}

function validDefinitionFile(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH ||
    value.trim() !== value ||
    CONTROL_CHARACTERS.test(value) ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function parseDefinitionCandidate(
  command: string,
  response: unknown,
): SavedSnapshotDefinitionResultCandidate {
  const code = "REFACTORKIT_DEFINITION_RESPONSE_REJECTED" as const;
  const record = navigationResponseRecord(command, response, code);
  exactNavigationFields(
    command,
    record,
    [
      "languageId",
      "workspaceId",
      "workspaceGeneration",
      "sessionId",
      "snapshotIdentity",
      "providerVersion",
      "backend",
      "selectedSymbol",
      "file",
      "point",
    ],
    code,
  );
  if (
    !validSavedSnapshotLanguage(record.languageId) ||
    !validSavedSnapshotIdentity(record.workspaceId) ||
    !validSavedSnapshotIdentity(record.sessionId) ||
    !validSavedSnapshotIdentity(record.snapshotIdentity) ||
    !validSavedSnapshotMetadata(record.providerVersion) ||
    !validSavedSnapshotMetadata(record.backend) ||
    typeof record.workspaceGeneration !== "number" ||
    !Number.isSafeInteger(record.workspaceGeneration) ||
    record.workspaceGeneration <= 0 ||
    !validDefinitionFile(record.file)
  ) {
    throw symbolNavigationError(command, code);
  }
  const point = navigationResponseRecord(command, record.point, code);
  exactNavigationFields(command, point, ["line", "character"], code);
  if (
    typeof point.line !== "number" ||
    !Number.isSafeInteger(point.line) ||
    point.line < 0 ||
    !Number.isSafeInteger(point.line + 1) ||
    typeof point.character !== "number" ||
    !Number.isSafeInteger(point.character) ||
    point.character < 0 ||
    !Number.isSafeInteger(point.character + 1)
  ) {
    throw symbolNavigationError(command, code);
  }
  return {
    languageId: record.languageId,
    workspaceId: record.workspaceId,
    workspaceGeneration: record.workspaceGeneration,
    sessionId: record.sessionId,
    snapshotIdentity: record.snapshotIdentity,
    providerVersion: record.providerVersion,
    backend: record.backend,
    selectedSymbol: parseNavigationSymbol(command, record.selectedSymbol, code),
    file: record.file,
    point: { line: point.line, character: point.character },
  };
}

function definitionAuthorityMatches(
  request: SavedSnapshotDefinitionRequest,
  result: Readonly<SavedSnapshotSymbolSearchResult>,
): boolean {
  return (
    request.languageId === result.languageId &&
    request.workspaceId === result.workspaceId &&
    request.workspaceGeneration === result.workspaceGeneration &&
    request.sessionId === result.sessionId &&
    request.snapshotIdentity === result.snapshotIdentity &&
    request.providerVersion === result.providerVersion &&
    request.backend === result.backend
  );
}

async function invokeSymbolNavigation(
  command: string,
  request: object,
  failureCode: "REFACTORKIT_SYMBOL_SEARCH_FAILED" | "REFACTORKIT_DEFINITION_FAILED",
): Promise<unknown> {
  try {
    return await invoke<unknown>(command, { request });
  } catch {
    throw symbolNavigationError(command, failureCode);
  }
}

function nativeErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (isRecord(error)) {
    for (const field of ["message", "error", "reason"] as const) {
      if (typeof error[field] === "string") return error[field];
    }
  }
  return "";
}

function nativeErrorText(error: unknown): string {
  return nativeErrorMessage(error).toLowerCase();
}

function safeJavaPreviewRefusalReason(error: unknown): string | undefined {
  const raw = nativeErrorMessage(error);
  const prefix = /RefactorKit refused this Java operation(?: \(JSON-RPC error -?\d+\))?\. /u.exec(
    raw,
  );
  if (!prefix || prefix.index === undefined) return undefined;
  const reasonStart = prefix.index + prefix[0].length;
  const end = [" Synchronize and review a new plan.", " No source changes were made."]
    .map((suffix) => raw.indexOf(suffix, reasonStart))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (end === undefined) return undefined;
  const reason = raw.slice(reasonStart, end).replace(/\s+/gu, " ").trim();
  if (
    !reason ||
    reason.length > 512 ||
    /[\\/]/u.test(reason) ||
    /\b(?:password|secret|credential|token|authorization|api key)\b/iu.test(reason) ||
    !/^[\p{L}\p{N}\s.,:;()'_\-.]+$/u.test(reason)
  )
    return undefined;
  return reason.replace(/[.!?]+$/u, "");
}

function managedCommandError(command: string, error: unknown): TauriAdapterError | RefactorRollbackNotStartedError {
  // Classification may inspect native text, but neither it nor the submitted request is
  // retained on the public error. Only a tightly filtered preview refusal reason is
  // carried through; other messages remain static and source-safe.
  const text = nativeErrorText(error);
  if (command === "get_refactorkit_capabilities") {
    return new TauriRefactorKitUpdateRequiredError(command);
  }
  if (command === "get_refactorkit_engine_capabilities") {
    return new TauriRefactorKitUpdateRequiredError(command);
  }
  if (command === "preview_refactorkit_external_java_import") {
    return new TauriRefactorKitManagedCommandError(
      command,
      /refus|reject/.test(text) ? "REFACTORKIT_PREVIEW_REFUSED" : "REFACTORKIT_PREVIEW_FAILED",
      /refus|reject/.test(text)
        ? "RefactorKit refused to preview this external Java import."
        : "RefactorKit could not preview the external Java import.",
    );
  }
  if (command === "preview_refactorkit_maven_module_rename") {
    if (text.startsWith("refactorkit refused the maven module destination or artifact id.")) {
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_PREVIEW_REFUSED",
        "RefactorKit refused the Maven module destination or artifact ID. Choose an unused module directory. Leave the artifact ID empty to keep it, or enter an unused ID for a direct-child rename.",
      );
    }
    if (text.startsWith("refactorkit could not verify the maven reactor model for this rename.")) {
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_PREVIEW_REFUSED",
        "RefactorKit could not verify the Maven reactor model for this rename. The workspace is unchanged.",
      );
    }
    if (/session failed or timed out/.test(text)) {
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_PREVIEW_SESSION_FAILED",
        "The RefactorKit daemon session failed or timed out while previewing the Maven module rename.",
      );
    }
    if (/invalid response/.test(text)) {
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_PREVIEW_PROTOCOL_FAILED",
        "RefactorKit returned an invalid response for the Maven module rename preview.",
      );
    }
    if (/request exceeds the allowed size/.test(text)) {
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_PREVIEW_REQUEST_TOO_LARGE",
        "The Maven module rename preview request exceeds the allowed size.",
      );
    }
    const refused = /refus|reject/.test(text);
    return new TauriRefactorKitManagedCommandError(
      command,
      refused ? "REFACTORKIT_PREVIEW_REFUSED" : "REFACTORKIT_PREVIEW_FAILED",
      refused
        ? "RefactorKit refused to preview this Maven module rename."
        : "RefactorKit could not preview the Maven module rename.",
    );
  }
  if (command === "discard_refactorkit_maven_module_rename_preview") {
    return new TauriRefactorKitManagedCommandError(
      command,
      "REFACTORKIT_DISCARD_FAILED",
      "RefactorKit could not discard the Maven module rename preview.",
    );
  }
  if (command === "apply_refactorkit_plan") {
    if (/stale|unknown|guard mismatch/.test(text)) {
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_APPLY_STALE",
        "The reviewed RefactorKit plan is stale or no longer available.",
      );
    }
    if (/refus|reject|approval/.test(text)) {
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_APPLY_REFUSED",
        "RefactorKit refused to apply the reviewed plan.",
      );
    }
    return new TauriRefactorKitManagedCommandError(
      command,
      "REFACTORKIT_APPLY_FAILED",
      "RefactorKit could not apply the reviewed plan.",
    );
  }
  if (command === "discard_refactorkit_plan") {
    return new TauriRefactorKitManagedCommandError(
      command,
      "REFACTORKIT_DISCARD_FAILED",
      "RefactorKit could not discard the retained plan.",
    );
  }
  if (command === "preview_refactorkit_refactoring") {
    return new TauriRefactorKitManagedCommandError(
      command,
      /refus|reject/.test(text) ? "REFACTORKIT_PREVIEW_REFUSED" : "REFACTORKIT_PREVIEW_FAILED",
      /refus|reject/.test(text)
        ? "RefactorKit refused to preview this Java refactoring."
        : "RefactorKit could not preview this Java refactoring.",
    );
  }
  if (command === "apply_refactorkit_refactoring") {
    if (/stale|unknown|guard mismatch/.test(text)) {
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_APPLY_STALE",
        "The reviewed RefactorKit refactoring plan is stale or no longer available.",
      );
    }
    if (/refus|reject|approval/.test(text)) {
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_APPLY_REFUSED",
        "RefactorKit refused to apply the reviewed refactoring plan.",
      );
    }
    return new TauriRefactorKitManagedCommandError(
      command,
      "REFACTORKIT_APPLY_FAILED",
      "RefactorKit could not apply the reviewed refactoring plan.",
    );
  }
  if (command === "discard_refactorkit_refactoring") {
    return new TauriRefactorKitManagedCommandError(
      command,
      "REFACTORKIT_DISCARD_FAILED",
      "RefactorKit could not discard the retained refactoring plan.",
    );
  }
  if (command === "rollback_refactorkit_refactoring") {
    if (/conflict|stale|unknown|ownership mismatch/.test(text)) {
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_ROLLBACK_CONFLICT",
        "RefactorKit could not roll back because the refactoring transaction conflicts with current workspace state.",
      );
    }
    return new TauriRefactorKitManagedCommandError(
      command,
      "REFACTORKIT_ROLLBACK_FAILED",
      "RefactorKit could not roll back the refactoring transaction.",
    );
  }
  if (command === "preview_refactorkit_engine_refactoring") {
    const refused = /refus|reject/.test(text);
    const refusalReason = refused ? safeJavaPreviewRefusalReason(error) : undefined;
    if (text.includes("did not return a managed plan for the selected saved java context"))
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_PREVIEW_CONTEXT_UNATTESTED",
        "RefactorKit could not verify this preview against the current saved Java project context. Apply is unavailable and no changes were made.",
      );
    if (
      /project inputs changed|synchronize and preview again|snapshot (?:changed|is stale)/i.test(
        text,
      )
    )
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_PREVIEW_STALE_CONTEXT",
        "The selected Java project context changed. Synchronize the project and preview again.",
      );
    return new TauriRefactorKitManagedCommandError(
      command,
      refused ? "REFACTORKIT_PREVIEW_REFUSED" : "REFACTORKIT_PREVIEW_FAILED",
      refused
        ? refusalReason
          ? `RefactorKit refused to preview this real-engine Java refactoring: ${refusalReason}. No source changes were made.`
          : "RefactorKit refused to preview this real-engine Java refactoring. No source changes were made."
        : "RefactorKit could not preview this real-engine Java refactoring.",
    );
  }
  if (command === "apply_refactorkit_engine_refactoring") {
    if (/stale|unknown|guard mismatch/.test(text)) {
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_APPLY_STALE",
        "The reviewed real-engine RefactorKit plan is stale or no longer available.",
      );
    }
    if (/refus|reject|approval/.test(text)) {
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_APPLY_REFUSED",
        "RefactorKit refused to apply the reviewed real-engine refactoring plan.",
      );
    }
    return new TauriRefactorKitManagedCommandError(
      command,
      "REFACTORKIT_APPLY_FAILED",
      "RefactorKit could not apply the reviewed real-engine refactoring plan.",
    );
  }
  if (command === "discard_refactorkit_engine_refactoring") {
    return new TauriRefactorKitManagedCommandError(
      command,
      "REFACTORKIT_DISCARD_FAILED",
      "RefactorKit could not discard the retained real-engine refactoring plan.",
    );
  }
  if (command === "rollback_refactorkit_engine_refactoring") {
    if (text.startsWith("rollback write outcome is unknown:")) {
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_ROLLBACK_OUTCOME_UNKNOWN",
        "Rollback may have changed files, but the result could not be confirmed. Inspect the project and compare open buffers with disk before continuing.",
      );
    }
    if (text.startsWith("saved project inputs changed after apply; rollback was not started (")) {
      return Object.assign(new RefactorRollbackNotStartedError(
        "Saved project files changed after Apply. Rollback was not started. Review the changes and the transaction before retrying.",
      ), { command, code: "REFACTORKIT_ROLLBACK_INPUTS_CHANGED" as const, cause: undefined });
    }
    if (/conflict|stale|unknown|ownership mismatch/.test(text)) {
      return new TauriRefactorKitManagedCommandError(
        command,
        "REFACTORKIT_ROLLBACK_CONFLICT",
        "RefactorKit could not roll back because the real-engine refactoring transaction conflicts with current workspace state.",
      );
    }
    return new TauriRefactorKitManagedCommandError(
      command,
      "REFACTORKIT_ROLLBACK_FAILED",
      "RefactorKit could not roll back the real-engine refactoring transaction.",
    );
  }
  if (
    command === "rollback_refactorkit_maven_module_rename" &&
    text.startsWith("maven module rename rollback conflicts with the current workspace state.")
  ) {
    return new TauriRefactorKitManagedCommandError(
      command,
      "REFACTORKIT_ROLLBACK_CONFLICT",
      "The workspace changed after the Maven module rename. Review the changes before retrying rollback.",
    );
  }
  if (/conflict|stale|unknown|ownership mismatch/.test(text)) {
    return new TauriRefactorKitManagedCommandError(
      command,
      "REFACTORKIT_ROLLBACK_CONFLICT",
      "RefactorKit could not roll back because the transaction conflicts with current workspace state.",
    );
  }
  return new TauriRefactorKitManagedCommandError(
    command,
    "REFACTORKIT_ROLLBACK_FAILED",
    "RefactorKit could not roll back the transaction.",
  );
}

async function invokeManaged(command: string, request?: RecordValue): Promise<unknown> {
  try {
    return await invoke<unknown>(command, request === undefined ? undefined : { request });
  } catch (error) {
    throw managedCommandError(command, error);
  }
}

function exactProtocolFields(
  command: string,
  record: RecordValue,
  expected: readonly string[],
  field: string,
): void {
  const actual = Object.keys(record);
  if (
    actual.length !== expected.length ||
    expected.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
  ) {
    throw invalidProtocolShape(command, `invalid fields ${field}`);
  }
}

function boundedLanguageString(command: string, record: RecordValue, field: string): string {
  const value = record[field];
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    UTF8_ENCODER.encode(value).length > MAX_LANGUAGE_STRING_BYTES ||
    /\p{Cc}/u.test(value)
  ) {
    throw invalidProtocolShape(command, `invalid string ${field}`);
  }
  return value;
}

function nullableBoundedRuntimeInteger(
  command: string,
  record: RecordValue,
  field: string,
  maximum: number,
): number | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw invalidProtocolShape(command, `invalid runtime limit ${field}`);
  }
  return value;
}

function normalizeLanguageExtensions(command: string, value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LANGUAGE_EXTENSIONS) {
    throw invalidProtocolShape(command, `invalid ${field}`);
  }
  const uniqueExtensions = new Set<string>();
  return value.map((extension) => {
    if (
      typeof extension !== "string" ||
      !/^[a-z0-9][a-z0-9+_-]{0,15}$/.test(extension) ||
      uniqueExtensions.has(extension)
    ) {
      throw invalidProtocolShape(command, `invalid or duplicate ${field}`);
    }
    uniqueExtensions.add(extension);
    return extension;
  });
}

function normalizeLanguageRuntime(
  command: string,
  value: unknown,
  field = "languageKernel.adapters.runtime",
): RefactorKitLanguageAdapterRuntime {
  const runtime = protocolRecord(command, value, field);
  exactProtocolFields(
    command,
    runtime,
    [
      "executionMode",
      "supportsTimeout",
      "supportsCancellation",
      "usesWorkspaceOverlay",
      "recordsProcessProvenance",
      "limits",
    ],
    field,
  );
  const limitsField = `${field}.limits`;
  const limitsRecord = protocolRecord(command, runtime.limits, limitsField);
  exactProtocolFields(
    command,
    limitsRecord,
    ["requestTimeoutMillis", "maxInputBytes", "maxOutputBytes", "maxProcesses"],
    limitsField,
  );
  const limits: RefactorKitLanguageAdapterResourceLimits = {
    requestTimeoutMillis: nullableBoundedRuntimeInteger(
      command,
      limitsRecord,
      "requestTimeoutMillis",
      MAX_RUNTIME_TIMEOUT_MILLIS,
    ),
    maxInputBytes: nullableBoundedRuntimeInteger(
      command,
      limitsRecord,
      "maxInputBytes",
      MAX_RUNTIME_BYTES,
    ),
    maxOutputBytes: nullableBoundedRuntimeInteger(
      command,
      limitsRecord,
      "maxOutputBytes",
      MAX_RUNTIME_BYTES,
    ),
    maxProcesses: nullableBoundedRuntimeInteger(
      command,
      limitsRecord,
      "maxProcesses",
      MAX_RUNTIME_PROCESSES,
    ),
  };
  const normalized: RefactorKitLanguageAdapterRuntime = {
    executionMode: enumValue(command, runtime, "executionMode", LANGUAGE_EXECUTION_MODE),
    supportsTimeout: protocolBoolean(command, runtime, "supportsTimeout"),
    supportsCancellation: protocolBoolean(command, runtime, "supportsCancellation"),
    usesWorkspaceOverlay: protocolBoolean(command, runtime, "usesWorkspaceOverlay"),
    recordsProcessProvenance: protocolBoolean(command, runtime, "recordsProcessProvenance"),
    limits,
  };
  if (
    (normalized.executionMode === "in-process" &&
      (normalized.recordsProcessProvenance || normalized.usesWorkspaceOverlay)) ||
    (normalized.supportsTimeout && normalized.limits.requestTimeoutMillis === null)
  ) {
    throw invalidProtocolShape(command, `incoherent ${field}`);
  }
  return normalized;
}

function exactProtocolFieldsWithOptional(
  command: string,
  record: RecordValue,
  required: readonly string[],
  optional: readonly string[],
  field: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(record);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(record, key)) ||
    actual.some((key) => !allowed.has(key))
  ) {
    throw invalidProtocolShape(command, `invalid fields ${field}`);
  }
}

function normalizeDiagnosticSnapshotModes(
  command: string,
  value: unknown,
  field: string,
): DiagnosticSnapshotMode[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > DIAGNOSTIC_SNAPSHOT_MODE_VOCABULARY.length
  ) {
    throw invalidProtocolShape(command, `invalid ${field}`);
  }
  const modes = value.map((mode) => {
    if (!DIAGNOSTIC_SNAPSHOT_MODE_VOCABULARY.includes(mode as DiagnosticSnapshotMode)) {
      throw invalidProtocolShape(command, `invalid ${field}`);
    }
    return mode as DiagnosticSnapshotMode;
  });
  const uniqueModes = new Set(modes);
  const orderedIndexes = modes.map((mode) => DIAGNOSTIC_OPERATION_SNAPSHOT_MODES.indexOf(mode));
  if (
    uniqueModes.size !== modes.length ||
    orderedIndexes.some((index, position) => position > 0 && index <= orderedIndexes[position - 1])
  ) {
    throw invalidProtocolShape(command, `invalid or duplicate ${field}`);
  }
  return modes;
}

function normalizeDiagnosticRangeCapability(
  command: string,
  value: unknown,
  field: string,
): DiagnosticRangeCapability {
  if (value !== DIAGNOSTIC_RANGE_CAPABILITY) {
    throw invalidProtocolShape(command, `invalid ${field}`);
  }
  return value;
}

function normalizeLanguageCapability(
  command: string,
  value: unknown,
  field: string,
): NormalizedLanguageCapability {
  const capability = protocolRecord(command, value, field);
  const operation = boundedLanguageString(command, capability, "operation");
  const requiredFields = [
    "operation",
    "stability",
    "evidence",
    "mutationAuthority",
    "backend",
    "runtime",
    "extensions",
  ] as const;
  if (operation === DIAGNOSTICS_OPERATION) {
    exactProtocolFieldsWithOptional(
      command,
      capability,
      requiredFields,
      ["diagnosticSnapshotModes", "diagnosticRangeCapability"],
      field,
    );
  } else {
    exactProtocolFields(command, capability, requiredFields, field);
  }
  const normalized: NormalizedLanguageCapability = {
    operation,
    stability: enumValue(command, capability, "stability", LANGUAGE_STABILITY),
    evidence: enumValue(command, capability, "evidence", LANGUAGE_EVIDENCE),
    mutationAuthority: enumValue(
      command,
      capability,
      "mutationAuthority",
      LANGUAGE_MUTATION_AUTHORITY,
    ),
    backend: boundedLanguageString(command, capability, "backend"),
    runtime: normalizeLanguageRuntime(command, capability.runtime, `${field}.runtime`),
    extensions: normalizeLanguageExtensions(command, capability.extensions, `${field}.extensions`),
  };
  const diagnosticSnapshotModes = Object.prototype.hasOwnProperty.call(
    capability,
    "diagnosticSnapshotModes",
  )
    ? normalizeDiagnosticSnapshotModes(
        command,
        capability.diagnosticSnapshotModes,
        `${field}.diagnosticSnapshotModes`,
      )
    : undefined;
  const diagnosticRangeCapability = Object.prototype.hasOwnProperty.call(
    capability,
    "diagnosticRangeCapability",
  )
    ? normalizeDiagnosticRangeCapability(
        command,
        capability.diagnosticRangeCapability,
        `${field}.diagnosticRangeCapability`,
      )
    : undefined;
  if (
    (diagnosticRangeCapability !== undefined && diagnosticSnapshotModes === undefined) ||
    (diagnosticSnapshotModes?.includes("immutable-editor-overlay") === true &&
      diagnosticRangeCapability !== DIAGNOSTIC_RANGE_CAPABILITY)
  ) {
    throw invalidProtocolShape(command, `incoherent ${field} diagnostic metadata`);
  }
  if (diagnosticSnapshotModes !== undefined) {
    normalized.diagnosticSnapshotModes = diagnosticSnapshotModes;
  }
  if (diagnosticRangeCapability !== undefined) {
    normalized.diagnosticRangeCapability = diagnosticRangeCapability;
  }
  if (
    normalized.mutationAuthority === "managed-stable" &&
    (normalized.stability !== "stable" ||
      normalized.evidence === "lexical" ||
      normalized.evidence === "none")
  ) {
    throw invalidProtocolShape(command, "invalid managed-stable language capability");
  }
  return normalized;
}

function requireExactVocabulary(
  command: string,
  vocabulary: RecordValue,
  field: string,
  expected: readonly string[],
): void {
  const value = vocabulary[field];
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((item, index) => item !== expected[index])
  ) {
    throw invalidProtocolShape(command, `invalid languageKernel vocabulary ${field}`);
  }
}

function normalizeLanguageKernel(command: string, value: unknown): NormalizedLanguageKernel {
  const schema = protocolRecord(command, value, "languageKernel.schema");
  exactProtocolFields(
    command,
    schema,
    ["schemaVersion", "adapters", "vocabulary"],
    "languageKernel.schema",
  );
  if (schema.schemaVersion !== 1) {
    throw invalidProtocolShape(command, "invalid languageKernel schemaVersion");
  }

  const vocabulary = protocolRecord(command, schema.vocabulary, "languageKernel.schema.vocabulary");
  exactProtocolFieldsWithOptional(
    command,
    vocabulary,
    ["stability", "evidence", "mutationAuthority", "executionMode"],
    ["diagnosticSnapshotMode", "diagnosticRangeCapability"],
    "languageKernel.schema.vocabulary",
  );
  requireExactVocabulary(command, vocabulary, "stability", LANGUAGE_STABILITY);
  requireExactVocabulary(command, vocabulary, "evidence", LANGUAGE_EVIDENCE);
  requireExactVocabulary(command, vocabulary, "mutationAuthority", LANGUAGE_MUTATION_AUTHORITY);
  requireExactVocabulary(command, vocabulary, "executionMode", LANGUAGE_EXECUTION_MODE);
  const hasDiagnosticSnapshotVocabulary = Object.prototype.hasOwnProperty.call(
    vocabulary,
    "diagnosticSnapshotMode",
  );
  const hasDiagnosticRangeVocabulary = Object.prototype.hasOwnProperty.call(
    vocabulary,
    "diagnosticRangeCapability",
  );
  if (hasDiagnosticSnapshotVocabulary !== hasDiagnosticRangeVocabulary) {
    throw invalidProtocolShape(command, "incomplete languageKernel diagnostic vocabulary");
  }
  if (hasDiagnosticSnapshotVocabulary) {
    requireExactVocabulary(
      command,
      vocabulary,
      "diagnosticSnapshotMode",
      DIAGNOSTIC_SNAPSHOT_MODE_VOCABULARY,
    );
    requireExactVocabulary(
      command,
      vocabulary,
      "diagnosticRangeCapability",
      DIAGNOSTIC_RANGE_CAPABILITY_VOCABULARY,
    );
  }

  if (!Array.isArray(schema.adapters) || schema.adapters.length > MAX_LANGUAGE_ADAPTERS) {
    throw invalidProtocolShape(command, "invalid languageKernel adapters");
  }
  const languageIds = new Set<string>();
  const ownedExtensions = new Set<string>();
  const adapters: NormalizedLanguageAdapter[] = schema.adapters.map((value, adapterIndex) => {
    const field = `languageKernel.schema.adapters[${adapterIndex}]`;
    const adapter = protocolRecord(command, value, field);
    exactProtocolFields(
      command,
      adapter,
      ["languageId", "extensions", "backend", "runtime", "capabilities"],
      field,
    );

    const languageId = adapter.languageId;
    if (
      typeof languageId !== "string" ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(languageId) ||
      languageIds.has(languageId)
    ) {
      throw invalidProtocolShape(command, "invalid or duplicate languageKernel languageId");
    }
    languageIds.add(languageId);

    const extensions = normalizeLanguageExtensions(
      command,
      adapter.extensions,
      `${field}.extensions`,
    );
    for (const extension of extensions) {
      if (ownedExtensions.has(extension)) {
        throw invalidProtocolShape(command, "ambiguous languageKernel extension");
      }
      ownedExtensions.add(extension);
    }

    if (
      !Array.isArray(adapter.capabilities) ||
      adapter.capabilities.length > MAX_LANGUAGE_CAPABILITIES
    ) {
      throw invalidProtocolShape(command, "invalid languageKernel capabilities");
    }
    const operations = new Set<string>();
    const capabilities = adapter.capabilities.map((capability, capabilityIndex) => {
      const normalized = normalizeLanguageCapability(
        command,
        capability,
        `${field}.capabilities[${capabilityIndex}]`,
      );
      if (operations.has(normalized.operation)) {
        throw invalidProtocolShape(command, "duplicate languageKernel operation");
      }
      operations.add(normalized.operation);
      return normalized;
    });

    return {
      languageId,
      extensions,
      backend: boundedLanguageString(command, adapter, "backend"),
      runtime: normalizeLanguageRuntime(command, adapter.runtime),
      capabilities,
    };
  });

  const normalizedVocabulary: NormalizedLanguageKernel["vocabulary"] = {
    stability: [...LANGUAGE_STABILITY],
    evidence: [...LANGUAGE_EVIDENCE],
    mutationAuthority: [...LANGUAGE_MUTATION_AUTHORITY],
    executionMode: [...LANGUAGE_EXECUTION_MODE],
  };
  if (hasDiagnosticSnapshotVocabulary) {
    normalizedVocabulary.diagnosticSnapshotMode = [...DIAGNOSTIC_SNAPSHOT_MODE_VOCABULARY];
    normalizedVocabulary.diagnosticRangeCapability = [DIAGNOSTIC_RANGE_CAPABILITY];
  }
  return {
    schemaVersion: 1,
    adapters,
    vocabulary: normalizedVocabulary,
  };
}

function normalizeLanguageKernelStatus(
  command: string,
  value: unknown,
): NormalizedLanguageKernelStatus {
  const status = protocolRecord(command, value, "languageKernel");
  const available = protocolBoolean(command, status, "available");
  if (available) {
    exactProtocolFields(command, status, ["available", "schema"], "languageKernel");
    return { available: true, schema: normalizeLanguageKernel(command, status.schema) };
  }
  exactProtocolFields(command, status, ["available", "schema", "reason"], "languageKernel");
  if (status.schema !== null) {
    throw invalidProtocolShape(command, "unavailable languageKernel must have a null schema");
  }
  return {
    available: false,
    schema: null,
    reason: protocolString(command, status, "reason", MAX_TEXT, false),
  };
}

function assertDiagnosticsV2LanguageMetadata(
  command: string,
  methods: readonly RefactorKitMethodCapability[] | undefined,
  languageKernel: NormalizedLanguageKernelStatus | undefined,
): void {
  if (!methods?.some(({ name }) => name === DIAGNOSTICS_V2_METHOD)) return;
  if (!languageKernel?.available) {
    throw invalidProtocolShape(command, "diagnostics.v2 languageKernel is unavailable");
  }
  const { vocabulary, adapters } = languageKernel.schema;
  if (
    vocabulary.diagnosticSnapshotMode === undefined ||
    vocabulary.diagnosticRangeCapability === undefined
  ) {
    throw invalidProtocolShape(command, "diagnostics.v2 vocabulary is unavailable");
  }
  const diagnostics = adapters.flatMap(({ capabilities }) =>
    capabilities.filter(
      ({ operation, backend }) =>
        operation === DIAGNOSTICS_OPERATION && backend === DIAGNOSTICS_V2_BACKEND,
    ),
  );
  if (
    diagnostics.length === 0 ||
    diagnostics.some(
      ({ diagnosticSnapshotModes, diagnosticRangeCapability }) =>
        diagnosticSnapshotModes === undefined ||
        diagnosticSnapshotModes.length !== DIAGNOSTIC_OPERATION_SNAPSHOT_MODES.length ||
        diagnosticSnapshotModes.some(
          (mode, index) => mode !== DIAGNOSTIC_OPERATION_SNAPSHOT_MODES[index],
        ) ||
        diagnosticRangeCapability !== DIAGNOSTIC_RANGE_CAPABILITY,
    )
  ) {
    throw invalidProtocolShape(command, "incoherent diagnostics.v2 language metadata");
  }
}

function normalizeSafety(command: string, value: unknown): RefactorKitSafetyCapabilities {
  const safety = protocolRecord(command, value, "safety");
  exactProtocolFields(
    command,
    safety,
    ["previewBeforeApply", "snapshotValidation", "transactionRollback", "workspaceScopedWrites"],
    "safety",
  );
  return {
    previewBeforeApply: protocolBoolean(command, safety, "previewBeforeApply"),
    snapshotValidation: protocolBoolean(command, safety, "snapshotValidation"),
    transactionRollback: protocolBoolean(command, safety, "transactionRollback"),
    workspaceScopedWrites: protocolBoolean(command, safety, "workspaceScopedWrites"),
  };
}

function normalizeGeneralRefactoring(
  command: string,
  value: unknown,
): RefactorKitGeneralRefactoringCapability {
  // Legacy adapters and daemons that predate the general-refactoring operation set
  // omit generalRefactoring. Surface an honest unavailable advertisement with the
  // canonical operation set still listed and every feature flag false; support is
  // never inferred from a version number, a generic apply button, or the import API.
  if (value === undefined || value === null) {
    return {
      supported: false,
      operations: [...REFACTORING_OPERATIONS],
      preview: false,
      apply: false,
      rollback: false,
      discard: false,
      stability: "experimental",
      reason:
        "RefactorKit general Java refactoring is unavailable. The daemon did not advertise the general-refactoring operation set.",
    };
  }
  const record = protocolRecord(command, value, "generalRefactoring");
  const supported = protocolBoolean(command, record, "supported");
  const operations = strings(command, record.operations, "operations").map((operation) => {
    validateRefactoringOperation(operation, command);
    return operation as RefactoringOperation;
  });
  if (new Set(operations).size !== operations.length) {
    throw invalidProtocolShape(command, "duplicate general refactoring operation");
  }
  if (supported && operations.length === 0) {
    throw invalidProtocolShape(command, "empty supported general refactoring operation set");
  }
  const result: RefactorKitGeneralRefactoringCapability = {
    supported,
    operations,
    preview: protocolBoolean(command, record, "preview"),
    apply: protocolBoolean(command, record, "apply"),
    rollback: protocolBoolean(command, record, "rollback"),
    discard: protocolBoolean(command, record, "discard"),
    stability: enumValue(command, record, "stability", ["experimental", "preview", "stable"]),
  };
  const reason = optionalProtocolString(command, record, "reason");
  const updateGuidance = optionalProtocolString(command, record, "updateGuidance");
  if (reason !== undefined) result.reason = reason;
  if (updateGuidance !== undefined) result.updateGuidance = updateGuidance;
  return result;
}

function normalizeCapabilities(command: string, response: unknown): RefactorKitCapabilities {
  const record = protocolRecord(command, response);
  const capability = protocolRecord(
    command,
    record.javaImportExternalClass,
    "javaImportExternalClass",
  );
  const normalized: RefactorKitCapabilities = {
    api: protocolString(command, record, "api", MAX_TEXT, false),
    apiVersion: protocolString(command, record, "apiVersion", MAX_TEXT, false),
    provider: protocolString(command, record, "provider", MAX_TEXT, false),
    providerVersion: nullableString(command, record, "providerVersion"),
    javaImportExternalClass: {
      supported: protocolBoolean(command, capability, "supported"),
      targetDirectory: protocolBoolean(command, capability, "targetDirectory"),
      preview: protocolBoolean(command, capability, "preview"),
      apply: protocolBoolean(command, capability, "apply"),
      rollback: protocolBoolean(command, capability, "rollback"),
      stability: enumValue(command, capability, "stability", ["experimental", "preview", "stable"]),
    },
    // The daemon always serializes generalRefactoring, so normalize it always.
    generalRefactoring: normalizeGeneralRefactoring(command, record.generalRefactoring),
  };
  if (record.safeDeleteReferenceAnalysis !== undefined) {
    if (record.safeDeleteReferenceAnalysis !== "complete-project")
      throw invalidProtocolShape(command, "invalid safe-delete reference analysis scope");
    normalized.safeDeleteReferenceAnalysis = "complete-project";
  }
  if (Object.prototype.hasOwnProperty.call(record, "methods")) {
    try {
      const methods = normalizeRefactorKitMethodCapabilities(record.methods);
      if (methods !== undefined) normalized.methods = methods;
    } catch {
      throw invalidProtocolShape(command, "invalid method capability metadata");
    }
  }
  if (record.javaContextRefactoring !== undefined) {
    const sdk = protocolRecord(command, record.javaContextRefactoring, "javaContextRefactoring");
    const operations = strings(command, sdk.operations, "javaContextRefactoring.operations");
    if (
      sdk.schemaVersion !== 1 ||
      sdk.requiresExplicitContext !== true ||
      sdk.sourceAuthority !== "saved-snapshot" ||
      operations.length > 64 ||
      operations.some((operation) => !operation || operation.length > 128) ||
      new Set(operations).size !== operations.length
    )
      throw invalidProtocolShape(command, "invalid Java SDK refactoring advertisement");
    normalized.javaContextRefactoring = {
      schemaVersion: 1,
      operations,
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: protocolBoolean(command, sdk, "rollbackAuthority"),
      renderedDiff:
        sdk.renderedDiff === undefined ? false : protocolBoolean(command, sdk, "renderedDiff"),
    };
    if (sdk.editorSelectionSchemaVersion !== undefined)
      normalized.javaContextRefactoring.editorSelectionSchemaVersion = protocolString(
        command,
        sdk,
        "editorSelectionSchemaVersion",
        128,
        false,
      );
    for (const key of ["selectionQueryKind", "selectionSchemaVersion"] as const)
      if (sdk[key] !== undefined)
        normalized.javaContextRefactoring[key] = protocolString(command, sdk, key, 128, false);
    for (const key of [
      "editorPreviewMethod",
      "editorPreviewSchemaVersion",
      "editorTransactionSchemaVersion",
    ] as const)
      if (sdk[key] !== undefined)
        normalized.javaContextRefactoring[key] = protocolString(command, sdk, key, 128, false);
    for (const key of [
      "dirtyEditorPreview",
      "dirtyEditorMutationAuthority",
      "durableEditorRecovery",
    ] as const)
      if (sdk[key] !== undefined)
        normalized.javaContextRefactoring[key] = protocolBoolean(command, sdk, key);
    for (const key of ["editorPreviewOperations", "editorMutationOperations"] as const)
      if (sdk[key] !== undefined) {
        const ops = strings(command, sdk[key], key);
        if (
          ops.length > 64 ||
          new Set(ops).size !== ops.length ||
          ops.some((v) => !v || v.length > 128)
        )
          throw invalidProtocolShape(command, "invalid editor preview operations");
        normalized.javaContextRefactoring[key] = ops;
      }
    const operationCapabilities = normalizeOperationCapabilities(
      command,
      sdk.operationCapabilities,
    );
    if (operationCapabilities !== undefined)
      normalized.javaContextRefactoring.operationCapabilities = operationCapabilities;
  }
  let languageKernel: NormalizedLanguageKernelStatus | undefined;
  if (Object.prototype.hasOwnProperty.call(record, "languageKernel")) {
    languageKernel = normalizeLanguageKernelStatus(command, record.languageKernel);
    normalized.languageKernel = languageKernel;
  }
  assertDiagnosticsV2LanguageMetadata(command, normalized.methods, languageKernel);
  if (Object.prototype.hasOwnProperty.call(record, "safety")) {
    normalized.safety = normalizeSafety(command, record.safety);
  }
  return normalized;
}

function normalizeOperationCapabilities(
  command: string,
  value: unknown,
): NonNullable<RefactorKitCapabilities["javaContextRefactoring"]>["operationCapabilities"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 64) return undefined;
  const normalized: NonNullable<
    RefactorKitCapabilities["javaContextRefactoring"]
  >["operationCapabilities"] = [];
  const moveClassRows = value.filter(
    (candidate) =>
      candidate !== null &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).operation === "moveClass",
  );
  if (moveClassRows.length > 1) return undefined;
  if (moveClassRows.length === 1) {
    const moveClass = moveClassRows[0] as Record<string, unknown>;
    if (moveClass.targetModuleSelection !== undefined) {
      const selection = protocolRecord(
        command,
        moveClass.targetModuleSelection,
        "operationCapabilities.moveClass.targetModuleSelection",
      );
      if (
        selection.schemaVersion !== "java-move-class-target-module-v1" ||
        selection.argument !== "targetModuleId" ||
        selection.identity !== "module-id-within-source-provider" ||
        selection.requiresAvailableContext !== true ||
        selection.sourceSetKind !== "main" ||
        selection.requiresUniqueNonGeneratedRoot !== true
      )
        return undefined;
      normalized.push({
        operation: "moveClass",
        targetModuleSelection: {
          schemaVersion: "java-move-class-target-module-v1",
          argument: "targetModuleId",
          identity: "module-id-within-source-provider",
          requiresAvailableContext: true,
          sourceSetKind: "main",
          requiresUniqueNonGeneratedRoot: true,
        },
      });
    }
  }

  const safeDeleteRows = value.filter(
    (candidate) =>
      candidate !== null &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).operation === "safeDelete",
  );
  if (safeDeleteRows.length > 1) return undefined;
  if (safeDeleteRows.length === 1) {
    const safeDelete = safeDeleteRows[0] as Record<string, unknown>;
    if (safeDelete.referenceAnalysis !== undefined) {
      const analysis = protocolRecord(
        command,
        safeDelete.referenceAnalysis,
        "operationCapabilities.safeDelete.referenceAnalysis",
      );
      if (
        analysis.schemaVersion !== "java-safe-delete-reference-analysis-v1" ||
        analysis.scope !== "workspace-text-v1" ||
        analysis.resultField !== "referenceAnalysis" ||
        !Array.isArray(analysis.statusValues) ||
        analysis.statusValues.length !== 2 ||
        analysis.statusValues[0] !== "complete" ||
        analysis.statusValues[1] !== "incomplete" ||
        analysis.managedApplyAuthority !== "none" ||
        analysis.completeProject !== false
      )
        return undefined;
      normalized.push({
        operation: "safeDelete",
        referenceAnalysis: {
          schemaVersion: "java-safe-delete-reference-analysis-v1",
          scope: "workspace-text-v1",
          resultField: "referenceAnalysis",
          statusValues: ["complete", "incomplete"],
          managedApplyAuthority: "none",
          completeProject: false,
        },
      });
    }
  }
  const addParameterRows = value.filter(
    (candidate) =>
      candidate !== null &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).operation === "changeSignature.addParameter",
  );
  const flags: unknown = addParameterRows[0]?.features;
  if (
    addParameterRows.length === 1 &&
    flags !== null &&
    typeof flags === "object" &&
    !Array.isArray(flags) &&
    Reflect.get(flags, "thisMethodReferenceMigration") === true
  ) {
    normalized.push({
      operation: "changeSignature.addParameter",
      features: { thisMethodReferenceMigration: true },
    });
  }
  const batchRows = value.filter((candidate) =>
    candidate && typeof candidate === "object" && !Array.isArray(candidate) && candidate.operation === "batchCleanup");
  const batchFeatures: unknown = batchRows[0]?.features;
  if (batchRows.length === 1 && batchFeatures && typeof batchFeatures === "object" &&
      !Array.isArray(batchFeatures) && Reflect.get(batchFeatures, "formatterProfile") === true) {
    normalized.push({ operation: "batchCleanup", features: { formatterProfile: true } });
  }
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Surfaces the authoritative real-engine capability report (RealEngineCapabilities)
 * as a provider-neutral RefactorKitCapabilities advertisement plus the engine's own
 * presence/version and CLI operational-surface metadata. Support is authoritative
 * only from the real engine's own report (engineDiscovered + advertised operations);
 * nothing is inferred from the fixture peer, a version string alone, or a visible
 * control. When the engine is not discoverable or reports no operations, the surface
 * is honestly unavailable (supported=false, all feature flags false, reason retained).
 */
function normalizeEngineCapabilities(
  command: string,
  response: unknown,
): TauriRefactorKitEngineCapabilities {
  const record = protocolRecord(command, response);
  const engineDiscovered = protocolBoolean(command, record, "engineDiscovered");
  const operations = strings(command, record.operations, "operations").map((operation) => {
    validateEngineOperation(operation, command);
    return operation;
  });
  if (new Set(operations).size !== operations.length) {
    throw invalidProtocolShape(command, "duplicate engine operation");
  }
  const managedOperations = strings(
    command,
    record.managedOperations ?? [],
    "managedOperations",
  ).map((operation) => {
    validateRefactoringOperation(operation, command);
    if (!operations.includes(operation))
      throw invalidProtocolShape(command, "managed mutation operation is not advertised");
    return operation as RefactoringOperation;
  });
  if (new Set(managedOperations).size !== managedOperations.length) {
    throw invalidProtocolShape(command, "duplicate managed mutation operation");
  }
  const operationalSurface = strings(command, record.operationalSurface, "operationalSurface");
  const rollbackAdvertised = protocolBoolean(command, record, "rollbackAdvertised");
  const previewReadOnly = protocolBoolean(command, record, "previewReadOnly");
  const path = nullableString(command, record, "path");
  const version = nullableString(command, record, "version");
  const workspaceId = protocolId(command, record, "workspaceId");
  const reason = nullableString(command, record, "reason");

  // The real engine advertises both the canonical Java refactoring operation set
  // and, when present, the Java symbol-navigation operations (definition /
  // references). These are distinct capability surfaces: general-refactoring
  // operations stay typed RefactoringOperation[], while definition/references are
  // advertised as a dedicated Java-navigation capability. An engine that advertises
  // only definition/references is honestly unavailable for general refactoring.
  const refactoringOperations = operations.filter((operation): operation is RefactoringOperation =>
    (REFACTORING_OPERATIONS as readonly string[]).includes(operation),
  );
  const navigationOperations = operations.filter(
    (operation): operation is TauriRefactorKitJavaNavigationOperation =>
      (JAVA_NAVIGATION_OPERATIONS as readonly string[]).includes(operation),
  );

  const refactoringSupported = engineDiscovered && refactoringOperations.length > 0;
  const generalRefactoring: RefactorKitGeneralRefactoringCapability = {
    supported: refactoringSupported,
    operations: refactoringOperations,
    preview: refactoringSupported && previewReadOnly,
    apply: refactoringSupported,
    rollback: refactoringSupported && rollbackAdvertised,
    discard: refactoringSupported,
    stability: refactoringSupported ? "stable" : "experimental",
  };
  if (!refactoringSupported && reason !== null) generalRefactoring.reason = reason;

  const navigationSupported = engineDiscovered && navigationOperations.length > 0;
  const javaNavigation: TauriRefactorKitJavaNavigationCapability = {
    supported: navigationSupported,
    operations: navigationOperations,
    stability: "experimental",
  };
  if (!navigationSupported && reason !== null) javaNavigation.reason = reason;
  const normalized: TauriRefactorKitEngineCapabilities = {
    api: "refactorkit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: version,
    javaImportExternalClass: {
      supported: false,
      targetDirectory: false,
      preview: false,
      apply: false,
      rollback: false,
      stability: "experimental",
    },
    generalRefactoring,
    engineDiscovered,
    enginePath: path,
    engineVersion: version,
    operationalSurface,
    workspaceId,
    managedJavaMutationOperations: managedOperations,
  };
  if (navigationOperations.length > 0) {
    normalized.javaNavigation = javaNavigation;
  }
  return deepFreeze(normalized);
}

function affectedFiles(command: string, value: unknown, field: string): RefactorKitAffectedFile[] {
  return array(command, value, field, (record) => {
    const path = validatePath(
      command,
      protocolString(command, record, "path", MAX_PATH, false),
      `${field}.path`,
    );
    const previousPath = optionalProtocolString(command, record, "previousPath", true);
    const result: RefactorKitAffectedFile = {
      change: enumValue(command, record, "change", ["create", "edit", "move", "delete"]),
      path,
      primary: protocolBoolean(command, record, "primary"),
    };
    if (previousPath !== undefined) result.previousPath = previousPath;
    return result;
  });
}

function diagnostics(command: string, value: unknown, field: string): RefactorKitPlanDiagnostic[] {
  return array(command, value, field, (record) => {
    const result: RefactorKitPlanDiagnostic = {
      severity: enumValue(command, record, "severity", ["error", "warning", "information", "hint"]),
      message: protocolString(command, record, "message"),
    };
    const path = optionalProtocolString(command, record, "path", true);
    const code = optionalProtocolString(command, record, "code");
    if (path !== undefined) result.path = path;
    if (code !== undefined) result.code = code;
    if (record.line !== undefined && record.line !== null)
      result.line = integer(command, record, "line", 1);
    if (record.column !== undefined && record.column !== null)
      result.column = integer(command, record, "column", 1);
    if (result.column !== undefined && result.line === undefined) {
      throw invalidProtocolShape(command, `invalid ${field} column without line`);
    }
    return result;
  });
}

function normalizePlan(command: string, response: unknown): RefactorKitPatchPlan {
  const record = protocolRecord(command, response);
  const confidence = record.confidence;
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw invalidProtocolShape(command, "invalid confidence");
  }
  const placement = protocolRecord(command, record.placement, "placement");
  const provenance = protocolRecord(command, record.provenance, "provenance");
  const eligibility = protocolRecord(command, record.applyEligibility, "applyEligibility");
  const staleness = protocolRecord(command, record.staleness, "staleness");

  return {
    planId: protocolId(command, record, "planId"),
    status: enumValue(command, record, "status", ["ready", "refused", "stale", "error"]),
    summary: protocolString(command, record, "summary"),
    confidence,
    riskLevel: enumValue(command, record, "riskLevel", ["low", "medium", "high", "unknown"]),
    evidence: array(command, record.evidence, "evidence", (item) => {
      const normalized: RefactorKitPatchPlan["evidence"][number] = {
        kind: protocolString(command, item, "kind", MAX_TEXT, false),
        summary: protocolString(command, item, "summary"),
      };
      const path = optionalProtocolString(command, item, "path", true);
      const detail = optionalProtocolString(command, item, "detail");
      if (path !== undefined) normalized.path = path;
      if (detail !== undefined) normalized.detail = detail;
      return normalized;
    }),
    affectedFiles: affectedFiles(command, record.affectedFiles, "affectedFiles"),
    placement: {
      packageName: nullableString(command, placement, "packageName"),
      sourceRoot:
        placement.sourceRoot === null
          ? null
          : validatePath(
              command,
              protocolString(command, placement, "sourceRoot", MAX_PATH, false),
              "placement.sourceRoot",
            ),
      moduleName: nullableString(command, placement, "moduleName"),
    },
    packageChanges: array(command, record.packageChanges, "packageChanges", (item) => {
      const normalized: RefactorKitPatchPlan["packageChanges"][number] = {
        fromPackage: nullableString(command, item, "fromPackage"),
        toPackage: nullableString(command, item, "toPackage"),
      };
      const path = optionalProtocolString(command, item, "path", true);
      if (path !== undefined) normalized.path = path;
      return normalized;
    }),
    renderedDiff: protocolString(command, record, "renderedDiff", MAX_DIFF),
    structuredDiff: array(command, record.structuredDiff, "structuredDiff", (item) => ({
      path: validatePath(
        command,
        protocolString(command, item, "path", MAX_PATH, false),
        "structuredDiff.path",
      ),
      change: enumValue(command, item, "change", ["create", "edit", "move", "delete"]),
      hunks: array(command, item.hunks, "structuredDiff.hunks", (hunk) => ({
        oldStart: integer(command, hunk, "oldStart"),
        oldLines: integer(command, hunk, "oldLines"),
        newStart: integer(command, hunk, "newStart"),
        newLines: integer(command, hunk, "newLines"),
        lines: strings(command, hunk.lines, "structuredDiff.hunks.lines"),
      })),
    })),
    warnings: strings(command, record.warnings, "warnings"),
    diagnosticsAfterPreview: diagnostics(
      command,
      record.diagnosticsAfterPreview,
      "diagnosticsAfterPreview",
    ),
    provenance: {
      sourceKind: enumValue(command, provenance, "sourceKind", ["clipboard"]),
      sourceUrl:
        provenance.sourceUrl === null
          ? null
          : (() => {
              throw invalidProtocolShape(command, "invalid provenance.sourceUrl");
            })(),
      detectedLicense: nullableString(command, provenance, "detectedLicense"),
      licensePolicy: enumValue(command, provenance, "licensePolicy", ["warn"]),
      notices: strings(command, provenance.notices, "provenance.notices"),
    },
    unresolvedDependencies: strings(
      command,
      record.unresolvedDependencies,
      "unresolvedDependencies",
    ),
    conflicts: array(command, record.conflicts, "conflicts", (item) => {
      const normalized: RefactorKitPatchPlan["conflicts"][number] = {
        kind: protocolString(command, item, "kind", MAX_TEXT, false),
        summary: protocolString(command, item, "summary"),
      };
      const path = optionalProtocolString(command, item, "path", true);
      if (path !== undefined) normalized.path = path;
      return normalized;
    }),
    refusalReasons: strings(command, record.refusalReasons, "refusalReasons"),
    applyEligibility: {
      eligible: protocolBoolean(command, eligibility, "eligible"),
      blockers: strings(command, eligibility.blockers, "applyEligibility.blockers"),
    },
    staleness: {
      stale: protocolBoolean(command, staleness, "stale"),
      reasons: strings(command, staleness.reasons, "staleness.reasons"),
    },
    provider: protocolString(command, record, "provider", MAX_TEXT, false),
    providerVersion: nullableString(command, record, "providerVersion"),
    workspaceId: protocolId(command, record, "workspaceId"),
    workspaceGeneration: integer(command, record, "workspaceGeneration", 1),
    selectionGeneration: integer(command, record, "selectionGeneration", 1),
    requestId: protocolId(command, record, "requestId"),
  };
}

function normalizeApply(command: string, response: unknown): ApplyRefactorKitPlanResult {
  const record = protocolRecord(command, response);
  const primaryFile =
    record.primaryFile === null
      ? null
      : validatePath(
          command,
          protocolString(command, record, "primaryFile", MAX_PATH, false),
          "primaryFile",
        );
  return {
    transactionId: protocolId(command, record, "transactionId"),
    planId: protocolId(command, record, "planId"),
    changedFiles: affectedFiles(command, record.changedFiles, "changedFiles"),
    primaryFile,
    diagnostics: diagnostics(command, record.diagnostics, "diagnostics"),
    provider: protocolString(command, record, "provider", MAX_TEXT, false),
    providerVersion: nullableString(command, record, "providerVersion"),
  };
}

function normalizeDiscard(command: string, response: unknown): DiscardRefactorKitPlanResult {
  const record = protocolRecord(command, response);
  return {
    planId: protocolId(command, record, "planId"),
    discarded: protocolBoolean(command, record, "discarded"),
  };
}

function normalizeRollback(
  command: string,
  response: unknown,
): RollbackRefactorKitTransactionResult {
  const record = protocolRecord(command, response);
  return {
    transactionId: protocolId(command, record, "transactionId"),
    rolledBack: protocolBoolean(command, record, "rolledBack"),
    changedFiles: affectedFiles(command, record.changedFiles, "changedFiles"),
    diagnostics: diagnostics(command, record.diagnostics, "diagnostics"),
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  if (Object.isFrozen(value)) return value;
  const record = value as Record<PropertyKey, unknown>;
  for (const key of Object.keys(record)) deepFreeze(record[key]);
  Object.freeze(value);
  return value;
}

function validateRefactoringOperation(
  value: string,
  command: string,
  projectContext = false,
): void {
  const operations = projectContext
    ? PROJECT_CONTEXT_REFACTORING_OPERATIONS
    : REFACTORING_OPERATIONS;
  if (!(operations as readonly string[]).includes(value)) {
    throw new TauriAdapterError(command, "Invalid RefactorKit refactoring operation");
  }
}

/** Accepts the canonical Java refactoring operations plus the Java navigation operations. */
function validateEngineOperation(value: string, command: string): void {
  if (
    !(REFACTORING_OPERATIONS as readonly string[]).includes(value) &&
    !(JAVA_NAVIGATION_OPERATIONS as readonly string[]).includes(value)
  ) {
    throw new TauriAdapterError(command, "Invalid RefactorKit engine operation");
  }
}

function validateRefactorTarget(request: RefactoringTarget, command: string): RecordValue {
  const record = request as unknown as RecordValue;
  const target: RecordValue = {
    kind: enumValue(command, record, "kind", REFACTOR_TARGET_KINDS),
    path: validatePath(command, request.path, "path"),
    identity: protocolString(command, record, "identity", MAX_TEXT, false),
  };
  if (request.selection !== undefined) {
    const selection = request.selection;
    if (
      !Number.isSafeInteger(selection.start) ||
      !Number.isSafeInteger(selection.end) ||
      selection.start < 0 ||
      selection.end < 0 ||
      selection.end < selection.start
    ) {
      throw new TauriAdapterError(command, "Invalid RefactorKit refactoring target selection");
    }
    target.selection = { start: selection.start, end: selection.end };
  }
  return target;
}

function validateRefactorAuthority(
  request: RefactorWorkspaceAuthority,
  command: string,
): RecordValue {
  requestId(request.workspaceId, command, "workspaceId");
  requestGeneration(request.workspaceGeneration, command, "workspaceGeneration");
  return {
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
  };
}

function validatePreviewRefactoringRequest(
  request: RefactorPreviewRequest,
  command: string,
): RecordValue {
  validateRefactoringOperation(request.operation, command, request.projectContext !== undefined);
  // RQR-RFK-ENGINE-001: the real-engine request carries an operation-specific
  // changeIntent. An operation that requires intent but is absent, mismatched, or
  // incomplete is honestly refused here (never fabricated, never an empty change
  // descriptor), so the daemon never sees a rename/move/signature preview without
  // its required intent. safe-delete needs no intent and is passed without one.
  const refusal = validateRefactorChangeIntent(request.operation, request.changeIntent);
  if (refusal !== undefined) {
    throw new TauriAdapterError(command, refusal);
  }
  const target = validateRefactorTarget(request.target, command);
  const authority = validateRefactorAuthority(request.authority, command);
  const formatterProfile = request.formatterProfile
    ? validateFormatterProfileSelection(request.formatterProfile, command)
    : undefined;
  if (formatterProfile && (!javaRefactoringFormatsFiles(request.operation, request.changeIntent) || !request.projectContext))
    throw new TauriAdapterError(
      command,
      "An Eclipse formatter profile requires a Java project-context preview with formatting.",
    );
  requestGeneration(request.selectionGeneration, command, "selectionGeneration");
  requestId(request.requestId, command, "requestId");
  const wire: RecordValue = {
    operation: request.operation,
    target,
    authority,
    selectionGeneration: request.selectionGeneration,
    requestId: request.requestId,
  };
  if (request.changeIntent !== undefined) {
    wire.changeIntent = request.changeIntent;
  }
  if (request.projectContext !== undefined) {
    if (!isJavaProjectOperationContext(request.projectContext))
      throw new TauriAdapterError(command, "Invalid Java project context.");
    wire.projectContext = structuredClone(request.projectContext);
  }
  if (formatterProfile !== undefined) wire.formatterProfile = formatterProfile;
  return wire;
}

function validateApplyRefactoringRequest(
  request: RefactorApplyRequest,
  command: string,
): RecordValue {
  validateRefactoringOperation(request.operation, command, request.projectContext !== undefined);
  // RQR-RFK-ENGINE-001: the real-engine apply carries an operation-specific
  // changeIntent. An operation that requires intent but is absent, mismatched, or
  // incomplete is honestly refused here (never fabricated, never an empty change
  // descriptor). safe-delete needs no intent and is passed without one.
  const refusal = validateRefactorChangeIntent(request.operation, request.changeIntent);
  if (refusal !== undefined) {
    throw new TauriAdapterError(command, refusal);
  }
  requestId(request.planId, command, "planId");
  requestId(request.requestId, command, "requestId");
  requestId(request.approval.approvalId, command, "approvalId");
  requestId(request.approval.approvedPlanId, command, "approvedPlanId");
  requestGeneration(request.selectionGeneration, command, "selectionGeneration");
  if (request.approval.approvedPlanId !== request.planId) {
    throw new TauriAdapterError(command, "Approval does not bind the requested RefactorKit plan");
  }
  const timestamp = request.approval.approvedAt;
  if (
    timestamp.length > MAX_ID ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw new TauriAdapterError(command, "Invalid RefactorKit approvedAt timestamp");
  }
  const target = validateRefactorTarget(request.target, command);
  const authority = validateRefactorAuthority(request.authority, command);
  const formatterProfile = request.formatterProfile
    ? validateFormatterProfileSelection(request.formatterProfile, command)
    : undefined;
  const formatterProfileSha256 = request.formatterProfileSha256;
  if (
    (formatterProfile === undefined) !== (formatterProfileSha256 === undefined) ||
    (formatterProfile && (!javaRefactoringFormatsFiles(request.operation, request.changeIntent) || !request.projectContext)) ||
    (formatterProfileSha256 !== undefined &&
      (typeof formatterProfileSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(formatterProfileSha256)))
  )
    throw new TauriAdapterError(command, "Invalid or stale Eclipse formatter profile approval.");
  const wire: RecordValue = {
    planId: request.planId,
    operation: request.operation,
    target,
    authority,
    selectionGeneration: request.selectionGeneration,
    requestId: request.requestId,
    approval: {
      approvalId: request.approval.approvalId,
      approvedPlanId: request.approval.approvedPlanId,
      approvedAt: request.approval.approvedAt,
    },
  };
  if (request.changeIntent !== undefined) {
    wire.changeIntent = request.changeIntent;
  }
  if (request.projectContext !== undefined) {
    if (!isJavaProjectOperationContext(request.projectContext))
      throw new TauriAdapterError(command, "Invalid Java project context.");
    wire.projectContext = structuredClone(request.projectContext);
  }
  if (formatterProfile !== undefined) {
    wire.formatterProfile = formatterProfile;
    wire.formatterProfileSha256 = formatterProfileSha256;
  }
  return wire;
}

function validateRollbackRefactoringRequest(
  request: RefactorRollbackRequest,
  command: string,
): RecordValue {
  validateRefactoringOperation(request.operation, command, request.projectContext !== undefined);
  requestId(request.transactionId, command, "transactionId");
  requestId(request.requestId, command, "requestId");
  const authority = validateRefactorAuthority(request.authority, command);
  const wire: RecordValue = {
    transactionId: request.transactionId,
    operation: request.operation,
    authority,
    requestId: request.requestId,
  };
  if (request.projectContext !== undefined) {
    if (
      !isJavaProjectOperationContext(request.projectContext) ||
      !/^[a-f0-9]{64}$/.test(request.expectedSnapshotHash ?? "")
    )
      throw new TauriAdapterError(command, "Invalid original Java rollback authority.");
    wire.projectContext = structuredClone(request.projectContext);
    wire.expectedSnapshotHash = request.expectedSnapshotHash;
  } else if (request.expectedSnapshotHash !== undefined) {
    throw new TauriAdapterError(command, "Missing original Java rollback context.");
  }
  return wire;
}

function normalizeRefactorTarget(command: string, value: unknown): RefactoringTarget {
  const record = protocolRecord(command, value, "target");
  const target: RefactoringTarget = {
    kind: enumValue(command, record, "kind", REFACTOR_TARGET_KINDS),
    path: validatePath(
      command,
      protocolString(command, record, "path", MAX_PATH, false),
      "target.path",
    ),
    identity: protocolString(command, record, "identity", MAX_TEXT, false),
  };
  if (record.selection !== undefined && record.selection !== null) {
    const selection = protocolRecord(command, record.selection, "target.selection");
    const start = integer(command, selection, "start");
    const end = integer(command, selection, "end");
    if (end < start) throw invalidProtocolShape(command, "invalid target.selection");
    target.selection = { start, end };
  }
  return target;
}

export function normalizeRefactorPreview(
  command: string,
  response: unknown,
): RefactorPreviewResult {
  const record = protocolRecord(command, response);
  const confidence = record.confidence;
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw invalidProtocolShape(command, "invalid confidence");
  }
  if (record.grantsApplyAuthority !== false) {
    throw invalidProtocolShape(command, "invalid grantsApplyAuthority");
  }
  const eligibility = protocolRecord(command, record.applyEligibility, "applyEligibility");
  const staleness = protocolRecord(command, record.staleness, "staleness");
  const authority = protocolRecord(command, record.authority, "authority");
  const result: RefactorPreviewResult = {
    planId: protocolId(command, record, "planId"),
    operation: enumValue(command, record, "operation", PROJECT_CONTEXT_REFACTORING_OPERATIONS),
    target: normalizeRefactorTarget(command, record.target),
    status: enumValue(command, record, "status", ["ready", "refused", "stale", "error"] as const),
    summary: protocolString(command, record, "summary", MAX_TEXT, false),
    confidence,
    riskLevel: enumValue(command, record, "riskLevel", [
      "low",
      "medium",
      "high",
      "unknown",
    ] as const),
    risks: strings(command, record.risks, "risks"),
    evidence: array(command, record.evidence, "evidence", (item) => {
      const normalized: RefactorKitEvidence = {
        kind: protocolString(command, item, "kind", MAX_TEXT, false),
        summary: protocolString(command, item, "summary"),
      };
      const path = optionalProtocolString(command, item, "path", true);
      const detail = optionalProtocolString(command, item, "detail");
      if (path !== undefined) normalized.path = path;
      if (detail !== undefined) normalized.detail = detail;
      return normalized;
    }),
    affectedFiles: affectedFiles(command, record.affectedFiles, "affectedFiles"),
    renderedDiff: protocolString(command, record, "renderedDiff", MAX_DIFF),
    structuredDiff: array(command, record.structuredDiff, "structuredDiff", (item) => ({
      path: validatePath(
        command,
        protocolString(command, item, "path", MAX_PATH, false),
        "structuredDiff.path",
      ),
      change: enumValue(command, item, "change", ["create", "edit", "move", "delete"] as const),
      hunks: array(command, item.hunks, "structuredDiff.hunks", (hunk) => ({
        oldStart: integer(command, hunk, "oldStart"),
        oldLines: integer(command, hunk, "oldLines"),
        newStart: integer(command, hunk, "newStart"),
        newLines: integer(command, hunk, "newLines"),
        lines: strings(command, hunk.lines, "structuredDiff.hunks.lines"),
      })),
    })),
    warnings: strings(command, record.warnings, "warnings"),
    diagnosticsAfterPreview: diagnostics(
      command,
      record.diagnosticsAfterPreview,
      "diagnosticsAfterPreview",
    ),
    conflicts: array(command, record.conflicts, "conflicts", (item) => {
      const normalized: RefactorKitPlanConflict = {
        kind: protocolString(command, item, "kind", MAX_TEXT, false),
        summary: protocolString(command, item, "summary"),
      };
      const path = optionalProtocolString(command, item, "path", true);
      if (path !== undefined) normalized.path = path;
      return normalized;
    }),
    refusalReasons: strings(command, record.refusalReasons, "refusalReasons"),
    applyEligibility: {
      eligible: protocolBoolean(command, eligibility, "eligible"),
      blockers: strings(command, eligibility.blockers, "applyEligibility.blockers"),
    },
    staleness: {
      stale: protocolBoolean(command, staleness, "stale"),
      reasons: strings(command, staleness.reasons, "staleness.reasons"),
    },
    grantsApplyAuthority: false,
    authority: {
      workspaceId: protocolId(command, authority, "workspaceId"),
      workspaceGeneration: integer(command, authority, "workspaceGeneration", 1),
    },
    selectionGeneration: integer(command, record, "selectionGeneration", 1),
    requestId: protocolId(command, record, "requestId"),
    provider: protocolString(command, record, "provider", MAX_TEXT, false),
    providerVersion: nullableString(command, record, "providerVersion"),
  };
  const referenceAnalysis = normalizeRefactorReferenceAnalysis(
    command,
    record.referenceAnalysis,
    result.operation,
  );
  if (referenceAnalysis !== undefined) result.referenceAnalysis = referenceAnalysis;
  if (record.projectContext !== undefined) {
    const context = protocolRecord(command, record.projectContext, "projectContext");
    const projectPath = protocolString(command, context, "projectPath", MAX_PATH);
    if (projectPath !== "") validatePath(command, projectPath, "projectContext.projectPath");
    const contextHash = protocolString(command, context, "contextHash", 64, false);
    const platformIdentities = strings(
      command,
      context.platformIdentities,
      "projectContext.platformIdentities",
    );
    if (
      (context.contextSchemaVersion !== "java-project-context-v1" &&
        context.contextSchemaVersion !== "java-project-context-v2" &&
        context.contextSchemaVersion !== "java-project-context-v3" &&
        context.contextSchemaVersion !== "java-project-context-v4" &&
        context.contextSchemaVersion !== "java-project-context-v5" &&
        context.contextSchemaVersion !== "java-project-context-v6" &&
        context.contextSchemaVersion !== "java-project-context-v7") ||
      !/^[a-f0-9]{64}$/.test(contextHash) ||
      platformIdentities.length === 0 ||
      platformIdentities.length > 256 ||
      platformIdentities.some((hash) => !/^[a-f0-9]{64}$/.test(hash))
    )
      throw invalidProtocolShape(command, "invalid Java project-context attestation");
    result.projectContext = {
      projectPath,
      contextHash,
      contextSchemaVersion: context.contextSchemaVersion,
      platformIdentities,
    };
  }
  const formatterProfilePath = optionalProtocolString(
    command,
    record,
    "formatterProfilePath",
    true,
  );
  const formatterProfileName = optionalProtocolString(command, record, "formatterProfileName");
  const formatterProfileSha256 = optionalProtocolString(command, record, "formatterProfileSha256");
  if (
    formatterProfilePath !== undefined ||
    formatterProfileName !== undefined ||
    formatterProfileSha256 !== undefined
  ) {
    if (
      !formatterProfilePath?.toLowerCase().endsWith(".xml") ||
      !formatterProfileName?.trim() ||
      formatterProfileName.trim() !== formatterProfileName ||
      /[\u0000-\u001f\u007f]/.test(formatterProfileName) ||
      !formatterProfileSha256 ||
      !/^[a-f0-9]{64}$/.test(formatterProfileSha256)
    )
      throw invalidProtocolShape(command, "invalid Eclipse formatter profile attestation");
    result.formatterProfilePath = formatterProfilePath;
    result.formatterProfileName = formatterProfileName;
    result.formatterProfileSha256 = formatterProfileSha256;
  }
  if (record.diffTruncated !== undefined) {
    result.diffTruncated = protocolBoolean(command, record, "diffTruncated");
    result.diffTruncationReasons = strings(
      command,
      record.diffTruncationReasons,
      "diffTruncationReasons",
    );
    if (result.diffTruncated && result.applyEligibility.eligible)
      throw invalidProtocolShape(command, "a truncated Java diff cannot authorize Apply");
  }
  if (record.editorPreview !== undefined) {
    result.editorPreview = normalizeJavaEditorPreviewAuthority(record.editorPreview);
    if (
      result.applyEligibility.eligible &&
      result.editorPreview.mutationMode !== "durable-editor-owned"
    )
      throw invalidProtocolShape(command, "editor plans cannot authorize saved-source Apply");
  }
  return deepFreeze(result);
}

function normalizeRefactorReferenceAnalysis(
  command: string,
  value: unknown,
  operation: RefactoringOperation,
): RefactorPreviewResult["referenceAnalysis"] | undefined {
  if (value === undefined || value === null) return undefined;
  const record = protocolRecord(command, value, "referenceAnalysis");
  if (record.schemaVersion === "java-safe-delete-reference-analysis-v1") {
    if (operation !== "safe-delete")
      throw invalidProtocolShape(command, "unexpected safe-delete reference analysis");
    return normalizeSafeDeleteReferenceAnalysis(command, record);
  }
  if (record.schemaVersion !== "refactorkit-reference-analysis-v1" || operation !== "rename-member")
    throw invalidProtocolShape(command, "unexpected typed reference analysis");
  return normalizeTypedReferenceAnalysis(command, record);
}

function normalizeSafeDeleteReferenceAnalysis(
  command: string,
  record: RecordValue,
): RefactorKitSafeDeleteReferenceAnalysis {
  const boundedCount = (candidate: unknown, maximum: number): number | null => {
    if (candidate === null) return null;
    if (
      typeof candidate !== "number" ||
      !Number.isSafeInteger(candidate) ||
      candidate < 0 ||
      candidate > maximum
    )
      throw invalidProtocolShape(command, "invalid safe-delete reference analysis count");
    return candidate;
  };
  const status = enumValue(command, record, "status", ["complete", "incomplete"] as const);
  const inputCount = boundedCount(record.inputCount, 8_192);
  const verifiedBytes = boundedCount(record.verifiedBytes, 32 * 1024 * 1024);
  const snapshotHash = protocolString(command, record, "snapshotHash", 64, false);
  if (
    record.schemaVersion !== "java-safe-delete-reference-analysis-v1" ||
    record.operation !== "safeDelete" ||
    record.scope !== "workspace-text-v1" ||
    (status === "complete" && (inputCount === null || verifiedBytes === null)) ||
    !/^[a-f0-9]{64}$/.test(snapshotHash) ||
    record.managedApplyAuthority !== "none" ||
    record.completeProject !== false ||
    record.referenceClosure !== "incomplete"
  )
    throw invalidProtocolShape(command, "invalid safe-delete reference analysis attestation");
  return {
    schemaVersion: "java-safe-delete-reference-analysis-v1",
    operation: "safeDelete",
    scope: "workspace-text-v1",
    status,
    inputCount,
    verifiedBytes,
    snapshotHash,
    managedApplyAuthority: "none",
    completeProject: false,
    referenceClosure: "incomplete",
  };
}

function normalizeTypedReferenceAnalysis(
  command: string,
  record: RecordValue,
): RefactorKitTypedReferenceAnalysis {
  const completeness = enumValue(command, record, "completeness", [
    "COMPLETE",
    "INCOMPLETE",
    "UNRESOLVED",
  ] as const);
  const managedWriteAuthority = enumValue(command, record, "managedWriteAuthority", [
    "none",
    "managed-stable",
  ] as const);
  const references: RefactorKitTypedReference[] = array(
    command,
    record.references,
    "referenceAnalysis.references",
    (reference) => {
      const location = protocolRecord(command, reference.location, "reference.location");
      const range = protocolRecord(command, location.range, "reference.location.range");
      const start = protocolRecord(command, range.start, "reference.location.range.start");
      const end = protocolRecord(command, range.end, "reference.location.range.end");
      const startPosition = {
        line: integer(command, start, "line"),
        character: integer(command, start, "character"),
      };
      const endPosition = {
        line: integer(command, end, "line"),
        character: integer(command, end, "character"),
      };
      if (
        endPosition.line < startPosition.line ||
        (endPosition.line === startPosition.line && endPosition.character < startPosition.character)
      )
        throw invalidProtocolShape(command, "invalid typed reference range");
      return {
        languageId: protocolString(command, reference, "languageId", 64, false),
        kind: enumValue(command, reference, "kind", [
          "symbol",
          "framework.entity-property",
          "configuration.value",
        ] as const),
        targetOwner: protocolString(command, reference, "targetOwner", MAX_TEXT, false),
        targetMember: protocolString(command, reference, "targetMember", MAX_TEXT, false),
        location: {
          path: validatePath(
            command,
            protocolString(command, location, "path", MAX_PATH, false),
            "reference.location.path",
          ),
          range: { start: startPosition, end: endPosition },
        },
        resourceKind: enumValue(command, reference, "resourceKind", [
          "source",
          "java.annotation-string",
          "xml",
          "yaml",
          "properties",
          "build-descriptor",
          "generated-source",
          "other",
        ] as const),
        provenance: protocolString(command, reference, "provenance", 256, false),
        completeness: enumValue(command, reference, "completeness", [
          "COMPLETE",
          "INCOMPLETE",
          "UNRESOLVED",
        ] as const),
      };
    },
  );
  const scope = protocolString(command, record, "scope", 256, false);
  if (record.schemaVersion !== "refactorkit-reference-analysis-v1")
    throw invalidProtocolShape(command, "invalid typed reference analysis identity");
  return {
    schemaVersion: "refactorkit-reference-analysis-v1",
    scope,
    completeness,
    completeProject: protocolBoolean(command, record, "completeProject"),
    managedWriteAuthority,
    references,
    warnings: strings(command, record.warnings, "referenceAnalysis.warnings"),
  };
}

function verifyRefactorReferenceAnalysis(
  command: string,
  request: RefactorPreviewRequest,
  result: RefactorPreviewResult,
): void {
  const analysis = result.referenceAnalysis;
  if (!analysis) return;
  if (analysis.schemaVersion === "java-safe-delete-reference-analysis-v1") {
    if (
      request.operation !== "safe-delete" ||
      !request.projectContext ||
      analysis.snapshotHash !== request.projectContext.snapshotHash
    )
      throw invalidProtocolShape(
        command,
        "safe-delete reference analysis does not match the selected Java snapshot",
      );
    return;
  }
  if (request.operation !== "rename-member" || !request.projectContext)
    throw invalidProtocolShape(
      command,
      "typed reference analysis requires a saved Java member rename context",
    );
  if (
    (!analysis.completeProject ||
      analysis.completeness !== "COMPLETE" ||
      analysis.managedWriteAuthority !== "managed-stable" ||
      analysis.references.some((reference) => reference.completeness !== "COMPLETE")) &&
    result.applyEligibility.eligible
  )
    throw invalidProtocolShape(
      command,
      "incomplete typed reference analysis cannot advertise managed Apply",
    );
}

export function normalizeRefactorApply(command: string, response: unknown): RefactorApplyResult {
  const record = protocolRecord(command, response);
  const primaryFile =
    record.primaryFile === null
      ? null
      : validatePath(
          command,
          protocolString(command, record, "primaryFile", MAX_PATH, false),
          "primaryFile",
        );
  const result: RefactorApplyResult = {
    planId: protocolId(command, record, "planId"),
    operation: enumValue(command, record, "operation", PROJECT_CONTEXT_REFACTORING_OPERATIONS),
    outcome: enumValue(command, record, "outcome", REFACTOR_APPLY_OUTCOMES),
    changedFiles: affectedFiles(command, record.changedFiles, "changedFiles"),
    primaryFile,
    diagnostics: diagnostics(command, record.diagnostics, "diagnostics"),
    provider: protocolString(command, record, "provider", MAX_TEXT, false),
    providerVersion: nullableString(command, record, "providerVersion"),
  };
  if (Object.prototype.hasOwnProperty.call(record, "transactionId")) {
    result.transactionId = protocolId(command, record, "transactionId");
  }
  if (record.appliedSnapshotHash !== undefined) {
    const snapshot = protocolString(command, record, "appliedSnapshotHash", 64, false);
    if (!/^[a-f0-9]{64}$/.test(snapshot))
      throw invalidProtocolShape(command, "invalid post-apply Java snapshot");
    result.appliedSnapshotHash = snapshot;
  }
  return result;
}

export function normalizeRefactorRollback(
  command: string,
  response: unknown,
): RefactorRollbackResult {
  const record = protocolRecord(command, response);
  const result: RefactorRollbackResult = {
    transactionId: protocolId(command, record, "transactionId"),
    rolledBack: protocolBoolean(command, record, "rolledBack"),
    changedFiles: affectedFiles(command, record.changedFiles, "changedFiles"),
    conflicts: array(command, record.conflicts, "conflicts", (item) => {
      const normalized: RefactorKitPlanConflict = {
        kind: protocolString(command, item, "kind", MAX_TEXT, false),
        summary: protocolString(command, item, "summary"),
      };
      const path = optionalProtocolString(command, item, "path", true);
      if (path !== undefined) normalized.path = path;
      return normalized;
    }),
    diagnostics: diagnostics(command, record.diagnostics, "diagnostics"),
  };
  for (const field of ["rolledBackContextHash", "restoredSnapshotHash"] as const) {
    if (record[field] !== undefined) {
      const value = protocolString(command, record, field, 64, false);
      if (!/^[a-f0-9]{64}$/.test(value))
        throw invalidProtocolShape(command, `invalid Java rollback ${field}`);
      result[field] = value;
    }
  }
  return result;
}

// Existing fixed-command normalization.
function requireRecord(command: string, value: unknown): RecordValue {
  if (!isRecord(value)) throw invalidShape(command, "expected object", value);
  return value;
}
function requireString(
  command: string,
  response: unknown,
  record: RecordValue,
  field: string,
): string {
  if (typeof record[field] !== "string")
    throw invalidShape(command, `missing string ${field}`, response);
  return record[field];
}
function requireBoolean(
  command: string,
  response: unknown,
  record: RecordValue,
  field: string,
): boolean {
  if (typeof record[field] !== "boolean")
    throw invalidShape(command, `missing boolean ${field}`, response);
  return record[field];
}
function requireInteger(
  command: string,
  response: unknown,
  record: RecordValue,
  field: string,
): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isInteger(value))
    throw invalidShape(command, `missing integer ${field}`, response);
  return value;
}
function optionalString(
  command: string,
  response: unknown,
  record: RecordValue,
  field: string,
): string | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalidShape(command, `invalid string ${field}`, response);
  return value;
}
function legacyStrings(
  command: string,
  response: unknown,
  value: unknown,
  field: string,
): string[] {
  if (!Array.isArray(value)) throw invalidShape(command, `missing string array ${field}`, response);
  return value.map((item, index) => {
    if (typeof item !== "string")
      throw invalidShape(command, `invalid string ${field}[${index}]`, response);
    return item;
  });
}
function normalizeLocations(
  command: string,
  response: unknown,
  value: unknown,
): RefactorKitCommandResult["locations"] {
  if (!Array.isArray(value)) throw invalidShape(command, "missing locations array", response);
  return value.map((location, index) => {
    if (!isRecord(location))
      throw invalidShape(command, `invalid locations[${index}] object`, response);
    const path = location.path;
    const line = location.line;
    const column = location.column;
    if (typeof path !== "string" || path.length === 0)
      throw invalidShape(command, `invalid locations[${index}].path`, response);
    if (typeof line !== "number" || !Number.isInteger(line) || line <= 0)
      throw invalidShape(command, `invalid locations[${index}].line`, response);
    if (
      column !== undefined &&
      (typeof column !== "number" || !Number.isInteger(column) || column <= 0)
    ) {
      throw invalidShape(command, `invalid locations[${index}].column`, response);
    }
    return column === undefined ? { path, line } : { path, line, column };
  });
}
function normalizeStatus(command: string, response: unknown): RefactorKitStatus {
  const record = requireRecord(command, response);
  const status: RefactorKitStatus = {
    available: requireBoolean(command, response, record, "available"),
  };
  for (const field of ["path", "version", "lastError", "checkedAt"] as const) {
    const value = optionalString(command, response, record, field);
    if (value !== undefined) status[field] = value;
  }
  return status;
}
/**
 * Normalizes a real-engine structural command result (RealEngineCommandResult)
 * into the provider-neutral RefactorKitCommandResult. The engine serializes
 * `command` as a string array (not an object with executable/args) and also
 * carries engine/engineVersion metadata that callers of the port contract do not
 * read; those extra fields are dropped. RQR-RFK-ENGINE-004: this is the shape
 * returned by the NEW run_refactorkit_engine_scan/symbols/definition/references/
 * diagnostics commands.
 */
function normalizeEngineCommandResult(
  command: string,
  response: unknown,
): RefactorKitCommandResult {
  const record = requireRecord(command, response);
  return {
    stdout: requireString(command, response, record, "stdout"),
    stderr: requireString(command, response, record, "stderr"),
    locations: normalizeLocations(command, response, record.locations),
    success: requireBoolean(command, response, record, "success"),
    code: requireInteger(command, response, record, "code"),
    timedOut: requireBoolean(command, response, record, "timedOut"),
    stdoutTruncated: requireBoolean(command, response, record, "stdoutTruncated"),
    stderrTruncated: requireBoolean(command, response, record, "stderrTruncated"),
    command: legacyStrings(command, response, record.command, "command"),
  };
}

/**
 * The real-engine capability surface returned by getCapabilities(): the
 * provider-neutral RefactorKitCapabilities advertisement plus the engine's own
 * presence/version and CLI operational-surface metadata. Backward-compatible
 * with callers that read only the base RefactorKitCapabilities shape.
 */
/** The canonical Java symbol-navigation operation set the real engine advertises. */
export type TauriRefactorKitJavaNavigationOperation = "definition" | "references";

/** The real-engine Java symbol-navigation capability advertisement (capability-before-offer). */
export interface TauriRefactorKitJavaNavigationCapability {
  supported: boolean;
  /** The canonical Java navigation operation set the engine authoritatively advertises. */
  operations: TauriRefactorKitJavaNavigationOperation[];
  stability: "experimental" | "preview" | "stable";
  /** Honest unavailable reason when `supported` is false. */
  reason?: string;
}

export interface TauriRefactorKitEngineCapabilities extends RefactorKitCapabilities {
  /** Whether a real engine was discovered through a wrapper PATH or installed path. */
  engineDiscovered: boolean;
  /** Absolute path of the discovered real engine, when present. */
  enginePath: string | null;
  /** Version reported by the discovered real engine, when present. */
  engineVersion: string | null;
  /** The CLI operational surface the real engine authoritatively advertises. */
  operationalSurface: string[];
  /** The real-engine Java symbol-navigation capability advertisement, when advertised. */
  javaNavigation?: TauriRefactorKitJavaNavigationCapability;
  /** The workspace the real-engine capability report is correlated to. */
  workspaceId: string;
}

export class TauriRefactorKitAdapter implements RefactorKitPort {
  private readonly editorPlans = new Set<string>();
  private readonly editorMutationPlans = new Map<
    string,
    {
      planHash: string;
      contextHash: string;
      snapshotHash: string;
      formatterProfile?: JavaFormatterProfile;
      formatterProfileSha256?: string;
    }
  >();
  private readonly sdkPlans = new Set<string>();
  private readonly mavenModuleRenamePlans = new Map<
    string,
    Pick<
      MavenModuleRenameDiscardRequest,
      "workspaceId" | "workspaceGeneration" | "selectionGeneration" | "requestId"
    >
  >();
  private readonly mavenModuleRenameTransactions = new Map<
    string,
    Pick<MavenModuleRenameRollbackRequest, "workspaceId" | "workspaceGeneration">
  >();
  private currentSavedSnapshotSymbolSearchResult:
    Readonly<SavedSnapshotSymbolSearchResult> | undefined;
  private savedSnapshotSearchSequence = 0;

  async getStatus(): Promise<RefactorKitStatus> {
    const command = "get_refactorkit_status";
    return normalizeStatus(command, await invokeTauri<unknown>(command));
  }

  async getCapabilities(): Promise<TauriRefactorKitEngineCapabilities> {
    // generalRefactoring is authoritative from the real engine's own capability
    // report; the base daemon surface (external-import, language-kernel, methods,
    // safety) is preserved alongside engine presence/version + operational surface.
    const engineCommand = "get_refactorkit_engine_capabilities";
    const engine = normalizeEngineCapabilities(engineCommand, await invokeManaged(engineCommand));
    const baseCommand = "get_refactorkit_capabilities";
    const base = normalizeCapabilities(baseCommand, await invokeManaged(baseCommand));
    const merged: TauriRefactorKitEngineCapabilities = {
      ...base,
      generalRefactoring: engine.generalRefactoring,
      managedJavaMutationOperations: engine.managedJavaMutationOperations,
      engineDiscovered: engine.engineDiscovered,
      enginePath: engine.enginePath,
      engineVersion: engine.engineVersion,
      operationalSurface: engine.operationalSurface,
      workspaceId: engine.workspaceId,
    };
    if (engine.javaNavigation !== undefined) merged.javaNavigation = engine.javaNavigation;
    return deepFreeze(merged);
  }

  async scan(): Promise<RefactorKitCommandResult> {
    return this.runAction("run_refactorkit_engine_scan");
  }
  async diagnostics(request: TypeScriptDiagnosticsRequest): Promise<TypeScriptDiagnosticsResponse> {
    const command = "run_refactorkit_diagnostics";
    const candidate = await invokeTauri<unknown>(command, { request });
    const decision = normalizeTypeScriptDiagnosticsResponse(
      diagnosticsNormalizationInput(command, request, candidate),
    );
    if (decision.kind === "rejected") {
      throw diagnosticsResponseError(command, decision.reason);
    }
    return decision.response;
  }
  async symbols(): Promise<RefactorKitCommandResult> {
    return this.runAction("run_refactorkit_engine_symbols");
  }

  async definition(symbol: string): Promise<RefactorKitCommandResult> {
    const command = "run_refactorkit_engine_definition";
    return normalizeEngineCommandResult(command, await invokeTauri<unknown>(command, { symbol }));
  }

  async references(symbol: string): Promise<RefactorKitCommandResult> {
    const command = "run_refactorkit_engine_references";
    return normalizeEngineCommandResult(command, await invokeTauri<unknown>(command, { symbol }));
  }

  async startSavedSnapshotSemanticSession(
    request: SavedSnapshotSemanticSessionStartRequest,
  ): Promise<SavedSnapshotSemanticSessionStartResult> {
    const command = "start_refactorkit_saved_snapshot_semantic_session";
    const exactRequest = enforceSemanticSessionBoundary(
      command,
      "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED",
      () => validateSemanticSessionStartRequest(request, command),
    );
    this.currentSavedSnapshotSymbolSearchResult = undefined;
    ++this.savedSnapshotSearchSequence;
    const response = await invokeSemanticSession(
      command,
      exactRequest,
      "REFACTORKIT_SEMANTIC_SESSION_START_FAILED",
    );
    const candidate = enforceSemanticSessionBoundary(
      command,
      "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
      () => parseSemanticSessionStartCandidate(command, response),
    );
    const decision = normalizeSavedSnapshotSemanticSessionStartResult({
      request: exactRequest,
      candidate,
    });
    if (decision.kind === "refused") {
      throw semanticSessionError(command, "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED");
    }
    return decision.result;
  }

  async stopSavedSnapshotSemanticSession(
    request: SavedSnapshotSemanticSessionStopRequest,
  ): Promise<SavedSnapshotSemanticSessionStopResult> {
    const command = "stop_refactorkit_saved_snapshot_semantic_session";
    const exactRequest = enforceSemanticSessionBoundary(
      command,
      "REFACTORKIT_SEMANTIC_SESSION_STOP_REQUEST_REJECTED",
      () => validateSemanticSessionStopRequest(request, command),
    );
    const response = await invokeSemanticSession(
      command,
      exactRequest,
      "REFACTORKIT_SEMANTIC_SESSION_STOP_FAILED",
    );
    const candidate = enforceSemanticSessionBoundary(
      command,
      "REFACTORKIT_SEMANTIC_SESSION_STOP_RESPONSE_REJECTED",
      () => parseSemanticSessionStopCandidate(command, response),
    );
    const decision = normalizeSavedSnapshotSemanticSessionStopResult({
      request: exactRequest,
      candidate,
    });
    if (decision.kind === "refused") {
      throw semanticSessionError(command, "REFACTORKIT_SEMANTIC_SESSION_STOP_RESPONSE_REJECTED");
    }
    if (
      decision.result.stopped &&
      this.currentSavedSnapshotSymbolSearchResult?.languageId === decision.result.languageId &&
      this.currentSavedSnapshotSymbolSearchResult.workspaceId === decision.result.workspaceId &&
      this.currentSavedSnapshotSymbolSearchResult.workspaceGeneration ===
        decision.result.workspaceGeneration &&
      this.currentSavedSnapshotSymbolSearchResult.sessionId === decision.result.sessionId
    ) {
      this.currentSavedSnapshotSymbolSearchResult = undefined;
      ++this.savedSnapshotSearchSequence;
    }
    return decision.result;
  }

  async searchSavedSnapshotSymbols(
    request: SavedSnapshotSymbolSearchRequest,
  ): Promise<SavedSnapshotSymbolSearchResult> {
    const command = "search_refactorkit_saved_snapshot_symbols";
    const exactRequest = validateSearchRequest(request, command);
    const sequence = ++this.savedSnapshotSearchSequence;
    this.currentSavedSnapshotSymbolSearchResult = undefined;
    const candidate = parseSearchCandidate(
      command,
      await invokeSymbolNavigation(command, exactRequest, "REFACTORKIT_SYMBOL_SEARCH_FAILED"),
    );
    const decision = normalizeSavedSnapshotSymbolSearchResult({
      request: exactRequest,
      candidate,
    });
    if (decision.kind === "refused") {
      throw symbolNavigationError(command, "REFACTORKIT_SYMBOL_SEARCH_RESPONSE_REJECTED");
    }
    if (sequence === this.savedSnapshotSearchSequence) {
      this.currentSavedSnapshotSymbolSearchResult = decision.result;
    }
    return decision.result;
  }

  async resolveSavedSnapshotDefinition(
    request: SavedSnapshotDefinitionRequest,
  ): Promise<SavedSnapshotDefinitionResult> {
    const command = "resolve_refactorkit_saved_snapshot_definition";
    const exactRequest = validateDefinitionRequest(request, command);
    const currentSearchResult = this.currentSavedSnapshotSymbolSearchResult;
    if (!currentSearchResult || !definitionAuthorityMatches(exactRequest, currentSearchResult)) {
      throw invalidSymbolNavigationRequest(command);
    }
    const selectedSymbol = currentSearchResult.symbols.find(
      ({ id }) => id === exactRequest.symbolId,
    );
    if (!selectedSymbol) throw invalidSymbolNavigationRequest(command);

    const candidate = parseDefinitionCandidate(
      command,
      await invokeSymbolNavigation(command, exactRequest, "REFACTORKIT_DEFINITION_FAILED"),
    );
    const decision = normalizeSavedSnapshotDefinitionResult({
      request: exactRequest,
      currentSearchResult,
      selectedSymbol,
      candidate,
    });
    if (decision.kind === "refused") {
      throw symbolNavigationError(command, "REFACTORKIT_DEFINITION_RESPONSE_REJECTED");
    }
    return decision.result;
  }

  async previewExternalJavaImport(
    request: PreviewExternalJavaImportRequest,
  ): Promise<RefactorKitPatchPlan> {
    const command = "preview_refactorkit_external_java_import";
    validatePreviewRequest(request, command);
    const exactRequest = {
      code: request.code,
      targetDirectory: request.targetDirectory,
      sourceKind: request.sourceKind,
      sourceUrl: request.sourceUrl,
      licensePolicy: request.licensePolicy,
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
    };
    return normalizePlan(command, await invokeManaged(command, exactRequest));
  }

  async applyPlan(request: ApplyRefactorKitPlanRequest): Promise<ApplyRefactorKitPlanResult> {
    const command = "apply_refactorkit_plan";
    validateApplyRequest(request, command);
    const exactRequest = {
      planId: request.planId,
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
      approval: {
        approvalId: request.approval.approvalId,
        approvedPlanId: request.approval.approvedPlanId,
        approvedAt: request.approval.approvedAt,
      },
    };
    const result = normalizeApply(command, await invokeManaged(command, exactRequest));
    if (result.planId !== request.planId) {
      throw invalidProtocolShape(command, "response planId does not match the requested plan");
    }
    return result;
  }

  async rollbackTransaction(
    request: RollbackRefactorKitTransactionRequest,
  ): Promise<RollbackRefactorKitTransactionResult> {
    const command = "rollback_refactorkit_transaction";
    validateRollbackRequest(request, command);
    const exactRequest = {
      transactionId: request.transactionId,
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      requestId: request.requestId,
    };
    const result = normalizeRollback(command, await invokeManaged(command, exactRequest));
    if (result.transactionId !== request.transactionId) {
      throw invalidProtocolShape(
        command,
        "response transactionId does not match the requested transaction",
      );
    }
    return result;
  }

  async discardPlan(request: DiscardRefactorKitPlanRequest): Promise<DiscardRefactorKitPlanResult> {
    const command = "discard_refactorkit_plan";
    validateDiscardRequest(request, command);
    const exactRequest = {
      planId: request.planId,
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
    };
    const result = normalizeDiscard(command, await invokeManaged(command, exactRequest));
    if (result.planId !== request.planId) {
      throw invalidProtocolShape(command, "response planId does not match the requested plan");
    }
    return result;
  }

  async previewMavenModuleRename(
    request: MavenModuleRenamePreviewRequest,
  ): Promise<MavenModuleRenamePreview> {
    const command = "preview_refactorkit_maven_module_rename";
    const exactRequest = validateMavenModuleRenamePreviewRequest(request, command);
    const capabilities = await this.getCapabilities();
    if (!mavenModuleRenamePreviewOffered(capabilities))
      throw new TauriAdapterError(
        command,
        "RefactorKit does not advertise Maven module rename preview with a rendered diff.",
      );
    if (
      (exactRequest.oldModuleDir.includes("/") || exactRequest.newModuleDir.includes("/")) &&
      !mavenModuleRenamePreviewOffered(capabilities, true)
    )
      throw new TauriAdapterError(
        command,
        "This RefactorKit runtime supports Maven module renames between direct children of the reactor root.",
      );
    const result = normalizeMavenModuleRenamePreview(
      command,
      await invokeManaged(command, { ...exactRequest }),
    );
    if (
      result.snapshotHash !== request.expectedSnapshotHash ||
      result.workspaceId !== request.workspaceId ||
      result.workspaceGeneration !== request.workspaceGeneration ||
      result.selectionGeneration !== request.selectionGeneration ||
      result.requestId !== request.requestId
    )
      throw invalidProtocolShape(
        command,
        "response does not match the requested workspace authority",
      );
    this.mavenModuleRenamePlans.set(result.planId, {
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
    });
    return deepFreeze(result);
  }

  async discardMavenModuleRenamePreview(
    request: MavenModuleRenameDiscardRequest,
  ): Promise<boolean> {
    const command = "discard_refactorkit_maven_module_rename_preview";
    const reviewed = this.mavenModuleRenamePlans.get(request.planId);
    if (
      !reviewed ||
      reviewed.workspaceId !== request.workspaceId ||
      reviewed.workspaceGeneration !== request.workspaceGeneration ||
      reviewed.selectionGeneration !== request.selectionGeneration ||
      reviewed.requestId !== request.requestId
    )
      throw new TauriAdapterError(command, "Maven module rename preview is stale or unknown.");
    validateDiscardRequest(request, command);
    const exactRequest = {
      planId: request.planId,
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
    };
    const result = normalizeDiscard(command, await invokeManaged(command, exactRequest));
    if (result.planId !== request.planId)
      throw invalidProtocolShape(command, "response planId does not match the requested plan");
    this.mavenModuleRenamePlans.delete(request.planId);
    return result.discarded;
  }

  async applyMavenModuleRename(
    request: MavenModuleRenameApplyRequest,
  ): Promise<MavenModuleRenameApplyResult> {
    const command = "apply_refactorkit_maven_module_rename";
    const reviewed = this.mavenModuleRenamePlans.get(request.planId);
    if (
      !reviewed ||
      reviewed.workspaceId !== request.workspaceId ||
      reviewed.workspaceGeneration !== request.workspaceGeneration ||
      reviewed.selectionGeneration !== request.selectionGeneration ||
      reviewed.requestId !== request.requestId
    )
      throw new TauriAdapterError(command, "Maven module rename preview is stale or unknown.");
    validateApplyRequest(request, command);
    if (!mavenModuleRenameApplyOffered(await this.getCapabilities()))
      throw new TauriAdapterError(
        command,
        "RefactorKit does not advertise managed Maven module rename Apply and Rollback.",
      );
    let result: MavenModuleRenameApplyResult;
    try {
      result = normalizeMavenModuleRenameApply(
        command,
        await invokeManaged(command, { ...request, approval: { ...request.approval } }),
      );
    } catch (error) {
      // The daemon may have committed before transport or response validation failed.
      this.mavenModuleRenamePlans.delete(request.planId);
      throw error;
    }
    if (result.planId !== request.planId)
      throw invalidProtocolShape(command, "response does not match the reviewed plan");
    this.mavenModuleRenamePlans.delete(request.planId);
    this.mavenModuleRenameTransactions.set(result.transactionId, {
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
    });
    return deepFreeze(result);
  }

  async rollbackMavenModuleRename(
    request: MavenModuleRenameRollbackRequest,
  ): Promise<MavenModuleRenameRollbackResult> {
    const command = "rollback_refactorkit_maven_module_rename";
    const reviewed = this.mavenModuleRenameTransactions.get(request.transactionId);
    if (
      !reviewed ||
      reviewed.workspaceId !== request.workspaceId ||
      reviewed.workspaceGeneration !== request.workspaceGeneration
    )
      throw new TauriAdapterError(command, "Maven module rename transaction is stale or unknown.");
    validateRollbackRequest(request, command);
    const exactRequest = {
      transactionId: request.transactionId,
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      requestId: request.requestId,
    };
    const result = normalizeMavenModuleRenameRollback(
      command,
      await invokeManaged(command, exactRequest),
    );
    if (result.transactionId !== request.transactionId)
      throw invalidProtocolShape(command, "response does not match the requested transaction");
    if (result.rolledBack) this.mavenModuleRenameTransactions.delete(request.transactionId);
    return deepFreeze(result);
  }

  // Capability-before-offer: general Java refactoring is offered only when the
  // daemon explicitly advertises the operation set and the requested feature. The
  // adapter never infers support from a version number, a generic apply button, or
  // the import API. This gate fetches the authoritative capabilities advertisement
  // and refuses (throws) before any refactoring command is invoked when the
  // capability is not supported, the specific operation is not advertised, or the
  // specific feature flag (preview/apply/rollback/discard) is not advertised.
  private async requireGeneralRefactoringFeature(
    command: string,
    operation: RefactoringOperation | undefined,
    feature: "preview" | "apply" | "rollback" | "discard",
  ): Promise<void> {
    const capabilities = await this.getCapabilities();
    const general = capabilities.generalRefactoring;
    if (!general || !general.supported) {
      throw new TauriAdapterError(
        command,
        "RefactorKit general Java refactoring is unavailable. The daemon did not advertise the general-refactoring operation set.",
      );
    }
    if (operation !== undefined && !general.operations.includes(operation)) {
      throw new TauriAdapterError(
        command,
        `RefactorKit general Java refactoring operation ${operation} is not advertised by the daemon.`,
      );
    }
    if (!general[feature]) {
      throw new TauriAdapterError(
        command,
        `RefactorKit general Java refactoring ${feature} is not advertised by the daemon.`,
      );
    }
    if (
      feature === "apply" &&
      operation !== undefined &&
      !javaRefactoringMutationAuthorized(capabilities, operation)
    ) {
      throw new TauriAdapterError(
        command,
        `RefactorKit does not advertise managed mutation authority for Java refactoring operation ${operation}.`,
      );
    }
  }

  private async requireJavaContextRefactoringFeature(
    command: string,
    operation: RefactoringOperation,
    feature: "preview" | "apply" | "rollback",
  ): Promise<void> {
    if (!javaContextRefactoringOffered(await this.getCapabilities(), operation, feature))
      throw new TauriAdapterError(
        command,
        "RefactorKit does not advertise this operation with the selected Java project context. Update the daemon and refresh capabilities.",
      );
  }

  async previewRefactoring(request: RefactorPreviewRequest): Promise<RefactorPreviewResult> {
    if (request.operation === "batch-cleanup" &&
        (!request.projectContext || request.editorOverlay || request.target.selection ||
         request.changeIntent?.operation !== "batch-cleanup" ||
         request.changeIntent.actions?.[0]?.path !== request.target.path))
      throw new TauriAdapterError("preview_refactorkit_engine_refactoring", "Batch cleanup requires a saved project context and its first selected file as target.");
    if (request.editorOverlay) {
      const command = "query_refactorkit_java_navigation";
      validatePreviewRefactoringRequest(request, command);
      const wire = javaEditorPreviewWire(request);
      if (!javaEditorRefactoringPreviewOffered(await this.getCapabilities(), request.operation))
        throw new TauriAdapterError(
          command,
          "RefactorKit does not advertise Java draft selection and preview.",
        );
      if (
        request.editorMutationMode &&
        !javaEditorMutationOffered(await this.getCapabilities(), request.operation)
      )
        throw new Error("Durable editor mutation is unavailable for this operation.");
      const response = await invokeTauri<unknown>(command, { request: wire });
      const record = protocolRecord(command, response);
      if (record.status === "refused" || record.status === "unavailable") {
        if (
          record.workspaceId !== wire.workspaceId ||
          record.generation !== wire.generation ||
          record.requestId !== wire.requestId ||
          record.kind !== wire.kind ||
          record.documentPath !== wire.document.path ||
          record.documentVersion !== wire.document.version ||
          (record.projectContextRetired !== undefined && record.projectContextRetired !== true)
        )
          throw invalidProtocolShape(command, "uncorrelated Java draft refusal");
        const message = protocolString(command, record, "message", 4096, false);
        if (record.projectContextRetired === true)
          throw new JavaProjectContextRetiredError(
            `${message} The Java project session was retired. Synchronize the project before trying again.`,
          );
        throw new TauriAdapterError(command, message);
      }
      const result = normalizeRefactorPreview(command, response);
      verifyFormatterProfileAttestation(command, request.formatterProfile, result);
      if (!javaProjectContextAttestationMatches(request.projectContext, result.projectContext))
        throw invalidProtocolShape(command, "draft preview does not attest the selected SDK");
      verifyRefactorReferenceAnalysis(command, request, result);
      await verifyJavaEditorPreview(result, request);
      this.editorPlans.add(result.planId);
      if (result.editorPreview?.mutationMode === "durable-editor-owned" && request.projectContext)
        this.editorMutationPlans.set(result.planId, {
          planHash: result.editorPreview.planHash,
          contextHash: request.projectContext.contextHash,
          snapshotHash: request.projectContext.snapshotHash,
          ...(request.formatterProfile
            ? { formatterProfile: structuredClone(request.formatterProfile) }
            : {}),
          ...(result.formatterProfileSha256
            ? { formatterProfileSha256: result.formatterProfileSha256 }
            : {}),
        });
      return deepFreeze(result);
    }
    const command = "preview_refactorkit_engine_refactoring";
    const exactRequest = validatePreviewRefactoringRequest(request, command);
    if (request.projectContext)
      await this.requireJavaContextRefactoringFeature(command, request.operation, "preview");
    else await this.requireGeneralRefactoringFeature(command, request.operation, "preview");
    const response = await invokeManaged(command, exactRequest);
    const result = normalizeRefactorPreview(command, response);
    verifyFormatterProfileAttestation(command, request.formatterProfile, result);
    if (request.projectContext && typeof result.diffTruncated !== "boolean")
      throw invalidProtocolShape(command, "missing Java diff completeness evidence");
    if (!javaProjectContextAttestationMatches(request.projectContext, result.projectContext))
      throw invalidProtocolShape(
        command,
        "response does not attest the selected Java project context",
      );
    verifyRefactorReferenceAnalysis(command, request, result);
    if (request.projectContext) this.sdkPlans.add(result.planId);
    return deepFreeze(result);
  }

  async editorTransaction(
    request: JavaEditorTransactionRequest,
  ): Promise<JavaEditorTransactionResult> {
    const capabilities = await this.getCapabilities();
    if (
      !["rename-class", "rename-member", "format-file", "organize-imports"].some((operation) =>
        javaEditorMutationOffered(capabilities, operation as RefactoringOperation),
      )
    )
      throw new Error("RefactorKit does not advertise durable Java editor transactions.");
    if (request.phase === "prepare" || request.phase === "confirm") {
      const review = this.editorMutationPlans.get(request.planId ?? "");
      if (
        !review ||
        review.planHash !== request.approvedPlanHash ||
        review.contextHash !== request.projectContext.contextHash ||
        review.snapshotHash !== request.projectContext.snapshotHash ||
        review.formatterProfileSha256 !== request.formatterProfileSha256 ||
        JSON.stringify(review.formatterProfile) !== JSON.stringify(request.formatterProfile)
      )
        throw new Error(
          "Review and approve the exact durable Java editor plan before applying it.",
        );
    }
    return invokeJavaEditorTransaction(request);
  }

  async applyRefactoring(request: RefactorApplyRequest): Promise<RefactorApplyResult> {
    if (this.editorPlans.has(request.planId))
      throw new Error("Applying a draft preview is unavailable.");
    const command = "apply_refactorkit_engine_refactoring";
    const exactRequest = validateApplyRefactoringRequest(request, command);
    if (request.projectContext)
      await this.requireJavaContextRefactoringFeature(command, request.operation, "apply");
    else await this.requireGeneralRefactoringFeature(command, request.operation, "apply");
    const response = await invokeManaged(command, exactRequest);
    const result = normalizeRefactorApply(command, response);
    if (request.projectContext && result.outcome === "applied") {
      const contextHash = protocolRecord(command, response).appliedContextHash;
      if (contextHash !== request.projectContext.contextHash || !result.appliedSnapshotHash)
        throw invalidProtocolShape(
          command,
          "write outcome is unknown: Java context attestation is missing or changed",
        );
      result.appliedContextHash = request.projectContext.contextHash;
    }
    if (result.planId !== request.planId) {
      throw invalidProtocolShape(command, "response planId does not match the requested plan");
    }
    this.sdkPlans.delete(request.planId);
    return result;
  }

  async rollbackRefactoring(request: RefactorRollbackRequest): Promise<RefactorRollbackResult> {
    const command = "rollback_refactorkit_engine_refactoring";
    const exactRequest = validateRollbackRefactoringRequest(request, command);
    if (request.projectContext)
      await this.requireJavaContextRefactoringFeature(command, request.operation, "rollback");
    else await this.requireGeneralRefactoringFeature(command, request.operation, "rollback");
    const result = normalizeRefactorRollback(command, await invokeManaged(command, exactRequest));
    if (
      request.projectContext &&
      result.rolledBack &&
      (result.rolledBackContextHash !== request.projectContext.contextHash ||
        result.restoredSnapshotHash !== request.projectContext.snapshotHash)
    )
      throw invalidProtocolShape(
        command,
        "rollback write outcome is unknown: original Java authority was not confirmed",
      );
    if (result.transactionId !== request.transactionId) {
      throw invalidProtocolShape(
        command,
        "response transactionId does not match the requested transaction",
      );
    }
    return result;
  }

  async discardRefactoring(
    request: DiscardRefactorKitPlanRequest,
  ): Promise<DiscardRefactorKitPlanResult> {
    const command = "discard_refactorkit_engine_refactoring";
    validateDiscardRequest(request, command);
    if (this.editorPlans.delete(request.planId)) {
      this.editorMutationPlans.delete(request.planId);
      return { planId: request.planId, discarded: true };
    }
    if (!this.sdkPlans.has(request.planId))
      await this.requireGeneralRefactoringFeature(command, undefined, "discard");
    const exactRequest = {
      planId: request.planId,
      authority: {
        workspaceId: request.workspaceId,
        workspaceGeneration: request.workspaceGeneration,
      },
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
    };
    const result = normalizeDiscard(command, await invokeManaged(command, exactRequest));
    if (result.planId !== request.planId) {
      throw invalidProtocolShape(command, "response planId does not match the requested plan");
    }
    this.sdkPlans.delete(request.planId);
    return result;
  }

  private async runAction(command: string): Promise<RefactorKitCommandResult> {
    return normalizeEngineCommandResult(command, await invokeTauri<unknown>(command));
  }
}
