import { invoke } from "@tauri-apps/api/core";
import {
  normalizeRefactorKitMethodCapabilities,
  normalizeSavedSnapshotDefinitionResult,
  normalizeSavedSnapshotSemanticSessionStartResult,
  normalizeSavedSnapshotSemanticSessionStopResult,
  normalizeSavedSnapshotSymbolSearchResult,
  normalizeTypeScriptDiagnosticsResponse,
} from "@ide/contracts";
import type {
  ApplyRefactorKitPlanRequest,
  ApplyRefactorKitPlanResult,
  DiscardRefactorKitPlanRequest,
  DiscardRefactorKitPlanResult,
  PreviewExternalJavaImportRequest,
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
  RefactorKitStatus,
  RefactoringOperation,
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
  "change-method-signature",
  "safe-delete",
] as const;
const REFACTOR_TARGET_KINDS = ["class", "member", "local-binding"] as const;
const REFACTOR_APPLY_OUTCOMES = ["applied", "refused", "stale", "failed", "indeterminate"] as const;
const UTF8_ENCODER = new TextEncoder();
const UPDATE_REQUIRED =
  "This RefactorKit operation requires an updated managed backend with targetDirectory preview, apply, discard, and rollback support.";

export type TauriRefactorKitManagedErrorCode =
  | "REFACTORKIT_UPDATE_REQUIRED"
  | "REFACTORKIT_PREVIEW_REFUSED"
  | "REFACTORKIT_PREVIEW_FAILED"
  | "REFACTORKIT_APPLY_STALE"
  | "REFACTORKIT_APPLY_REFUSED"
  | "REFACTORKIT_APPLY_FAILED"
  | "REFACTORKIT_DISCARD_FAILED"
  | "REFACTORKIT_ROLLBACK_CONFLICT"
  | "REFACTORKIT_ROLLBACK_FAILED";

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

function nativeErrorText(error: unknown): string {
  if (typeof error === "string") return error.toLowerCase();
  if (error instanceof Error) return error.message.toLowerCase();
  if (isRecord(error)) {
    for (const field of ["message", "error", "reason"] as const) {
      if (typeof error[field] === "string") return error[field].toLowerCase();
    }
  }
  return "";
}

