import {
  XCOM2_MODULE_EVIDENCE_KINDS,
  type Xcom2ModuleActivationReason,
  type Xcom2ModuleEvidenceObservation,
  type Xcom2ModuleScanIssue,
} from "./xcom2-module-activation";
import {
  XCOM2_MODULE_CONFIGURATION_LIMITS,
  type Xcom2ModuleConfiguration,
  type Xcom2ProjectActivationDecision,
  type Xcom2ProjectActivationEvaluation,
  type Xcom2ProjectActivationReason,
  type Xcom2ProjectActivationSnapshot,
} from "./xcom2-module-configuration-activation";
import {
  XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS,
  type Xcom2NativeAcceptedActivationSnapshot,
  type Xcom2NativeActivationAcknowledgmentDecision,
  type Xcom2NativeActivationBeginDecision,
  type Xcom2NativeActivationCandidate,
  type Xcom2NativeActivationCorrelation,
  type Xcom2NativeActivationCurrent,
  type Xcom2NativeActivationEvidenceHandle,
  type Xcom2NativeActivationEvidenceState,
  type Xcom2NativeActivationLifecycleDecision,
  type Xcom2NativeActivationLifecycleEvent,
  type Xcom2NativeInspectionAuthorizationDecision,
  type Xcom2NativeInspectionCurrent,
  type Xcom2NativeModuleConfigurationReadResult,
  type Xcom2NativeModuleScanSnapshot,
  type Xcom2NativeSelectedActivationModule,
} from "./xcom2-native-activation-evidence";

const EVIDENCE_KINDS = new Set<unknown>(XCOM2_MODULE_EVIDENCE_KINDS);
const SCAN_COMPLETENESS = new Set<unknown>(["complete", "partial"]);
const SCAN_ISSUES = new Set<unknown>([
  "unreadable-entry",
  "unreadable-subtree",
  "depth-limit-reached",
  "encountered-entry-limit-reached",
]);
const CONFIGURATION_STOP_CODES = new Set<unknown>([
  "configuration-unreadable",
  "configuration-too-large",
  "configuration-invalid-utf8",
  "configuration-invalid-json",
  "configuration-invalid-schema",
  "configuration-unsupported-version",
  "configuration-unsupported-target",
  "configuration-invalid-module-roots",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareLexically);
  const expected = [...keys].sort(compareLexically);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function compareLexically(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function utf8ByteLength(value: string): number | undefined {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x7f) bytes += 1;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return undefined;
      bytes += 4;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return undefined;
    else bytes += 3;
  }
  return bytes;
}

function boundedString(value: unknown, maximumBytes: number): value is string {
  if (typeof value !== "string") return false;
  const bytes = utf8ByteLength(value);
  if (bytes === undefined || bytes === 0 || bytes > maximumBytes) return false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f)) return false;
  }
  return true;
}

function opaqueId(value: unknown): value is string {
  return boundedString(value, XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS.maximumOpaqueIdBytes);
}

function moduleRoot(value: unknown): value is string {
  return boundedString(value, XCOM2_MODULE_CONFIGURATION_LIMITS.maximumModuleRootBytes);
}

function generation(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validCorrelation(value: Record<string, unknown>): boolean {
  return (
    opaqueId(value.workspaceId) &&
    generation(value.workspaceGeneration) &&
    generation(value.activationGeneration) &&
    opaqueId(value.activationAttemptReceipt)
  );
}

function sameAttempt(
  left: Readonly<Xcom2NativeActivationCorrelation>,
  right: Readonly<Xcom2NativeActivationCorrelation>,
): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.workspaceGeneration === right.workspaceGeneration &&
    left.activationGeneration === right.activationGeneration &&
    left.activationAttemptReceipt === right.activationAttemptReceipt
  );
}

function validIssue(value: unknown): value is Readonly<Xcom2ModuleScanIssue> {
  return (
    record(value) &&
    hasExactKeys(value, ["kind", "relativePath"]) &&
    SCAN_ISSUES.has(value.kind) &&
    moduleRoot(value.relativePath)
  );
}

