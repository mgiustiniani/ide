import {
  XCOM2_MODULE_EVIDENCE_KINDS,
  XCOM2_MODULE_SCAN_LIMITS,
  type Xcom2ModuleEvidenceKind,
  type Xcom2ModuleEvidenceObservation,
  type Xcom2ModuleScanCompleteness,
  type Xcom2ModuleScanIssue,
  type Xcom2ModuleScanIssueKind,
  type Xcom2ModuleScanRequest,
  type Xcom2ModuleScanSnapshot,
} from "@ide/contracts";
import type { Xcom2ModuleScannerPort } from "@ide/web-core/ports";

import { TauriAdapterError, invokeTauri, toTauriAdapterError } from "./errors";

const COMMAND = "scan_xcom2_module_evidence";
const MAXIMUM_ID_BYTES = 256;
const MAXIMUM_PATH_BYTES = 4_096;
const MAXIMUM_OBSERVATIONS = XCOM2_MODULE_SCAN_LIMITS.maximumEncounteredEntries;
// The final encountered entry may produce both an entry issue and the one budget issue.
const MAXIMUM_ISSUES = XCOM2_MODULE_SCAN_LIMITS.maximumEncounteredEntries + 1;
const CORRELATION_ID = /^[A-Za-z0-9_.:-]+$/u;
const UNSAFE_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const WINDOWS_OR_URI_ABSOLUTE_PATH = /^(?:[A-Za-z]:|file:\/)/iu;

const EVIDENCE_KIND_ORDER = new Map<Xcom2ModuleEvidenceKind, number>(
  XCOM2_MODULE_EVIDENCE_KINDS.map((kind, index) => [kind, index]),
);
const ISSUE_KINDS = [
  "unreadable-entry",
  "unreadable-subtree",
  "depth-limit-reached",
  "encountered-entry-limit-reached",
] as const satisfies readonly Xcom2ModuleScanIssueKind[];
const ISSUE_KIND_ORDER = new Map<Xcom2ModuleScanIssueKind, number>(
  ISSUE_KINDS.map((kind, index) => [kind, index]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string, cause?: unknown): TauriAdapterError {
  return new TauriAdapterError(COMMAND, `Invalid ${COMMAND} response: ${message}`, cause);
}

function invalidRequest(message: string, cause?: unknown): TauriAdapterError {
  return new TauriAdapterError(COMMAND, `Invalid ${COMMAND} request: ${message}`, cause);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  location: string,
  response: unknown,
): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(`${location} must be an object`, response);
  const actual = Object.keys(value);
  if (
    actual.length !== fields.length ||
    fields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))
  ) {
    throw invalid(`${location} has missing or unsupported fields`, response);
  }
  return value;
}

function exactRequestRecord(
  value: unknown,
  fields: readonly string[],
  location: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw invalidRequest(`${location} must be an object`, value);
  const actual = Object.keys(value);
  if (
    actual.length !== fields.length ||
    fields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))
  ) {
    throw invalidRequest(`${location} has missing or unsupported fields`, value);
  }
  return value;
}

function validCorrelationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).length <= MAXIMUM_ID_BYTES &&
    CORRELATION_ID.test(value)
  );
}

function positiveSafeGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function extractRequest(request: unknown): Readonly<Xcom2ModuleScanRequest> {
  const source = exactRequestRecord(
    request,
    ["workspaceId", "workspaceGeneration", "scanId", "scanGeneration", "limits"],
    "request",
  );
  const limits = exactRequestRecord(
    source.limits,
    ["maximumDepth", "maximumEncounteredEntries"],
    "request.limits",
  );
  const workspaceId = source.workspaceId;
  const workspaceGeneration = source.workspaceGeneration;
  const scanId = source.scanId;
  const scanGeneration = source.scanGeneration;

  if (!validCorrelationId(workspaceId) || !validCorrelationId(scanId)) {
    throw invalidRequest("correlation IDs must use the bounded native ID format", request);
  }
  if (!positiveSafeGeneration(workspaceGeneration) || !positiveSafeGeneration(scanGeneration)) {
    throw invalidRequest("generations must be positive safe integers", request);
  }
  if (
    limits.maximumDepth !== XCOM2_MODULE_SCAN_LIMITS.maximumDepth ||
    limits.maximumEncounteredEntries !== XCOM2_MODULE_SCAN_LIMITS.maximumEncounteredEntries
  ) {
    throw invalidRequest("limits must equal the committed scanner limits", request);
  }

  return Object.freeze({
    workspaceId,
    workspaceGeneration,
    scanId,
    scanGeneration,
    limits: Object.freeze({
      maximumDepth: XCOM2_MODULE_SCAN_LIMITS.maximumDepth,
      maximumEncounteredEntries: XCOM2_MODULE_SCAN_LIMITS.maximumEncounteredEntries,
    }),
  });
}

