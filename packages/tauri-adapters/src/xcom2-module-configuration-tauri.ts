import {
  XCOM2_MODULE_CONFIGURATION_LIMITS,
  XCOM2_MODULE_CONFIGURATION_SCHEMA,
  type Xcom2ModuleConfiguration,
  type Xcom2ModuleConfigurationReadRequest,
  type Xcom2ModuleConfigurationReadResult,
  type Xcom2ModuleConfigurationStopCode,
} from "@ide/contracts";
import type { Xcom2ModuleConfigurationPort } from "@ide/web-core/ports";

import { TauriAdapterError, invokeTauri } from "./errors";

const COMMAND = "read_xcom2_module_configuration";
const MAXIMUM_ID_BYTES = 256;
const CORRELATION_ID = /^[A-Za-z0-9_.:-]+$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const WINDOWS_OR_URI_ABSOLUTE_PATH = /^(?:[A-Za-z]:|file:\/)/iu;
const CORRELATION_FIELDS = [
  "workspaceId",
  "workspaceGeneration",
  "activationGeneration",
  "configurationReadId",
] as const;
const STOP_CODES = new Set<Xcom2ModuleConfigurationStopCode>([
  "configuration-unreadable",
  "configuration-too-large",
  "configuration-invalid-utf8",
  "configuration-invalid-json",
  "configuration-invalid-schema",
  "configuration-unsupported-version",
  "configuration-unsupported-target",
  "configuration-invalid-module-roots",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): TauriAdapterError {
  return new TauriAdapterError(COMMAND, `Invalid ${COMMAND} response: ${message}`);
}

function invalidRequest(message: string): TauriAdapterError {
  return new TauriAdapterError(COMMAND, `Invalid ${COMMAND} request: ${message}`);
}

function nativeFailure(): TauriAdapterError {
  return new TauriAdapterError(COMMAND, "Native XCOM 2 module configuration read failed");
}

function hasExactOwnFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === fields.length &&
    keys.every((key) => typeof key === "string" && fields.includes(key)) &&
    fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))
  );
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  location: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(`${location} must be an object`);
  if (!hasExactOwnFields(value, fields)) {
    throw invalid(`${location} has missing or unsupported fields`);
  }
  return value;
}

function exactRequestRecord(
  value: unknown,
  fields: readonly string[],
  location: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw invalidRequest(`${location} must be an object`);
  if (!hasExactOwnFields(value, fields)) {
    throw invalidRequest(`${location} has missing or unsupported fields`);
  }
  return value;
}

function validCorrelationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAXIMUM_ID_BYTES &&
    CORRELATION_ID.test(value)
  );
}

function positiveSafeGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function extractRequest(request: unknown): Readonly<Xcom2ModuleConfigurationReadRequest> {
  const source = exactRequestRecord(request, CORRELATION_FIELDS, "request");
  const workspaceId = source.workspaceId;
  const workspaceGeneration = source.workspaceGeneration;
  const activationGeneration = source.activationGeneration;
  const configurationReadId = source.configurationReadId;

  if (!validCorrelationId(workspaceId) || !validCorrelationId(configurationReadId)) {
    throw invalidRequest("correlation IDs must use the bounded native ID format");
  }
  if (
    !positiveSafeGeneration(workspaceGeneration) ||
    !positiveSafeGeneration(activationGeneration)
  ) {
    throw invalidRequest("generations must be positive safe integers");
  }

  return Object.freeze({
    workspaceId,
    workspaceGeneration,
    activationGeneration,
    configurationReadId,
  });
}

function exactBoundedArray(
  value: unknown,
  minimum: number,
  maximum: number,
  location: string,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw invalid(`${location} must be a bounded array`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) {
    throw invalid(`${location} must have only dense array entries`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw invalid(`${location} must not be sparse`);
    }
  }
  return value;
}

