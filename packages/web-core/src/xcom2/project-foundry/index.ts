import {
  XCOM2_PROJECT_FOUNDRY_APPLY_SCHEMA_VERSION,
  XCOM2_PROJECT_FOUNDRY_PACK_ID,
  XCOM2_PROJECT_FOUNDRY_PLAN_SCHEMA_VERSION,
  XCOM2_PROJECT_FOUNDRY_PLATFORM,
  XCOM2_PROJECT_FOUNDRY_PUBLICATION_STATUS,
  XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES,
  XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
  XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
  type Xcom2ProjectFoundryApplyCurrentSelection,
  type Xcom2ProjectFoundryApplyEvent,
  type Xcom2ProjectFoundryApplyPreparation,
  type Xcom2ProjectFoundryApplyPreparationResult,
  type Xcom2ProjectFoundryApplyRefusalCode,
  type Xcom2ProjectFoundryApplyRequest,
  type Xcom2ProjectFoundryApplyResult,
  type Xcom2ProjectFoundryApplyState,
  type Xcom2ProjectFoundryApplyStateDecision,
  type Xcom2ProjectFoundryApplyingState,
  type Xcom2ProjectFoundryCreatedReceipt,
  type Xcom2ProjectFoundryReadyApplyState,
  type Xcom2ProjectFoundryDigestBoundPlan,
  type Xcom2ProjectFoundryModIdValidationResult,
  type Xcom2ProjectFoundryPreviewPlan,
  type Xcom2ProjectFoundryPreviewRefusalCode,
  type Xcom2ProjectFoundryPreviewRequest,
  type Xcom2ProjectFoundryPreviewResult,
} from "@ide/contracts";

import {
  APPROVED_FOUNDRY_ABSENCES,
  APPROVED_FOUNDRY_DIRECTORIES,
  APPROVED_FOUNDRY_FILES,
  APPROVED_FOUNDRY_WARNINGS,
  APPROVED_SOLUTION_ESCAPED_PREVIEW,
  APPROVED_X2PROJ_ESCAPED_PREVIEW,
} from "./approved-preview-metadata";
import { canonicalizeJsonRfc8785, sha256Hex, uuidV5 } from "./deterministic-data";

export {
  createXcom2ProjectFoundryRenderRequest,
  validateAndDigestXcom2ProjectFoundryRenderedPlan,
} from "./rendered-plan-custody";

const URL_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
const MOD_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,47}$/u;
const WINDOWS_DEVICE_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu;
const GIT_OBJECT_ID_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GRANT_IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SOURCE_REFUSALS = new Set<Xcom2ProjectFoundryPreviewRefusalCode>(
  XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES.filter(
    (code) => code.startsWith("source-") && code !== "source-grant-invalid",
  ),
);

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

function refused(code: Xcom2ProjectFoundryPreviewRefusalCode): Xcom2ProjectFoundryPreviewResult {
  return Object.freeze({ kind: "refused", code });
}

function isCanonicalAbsolutePath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\\")) return false;
  if (value.length > 1 && value.endsWith("/")) return false;
  const segments = value.split("/").slice(1);
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && GRANT_IDENTITY_PATTERN.test(value);
}