function validObservation(value: unknown): value is Readonly<Xcom2ModuleEvidenceObservation> {
  return (
    record(value) &&
    hasExactKeys(value, ["evidenceKind", "moduleRoot", "relativePath"]) &&
    EVIDENCE_KINDS.has(value.evidenceKind) &&
    moduleRoot(value.moduleRoot) &&
    moduleRoot(value.relativePath)
  );
}

function validEvidenceHandle(
  value: unknown,
): value is Readonly<Xcom2NativeActivationEvidenceHandle> {
  return (
    record(value) &&
    hasExactKeys(value, ["moduleRoot", "evidenceHandle"]) &&
    moduleRoot(value.moduleRoot) &&
    opaqueId(value.evidenceHandle)
  );
}

function validHandleList(
  value: unknown,
): value is readonly Readonly<Xcom2NativeActivationEvidenceHandle>[] {
  return (
    Array.isArray(value) &&
    value.length <= XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS.maximumEvidenceHandles &&
    value.every(validEvidenceHandle)
  );
}

function validScan(value: unknown): value is Readonly<Xcom2NativeModuleScanSnapshot> {
  if (!record(value)) return false;
  return (
    hasExactKeys(value, [
      "workspaceId",
      "workspaceGeneration",
      "activationGeneration",
      "activationAttemptReceipt",
      "scanId",
      "scanGeneration",
      "completeness",
      "issues",
      "limits",
      "observations",
      "evidenceHandles",
    ]) &&
    validCorrelation(value) &&
    opaqueId(value.scanId) &&
    generation(value.scanGeneration) &&
    SCAN_COMPLETENESS.has(value.completeness) &&
    Array.isArray(value.issues) &&
    value.issues.length <= 20_000 &&
    value.issues.every(validIssue) &&
    record(value.limits) &&
    hasExactKeys(value.limits, ["maximumDepth", "maximumEncounteredEntries"]) &&
    value.limits.maximumDepth === 8 &&
    value.limits.maximumEncounteredEntries === 20_000 &&
    Array.isArray(value.observations) &&
    value.observations.length <= 20_000 &&
    value.observations.every(validObservation) &&
    validHandleList(value.evidenceHandles)
  );
}

function validConfigurationShape(value: unknown): value is Readonly<Xcom2ModuleConfiguration> {
  if (!record(value) || !hasExactKeys(value, ["version", "target", "moduleRoots"])) return false;
  return (
    typeof value.version === "number" &&
    typeof value.target === "string" &&
    Array.isArray(value.moduleRoots) &&
    value.moduleRoots.length <= XCOM2_MODULE_CONFIGURATION_LIMITS.maximumModuleRoots &&
    value.moduleRoots.every(moduleRoot)
  );
}

function validConfiguration(
  value: unknown,
): value is Readonly<Xcom2NativeModuleConfigurationReadResult> {
  if (!record(value) || !validCorrelation(value) || !opaqueId(value.configurationReadId)) {
    return false;
  }
  const common = [
    "workspaceId",
    "workspaceGeneration",
    "activationGeneration",
    "activationAttemptReceipt",
    "configurationReadId",
    "kind",
    "evidenceHandles",
  ];
  if (!validHandleList(value.evidenceHandles)) return false;
  if (value.kind === "absent") return hasExactKeys(value, common);
  if (value.kind === "ready") {
    return (
      hasExactKeys(value, [...common, "configuration"]) &&
      validConfigurationShape(value.configuration)
    );
  }
  if (value.kind === "stopped") {
    return hasExactKeys(value, [...common, "code"]) && CONFIGURATION_STOP_CODES.has(value.code);
  }
  return false;
}

function cloneHandle(
  value: Readonly<Xcom2NativeActivationEvidenceHandle>,
): Readonly<Xcom2NativeActivationEvidenceHandle> {
  return Object.freeze({ moduleRoot: value.moduleRoot, evidenceHandle: value.evidenceHandle });
}