function managedCommandError(command: string, error: unknown): TauriAdapterError {
  // Classification may inspect native text, but neither it nor the submitted request is
  // retained on the public error. Messages are deliberately static and source-safe.
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
    return new TauriRefactorKitManagedCommandError(
      command,
      /refus|reject/.test(text) ? "REFACTORKIT_PREVIEW_REFUSED" : "REFACTORKIT_PREVIEW_FAILED",
      /refus|reject/.test(text)
        ? "RefactorKit refused to preview this real-engine Java refactoring."
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
  if (supported && REFACTORING_OPERATIONS.some((operation) => !operations.includes(operation))) {
    throw invalidProtocolShape(command, "incomplete general refactoring operation set");
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
  if (Object.prototype.hasOwnProperty.call(record, "methods")) {
    try {
      const methods = normalizeRefactorKitMethodCapabilities(record.methods);
      if (methods !== undefined) normalized.methods = methods;
    } catch {
      throw invalidProtocolShape(command, "invalid method capability metadata");
    }
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
    validateRefactoringOperation(operation, command);
    return operation as RefactoringOperation;
  });
  if (new Set(operations).size !== operations.length) {
    throw invalidProtocolShape(command, "duplicate engine refactoring operation");
  }
  const operationalSurface = strings(command, record.operationalSurface, "operationalSurface");
  const rollbackAdvertised = protocolBoolean(command, record, "rollbackAdvertised");
  const previewReadOnly = protocolBoolean(command, record, "previewReadOnly");
  const path = nullableString(command, record, "path");
  const version = nullableString(command, record, "version");
  const workspaceId = protocolId(command, record, "workspaceId");
  const reason = nullableString(command, record, "reason");
  const supported = engineDiscovered && operations.length > 0;
  const generalRefactoring: RefactorKitGeneralRefactoringCapability = {
    supported,
    operations,
    preview: supported && previewReadOnly,
    apply: supported,
    rollback: supported && rollbackAdvertised,
    discard: supported,
    stability: supported ? "stable" : "experimental",
  };
  if (!supported && reason !== null) generalRefactoring.reason = reason;
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
  };
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

function validateRefactoringOperation(value: string, command: string): void {
  if (!(REFACTORING_OPERATIONS as readonly string[]).includes(value)) {
    throw new TauriAdapterError(command, "Invalid RefactorKit refactoring operation");
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
  validateRefactoringOperation(request.operation, command);
  const target = validateRefactorTarget(request.target, command);
  const authority = validateRefactorAuthority(request.authority, command);
  requestGeneration(request.selectionGeneration, command, "selectionGeneration");
  requestId(request.requestId, command, "requestId");
  // The real-engine request carries an operation-specific change descriptor. The
  // provider-neutral preview request does not carry rename/move/signature parameters
  // yet, so the adapter delegates an empty change descriptor and lets the engine's
  // own validation honestly refuse operations that require one (rename-class,
  // rename-member, rename-local-variable, move-class, change-method-signature).
  return {
    operation: request.operation,
    target,
    change: {},
    authority,
    selectionGeneration: request.selectionGeneration,
    requestId: request.requestId,
  };
}

function validateApplyRefactoringRequest(
  request: RefactorApplyRequest,
  command: string,
): RecordValue {
  validateRefactoringOperation(request.operation, command);
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
  return {
    planId: request.planId,
    operation: request.operation,
    target,
    change: {},
    authority,
    selectionGeneration: request.selectionGeneration,
    requestId: request.requestId,
    approval: {
      approvalId: request.approval.approvalId,
      approvedPlanId: request.approval.approvedPlanId,
      approvedAt: request.approval.approvedAt,
    },
  };
}

function validateRollbackRefactoringRequest(
  request: RefactorRollbackRequest,
  command: string,
): RecordValue {
  validateRefactoringOperation(request.operation, command);
  requestId(request.transactionId, command, "transactionId");
  requestId(request.requestId, command, "requestId");
  const authority = validateRefactorAuthority(request.authority, command);
  return {
    transactionId: request.transactionId,
    operation: request.operation,
    authority,
    requestId: request.requestId,
  };
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

function normalizeRefactorPreview(command: string, response: unknown): RefactorPreviewResult {
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
    operation: enumValue(command, record, "operation", REFACTORING_OPERATIONS),
    target: normalizeRefactorTarget(command, record.target),
    status: enumValue(command, record, "status", ["ready", "refused", "stale", "error"] as const),
    summary: protocolString(command, record, "summary", MAX_TEXT, false),
    confidence,
    riskLevel: enumValue(
      command,
      record,
      "riskLevel",
      ["low", "medium", "high", "unknown"] as const,
    ),
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
  return deepFreeze(result);
}

function normalizeRefactorApply(command: string, response: unknown): RefactorApplyResult {
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
    operation: enumValue(command, record, "operation", REFACTORING_OPERATIONS),
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
  return result;
}

function normalizeRefactorRollback(command: string, response: unknown): RefactorRollbackResult {
  const record = protocolRecord(command, response);
  return {
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
function normalizeCommand(command: string, response: unknown): string[] {
  const metadata = requireRecord(command, response).command;
  if (!isRecord(metadata)) throw invalidShape(command, "missing command metadata object", response);
  return [
    requireString(command, response, metadata, "executable"),
    ...legacyStrings(command, response, metadata.args, "command.args"),
  ];
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
function normalizeCommandResult(command: string, response: unknown): RefactorKitCommandResult {
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
    command: normalizeCommand(command, response),
  };
}

/**
 * The real-engine capability surface returned by getCapabilities(): the
 * provider-neutral RefactorKitCapabilities advertisement plus the engine's own
 * presence/version and CLI operational-surface metadata. Backward-compatible
 * with callers that read only the base RefactorKitCapabilities shape.
 */
export interface TauriRefactorKitEngineCapabilities extends RefactorKitCapabilities {
  /** Whether a real engine was discovered through a wrapper PATH or installed path. */
  engineDiscovered: boolean;
  /** Absolute path of the discovered real engine, when present. */
  enginePath: string | null;
  /** Version reported by the discovered real engine, when present. */
  engineVersion: string | null;
  /** The CLI operational surface the real engine authoritatively advertises. */
  operationalSurface: string[];
  /** The workspace the real-engine capability report is correlated to. */
  workspaceId: string;
}

export class TauriRefactorKitAdapter implements RefactorKitPort {
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
    const engine = normalizeEngineCapabilities(
      engineCommand,
      await invokeManaged(engineCommand),
    );
    const baseCommand = "get_refactorkit_capabilities";
    const base = normalizeCapabilities(baseCommand, await invokeManaged(baseCommand));
    const merged: TauriRefactorKitEngineCapabilities = {
      api: base.api,
      apiVersion: base.apiVersion,
      provider: base.provider,
      providerVersion: base.providerVersion,
      javaImportExternalClass: base.javaImportExternalClass,
      generalRefactoring: engine.generalRefactoring,
      engineDiscovered: engine.engineDiscovered,
      enginePath: engine.enginePath,
      engineVersion: engine.engineVersion,
      operationalSurface: engine.operationalSurface,
      workspaceId: engine.workspaceId,
    };
    if (base.methods !== undefined) merged.methods = base.methods;
    if (base.languageKernel !== undefined) merged.languageKernel = base.languageKernel;
    if (base.safety !== undefined) merged.safety = base.safety;
    return deepFreeze(merged);
  }

  async scan(): Promise<RefactorKitCommandResult> {
    return this.runAction("run_refactorkit_scan");
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
    return this.runAction("run_refactorkit_symbols");
  }

  async definition(symbol: string): Promise<RefactorKitCommandResult> {
    const command = "run_refactorkit_definition";
    return normalizeCommandResult(command, await invokeTauri<unknown>(command, { symbol }));
  }

  async references(symbol: string): Promise<RefactorKitCommandResult> {
    const command = "run_refactorkit_references";
    return normalizeCommandResult(command, await invokeTauri<unknown>(command, { symbol }));
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
  }

  async previewRefactoring(request: RefactorPreviewRequest): Promise<RefactorPreviewResult> {
    const command = "preview_refactorkit_engine_refactoring";
    const exactRequest = validatePreviewRefactoringRequest(request, command);
    await this.requireGeneralRefactoringFeature(command, request.operation, "preview");
    return normalizeRefactorPreview(command, await invokeManaged(command, exactRequest));
  }

  async applyRefactoring(request: RefactorApplyRequest): Promise<RefactorApplyResult> {
    const command = "apply_refactorkit_engine_refactoring";
    const exactRequest = validateApplyRefactoringRequest(request, command);
    await this.requireGeneralRefactoringFeature(command, request.operation, "apply");
    const result = normalizeRefactorApply(command, await invokeManaged(command, exactRequest));
    if (result.planId !== request.planId) {
      throw invalidProtocolShape(command, "response planId does not match the requested plan");
    }
    return result;
  }

  async rollbackRefactoring(request: RefactorRollbackRequest): Promise<RefactorRollbackResult> {
    const command = "rollback_refactorkit_engine_refactoring";
    const exactRequest = validateRollbackRefactoringRequest(request, command);
    await this.requireGeneralRefactoringFeature(command, request.operation, "rollback");
    const result = normalizeRefactorRollback(command, await invokeManaged(command, exactRequest));
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
    return result;
  }

  private async runAction(command: string): Promise<RefactorKitCommandResult> {
    return normalizeCommandResult(command, await invokeTauri<unknown>(command));
  }
}