function utf8ByteLength(value: string): number | undefined {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (!Number.isFinite(nextCodeUnit) || nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return undefined;
      }
      bytes += 4;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return undefined;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function portableModuleRoot(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const bytes = utf8ByteLength(value);
  if (
    bytes === undefined ||
    bytes === 0 ||
    bytes > XCOM2_MODULE_CONFIGURATION_LIMITS.maximumModuleRootBytes ||
    CONTROL_CHARACTER.test(value) ||
    value.includes("\\") ||
    value.startsWith("/") ||
    WINDOWS_OR_URI_ABSOLUTE_PATH.test(value)
  ) {
    return false;
  }
  if (value === ".") return true;
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

function normalizeConfiguration(value: unknown): Readonly<Xcom2ModuleConfiguration> {
  const source = exactRecord(value, ["version", "target", "moduleRoots"], "configuration");
  if (source.version !== XCOM2_MODULE_CONFIGURATION_SCHEMA.version) {
    throw invalid("configuration.version is unsupported");
  }
  if (source.target !== XCOM2_MODULE_CONFIGURATION_SCHEMA.target) {
    throw invalid("configuration.target is unsupported");
  }

  const rootSource = exactBoundedArray(
    source.moduleRoots,
    XCOM2_MODULE_CONFIGURATION_LIMITS.minimumModuleRoots,
    XCOM2_MODULE_CONFIGURATION_LIMITS.maximumModuleRoots,
    "configuration.moduleRoots",
  );
  const seen = new Set<string>();
  const moduleRoots = rootSource.map((root, index) => {
    if (!portableModuleRoot(root)) {
      throw invalid(`configuration.moduleRoots[${index}] is not canonical`);
    }
    if (seen.has(root)) {
      throw invalid("configuration.moduleRoots contains a duplicate");
    }
    seen.add(root);
    return root;
  });
  for (let index = 1; index < moduleRoots.length; index += 1) {
    if (compareText(moduleRoots[index - 1]!, moduleRoots[index]!) >= 0) {
      throw invalid("configuration.moduleRoots is not in native lexical order");
    }
  }

  return Object.freeze({
    version: XCOM2_MODULE_CONFIGURATION_SCHEMA.version,
    target: XCOM2_MODULE_CONFIGURATION_SCHEMA.target,
    moduleRoots: Object.freeze(moduleRoots),
  });
}

function requireCorrelation(
  source: Record<string, unknown>,
  request: Readonly<Xcom2ModuleConfigurationReadRequest>,
): void {
  if (
    !validCorrelationId(source.workspaceId) ||
    !positiveSafeGeneration(source.workspaceGeneration) ||
    !positiveSafeGeneration(source.activationGeneration) ||
    !validCorrelationId(source.configurationReadId) ||
    source.workspaceId !== request.workspaceId ||
    source.workspaceGeneration !== request.workspaceGeneration ||
    source.activationGeneration !== request.activationGeneration ||
    source.configurationReadId !== request.configurationReadId
  ) {
    throw invalid("correlation does not exactly match the request");
  }
}

function normalizeResponse(
  response: unknown,
  request: Readonly<Xcom2ModuleConfigurationReadRequest>,
): Readonly<Xcom2ModuleConfigurationReadResult> {
  if (!isRecord(response)) throw invalid("response must be an object");
  const kind = response.kind;

  if (kind === "absent") {
    const source = exactRecord(response, [...CORRELATION_FIELDS, "kind"], "response");
    requireCorrelation(source, request);
    return Object.freeze({ ...request, kind: "absent" });
  }

  if (kind === "ready") {
    const source = exactRecord(
      response,
      [...CORRELATION_FIELDS, "kind", "configuration"],
      "response",
    );
    requireCorrelation(source, request);
    const configuration = normalizeConfiguration(source.configuration);
    return Object.freeze({ ...request, kind: "ready", configuration });
  }

  if (kind === "stopped") {
    const source = exactRecord(response, [...CORRELATION_FIELDS, "kind", "code"], "response");
    requireCorrelation(source, request);
    if (!STOP_CODES.has(source.code as Xcom2ModuleConfigurationStopCode)) {
      throw invalid("stopped code is unsupported");
    }
    return Object.freeze({
      ...request,
      kind: "stopped",
      code: source.code as Xcom2ModuleConfigurationStopCode,
    });
  }

  throw invalid("kind is unsupported");
}

/** Thin native bridge for the fixed, read-only XCOM 2 module configuration. */
export class TauriXcom2ModuleConfigurationAdapter implements Xcom2ModuleConfigurationPort {
  async read(
    request: Readonly<Xcom2ModuleConfigurationReadRequest>,
  ): Promise<Readonly<Xcom2ModuleConfigurationReadResult>> {
    const immutableRequest = extractRequest(request);
    let response: unknown;
    try {
      response = await invokeTauri<unknown>(COMMAND, { request: immutableRequest });
    } catch {
      throw nativeFailure();
    }
    return normalizeResponse(response, immutableRequest);
  }
}