function cloneScan(
  value: Readonly<Xcom2NativeModuleScanSnapshot>,
): Readonly<Xcom2NativeModuleScanSnapshot> {
  return Object.freeze({
    workspaceId: value.workspaceId,
    workspaceGeneration: value.workspaceGeneration,
    activationGeneration: value.activationGeneration,
    activationAttemptReceipt: value.activationAttemptReceipt,
    scanId: value.scanId,
    scanGeneration: value.scanGeneration,
    completeness: value.completeness,
    issues: Object.freeze(
      value.issues.map(({ kind, relativePath }) => Object.freeze({ kind, relativePath })),
    ),
    limits: Object.freeze({
      maximumDepth: value.limits.maximumDepth,
      maximumEncounteredEntries: value.limits.maximumEncounteredEntries,
    }),
    observations: Object.freeze(
      value.observations.map(({ evidenceKind, moduleRoot: root, relativePath }) =>
        Object.freeze({ evidenceKind, moduleRoot: root, relativePath }),
      ),
    ),
    evidenceHandles: Object.freeze(value.evidenceHandles.map(cloneHandle)),
  });
}

function cloneConfiguration(
  value: Readonly<Xcom2NativeModuleConfigurationReadResult>,
): Readonly<Xcom2NativeModuleConfigurationReadResult> {
  const common = {
    workspaceId: value.workspaceId,
    workspaceGeneration: value.workspaceGeneration,
    activationGeneration: value.activationGeneration,
    activationAttemptReceipt: value.activationAttemptReceipt,
    configurationReadId: value.configurationReadId,
    evidenceHandles: Object.freeze(value.evidenceHandles.map(cloneHandle)),
  };
  if (value.kind === "absent") return Object.freeze({ ...common, kind: "absent" });
  if (value.kind === "stopped") {
    return Object.freeze({ ...common, kind: "stopped", code: value.code });
  }
  return Object.freeze({
    ...common,
    kind: "ready",
    configuration: Object.freeze({
      version: value.configuration.version,
      target: value.configuration.target,
      moduleRoots: Object.freeze([...value.configuration.moduleRoots]),
    }),
  });
}

function revoked(
  code: Extract<Xcom2NativeActivationEvidenceState, { kind: "revoked" }>["code"],
): Readonly<Extract<Xcom2NativeActivationEvidenceState, { kind: "revoked" }>> {
  return Object.freeze({ kind: "revoked", code });
}

/** Validate and immutably retain one native-issued activation attempt. */
export function beginXcom2NativeActivationEvidence(
  candidate: Readonly<Xcom2NativeActivationCandidate>,
): Readonly<Xcom2NativeActivationBeginDecision> {
  if (!record(candidate) || !hasExactKeys(candidate, ["scan", "configuration"])) {
    return Object.freeze({
      kind: "refused",
      code: "candidate-invalid",
      state: revoked("candidate-invalid"),
    });
  }
  if (!validScan(candidate.scan) || !validConfiguration(candidate.configuration)) {
    return Object.freeze({
      kind: "refused",
      code: "candidate-invalid",
      state: revoked("candidate-invalid"),
    });
  }
  if (!sameAttempt(candidate.scan, candidate.configuration)) {
    return Object.freeze({
      kind: "refused",
      code: "mixed-activation-attempt",
      state: revoked("mixed-activation-attempt"),
    });
  }

  const scan = cloneScan(candidate.scan);
  const configuration = cloneConfiguration(candidate.configuration);
  const state = Object.freeze({
    kind: "pending" as const,
    workspaceId: scan.workspaceId,
    workspaceGeneration: scan.workspaceGeneration,
    activationGeneration: scan.activationGeneration,
    activationAttemptReceipt: scan.activationAttemptReceipt,
    scan,
    configuration,
  });
  return Object.freeze({ kind: "pending", state });
}

function validRecognitionReason(value: unknown): value is Readonly<Xcom2ModuleActivationReason> {
  return (
    record(value) &&
    hasExactKeys(value, ["kind", "evidenceKind", "relativePath"]) &&
    value.kind === "recognition" &&
    EVIDENCE_KINDS.has(value.evidenceKind) &&
    moduleRoot(value.relativePath)
  );
}