function validateObjectId(
  value: unknown,
  expected: string,
  object: "commit" | "tree",
): Xcom2ProjectFoundryPreviewRefusalCode | undefined {
  if (value === "") return `source-${object}-missing`;
  if (typeof value !== "string") return `source-${object}-unreadable`;
  if (!GIT_OBJECT_ID_PATTERN.test(value)) return `source-${object}-fingerprint-invalid`;
  if (value !== expected) return `source-${object}-mismatched`;
  return undefined;
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

/** Derive the legacy generator's deterministic project identity during App migration. */
function deriveXcom2ProjectFoundryProjectGuid(modId: string): string {
  if (validateXcom2ProjectFoundryModId(modId).kind !== "accepted") {
    throw new TypeError("A valid Project Foundry ModId is required");
  }
  const name = `urn:ide:project-foundry:${XCOM2_PROJECT_FOUNDRY_PACK_ID}:${XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT}:${modId}`;
  return `{${uuidV5(URL_NAMESPACE, name).toUpperCase()}}`;
}

/**
 * @deprecated Transitional frontend render request retained only until the current App uses the
 * native renderer port and createXcom2ProjectFoundryRenderRequest.
 */
export function createXcom2ProjectFoundryPreviewRequest(
  input: Xcom2ProjectFoundryPreviewRequest,
): Readonly<Xcom2ProjectFoundryPreviewRequest> {
  return deepFreeze(cloneJsonData(input));
}

/** Digest JSON plan data with SHA-256 over its RFC 8785 canonical representation. */
export function digestXcom2ProjectFoundryPlan(plan: Xcom2ProjectFoundryDigestBoundPlan): string {
  return sha256Hex(canonicalizeJsonRfc8785(plan));
}

/**
 * @deprecated Transitional frontend output generator retained solely so the current App compiles.
 * Native rendering is the only target output authority.
 */
export function previewXcom2ProjectFoundry(
  request: Readonly<Xcom2ProjectFoundryPreviewRequest>,
): Xcom2ProjectFoundryPreviewResult {
  const modValidation = validateXcom2ProjectFoundryModId(request.modId);
  if (modValidation.kind === "refused") return refused(modValidation.code);

  const sourceGrant = request.sourceGrant as unknown as Record<string, unknown>;
  if (
    sourceGrant?.kind !== "source-repository" ||
    !isCanonicalAbsolutePath(sourceGrant.repository) ||
    !validIdentity(sourceGrant.identity)
  ) {
    return refused("source-grant-invalid");
  }

  const sourceObject = request.sourceObject as unknown as Record<string, unknown>;
  const commitRefusal = validateObjectId(
    sourceObject?.commit,
    XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
    "commit",
  );
  if (commitRefusal) return refused(commitRefusal);
  const treeRefusal = validateObjectId(
    sourceObject?.tree,
    XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
    "tree",
  );
  if (treeRefusal) return refused(treeRefusal);
  if (sourceObject?.fingerprintResult !== "Verified") {
    if (
      SOURCE_REFUSALS.has(sourceObject?.fingerprintResult as Xcom2ProjectFoundryPreviewRefusalCode)
    ) {
      return refused(sourceObject.fingerprintResult as Xcom2ProjectFoundryPreviewRefusalCode);
    }
    return refused("source-commit-fingerprint-invalid");
  }

  const destinationGrant = request.destinationParentGrant as unknown as Record<string, unknown>;
  if (request.destinationState === "parent-unavailable") {
    return refused("destination-parent-unavailable");
  }
  if (
    destinationGrant?.kind !== "destination-parent" ||
    !isCanonicalAbsolutePath(destinationGrant.parent) ||
    !validIdentity(destinationGrant.identity)
  ) {
    return refused("destination-parent-grant-invalid");
  }
  if (request.destinationState === "present") return refused("derived-destination-present");
  if (request.destinationState !== "absent") return refused("derived-destination-mismatched");

  const expectedDestination = `${destinationGrant.parent}/${request.modId}`;
  const operationGrant = request.operationGrant as unknown as Record<string, unknown>;
  if (operationGrant?.derivedDestination !== expectedDestination) {
    return refused("derived-destination-mismatched");
  }
  if (operationGrant.kind !== "preview-operation" || !validIdentity(operationGrant.identity)) {
    return refused("operation-grant-invalid");
  }

  const guid = deriveXcom2ProjectFoundryProjectGuid(request.modId);
  const boundPlan: Xcom2ProjectFoundryDigestBoundPlan = {
    schemaVersion: XCOM2_PROJECT_FOUNDRY_PLAN_SCHEMA_VERSION,
    canonicalization: "RFC 8785",
    digestAlgorithm: "SHA-256",
    packId: XCOM2_PROJECT_FOUNDRY_PACK_ID,
    platform: XCOM2_PROJECT_FOUNDRY_PLATFORM,
    publicationStatus: XCOM2_PROJECT_FOUNDRY_PUBLICATION_STATUS,
    source: {
      repository: sourceGrant.repository,
      grantIdentity: sourceGrant.identity,
      commit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
      tree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
      fingerprintResult: "Verified",
      policy:
        "Committed Git objects only; working-tree modifications and untracked files are ignored",
    },
    project: { modId: request.modId, guid },
    destination: {
      parent: destinationGrant.parent,
      parentGrantIdentity: destinationGrant.identity,
      derivedAbsentDestination: operationGrant.derivedDestination,
      operationGrantIdentity: operationGrant.identity,
    },
    symlinks: "none",
    directories: cloneJsonData(APPROVED_FOUNDRY_DIRECTORIES),
    files: cloneJsonData(APPROVED_FOUNDRY_FILES),
    generatedPreviews: [
      {
        path: "FoundryPreviewFixture/FoundryPreviewFixture.x2proj",
        encoding: "UTF-8",
        byteOrderMark: "present",
        lineEndings: "LF",
        escapedBytePreview: APPROVED_X2PROJ_ESCAPED_PREVIEW,
      },
      {
        path: "FoundryPreviewFixture.XCOM_sln",
        encoding: "UTF-8",
        byteOrderMark: "absent",
        lineEndings: "LF",
        escapedBytePreview: APPROVED_SOLUTION_ESCAPED_PREVIEW,
      },
    ],
    absences: cloneJsonData(APPROVED_FOUNDRY_ABSENCES),
    warnings: cloneJsonData(APPROVED_FOUNDRY_WARNINGS),
  };
  const plan: Xcom2ProjectFoundryPreviewPlan = {
    ...boundPlan,
    planDigest: digestXcom2ProjectFoundryPlan(boundPlan),
  };
  return deepFreeze({ kind: "ready", plan });
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
