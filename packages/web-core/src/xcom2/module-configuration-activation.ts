import {
  XCOM2_MODULE_CONFIGURATION_LIMITS,
  XCOM2_MODULE_CONFIGURATION_SCHEMA,
  XCOM2_MODULE_EVIDENCE_KINDS,
  type Xcom2ModuleActivationDecision,
  type Xcom2ModuleActivationSnapshot,
  type Xcom2ModuleConfiguration,
  type Xcom2ModuleConfigurationReadRequest,
  type Xcom2ModuleConfigurationReadResult,
  type Xcom2ModuleConfigurationStopCode,
  type Xcom2ModuleEvidenceKind,
  type Xcom2ProjectActivationDecision,
  type Xcom2ProjectActivationEvaluation,
  type Xcom2ProjectActivationReason,
  type Xcom2ProjectActivationSnapshot,
  type Xcom2ProjectRecognitionReason,
} from "@ide/contracts";

const EVIDENCE_KIND_ORDER = new Map<Xcom2ModuleEvidenceKind, number>(
  XCOM2_MODULE_EVIDENCE_KINDS.map((kind, index) => [kind, index]),
);

interface ValidConfiguration {
  readonly roots: ReadonlySet<string>;
}

interface InvalidConfiguration {
  readonly code: Xcom2ModuleConfigurationStopCode;
}

type ConfigurationValidation = ValidConfiguration | InvalidConfiguration;

