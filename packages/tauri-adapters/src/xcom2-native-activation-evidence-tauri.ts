import {
  XCOM2_MODULE_CONFIGURATION_LIMITS,
  XCOM2_MODULE_CONFIGURATION_SCHEMA,
  XCOM2_MODULE_EVIDENCE_KINDS,
  XCOM2_MODULE_SCAN_LIMITS,
  XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS,
  beginXcom2NativeActivationEvidence,
  type Xcom2ModuleEvidenceKind,
  type Xcom2ModuleScanIssueKind,
  type Xcom2NativeActivationAcknowledgment,
  type Xcom2NativeActivationAcknowledgmentDecision,
  type Xcom2NativeActivationCandidate,
  type Xcom2NativeActivationEvidenceState,
  type Xcom2NativeActivationLifecycleDecision,
  type Xcom2NativeActivationLifecycleEvent,
} from "@ide/contracts";
import type {
  Xcom2NativeActivationEvidenceBeginRequest,
  Xcom2NativeActivationEvidencePort,
} from "@ide/web-core/ports";

import {
  boundedText,
  compareText,
  copyUnknownData,
  exactDataRecord,
  exactDenseArray,
  invokeNativeUnknown,
  portableRelativePath,
  positiveSafeInteger,
  protocolError,
  type ProtocolPhase,
} from "./xcom2-native-tauri-validation";

export const XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS = Object.freeze({
  begin: "begin_xcom2_native_activation_evidence",
  acknowledge: "acknowledge_xcom2_native_activation_evidence",
  revoke: "revoke_xcom2_native_activation_evidence",
} as const);

const MAXIMUM_ID_BYTES = XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS.maximumOpaqueIdBytes;
const MAXIMUM_MODULE_ROOT_BYTES = XCOM2_MODULE_CONFIGURATION_LIMITS.maximumModuleRootBytes;
const MAXIMUM_HANDLES = XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS.maximumEvidenceHandles;
const ISSUE_KIND_ORDER = new Map<Xcom2ModuleScanIssueKind, number>(
  (
    [
      "unreadable-entry",
      "unreadable-subtree",
      "depth-limit-reached",
      "encountered-entry-limit-reached",
    ] as const
  ).map((kind, index) => [kind, index]),
);
const EVIDENCE_KIND_ORDER = new Map<Xcom2ModuleEvidenceKind, number>(
  XCOM2_MODULE_EVIDENCE_KINDS.map((kind, index) => [kind, index]),
);
const REVOCATION_CODES = new Set([
  "workspace-refresh",
  "workspace-switch-started",
  "workspace-activation-started",
  "workspace-activation-failed",
  "activation-attempt-failed",
  "newer-activation-generation",
  "app-exit",
  "cached-react-restoration",
  "candidate-invalid",
  "mixed-activation-attempt",
]);
const ACKNOWLEDGMENT_REFUSAL_CODES = new Set([
  "authority-unavailable",
  "evaluation-invalid",
  "inactive",
  "needs-confirmation",
  "weak-evidence",
  "incomplete-evidence",
  "stale-correlation",
  "duplicate-evidence-handle",
  "unknown-evidence-handle",
]);
const SIMPLE_LIFECYCLE_EVENTS = new Set([
  "workspace-refresh",
  "workspace-switch-started",
  "workspace-activation-started",
  "workspace-activation-failed",
  "activation-attempt-failed",
  "app-exit",
  "cached-react-restoration",
]);

function invalid(command: string, phase: ProtocolPhase, detail: string): never {
  throw protocolError(command, phase, detail);
}

function dataKind(command: string, phase: ProtocolPhase, value: unknown, location: string): string {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("not an object");
    }
    const prototype = Object.getPrototypeOf(value);
    const descriptor = Object.getOwnPropertyDescriptor(value, "kind");
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      typeof descriptor.value !== "string"
    ) {
      throw new TypeError("invalid kind field");
    }
    return descriptor.value;
  } catch {
    return invalid(command, phase, `${location} kind could not be safely inspected`);
  }
}

function opaqueId(value: unknown): value is string {
  return boundedText(value, MAXIMUM_ID_BYTES);
}

function moduleRoot(value: unknown): value is string {
  return portableRelativePath(value, MAXIMUM_MODULE_ROOT_BYTES, true);
}