function validActivationReason(value: unknown): value is Readonly<Xcom2ProjectActivationReason> {
  if (!record(value)) return false;
  if (value.kind === "configuration") {
    return hasExactKeys(value, ["kind", "target"]) && value.target === "wotc";
  }
  return validRecognitionReason(value);
}

function validDecision(value: unknown): value is Readonly<Xcom2ProjectActivationDecision> {
  if (!record(value) || !moduleRoot(value.moduleRoot) || !Array.isArray(value.reasons))
    return false;
  if (value.state === "needs-confirmation") {
    return (
      hasExactKeys(value, ["moduleRoot", "state", "source", "recognitionConfidence", "reasons"]) &&
      value.source === "recognized" &&
      value.recognitionConfidence === "medium" &&
      value.reasons.every(validRecognitionReason)
    );
  }
  return (
    value.state === "active" &&
    hasExactKeys(value, [
      "moduleRoot",
      "state",
      "source",
      "activationConfidence",
      "recognitionConfidence",
      "reasons",
    ]) &&
    new Set(["configured", "recognized", "configured-and-recognized"]).has(
      value.source as string,
    ) &&
    new Set(["explicit", "high"]).has(value.activationConfidence as string) &&
    new Set(["none", "medium", "high"]).has(value.recognitionConfidence as string) &&
    value.reasons.every(validActivationReason)
  );
}

function validSnapshot(value: unknown): value is Readonly<Xcom2ProjectActivationSnapshot> {
  if (!record(value)) return false;
  const required = [
    "workspaceId",
    "workspaceGeneration",
    "activationGeneration",
    "configurationReadId",
    "scanId",
    "scanGeneration",
    "state",
    "recognitionConfidence",
    "decisions",
  ];
  const keys = value.diagnostic === undefined ? required : [...required, "diagnostic"];
  return (
    hasExactKeys(value, keys) &&
    opaqueId(value.workspaceId) &&
    generation(value.workspaceGeneration) &&
    generation(value.activationGeneration) &&
    opaqueId(value.configurationReadId) &&
    opaqueId(value.scanId) &&
    generation(value.scanGeneration) &&
    new Set(["inactive", "needs-confirmation", "active"]).has(value.state as string) &&
    new Set(["none", "medium", "high"]).has(value.recognitionConfidence as string) &&
    Array.isArray(value.decisions) &&
    value.decisions.length <= XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS.maximumEvidenceHandles &&
    value.decisions.every(validDecision) &&
    (value.diagnostic === undefined ||
      (record(value.diagnostic) &&
        hasExactKeys(value.diagnostic, ["code"]) &&
        CONFIGURATION_STOP_CODES.has(value.diagnostic.code)))
  );
}

function validEvaluation(value: unknown): value is Readonly<Xcom2ProjectActivationEvaluation> {
  if (!record(value)) return false;
  if (value.kind === "rejected") {
    return (
      hasExactKeys(value, ["kind", "reason"]) &&
      new Set(["configuration-correlation-mismatch", "recognition-correlation-mismatch"]).has(
        value.reason as string,
      )
    );
  }
  return (
    value.kind === "accepted" &&
    hasExactKeys(value, ["kind", "snapshot"]) &&
    validSnapshot(value.snapshot)
  );
}

function validCurrent(value: unknown): value is Readonly<Xcom2NativeActivationCurrent> {
  return (
    record(value) &&
    hasExactKeys(value, [
      "workspaceId",
      "workspaceGeneration",
      "activationGeneration",
      "activationAttemptReceipt",
    ]) &&
    validCorrelation(value)
  );
}

function refusedAcknowledgment(
  code: Exclude<Xcom2NativeActivationAcknowledgmentDecision, { kind: "acknowledged" }>["code"],
  state: Readonly<Xcom2NativeActivationEvidenceState>,
): Readonly<Xcom2NativeActivationAcknowledgmentDecision> {
  return Object.freeze({ kind: "refused", code, state });
}