function compareLexically(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareRecognitionReasons(
  left: Readonly<Xcom2ProjectRecognitionReason>,
  right: Readonly<Xcom2ProjectRecognitionReason>,
): number {
  const kindDifference =
    EVIDENCE_KIND_ORDER.get(left.evidenceKind)! - EVIDENCE_KIND_ORDER.get(right.evidenceKind)!;

  return kindDifference || compareLexically(left.relativePath, right.relativePath);
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

function isPortableModuleRoot(root: unknown): root is string {
  if (typeof root !== "string") return false;

  const byteLength = utf8ByteLength(root);
  if (
    byteLength === undefined ||
    byteLength === 0 ||
    byteLength > XCOM2_MODULE_CONFIGURATION_LIMITS.maximumModuleRootBytes
  ) {
    return false;
  }

  for (let index = 0; index < root.length; index += 1) {
    const codeUnit = root.charCodeAt(index);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) return false;
  }

  if (root === ".") return true;
  if (
    root.startsWith("/") ||
    root.includes("\\") ||
    /^[A-Za-z]:/.test(root) ||
    /^file:\//i.test(root)
  ) {
    return false;
  }

  const components = root.split("/");
  return components.every(
    (component) =>
      component.length > 0 && component !== "." && component !== ".." && !component.includes("\0"),
  );
}

function validateReadyConfiguration(configuration: unknown): ConfigurationValidation {
  if (typeof configuration !== "object" || configuration === null || Array.isArray(configuration)) {
    return { code: "configuration-invalid-schema" };
  }

  const fields = Object.keys(configuration).sort(compareLexically);
  if (fields.join("\0") !== "moduleRoots\0target\0version") {
    return { code: "configuration-invalid-schema" };
  }

  const candidate = configuration as Partial<Xcom2ModuleConfiguration>;
  if (candidate.version !== XCOM2_MODULE_CONFIGURATION_SCHEMA.version) {
    return { code: "configuration-unsupported-version" };
  }
  if (candidate.target !== XCOM2_MODULE_CONFIGURATION_SCHEMA.target) {
    return { code: "configuration-unsupported-target" };
  }
  if (!Array.isArray(candidate.moduleRoots)) {
    return { code: "configuration-invalid-schema" };
  }

  const roots = candidate.moduleRoots;
  if (
    roots.length < XCOM2_MODULE_CONFIGURATION_LIMITS.minimumModuleRoots ||
    roots.length > XCOM2_MODULE_CONFIGURATION_LIMITS.maximumModuleRoots ||
    !roots.every(isPortableModuleRoot) ||
    new Set(roots).size !== roots.length
  ) {
    return { code: "configuration-invalid-module-roots" };
  }

  return { roots: new Set(roots) };
}

function cloneRecognitionReasons(
  decision: Readonly<Xcom2ModuleActivationDecision>,
): readonly Readonly<Xcom2ProjectRecognitionReason>[] {
  return Object.freeze(
    decision.reasons
      .map(({ evidenceKind, relativePath }) =>
        Object.freeze({
          kind: "recognition" as const,
          evidenceKind,
          relativePath,
        }),
      )
      .sort(compareRecognitionReasons),
  );
}

function createDecision(
  moduleRoot: string,
  configured: boolean,
  recognized: Readonly<Xcom2ModuleActivationDecision> | undefined,
): Readonly<Xcom2ProjectActivationDecision> {
  const recognitionReasons = recognized ? cloneRecognitionReasons(recognized) : [];
  const reasons: readonly Readonly<Xcom2ProjectActivationReason>[] = Object.freeze([
    ...(configured
      ? [Object.freeze({ kind: "configuration" as const, target: "wotc" as const })]
      : []),
    ...recognitionReasons,
  ]);

  if (configured) {
    return Object.freeze({
      moduleRoot,
      state: "active",
      source: recognized ? "configured-and-recognized" : "configured",
      activationConfidence: "explicit",
      recognitionConfidence: recognized?.confidence ?? "none",
      reasons,
    });
  }

  if (recognized?.state === "active") {
    return Object.freeze({
      moduleRoot,
      state: "active",
      source: "recognized",
      activationConfidence: "high",
      recognitionConfidence: "high",
      reasons,
    });
  }

  return Object.freeze({
    moduleRoot,
    state: "needs-confirmation",
    source: "recognized",
    recognitionConfidence: "medium",
    reasons: recognitionReasons,
  });
}

function configurationMatchesRequest(
  request: Readonly<Xcom2ModuleConfigurationReadRequest>,
  result: Readonly<Xcom2ModuleConfigurationReadResult>,
): boolean {
  return (
    result.workspaceId === request.workspaceId &&
    result.workspaceGeneration === request.workspaceGeneration &&
    result.activationGeneration === request.activationGeneration &&
    result.configurationReadId === request.configurationReadId
  );
}

function recognitionMatchesRequest(
  request: Readonly<Xcom2ModuleConfigurationReadRequest>,
  recognition: Readonly<Xcom2ModuleActivationSnapshot>,
): boolean {
  return (
    recognition.workspaceId === request.workspaceId &&
    recognition.workspaceGeneration === request.workspaceGeneration
  );
}

/**
 * Combine explicit project intent with convention recognition without performing platform access.
 * Any stale correlation rejects the whole candidate, and invalid configuration grants no authority.
 */
export function evaluateXcom2ProjectActivation(
  request: Readonly<Xcom2ModuleConfigurationReadRequest>,
  configurationResult: Readonly<Xcom2ModuleConfigurationReadResult>,
  recognition: Readonly<Xcom2ModuleActivationSnapshot>,
): Readonly<Xcom2ProjectActivationEvaluation> {
  if (!configurationMatchesRequest(request, configurationResult)) {
    return Object.freeze({
      kind: "rejected",
      reason: "configuration-correlation-mismatch",
    });
  }
  if (!recognitionMatchesRequest(request, recognition)) {
    return Object.freeze({
      kind: "rejected",
      reason: "recognition-correlation-mismatch",
    });
  }

  let configuredRoots: ReadonlySet<string> = new Set();
  let diagnosticCode: Xcom2ModuleConfigurationStopCode | undefined;

  if (configurationResult.kind === "ready") {
    const validation = validateReadyConfiguration(configurationResult.configuration);
    if ("roots" in validation) configuredRoots = validation.roots;
    else diagnosticCode = validation.code;
  } else if (configurationResult.kind === "stopped") {
    diagnosticCode = configurationResult.code;
  }

  const recognizedByRoot = new Map(
    recognition.decisions.map((decision) => [decision.moduleRoot, decision] as const),
  );
  const moduleRoots = [...new Set([...configuredRoots, ...recognizedByRoot.keys()])].sort(
    compareLexically,
  );
  const decisions = Object.freeze(
    moduleRoots.map((moduleRoot) =>
      createDecision(moduleRoot, configuredRoots.has(moduleRoot), recognizedByRoot.get(moduleRoot)),
    ),
  );
  const hasActiveDecision = decisions.some(({ state }) => state === "active");
  const diagnostic = diagnosticCode ? Object.freeze({ code: diagnosticCode }) : undefined;

  const snapshot: Readonly<Xcom2ProjectActivationSnapshot> = Object.freeze({
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    activationGeneration: request.activationGeneration,
    configurationReadId: request.configurationReadId,
    scanId: recognition.scanId,
    scanGeneration: recognition.scanGeneration,
    state: hasActiveDecision ? "active" : decisions.length > 0 ? "needs-confirmation" : "inactive",
    recognitionConfidence: recognition.confidence,
    decisions,
    ...(diagnostic ? { diagnostic } : {}),
  });

  return Object.freeze({ kind: "accepted", snapshot });
}
