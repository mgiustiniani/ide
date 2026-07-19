import {
  XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION,
  XCOM2_PROJECT_FOUNDRY_APPLY_SCHEMA_VERSION,
  XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION,
  type Xcom2ProjectFoundryApplyAttentionPresentation,
  type Xcom2ProjectFoundryApplyCurrentSelection,
  type Xcom2ProjectFoundryApplyEvent,
  type Xcom2ProjectFoundryApplyPreparation,
  type Xcom2ProjectFoundryApplyPreparationResult,
  type Xcom2ProjectFoundryApplyRefusalCode,
  type Xcom2ProjectFoundryApplyRequest,
  type Xcom2ProjectFoundryApplyResult,
  type Xcom2ProjectFoundryApplyState,
  type Xcom2ProjectFoundryApplyStateDecision,
  type Xcom2ProjectFoundryApplyTerminalSessionDecision,
  type Xcom2ProjectFoundryApplyingState,
  type Xcom2ProjectFoundryCreatedReceipt,
  type Xcom2ProjectFoundryDigestBoundPlan,
  type Xcom2ProjectFoundryModIdValidationResult,
  type Xcom2ProjectFoundryPreviewResult,
  type Xcom2ProjectFoundryReadyApplyState,
  type Xcom2ProjectFoundryRefusedApplyState,
} from "@ide/contracts";

import { canonicalizeJsonRfc8785, sha256Hex } from "./deterministic-data";

export {
  createXcom2ProjectFoundryRenderRequest,
  validateAndDigestXcom2ProjectFoundryRenderedPlan,
} from "./rendered-plan-custody";
export {
  XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION,
  XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION,
};

const MOD_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,47}$/u;
const WINDOWS_DEVICE_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function deepFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function cloneJsonData<T>(value: T, active = new Set<object>()): T {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Request numbers must be finite");
    return value;
  }
  if (typeof value !== "object") throw new TypeError("Request must contain only JSON data");
  if (active.has(value)) throw new TypeError("Request must be acyclic");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const output: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError("Request must not contain sparse arrays");
        }
        output.push(cloneJsonData(value[index], active));
      }
      return output as T;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Request must contain only plain data objects");
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError("Request must not contain symbol properties");
    }
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) output[key] = cloneJsonData(child, active);
    return output as T;
  } finally {
    active.delete(value);
  }
}

/** Validate the exact case-preserved portable ModId grammar without normalization. */
export function validateXcom2ProjectFoundryModId(
  candidate: string,
): Xcom2ProjectFoundryModIdValidationResult {
  if (!MOD_ID_PATTERN.test(candidate))
    return Object.freeze({ kind: "refused", code: "mod-id-invalid" });
  if (WINDOWS_DEVICE_PATTERN.test(candidate)) {
    return Object.freeze({ kind: "refused", code: "mod-id-windows-device" });
  }
  return Object.freeze({ kind: "accepted", modId: candidate });
}

/** Digest JSON plan data with SHA-256 over its RFC 8785 canonical representation. */
export function digestXcom2ProjectFoundryPlan(plan: Xcom2ProjectFoundryDigestBoundPlan): string {
  return sha256Hex(canonicalizeJsonRfc8785(plan));
}

type ReadyFoundryPreview = Extract<Xcom2ProjectFoundryPreviewResult, { readonly kind: "ready" }>;

function applyRefused(
  code: Xcom2ProjectFoundryApplyRefusalCode,
): Xcom2ProjectFoundryApplyPreparationResult {
  return Object.freeze({ kind: "refused", code });
}

function copySourceGrant(
  grant: Xcom2ProjectFoundryApplyCurrentSelection["sourceGrant"],
): Xcom2ProjectFoundryApplyCurrentSelection["sourceGrant"] {
  return {
    kind: grant.kind,
    repository: grant.repository,
    identity: grant.identity,
  };
}

function copyDestinationParentGrant(
  grant: Xcom2ProjectFoundryApplyCurrentSelection["destinationParentGrant"],
): Xcom2ProjectFoundryApplyCurrentSelection["destinationParentGrant"] {
  return {
    kind: grant.kind,
    parent: grant.parent,
    identity: grant.identity,
  };
}

function copyOperationGrant(
  grant: Xcom2ProjectFoundryApplyCurrentSelection["operationGrant"],
): Xcom2ProjectFoundryApplyCurrentSelection["operationGrant"] {
  return {
    kind: grant.kind,
    derivedDestination: grant.derivedDestination,
    identity: grant.identity,
  };
}