function mapHandles(
  handles: readonly Readonly<Xcom2NativeActivationEvidenceHandle>[],
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>();
  for (const { moduleRoot: root, evidenceHandle } of handles) {
    const existing = result.get(root);
    if (existing) existing.push(evidenceHandle);
    else result.set(root, [evidenceHandle]);
  }
  return result;
}

function validateRetainedHandles(
  scanHandles: readonly Readonly<Xcom2NativeActivationEvidenceHandle>[],
  configurationHandles: readonly Readonly<Xcom2NativeActivationEvidenceHandle>[],
  scanFacts: ReadonlySet<string>,
  configurationFacts: ReadonlySet<string>,
): "duplicate-evidence-handle" | "unknown-evidence-handle" | undefined {
  const handleRoots = new Map<string, string>();

  for (const [handles, facts] of [
    [scanHandles, scanFacts],
    [configurationHandles, configurationFacts],
  ] as const) {
    const roots = new Map<string, string>();
    for (const { moduleRoot: root, evidenceHandle } of handles) {
      if (!facts.has(root)) return "unknown-evidence-handle";
      const priorForRoot = roots.get(root);
      if (priorForRoot === evidenceHandle) return "duplicate-evidence-handle";
      if (priorForRoot !== undefined) return "unknown-evidence-handle";
      roots.set(root, evidenceHandle);

      const priorRoot = handleRoots.get(evidenceHandle);
      if (priorRoot !== undefined && priorRoot !== root) return "duplicate-evidence-handle";
      handleRoots.set(evidenceHandle, root);
    }
  }
  return undefined;
}