function extractBeginRequest(
  request: unknown,
): Readonly<Xcom2NativeActivationEvidenceBeginRequest> {
  const command = XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS.begin;
  const source = exactDataRecord(
    command,
    "request",
    request,
    [
      "workspaceId",
      "workspaceGeneration",
      "scanId",
      "scanGeneration",
      "configurationReadId",
      "limits",
    ],
    "begin request",
  );
  const limits = exactDataRecord(
    command,
    "request",
    source.limits,
    ["maximumDepth", "maximumEncounteredEntries"],
    "begin request limits",
  );
  if (
    !opaqueId(source.workspaceId) ||
    !positiveSafeInteger(source.workspaceGeneration) ||
    !opaqueId(source.scanId) ||
    !positiveSafeInteger(source.scanGeneration) ||
    !opaqueId(source.configurationReadId) ||
    limits.maximumDepth !== XCOM2_MODULE_SCAN_LIMITS.maximumDepth ||
    limits.maximumEncounteredEntries !== XCOM2_MODULE_SCAN_LIMITS.maximumEncounteredEntries
  ) {
    return invalid(command, "request", "begin request violates the native contract");
  }
  return Object.freeze({
    workspaceId: source.workspaceId,
    workspaceGeneration: source.workspaceGeneration,
    scanId: source.scanId,
    scanGeneration: source.scanGeneration,
    configurationReadId: source.configurationReadId,
    limits: Object.freeze({
      maximumDepth: XCOM2_MODULE_SCAN_LIMITS.maximumDepth,
      maximumEncounteredEntries: XCOM2_MODULE_SCAN_LIMITS.maximumEncounteredEntries,
    }),
  });
}

function compareIssues(
  left: Xcom2NativeActivationCandidate["scan"]["issues"][number],
  right: Xcom2NativeActivationCandidate["scan"]["issues"][number],
): number {
  return (
    ISSUE_KIND_ORDER.get(left.kind)! - ISSUE_KIND_ORDER.get(right.kind)! ||
    compareText(left.relativePath, right.relativePath)
  );
}

function compareObservations(
  left: Xcom2NativeActivationCandidate["scan"]["observations"][number],
  right: Xcom2NativeActivationCandidate["scan"]["observations"][number],
): number {
  return (
    EVIDENCE_KIND_ORDER.get(left.evidenceKind)! - EVIDENCE_KIND_ORDER.get(right.evidenceKind)! ||
    compareText(left.relativePath, right.relativePath) ||
    compareText(left.moduleRoot, right.moduleRoot)
  );
}

function requireStrictOrder<T>(
  command: string,
  values: readonly T[],
  compare: (left: T, right: T) => number,
  location: string,
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1]!, values[index]!) >= 0) {
      invalid(command, "response", `${location} is duplicated or not in native order`);
    }
  }
}

function validateCandidateCanonicalForm(
  command: string,
  candidate: Readonly<Xcom2NativeActivationCandidate>,
): void {
  requireStrictOrder(command, candidate.scan.issues, compareIssues, "scan issues");
  if ((candidate.scan.completeness === "complete") !== (candidate.scan.issues.length === 0)) {
    invalid(command, "response", "scan completeness conflicts with scan issues");
  }
  requireStrictOrder(
    command,
    candidate.scan.observations,
    compareObservations,
    "scan observations",
  );

  const configuredRoots =
    candidate.configuration.kind === "ready"
      ? candidate.configuration.configuration.moduleRoots
      : [];
  if (
    candidate.configuration.kind === "ready" &&
    (candidate.configuration.configuration.version !== XCOM2_MODULE_CONFIGURATION_SCHEMA.version ||
      candidate.configuration.configuration.target !== XCOM2_MODULE_CONFIGURATION_SCHEMA.target ||
      configuredRoots.length < XCOM2_MODULE_CONFIGURATION_LIMITS.minimumModuleRoots)
  ) {
    invalid(command, "response", "configuration payload is unsupported");
  }
  requireStrictOrder(command, configuredRoots, compareText, "configuration module roots");

  const handleOwner = new Map<string, string>();
  const validateHandles = (
    handles: typeof candidate.scan.evidenceHandles,
    expectedRoots: readonly string[],
    location: string,
  ): void => {
    requireStrictOrder(
      command,
      handles,
      (left, right) => compareText(left.moduleRoot, right.moduleRoot),
      location,
    );
    if (
      handles.length !== expectedRoots.length ||
      handles.some(({ moduleRoot: root }, index) => root !== expectedRoots[index])
    ) {
      invalid(command, "response", `${location} do not exactly bind their native facts`);
    }
    for (const { moduleRoot: root, evidenceHandle } of handles) {
      const priorRoot = handleOwner.get(evidenceHandle);
      if (priorRoot !== undefined && priorRoot !== root) {
        invalid(command, "response", "one evidence handle is bound to multiple module roots");
      }
      handleOwner.set(evidenceHandle, root);
    }
  };

  const scanRoots = [
    ...new Set(candidate.scan.observations.map(({ moduleRoot: root }) => root)),
  ].sort(compareText);
  validateHandles(candidate.scan.evidenceHandles, scanRoots, "scan evidence handles");
  validateHandles(
    candidate.configuration.evidenceHandles,
    [...configuredRoots],
    "configuration evidence handles",
  );

  const byRoot = new Map<string, string>();
  for (const { moduleRoot: root, evidenceHandle } of [
    ...candidate.scan.evidenceHandles,
    ...candidate.configuration.evidenceHandles,
  ]) {
    const prior = byRoot.get(root);
    if (prior !== undefined && prior !== evidenceHandle) {
      invalid(command, "response", "one module root is bound to multiple evidence handles");
    }
    byRoot.set(root, evidenceHandle);
  }
}