function copyCurrentSelection(
  current: Readonly<Xcom2ProjectFoundryApplyCurrentSelection>,
): Xcom2ProjectFoundryApplyCurrentSelection {
  return {
    sourceGrant: copySourceGrant(current.sourceGrant),
    destinationParentGrant: copyDestinationParentGrant(current.destinationParentGrant),
    operationGrant: copyOperationGrant(current.operationGrant),
    modId: current.modId,
  };
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function isExactDestinationPresentRefusal(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;

    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== 3 ||
      !keys.includes("result") ||
      !keys.includes("phase") ||
      !keys.includes("reason")
    ) {
      return false;
    }

    const result = Object.getOwnPropertyDescriptor(value, "result");
    const phase = Object.getOwnPropertyDescriptor(value, "phase");
    const reason = Object.getOwnPropertyDescriptor(value, "reason");
    return (
      result !== undefined &&
      "value" in result &&
      result.enumerable === true &&
      result.value === "refused" &&
      phase !== undefined &&
      "value" in phase &&
      phase.enumerable === true &&
      phase.value === "pre-commit" &&
      reason !== undefined &&
      "value" in reason &&
      reason.enumerable === true &&
      reason.value === "destination-present" &&
      Reflect.get(value, "result") === result.value &&
      Reflect.get(value, "phase") === phase.value &&
      Reflect.get(value, "reason") === reason.value
    );
  } catch {
    return false;
  }
}

/** Collapse untrusted Apply results to one of two immutable, non-interpolated presentations. */
export function mapXcom2ProjectFoundryApplyAttentionPresentation(
  result: unknown,
): Readonly<Xcom2ProjectFoundryApplyAttentionPresentation> {
  return isExactDestinationPresentRefusal(result)
    ? XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION
    : XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION;
}

const XCOM2_PROJECT_FOUNDRY_APPLY_TERMINAL_SESSION_DECISION = deepFreeze({
  kind: "terminal",
  authority: "consumed",
  preview: "retained-context",
  disabledControls: ["source-selection", "destination-selection", "mod-id", "preview", "create"],
  enabledControls: ["cancel"],
} as const satisfies Xcom2ProjectFoundryApplyTerminalSessionDecision);

/** Keep a refused Preview as context while exposing Cancel as the only live control. */
export function decideXcom2ProjectFoundryApplyTerminalSession(
  _state: Readonly<Xcom2ProjectFoundryRefusedApplyState>,
): Readonly<Xcom2ProjectFoundryApplyTerminalSessionDecision> {
  return XCOM2_PROJECT_FOUNDRY_APPLY_TERMINAL_SESSION_DECISION;
}

function sourceGrantMatchesPlan(
  current: Readonly<Xcom2ProjectFoundryApplyCurrentSelection>,
  preview: Readonly<ReadyFoundryPreview>,
): boolean {
  const grant = objectRecord(current.sourceGrant);
  return (
    grant?.kind === "source-repository" &&
    grant.repository === preview.plan.source.repository &&
    grant.identity === preview.plan.source.grantIdentity
  );
}

function destinationParentGrantMatchesPlan(
  current: Readonly<Xcom2ProjectFoundryApplyCurrentSelection>,
  preview: Readonly<ReadyFoundryPreview>,
): boolean {
  const grant = objectRecord(current.destinationParentGrant);
  return (
    grant?.kind === "destination-parent" &&
    grant.parent === preview.plan.destination.parent &&
    grant.identity === preview.plan.destination.parentGrantIdentity
  );
}

function operationGrantMatchesPlan(
  current: Readonly<Xcom2ProjectFoundryApplyCurrentSelection>,
  preview: Readonly<ReadyFoundryPreview>,
): boolean {
  const grant = objectRecord(current.operationGrant);
  return (
    grant?.kind === "preview-operation" &&
    grant.derivedDestination === preview.plan.destination.derivedAbsentDestination &&
    grant.identity === preview.plan.destination.operationGrantIdentity
  );
}