/** Map only current evaluator-approved active roots to native-retained opaque handles. */
export function acknowledgeXcom2NativeActivationEvidence(
  state: Readonly<Xcom2NativeActivationEvidenceState>,
  evaluation: Readonly<Xcom2ProjectActivationEvaluation>,
  current: Readonly<Xcom2NativeActivationCurrent>,
): Readonly<Xcom2NativeActivationAcknowledgmentDecision> {
  if (state.kind !== "pending") return refusedAcknowledgment("authority-unavailable", state);
  if (!validCurrent(current) || !validEvaluation(evaluation)) {
    return refusedAcknowledgment("evaluation-invalid", state);
  }
  if (
    current.workspaceId !== state.workspaceId ||
    current.workspaceGeneration !== state.workspaceGeneration ||
    current.activationGeneration !== state.activationGeneration ||
    current.activationAttemptReceipt !== state.activationAttemptReceipt
  ) {
    return refusedAcknowledgment("stale-correlation", state);
  }
  if (evaluation.kind === "rejected") return refusedAcknowledgment("stale-correlation", state);

  const snapshot = evaluation.snapshot;
  if (
    snapshot.workspaceId !== state.workspaceId ||
    snapshot.workspaceGeneration !== state.workspaceGeneration ||
    snapshot.activationGeneration !== state.activationGeneration ||
    snapshot.scanId !== state.scan.scanId ||
    snapshot.scanGeneration !== state.scan.scanGeneration ||
    snapshot.configurationReadId !== state.configuration.configurationReadId
  ) {
    return refusedAcknowledgment("stale-correlation", state);
  }
  if (state.scan.completeness !== "complete") {
    return refusedAcknowledgment("incomplete-evidence", state);
  }
  if (snapshot.state === "inactive") return refusedAcknowledgment("inactive", state);
  if (snapshot.state === "needs-confirmation") {
    return refusedAcknowledgment("needs-confirmation", state);
  }

  const active = snapshot.decisions.filter(
    (decision): decision is Extract<Xcom2ProjectActivationDecision, { state: "active" }> =>
      decision.state === "active",
  );
  if (active.length === 0) return refusedAcknowledgment("weak-evidence", state);

  const scanFacts = new Set(state.scan.observations.map(({ moduleRoot: root }) => root));
  const configurationFacts = new Set(
    state.configuration.kind === "ready" ? state.configuration.configuration.moduleRoots : [],
  );
  const retainedHandleRefusal = validateRetainedHandles(
    state.scan.evidenceHandles,
    state.configuration.evidenceHandles,
    scanFacts,
    configurationFacts,
  );
  if (retainedHandleRefusal) return refusedAcknowledgment(retainedHandleRefusal, state);

  const scanHandles = mapHandles(state.scan.evidenceHandles);
  const configurationHandles = mapHandles(state.configuration.evidenceHandles);
  const selected: Xcom2NativeSelectedActivationModule[] = [];

  for (const decision of [...active].sort((left, right) =>
    compareLexically(left.moduleRoot, right.moduleRoot),
  )) {
    const needsScan = decision.source !== "configured";
    const needsConfiguration = decision.source !== "recognized";
    if (
      (needsScan && !scanFacts.has(decision.moduleRoot)) ||
      (needsConfiguration && !configurationFacts.has(decision.moduleRoot))
    ) {
      return refusedAcknowledgment("unknown-evidence-handle", state);
    }

    const fromScan = needsScan ? scanHandles.get(decision.moduleRoot) : undefined;
    const fromConfiguration = needsConfiguration
      ? configurationHandles.get(decision.moduleRoot)
      : undefined;
    if (
      (needsScan && fromScan?.length !== 1) ||
      (needsConfiguration && fromConfiguration?.length !== 1)
    ) {
      return refusedAcknowledgment("unknown-evidence-handle", state);
    }
    const evidenceHandle = fromScan?.[0] ?? fromConfiguration?.[0];
    if (
      evidenceHandle === undefined ||
      (fromScan?.[0] !== undefined &&
        fromConfiguration?.[0] !== undefined &&
        fromScan[0] !== fromConfiguration[0])
    ) {
      return refusedAcknowledgment("unknown-evidence-handle", state);
    }
    selected.push({ moduleRoot: decision.moduleRoot, evidenceHandle });
  }

  if (new Set(selected.map(({ evidenceHandle }) => evidenceHandle)).size !== selected.length) {
    return refusedAcknowledgment("duplicate-evidence-handle", state);
  }

  const selectedModules = Object.freeze(
    selected.map(({ moduleRoot: root, evidenceHandle }) =>
      Object.freeze({ moduleRoot: root, evidenceHandle }),
    ),
  );
  const acknowledgment = Object.freeze({
    activationAttemptReceipt: state.activationAttemptReceipt,
    evidenceHandles: Object.freeze(selectedModules.map(({ evidenceHandle }) => evidenceHandle)),
  });
  const acknowledgedState = Object.freeze({
    kind: "acknowledged" as const,
    workspaceId: state.workspaceId,
    workspaceGeneration: state.workspaceGeneration,
    activationGeneration: state.activationGeneration,
    activationAttemptReceipt: state.activationAttemptReceipt,
    acknowledgment,
    selectedModules,
  });
  return Object.freeze({ kind: "acknowledged", acknowledgment, state: acknowledgedState });
}

function validLifecycleEvent(
  value: unknown,
): value is Readonly<Xcom2NativeActivationLifecycleEvent> {
  if (!record(value) || typeof value.kind !== "string") return false;
  if (value.kind === "newer-activation-generation") {
    return (
      hasExactKeys(value, ["kind", "activationGeneration"]) &&
      generation(value.activationGeneration)
    );
  }
  return (
    new Set([
      "workspace-refresh",
      "workspace-switch-started",
      "workspace-activation-started",
      "workspace-activation-failed",
      "activation-attempt-failed",
      "app-exit",
      "cached-react-restoration",
    ]).has(value.kind) && hasExactKeys(value, ["kind"])
  );
}

/** Apply synchronous revocation events; a cached presentation restoration is revocation only. */
export function transitionXcom2NativeActivationEvidence(
  state: Readonly<Xcom2NativeActivationEvidenceState>,
  event: Readonly<Xcom2NativeActivationLifecycleEvent>,
): Readonly<Xcom2NativeActivationLifecycleDecision> {
  if (!validLifecycleEvent(event)) {
    return Object.freeze({ kind: "refused", code: "event-invalid", state });
  }
  if (event.kind === "newer-activation-generation") {
    if (state.kind === "revoked" || event.activationGeneration <= state.activationGeneration) {
      return Object.freeze({ kind: "retained", state });
    }
    const next = revoked("newer-activation-generation");
    return Object.freeze({ kind: "revoked", state: next });
  }
  const next = revoked(event.kind);
  return Object.freeze({ kind: "revoked", state: next });
}