function boundedArray(
  value: unknown,
  maximum: number,
  location: string,
  response: unknown,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw invalid(`${location} must be a bounded array`, response);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw invalid(`${location} must not be sparse`, response);
    }
  }
  return value;
}

function normalizedRelativePath(value: unknown, allowRoot: boolean): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    new TextEncoder().encode(value).length > MAXIMUM_PATH_BYTES ||
    UNSAFE_CONTROL_CHARACTER.test(value) ||
    value.includes("\\") ||
    value.startsWith("/") ||
    WINDOWS_OR_URI_ABSOLUTE_PATH.test(value)
  ) {
    return false;
  }
  if (value === ".") return allowRoot;
  return value
    .split("/")
    .every((component) => component.length > 0 && component !== "." && component !== "..");
}

function compareText(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftPoints[index]!.codePointAt(0)!;
    const rightPoint = rightPoints[index]!.codePointAt(0)!;
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
  }
  return leftPoints.length - rightPoints.length;
}

function compareIssues(
  left: Readonly<Xcom2ModuleScanIssue>,
  right: Readonly<Xcom2ModuleScanIssue>,
): number {
  return (
    ISSUE_KIND_ORDER.get(left.kind)! - ISSUE_KIND_ORDER.get(right.kind)! ||
    compareText(left.relativePath, right.relativePath)
  );
}

function compareObservations(
  left: Readonly<Xcom2ModuleEvidenceObservation>,
  right: Readonly<Xcom2ModuleEvidenceObservation>,
): number {
  return (
    EVIDENCE_KIND_ORDER.get(left.evidenceKind)! - EVIDENCE_KIND_ORDER.get(right.evidenceKind)! ||
    compareText(left.relativePath, right.relativePath) ||
    compareText(left.moduleRoot, right.moduleRoot)
  );
}

function normalizeIssues(
  response: unknown,
  value: unknown,
): readonly Readonly<Xcom2ModuleScanIssue>[] {
  const source = boundedArray(value, MAXIMUM_ISSUES, "issues", response);
  const seen = new Set<string>();
  const issues = source.map((candidate, index) => {
    const item = exactRecord(candidate, ["kind", "relativePath"], `issues[${index}]`, response);
    if (!ISSUE_KIND_ORDER.has(item.kind as Xcom2ModuleScanIssueKind)) {
      throw invalid(`issues[${index}].kind is unsupported`, response);
    }
    if (!normalizedRelativePath(item.relativePath, false)) {
      throw invalid(`issues[${index}].relativePath is not canonical`, response);
    }
    const issue = Object.freeze({
      kind: item.kind as Xcom2ModuleScanIssueKind,
      relativePath: item.relativePath,
    });
    const identity = `${issue.kind}\u0000${issue.relativePath}`;
    if (seen.has(identity)) throw invalid("issues contains a duplicate", response);
    seen.add(identity);
    return issue;
  });
  for (let index = 1; index < issues.length; index += 1) {
    if (compareIssues(issues[index - 1]!, issues[index]!) >= 0) {
      throw invalid("issues is not in native canonical order", response);
    }
  }
  return Object.freeze(issues);
}