/** Prepare only the exact one-shot Apply authority DTO for a still-live reviewed plan. */
export function prepareXcom2ProjectFoundryApply(
  preparation: Readonly<Xcom2ProjectFoundryApplyPreparation>,
): Xcom2ProjectFoundryApplyPreparationResult {
  if (preparation.preview.kind !== "ready") return applyRefused("preview-not-ready");
  if (preparation.stale) return applyRefused("preview-stale");
  if (!sourceGrantMatchesPlan(preparation.current, preparation.preview)) {
    return applyRefused("source-grant-mismatched");
  }
  if (!destinationParentGrantMatchesPlan(preparation.current, preparation.preview)) {
    return applyRefused("destination-parent-grant-mismatched");
  }
  if (!operationGrantMatchesPlan(preparation.current, preparation.preview)) {
    return applyRefused("operation-grant-mismatched");
  }
  if (validateXcom2ProjectFoundryModId(preparation.current.modId).kind !== "accepted") {
    return applyRefused("mod-id-invalid");
  }
  if (preparation.current.modId !== preparation.preview.plan.project.modId) {
    return applyRefused("mod-id-mismatched");
  }
  if (!SHA256_PATTERN.test(preparation.approvedPlanDigest)) {
    return applyRefused("approved-plan-digest-invalid");
  }
  if (preparation.approvedPlanDigest !== preparation.preview.plan.planDigest) {
    return applyRefused("approved-plan-digest-mismatched");
  }
  if (preparation.authority !== "available") return applyRefused("apply-authority-consumed");

  const current = copyCurrentSelection(preparation.current);
  const request: Xcom2ProjectFoundryApplyRequest = {
    schemaVersion: XCOM2_PROJECT_FOUNDRY_APPLY_SCHEMA_VERSION,
    sourceGrant: current.sourceGrant,
    destinationParentGrant: current.destinationParentGrant,
    operationGrant: current.operationGrant,
    modId: current.modId,
    approvedPlanDigest: preparation.approvedPlanDigest,
  };
  return deepFreeze({ kind: "ready", request });
}

/** Create an isolated immutable state for a newly reviewed ready preview. */
export function createXcom2ProjectFoundryReadyApplyState(input: {
  readonly preview: Readonly<ReadyFoundryPreview>;
  readonly current: Readonly<Xcom2ProjectFoundryApplyCurrentSelection>;
}): Xcom2ProjectFoundryReadyApplyState {
  return deepFreeze({
    status: "ready",
    authority: "available",
    current: copyCurrentSelection(input.current),
    preview: cloneJsonData(input.preview),
  });
}

function copyApplyState(
  state: Readonly<Xcom2ProjectFoundryApplyState>,
): Xcom2ProjectFoundryApplyState {
  return deepFreeze(cloneJsonData(state)) as Xcom2ProjectFoundryApplyState;
}

function stateRefused(
  state: Readonly<Xcom2ProjectFoundryApplyState>,
  code: Xcom2ProjectFoundryApplyRefusalCode,
): Xcom2ProjectFoundryApplyStateDecision {
  return deepFreeze({ kind: "refused", code, state: copyApplyState(state) });
}

function editableCurrent(
  state: Readonly<Xcom2ProjectFoundryApplyState>,
): Readonly<Xcom2ProjectFoundryApplyCurrentSelection> | undefined {
  return state.status === "ready" || state.status === "editing" ? state.current : undefined;
}