function validInspectionRequest(value: unknown): value is Readonly<Xcom2NativeInspectionCurrent> {
  return (
    record(value) &&
    hasExactKeys(value, ["workspaceId", "generation", "moduleRoot"]) &&
    opaqueId(value.workspaceId) &&
    generation(value.generation) &&
    moduleRoot(value.moduleRoot)
  );
}

function validAcceptedSnapshot(
  value: unknown,
): value is Readonly<Xcom2NativeAcceptedActivationSnapshot> {
  if (
    !record(value) ||
    !hasExactKeys(value, [
      "workspaceId",
      "workspaceGeneration",
      "activationGeneration",
      "activationAttemptReceipt",
      "modules",
    ]) ||
    !validCorrelation(value) ||
    !Array.isArray(value.modules) ||
    value.modules.length === 0 ||
    value.modules.length > XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS.maximumEvidenceHandles ||
    !value.modules.every(validEvidenceHandle)
  ) {
    return false;
  }
  const roots = value.modules.map(
    (entry) => (entry as Xcom2NativeSelectedActivationModule).moduleRoot,
  );
  const handles = value.modules.map(
    (entry) => (entry as Xcom2NativeSelectedActivationModule).evidenceHandle,
  );
  return new Set(roots).size === roots.length && new Set(handles).size === handles.length;
}

/**
 * Bind the existing token-free inspection identity to the current native accepted snapshot.
 * Authorization results deliberately disclose neither receipt nor evidence handle.
 */
export function authorizeXcom2NativeBuildRecipeInspection(
  state: Readonly<Xcom2NativeActivationEvidenceState>,
  current: Readonly<Xcom2NativeInspectionCurrent>,
  acceptedSnapshot: Readonly<Xcom2NativeAcceptedActivationSnapshot>,
): Readonly<Xcom2NativeInspectionAuthorizationDecision> {
  if (!validInspectionRequest(current)) {
    return Object.freeze({ kind: "refused", code: "request-invalid" });
  }
  if (state.kind !== "acknowledged") {
    return Object.freeze({ kind: "refused", code: "authority-unavailable" });
  }
  if (!validAcceptedSnapshot(acceptedSnapshot)) {
    return Object.freeze({ kind: "refused", code: "accepted-snapshot-invalid" });
  }
  if (
    acceptedSnapshot.workspaceId !== state.workspaceId ||
    acceptedSnapshot.workspaceGeneration !== state.workspaceGeneration ||
    acceptedSnapshot.activationGeneration !== state.activationGeneration ||
    acceptedSnapshot.activationAttemptReceipt !== state.activationAttemptReceipt ||
    acceptedSnapshot.modules.length !== state.selectedModules.length ||
    acceptedSnapshot.modules.some(
      (module, index) =>
        module.moduleRoot !== state.selectedModules[index]?.moduleRoot ||
        module.evidenceHandle !== state.selectedModules[index]?.evidenceHandle,
    )
  ) {
    return Object.freeze({ kind: "refused", code: "accepted-snapshot-mismatch" });
  }
  if (
    current.workspaceId !== state.workspaceId ||
    current.generation !== state.workspaceGeneration
  ) {
    return Object.freeze({ kind: "refused", code: "stale-workspace" });
  }
  if (!state.selectedModules.some(({ moduleRoot: root }) => root === current.moduleRoot)) {
    return Object.freeze({ kind: "refused", code: "module-not-active" });
  }
  return Object.freeze({
    kind: "authorized",
    workspaceId: current.workspaceId,
    generation: current.generation,
    activationGeneration: state.activationGeneration,
    moduleRoot: current.moduleRoot,
  });
}