function normalizeObservations(
  response: unknown,
  value: unknown,
): readonly Readonly<Xcom2ModuleEvidenceObservation>[] {
  const source = boundedArray(value, MAXIMUM_OBSERVATIONS, "observations", response);
  const seen = new Set<string>();
  const observations = source.map((candidate, index) => {
    const item = exactRecord(
      candidate,
      ["evidenceKind", "moduleRoot", "relativePath"],
      `observations[${index}]`,
      response,
    );
    if (!EVIDENCE_KIND_ORDER.has(item.evidenceKind as Xcom2ModuleEvidenceKind)) {
      throw invalid(`observations[${index}].evidenceKind is unsupported`, response);
    }
    if (!normalizedRelativePath(item.moduleRoot, true)) {
      throw invalid(`observations[${index}].moduleRoot is not canonical`, response);
    }
    if (!normalizedRelativePath(item.relativePath, false)) {
      throw invalid(`observations[${index}].relativePath is not canonical`, response);
    }
    if (item.moduleRoot !== "." && !item.relativePath.startsWith(`${item.moduleRoot}/`)) {
      throw invalid(`observations[${index}] escapes its module root`, response);
    }
    const observation = Object.freeze({
      evidenceKind: item.evidenceKind as Xcom2ModuleEvidenceKind,
      moduleRoot: item.moduleRoot,
      relativePath: item.relativePath,
    });
    const identity = `${observation.evidenceKind}\u0000${observation.moduleRoot}\u0000${observation.relativePath}`;
    if (seen.has(identity)) throw invalid("observations contains a duplicate", response);
    seen.add(identity);
    return observation;
  });
  for (let index = 1; index < observations.length; index += 1) {
    if (compareObservations(observations[index - 1]!, observations[index]!) >= 0) {
      throw invalid("observations is not in native canonical order", response);
    }
  }
  return Object.freeze(observations);
}

function normalizeResponse(
  response: unknown,
  request: Readonly<Xcom2ModuleScanRequest>,
): Readonly<Xcom2ModuleScanSnapshot> {
  const source = exactRecord(
    response,
    [
      "workspaceId",
      "workspaceGeneration",
      "scanId",
      "scanGeneration",
      "completeness",
      "issues",
      "limits",
      "observations",
    ],
    "response",
    response,
  );
  const limits = exactRecord(
    source.limits,
    ["maximumDepth", "maximumEncounteredEntries"],
    "limits",
    response,
  );
  if (
    !validCorrelationId(source.workspaceId) ||
    !positiveSafeGeneration(source.workspaceGeneration) ||
    !validCorrelationId(source.scanId) ||
    !positiveSafeGeneration(source.scanGeneration) ||
    source.workspaceId !== request.workspaceId ||
    source.workspaceGeneration !== request.workspaceGeneration ||
    source.scanId !== request.scanId ||
    source.scanGeneration !== request.scanGeneration
  ) {
    throw invalid("correlation does not exactly match the request", response);
  }
  if (
    limits.maximumDepth !== request.limits.maximumDepth ||
    limits.maximumEncounteredEntries !== request.limits.maximumEncounteredEntries
  ) {
    throw invalid("limits do not exactly match the request", response);
  }
  if (source.completeness !== "complete" && source.completeness !== "partial") {
    throw invalid("completeness is unsupported", response);
  }

  const issues = normalizeIssues(response, source.issues);
  const observations = normalizeObservations(response, source.observations);
  const completeness = source.completeness as Xcom2ModuleScanCompleteness;
  if ((completeness === "complete") !== (issues.length === 0)) {
    throw invalid("completeness conflicts with issues", response);
  }

  return Object.freeze({
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    scanId: request.scanId,
    scanGeneration: request.scanGeneration,
    completeness,
    issues,
    limits: Object.freeze({
      maximumDepth: request.limits.maximumDepth,
      maximumEncounteredEntries: request.limits.maximumEncounteredEntries,
    }),
    observations,
  });
}

/** Thin native bridge for the committed read-only XCOM 2 convention-evidence scanner. */
export class TauriXcom2ModuleScannerAdapter implements Xcom2ModuleScannerPort {
  async scan(
    request: Readonly<Xcom2ModuleScanRequest>,
  ): Promise<Readonly<Xcom2ModuleScanSnapshot>> {
    try {
      const immutableRequest = extractRequest(request);
      const response = await invokeTauri<unknown>(COMMAND, { request: immutableRequest });
      return normalizeResponse(response, immutableRequest);
    } catch (error) {
      throw toTauriAdapterError(COMMAND, error);
    }
  }
}