function normalizeCandidateData(
  command: string,
  data: unknown,
): Readonly<Xcom2NativeActivationCandidate> {
  let decision;
  try {
    decision = beginXcom2NativeActivationEvidence(data as Readonly<Xcom2NativeActivationCandidate>);
  } catch {
    return invalid(command, "response", "activation candidate validation failed");
  }
  if (decision.kind !== "pending") {
    return invalid(command, "response", `activation candidate was refused as ${decision.code}`);
  }
  const candidate = Object.freeze({
    scan: decision.state.scan,
    configuration: decision.state.configuration,
  });
  validateCandidateCanonicalForm(command, candidate);
  return candidate;
}

function normalizeBeginResponse(
  value: unknown,
  request: Readonly<Xcom2NativeActivationEvidenceBeginRequest>,
): Readonly<Xcom2NativeActivationCandidate> {
  const command = XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS.begin;
  const candidate = normalizeCandidateData(command, copyUnknownData(command, value));
  if (
    candidate.scan.workspaceId !== request.workspaceId ||
    candidate.scan.workspaceGeneration !== request.workspaceGeneration ||
    candidate.scan.scanId !== request.scanId ||
    candidate.scan.scanGeneration !== request.scanGeneration ||
    candidate.scan.limits.maximumDepth !== request.limits.maximumDepth ||
    candidate.scan.limits.maximumEncounteredEntries !== request.limits.maximumEncounteredEntries ||
    candidate.configuration.configurationReadId !== request.configurationReadId
  ) {
    return invalid(command, "response", "activation candidate correlation is stale");
  }
  return candidate;
}

function normalizeAcknowledgment(
  command: string,
  phase: ProtocolPhase,
  value: unknown,
): Readonly<Xcom2NativeActivationAcknowledgment> {
  const source = exactDataRecord(
    command,
    phase,
    value,
    ["activationAttemptReceipt", "evidenceHandles"],
    "activation acknowledgment",
  );
  const handles = exactDenseArray(
    command,
    phase,
    source.evidenceHandles,
    MAXIMUM_HANDLES,
    "activation acknowledgment handles",
  );
  if (
    !opaqueId(source.activationAttemptReceipt) ||
    handles.some((handle) => !opaqueId(handle)) ||
    new Set(handles).size !== handles.length
  ) {
    return invalid(command, phase, "activation acknowledgment is malformed or duplicated");
  }
  return Object.freeze({
    activationAttemptReceipt: source.activationAttemptReceipt,
    evidenceHandles: Object.freeze([...handles] as string[]),
  });
}

function sameAcknowledgment(
  left: Readonly<Xcom2NativeActivationAcknowledgment>,
  right: Readonly<Xcom2NativeActivationAcknowledgment>,
): boolean {
  return (
    left.activationAttemptReceipt === right.activationAttemptReceipt &&
    left.evidenceHandles.length === right.evidenceHandles.length &&
    left.evidenceHandles.every((handle, index) => handle === right.evidenceHandles[index])
  );
}