function reduceEditingChange(
  state: Readonly<Xcom2ProjectFoundryApplyState>,
  event: Extract<
    Xcom2ProjectFoundryApplyEvent,
    {
      readonly kind:
        "source-selection-changed" | "destination-selection-changed" | "mod-id-changed";
    }
  >,
): Xcom2ProjectFoundryApplyStateDecision {
  const existing = editableCurrent(state);
  if (!existing) return stateRefused(state, "apply-authority-consumed");
  let current: Xcom2ProjectFoundryApplyCurrentSelection;
  let invalidatedBy: "source" | "destination" | "mod-id";
  if (event.kind === "source-selection-changed") {
    current = {
      ...copyCurrentSelection(existing),
      sourceGrant: copySourceGrant(event.sourceGrant),
    };
    invalidatedBy = "source";
  } else if (event.kind === "destination-selection-changed") {
    current = {
      ...copyCurrentSelection(existing),
      destinationParentGrant: copyDestinationParentGrant(event.destinationParentGrant),
      operationGrant: copyOperationGrant(event.operationGrant),
    };
    invalidatedBy = "destination";
  } else {
    current = { ...copyCurrentSelection(existing), modId: event.modId };
    invalidatedBy = "mod-id";
  }
  return deepFreeze({
    kind: "transitioned",
    state: {
      status: "editing",
      authority: "available",
      current,
      invalidatedBy,
    },
  });
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function createdReceiptIsExact(
  result: Readonly<Xcom2ProjectFoundryApplyResult>,
  state: Readonly<Xcom2ProjectFoundryApplyingState>,
): result is Xcom2ProjectFoundryCreatedReceipt {
  const record = objectRecord(result);
  if (!record) return false;
  return (
    hasExactKeys(record, [
      "result",
      "planDigest",
      "finalProjectLocation",
      "sourceCommit",
      "sourceTree",
      "committedDirectories",
      "committedFiles",
    ]) &&
    record.result === "created" &&
    typeof record.planDigest === "string" &&
    SHA256_PATTERN.test(record.planDigest) &&
    record.planDigest === state.request.approvedPlanDigest &&
    record.planDigest === state.preview.plan.planDigest &&
    record.finalProjectLocation === state.request.operationGrant.derivedDestination &&
    record.finalProjectLocation === state.preview.plan.destination.derivedAbsentDestination &&
    record.sourceCommit === state.preview.plan.source.commit &&
    record.sourceTree === state.preview.plan.source.tree &&
    record.committedDirectories === state.preview.plan.directories.length &&
    record.committedFiles === state.preview.plan.files.length
  );
}

function reduceApplyCompletion(
  state: Readonly<Xcom2ProjectFoundryApplyingState>,
  result: Readonly<Xcom2ProjectFoundryApplyResult>,
): Xcom2ProjectFoundryApplyStateDecision {
  const record = objectRecord(result);
  if (!record) return stateRefused(state, "created-receipt-invalid");
  if (record.result === "created") {
    if (!createdReceiptIsExact(result, state)) {
      return stateRefused(state, "created-receipt-invalid");
    }
    const receipt: Xcom2ProjectFoundryCreatedReceipt = {
      result: "created",
      planDigest: result.planDigest,
      finalProjectLocation: result.finalProjectLocation,
      sourceCommit: result.sourceCommit,
      sourceTree: result.sourceTree,
      committedDirectories: result.committedDirectories,
      committedFiles: result.committedFiles,
    };
    return deepFreeze({
      kind: "transitioned",
      state: { status: "created", authority: "consumed", receipt },
    });
  }
  if (
    record.result === "refused" &&
    record.phase === "pre-commit" &&
    typeof record.reason === "string"
  ) {
    return deepFreeze({
      kind: "transitioned",
      state: {
        status: "refused",
        authority: "consumed",
        preview: cloneJsonData(state.preview),
        refusal: { result: "refused", phase: "pre-commit", reason: record.reason },
      },
    });
  }
  if (
    record.result === "failed" &&
    record.phase === "pre-commit" &&
    typeof record.reason === "string"
  ) {
    return deepFreeze({
      kind: "transitioned",
      state: {
        status: "failed",
        authority: "consumed",
        failure: { result: "failed", phase: "pre-commit", reason: record.reason },
      },
    });
  }
  if (
    record.result === "created-recovery-required" &&
    record.phase === "post-commit" &&
    typeof record.planDigest === "string" &&
    SHA256_PATTERN.test(record.planDigest) &&
    record.planDigest === state.request.approvedPlanDigest &&
    record.planDigest === state.preview.plan.planDigest &&
    record.finalProjectLocation === state.request.operationGrant.derivedDestination &&
    record.finalProjectLocation === state.preview.plan.destination.derivedAbsentDestination &&
    typeof record.reason === "string"
  ) {
    return deepFreeze({
      kind: "transitioned",
      state: {
        status: "created-recovery-required",
        authority: "consumed",
        failure: {
          result: "created-recovery-required",
          phase: "post-commit",
          planDigest: record.planDigest,
          finalProjectLocation: record.finalProjectLocation,
          reason: record.reason,
        },
      },
    });
  }
  return stateRefused(state, "created-receipt-invalid");
}

/** Reduce one pure Apply lifecycle event without invoking a backend or rendering output. */
export function reduceXcom2ProjectFoundryApplyState(
  state: Readonly<Xcom2ProjectFoundryApplyState>,
  event: Readonly<Xcom2ProjectFoundryApplyEvent>,
): Xcom2ProjectFoundryApplyStateDecision {
  if (
    event.kind === "source-selection-changed" ||
    event.kind === "destination-selection-changed" ||
    event.kind === "mod-id-changed"
  ) {
    return reduceEditingChange(state, event);
  }

  if (event.kind === "apply-requested") {
    if (state.authority === "consumed") {
      return stateRefused(state, "apply-authority-consumed");
    }
    if (state.status !== "ready") return stateRefused(state, "preview-not-ready");
    const prepared = prepareXcom2ProjectFoundryApply({
      preview: state.preview,
      current: state.current,
      approvedPlanDigest: event.approvedPlanDigest,
      authority: state.authority,
      stale: false,
    });
    if (prepared.kind === "refused") return stateRefused(state, prepared.code);

    const applying = deepFreeze({
      status: "applying",
      authority: "consumed",
      preview: cloneJsonData(state.preview),
      request: cloneJsonData(prepared.request),
    }) as Xcom2ProjectFoundryApplyingState;
    return deepFreeze({ kind: "prepared", state: applying, request: applying.request });
  }

  if (state.status !== "applying") {
    return stateRefused(
      state,
      state.authority === "consumed" ? "apply-authority-consumed" : "preview-not-ready",
    );
  }
  return reduceApplyCompletion(state, event.result);
}

export { canonicalizeJsonRfc8785, sha1, sha256, sha256Hex, uuidV5 } from "./deterministic-data";