function normalizeState(
  command: string,
  value: unknown,
): Readonly<Xcom2NativeActivationEvidenceState> {
  const kind = dataKind(command, "response", value, "activation state");
  if (kind === "revoked") {
    const source = exactDataRecord(
      command,
      "response",
      value,
      ["kind", "code"],
      "revoked activation state",
    );
    if (!REVOCATION_CODES.has(source.code as string)) {
      return invalid(command, "response", "revocation code is unsupported");
    }
    return Object.freeze({
      kind: "revoked",
      code: source.code as Extract<Xcom2NativeActivationEvidenceState, { kind: "revoked" }>["code"],
    });
  }

  if (kind === "pending") {
    const source = exactDataRecord(
      command,
      "response",
      value,
      [
        "kind",
        "workspaceId",
        "workspaceGeneration",
        "activationGeneration",
        "activationAttemptReceipt",
        "scan",
        "configuration",
      ],
      "pending activation state",
    );
    const candidate = normalizeCandidateData(command, {
      scan: source.scan,
      configuration: source.configuration,
    });
    if (
      source.workspaceId !== candidate.scan.workspaceId ||
      source.workspaceGeneration !== candidate.scan.workspaceGeneration ||
      source.activationGeneration !== candidate.scan.activationGeneration ||
      source.activationAttemptReceipt !== candidate.scan.activationAttemptReceipt
    ) {
      return invalid(command, "response", "pending state correlation is inconsistent");
    }
    return Object.freeze({
      kind: "pending",
      workspaceId: candidate.scan.workspaceId,
      workspaceGeneration: candidate.scan.workspaceGeneration,
      activationGeneration: candidate.scan.activationGeneration,
      activationAttemptReceipt: candidate.scan.activationAttemptReceipt,
      scan: candidate.scan,
      configuration: candidate.configuration,
    });
  }

  if (kind === "acknowledged") {
    const source = exactDataRecord(
      command,
      "response",
      value,
      [
        "kind",
        "workspaceId",
        "workspaceGeneration",
        "activationGeneration",
        "activationAttemptReceipt",
        "acknowledgment",
        "selectedModules",
      ],
      "acknowledged activation state",
    );
    if (
      !opaqueId(source.workspaceId) ||
      !positiveSafeInteger(source.workspaceGeneration) ||
      !positiveSafeInteger(source.activationGeneration) ||
      !opaqueId(source.activationAttemptReceipt)
    ) {
      return invalid(command, "response", "acknowledged state correlation is malformed");
    }
    const acknowledgment = normalizeAcknowledgment(command, "response", source.acknowledgment);
    const selectedSource = exactDenseArray(
      command,
      "response",
      source.selectedModules,
      MAXIMUM_HANDLES,
      "selected activation modules",
    );
    if (selectedSource.length === 0) {
      return invalid(command, "response", "acknowledged state has no selected modules");
    }
    const selectedModules = selectedSource.map((entry, index) => {
      const module = exactDataRecord(
        command,
        "response",
        entry,
        ["moduleRoot", "evidenceHandle"],
        `selected activation module ${index}`,
      );
      if (!moduleRoot(module.moduleRoot) || !opaqueId(module.evidenceHandle)) {
        return invalid(command, "response", "selected activation module is malformed");
      }
      return Object.freeze({
        moduleRoot: module.moduleRoot,
        evidenceHandle: module.evidenceHandle,
      });
    });
    requireStrictOrder(
      command,
      selectedModules,
      (left, right) => compareText(left.moduleRoot, right.moduleRoot),
      "selected activation modules",
    );
    if (
      source.activationAttemptReceipt !== acknowledgment.activationAttemptReceipt ||
      acknowledgment.evidenceHandles.length !== selectedModules.length ||
      acknowledgment.evidenceHandles.some(
        (handle, index) => handle !== selectedModules[index]?.evidenceHandle,
      ) ||
      new Set(selectedModules.map(({ evidenceHandle }) => evidenceHandle)).size !==
        selectedModules.length
    ) {
      return invalid(command, "response", "acknowledged state bindings are inconsistent");
    }
    return Object.freeze({
      kind: "acknowledged",
      workspaceId: source.workspaceId,
      workspaceGeneration: source.workspaceGeneration,
      activationGeneration: source.activationGeneration,
      activationAttemptReceipt: source.activationAttemptReceipt,
      acknowledgment,
      selectedModules: Object.freeze(selectedModules),
    });
  }

  return invalid(command, "response", "activation state kind is unsupported");
}

function normalizeAcknowledgmentDecision(
  value: unknown,
  request: Readonly<Xcom2NativeActivationAcknowledgment>,
): Readonly<Xcom2NativeActivationAcknowledgmentDecision> {
  const command = XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS.acknowledge;
  const data = copyUnknownData(command, value);
  const kind = dataKind(command, "response", data, "acknowledgment decision");
  if (kind === "acknowledged") {
    const source = exactDataRecord(
      command,
      "response",
      data,
      ["kind", "acknowledgment", "state"],
      "acknowledged decision",
    );
    const acknowledgment = normalizeAcknowledgment(command, "response", source.acknowledgment);
    const state = normalizeState(command, source.state);
    if (
      state.kind !== "acknowledged" ||
      !sameAcknowledgment(acknowledgment, request) ||
      !sameAcknowledgment(state.acknowledgment, request)
    ) {
      return invalid(command, "response", "acknowledgment decision bindings are stale");
    }
    return Object.freeze({ kind: "acknowledged", acknowledgment, state });
  }
  if (kind === "refused") {
    const source = exactDataRecord(
      command,
      "response",
      data,
      ["kind", "code", "state"],
      "refused acknowledgment decision",
    );
    if (!ACKNOWLEDGMENT_REFUSAL_CODES.has(source.code as string)) {
      return invalid(command, "response", "acknowledgment refusal code is unsupported");
    }
    return Object.freeze({
      kind: "refused",
      code: source.code as Extract<
        Xcom2NativeActivationAcknowledgmentDecision,
        { kind: "refused" }
      >["code"],
      state: normalizeState(command, source.state),
    });
  }
  return invalid(command, "response", "acknowledgment decision kind is unsupported");
}

function extractLifecycleEvent(value: unknown): Readonly<Xcom2NativeActivationLifecycleEvent> {
  const command = XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS.revoke;
  const kind = dataKind(command, "request", value, "lifecycle event");
  if (kind === "newer-activation-generation") {
    const source = exactDataRecord(
      command,
      "request",
      value,
      ["kind", "activationGeneration"],
      "newer-generation lifecycle event",
    );
    if (!positiveSafeInteger(source.activationGeneration)) {
      return invalid(command, "request", "lifecycle generation is invalid");
    }
    return Object.freeze({
      kind: "newer-activation-generation",
      activationGeneration: source.activationGeneration,
    });
  }
  if (!SIMPLE_LIFECYCLE_EVENTS.has(kind)) {
    return invalid(command, "request", "lifecycle event kind is unsupported");
  }
  exactDataRecord(command, "request", value, ["kind"], "lifecycle event");
  return Object.freeze({ kind } as Xcom2NativeActivationLifecycleEvent);
}

function normalizeLifecycleDecision(
  value: unknown,
  event: Readonly<Xcom2NativeActivationLifecycleEvent>,
): Readonly<Xcom2NativeActivationLifecycleDecision> {
  const command = XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS.revoke;
  const data = copyUnknownData(command, value);
  const kind = dataKind(command, "response", data, "lifecycle decision");
  if (kind === "revoked") {
    const source = exactDataRecord(
      command,
      "response",
      data,
      ["kind", "state"],
      "revoked lifecycle decision",
    );
    const state = normalizeState(command, source.state);
    if (state.kind !== "revoked" || state.code !== event.kind) {
      return invalid(command, "response", "revocation does not match the requested event");
    }
    return Object.freeze({ kind: "revoked", state });
  }
  if (kind === "retained") {
    const source = exactDataRecord(
      command,
      "response",
      data,
      ["kind", "state"],
      "retained lifecycle decision",
    );
    if (event.kind !== "newer-activation-generation") {
      return invalid(command, "response", "only a newer-generation event may be retained");
    }
    return Object.freeze({ kind: "retained", state: normalizeState(command, source.state) });
  }
  return invalid(command, "response", "lifecycle decision kind is unsupported");
}

/** Strict native bridge for opaque XCOM activation evidence lifecycle commands. */
export class TauriXcom2NativeActivationEvidenceAdapter implements Xcom2NativeActivationEvidencePort {
  async begin(
    request: Readonly<Xcom2NativeActivationEvidenceBeginRequest>,
  ): Promise<Readonly<Xcom2NativeActivationCandidate>> {
    const extracted = extractBeginRequest(request);
    const response = await invokeNativeUnknown(
      XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS.begin,
      Object.freeze({ request: extracted }),
    );
    return normalizeBeginResponse(response, extracted);
  }

  async acknowledge(
    acknowledgment: Readonly<Xcom2NativeActivationAcknowledgment>,
  ): Promise<Readonly<Xcom2NativeActivationAcknowledgmentDecision>> {
    const command = XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS.acknowledge;
    const extracted = normalizeAcknowledgment(command, "request", acknowledgment);
    const response = await invokeNativeUnknown(
      command,
      Object.freeze({ acknowledgment: extracted }),
    );
    return normalizeAcknowledgmentDecision(response, extracted);
  }

  async revoke(
    event: Readonly<Xcom2NativeActivationLifecycleEvent>,
  ): Promise<Readonly<Xcom2NativeActivationLifecycleDecision>> {
    const command = XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS.revoke;
    const extracted = extractLifecycleEvent(event);
    const response = await invokeNativeUnknown(command, Object.freeze({ event: extracted }));
    return normalizeLifecycleDecision(response, extracted);
  }
}

export function createTauriXcom2NativeActivationEvidencePort(): Xcom2NativeActivationEvidencePort {
  return new TauriXcom2NativeActivationEvidenceAdapter();
}
