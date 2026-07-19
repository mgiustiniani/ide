import {
  XCOM2_PROJECT_FOUNDRY_APPLY_SCHEMA_VERSION,
  XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES,
  XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
  XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
  type Xcom2ProjectFoundryApplyRequest,
  type Xcom2ProjectFoundryApplyResult,
  type Xcom2ProjectFoundryDestinationParentSelectionGrant,
  type Xcom2ProjectFoundryDestinationState,
  type Xcom2ProjectFoundryOperationGrant,
  type Xcom2ProjectFoundryPreviewRefusalCode,
  type Xcom2ProjectFoundryRenderRequest,
  type Xcom2ProjectFoundrySourceObjectEvidence,
  type Xcom2ProjectFoundrySourceSelectionGrant,
} from "@ide/contracts";
import { validateXcom2ProjectFoundryModId } from "@ide/web-core";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { TauriAdapterError } from "./errors";

export const XCOM2_PROJECT_FOUNDRY_COMMANDS = Object.freeze({
  authorizeSourceRepository: "authorize_xcom2_project_foundry_source_repository",
  resolveSourceObject: "resolve_xcom2_project_foundry_source_object",
  authorizeDestinationParent: "authorize_xcom2_project_foundry_destination_parent",
  inspectDestination: "inspect_xcom2_project_foundry_destination",
  revokeAll: "revoke_all_xcom2_project_foundry_preview_grants",
} as const);

/** Corrected renderer commands kept separate so the legacy command vocabulary remains stable. */
export const XCOM2_PROJECT_FOUNDRY_RENDERER_COMMANDS = Object.freeze({
  authorizeDestinationParentSelection:
    "authorize_xcom2_project_foundry_destination_parent_selection",
  renderPreview: "render_xcom2_project_foundry_preview",
  revokeOperation: "revoke_xcom2_project_foundry_operation_grants",
} as const);

/** One-shot mutation command kept outside the stable preview command vocabularies. */
export const XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND = "apply_xcom2_project_foundry" as const;

const DIALOG_COMMAND = "plugin:dialog|open";
const DIRECTORY_DIALOG_OPTIONS = Object.freeze({ directory: true, multiple: false } as const);
const MAXIMUM_PATH_BYTES = 4_096;
const MAXIMUM_GRANT_IDENTITY_BYTES = 128;
const MAXIMUM_RENDER_JSON_DEPTH = 32;
const MAXIMUM_RENDER_JSON_NODES = 10_000;
const MAXIMUM_RENDER_JSON_ARRAY_LENGTH = 4_096;
const MAXIMUM_RENDER_JSON_OBJECT_FIELDS = 256;
const MAXIMUM_RENDER_JSON_KEY_BYTES = 256;
const MAXIMUM_RENDER_JSON_STRING_BYTES = 1_048_576;
const MAXIMUM_RENDER_JSON_TOTAL_STRING_BYTES = 4_194_304;
const EXPECTED_COMMITTED_DIRECTORIES = 12;
const EXPECTED_COMMITTED_FILES = 27;
const GRANT_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const FINGERPRINT_RESULTS = new Set<string>([
  "Verified",
  ...(["commit", "tree", "blob"] as const).flatMap((object) =>
    (["missing", "unreadable", "mismatched", "fingerprint-invalid"] as const).map(
      (state) => `source-${object}-${state}`,
    ),
  ),
]);
const DESTINATION_STATES = new Set<Xcom2ProjectFoundryDestinationState>([
  "absent",
  "parent-unavailable",
  "present",
  "mismatched",
]);
const RENDER_REFUSAL_CODES = new Set<string>(XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES);
const APPLY_REFUSAL_REASONS = new Set<string>([
  "schema-version-invalid",
  "source-grant-mismatched",
  "destination-parent-grant-mismatched",
  "operation-grant-mismatched",
  "mod-id-invalid",
  "mod-id-mismatched",
  "approved-plan-digest-invalid",
  "approved-plan-digest-mismatched",
  "apply-authority-consumed",
  "source-stale",
  "destination-parent-stale",
  "destination-present",
  "rendered-plan-invalid",
  "stage-conflict",
  "journal-conflict",
]);
const APPLY_PRE_COMMIT_FAILURE_REASONS = new Set<string>([
  "journal-create-failed",
  "journal-sync-failed",
  "stage-create-failed",
  "stage-write-failed",
  "stage-verify-failed",
  "stage-sync-failed",
  "parent-sync-failed",
  "atomic-commit-failed",
  "cleanup-failed",
]);
const APPLY_POST_COMMIT_FAILURE_REASONS = new Set<string>([
  "post-commit-parent-sync-failed",
  "post-commit-journal-failed",
]);
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_NATIVE_REJECTIONS = new Set([
  "foundry-linux-only",
  "foundry-grant-mint-failed",
  "foundry-grant-revocation-failed",
  "source-repository-unavailable",
  "source-grant-invalid",
  "destination-parent-unavailable",
  "destination-parent-grant-invalid",
  "derived-destination-present",
  "derived-destination-mismatched",
  "operation-grant-invalid",
  "rendered-plan-invalid",
  "mod-id-invalid",
  "mod-id-windows-device",
  ...[...FINGERPRINT_RESULTS].filter((value) => value !== "Verified"),
]);

export type TauriXcom2ProjectFoundryNativeRenderResult =
  | Readonly<{
      readonly kind: "rendered";
      readonly operationGrant: Readonly<Xcom2ProjectFoundryOperationGrant>;
      /** Deliberately unknown until web-core takes strict rendered-plan custody. */
      readonly planBody: unknown;
    }>
  | Readonly<{
      readonly kind: "refused";
      readonly code: Xcom2ProjectFoundryPreviewRefusalCode;
    }>;

/** Corrected selector/renderer boundary for migration away from frontend rendering authority. */
export interface TauriXcom2ProjectFoundryRendererComposition {
  readonly selectors: {
    selectSourceRepository(): Promise<Xcom2ProjectFoundrySourceSelectionGrant>;
    selectDestinationParent(): Promise<Xcom2ProjectFoundryDestinationParentSelectionGrant>;
  };
  readonly renderer: {
    renderPreview(
      request: Readonly<Xcom2ProjectFoundryRenderRequest>,
    ): Promise<TauriXcom2ProjectFoundryNativeRenderResult>;
  };
  apply(
    request: Readonly<Xcom2ProjectFoundryApplyRequest>,
  ): Promise<Xcom2ProjectFoundryApplyResult>;
  readonly grants: {
    revokeOperation(): Promise<void>;
    revokeAll(): Promise<void>;
  };
}

/** Transitional composition retained unchanged until the desktop controller migrates. */
export interface TauriXcom2ProjectFoundryComposition {
  readonly selectors: {
    selectSourceRepository(): Promise<Xcom2ProjectFoundrySourceSelectionGrant>;
    selectDestinationParent(modId?: string): Promise<{
      readonly destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant;
      readonly operationGrant: Xcom2ProjectFoundryOperationGrant;
    }>;
  };
  readonly source: {
    resolvePinnedObject(
      grant: Xcom2ProjectFoundrySourceSelectionGrant,
    ): Promise<Xcom2ProjectFoundrySourceObjectEvidence>;
  };
  readonly destination: {
    inspectDerivedDestination(
      destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant,
      operationGrant: Xcom2ProjectFoundryOperationGrant,
    ): Promise<Xcom2ProjectFoundryDestinationState>;
  };
  readonly grants: {
    revokeAll(): Promise<void>;
  };
}

/** A native chooser cancellation carries no path, provider value, or error cause. */
export class TauriProjectFoundrySelectionCancelledError extends Error {
  constructor(public readonly selection: "source-repository" | "destination-parent") {
    super("Native directory selection was cancelled");
    this.name = "TauriProjectFoundrySelectionCancelledError";
  }
}

function protocolError(
  command: string,
  phase: "request" | "response",
  detail: string,
): TauriAdapterError {
  return new TauriAdapterError(command, `Invalid Project Foundry ${phase}: ${detail}`);
}

function exactDataRecord(
  command: string,
  phase: "request" | "response",
  value: unknown,
  fields: readonly string[],
  location: string,
): Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw protocolError(command, phase, `${location} must be an exact data object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw protocolError(command, phase, `${location} must be a plain data object`);
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== fields.length ||
      fields.some((field) => !keys.includes(field)) ||
      keys.some((key) => typeof key !== "string" || !fields.includes(key))
    ) {
      throw protocolError(command, phase, `${location} has missing or unsupported fields`);
    }
    const output: Record<string, unknown> = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw protocolError(command, phase, `${location} must contain enumerable data fields`);
      }
      output[field] = descriptor.value;
    }
    return output;
  } catch {
    // Never retain or rethrow an exception supplied by a malformed provider object.
    throw protocolError(command, phase, `${location} could not be safely inspected`);
  }
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function safeText(value: unknown): value is string {
  return typeof value === "string" && !CONTROL_CHARACTER.test(value) && !hasLoneSurrogate(value);
}

function canonicalLinuxPath(value: unknown): value is string {
  if (
    !safeText(value) ||
    value.length === 0 ||
    new TextEncoder().encode(value).length > MAXIMUM_PATH_BYTES ||
    !value.startsWith("/") ||
    value.includes("\\") ||
    (value.length > 1 && value.endsWith("/"))
  ) {
    return false;
  }
  if (value === "/") return true;
  return value
    .split("/")
    .slice(1)
    .every((component) => component.length > 0 && component !== "." && component !== "..");
}

function opaqueIdentity(value: unknown): value is string {
  return (
    safeText(value) &&
    new TextEncoder().encode(value).length <= MAXIMUM_GRANT_IDENTITY_BYTES &&
    GRANT_IDENTITY.test(value)
  );
}

function validModId(value: unknown): value is string {
  return typeof value === "string" && validateXcom2ProjectFoundryModId(value).kind === "accepted";
}

function normalizeSourceGrant(
  command: string,
  phase: "request" | "response",
  value: unknown,
): Readonly<Xcom2ProjectFoundrySourceSelectionGrant> {
  const record = exactDataRecord(
    command,
    phase,
    value,
    ["kind", "repository", "identity"],
    "source grant",
  );
  if (
    record.kind !== "source-repository" ||
    !canonicalLinuxPath(record.repository) ||
    !opaqueIdentity(record.identity)
  ) {
    throw protocolError(command, phase, "source grant fields violate the native contract");
  }
  return Object.freeze({
    kind: "source-repository",
    repository: record.repository,
    identity: record.identity,
  });
}

function normalizeDestinationGrant(
  command: string,
  phase: "request" | "response",
  value: unknown,
): Readonly<Xcom2ProjectFoundryDestinationParentSelectionGrant> {
  const record = exactDataRecord(
    command,
    phase,
    value,
    ["kind", "parent", "identity"],
    "destination grant",
  );
  if (
    record.kind !== "destination-parent" ||
    !canonicalLinuxPath(record.parent) ||
    !opaqueIdentity(record.identity)
  ) {
    throw protocolError(command, phase, "destination grant fields violate the native contract");
  }
  return Object.freeze({
    kind: "destination-parent",
    parent: record.parent,
    identity: record.identity,
  });
}

function normalizeOperationGrant(
  command: string,
  phase: "request" | "response",
  value: unknown,
): Readonly<Xcom2ProjectFoundryOperationGrant> {
  const record = exactDataRecord(
    command,
    phase,
    value,
    ["kind", "derivedDestination", "identity"],
    "operation grant",
  );
  if (
    record.kind !== "preview-operation" ||
    !canonicalLinuxPath(record.derivedDestination) ||
    !opaqueIdentity(record.identity)
  ) {
    throw protocolError(command, phase, "operation grant fields violate the native contract");
  }
  return Object.freeze({
    kind: "preview-operation",
    derivedDestination: record.derivedDestination,
    identity: record.identity,
  });
}

interface RenderJsonBudget {
  nodes: number;
  stringBytes: number;
  readonly active: Set<object>;
}

function copyBoundedRenderJson(
  command: string,
  value: unknown,
  budget: RenderJsonBudget,
  depth = 0,
): unknown {
  if (depth > MAXIMUM_RENDER_JSON_DEPTH) {
    throw protocolError(command, "response", "rendered plan exceeds the JSON depth limit");
  }
  budget.nodes += 1;
  if (budget.nodes > MAXIMUM_RENDER_JSON_NODES) {
    throw protocolError(command, "response", "rendered plan exceeds the JSON node limit");
  }

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw protocolError(command, "response", "rendered plan contains a non-JSON number");
    }
    return value;
  }
  if (typeof value === "string") {
    if (!safeText(value)) {
      throw protocolError(command, "response", "rendered plan contains unsafe text");
    }
    const bytes = new TextEncoder().encode(value).length;
    budget.stringBytes += bytes;
    if (
      bytes > MAXIMUM_RENDER_JSON_STRING_BYTES ||
      budget.stringBytes > MAXIMUM_RENDER_JSON_TOTAL_STRING_BYTES
    ) {
      throw protocolError(command, "response", "rendered plan exceeds the JSON string limit");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw protocolError(command, "response", "rendered plan contains a non-JSON value");
  }
  if (budget.active.has(value)) {
    throw protocolError(command, "response", "rendered plan contains a cycle");
  }

  budget.active.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > MAXIMUM_RENDER_JSON_ARRAY_LENGTH
      ) {
        throw protocolError(command, "response", "rendered plan contains an invalid array");
      }
      const keys = Reflect.ownKeys(value);
      if (
        keys.length !== value.length + 1 ||
        keys.some(
          (key) =>
            typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)),
        )
      ) {
        throw protocolError(command, "response", "rendered plan contains an inexact array");
      }
      const output: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw protocolError(command, "response", "rendered plan contains a sparse array");
        }
        output.push(copyBoundedRenderJson(command, descriptor.value, budget, depth + 1));
      }
      return Object.freeze(output);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw protocolError(command, "response", "rendered plan contains a non-data object");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAXIMUM_RENDER_JSON_OBJECT_FIELDS) {
      throw protocolError(command, "response", "rendered plan exceeds the object field limit");
    }
    const output: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string" || !safeText(key)) {
        throw protocolError(command, "response", "rendered plan contains an unsafe field name");
      }
      const keyBytes = new TextEncoder().encode(key).length;
      budget.stringBytes += keyBytes;
      if (
        keyBytes > MAXIMUM_RENDER_JSON_KEY_BYTES ||
        budget.stringBytes > MAXIMUM_RENDER_JSON_TOTAL_STRING_BYTES
      ) {
        throw protocolError(command, "response", "rendered plan exceeds the JSON string limit");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw protocolError(command, "response", "rendered plan contains a non-data field");
      }
      Object.defineProperty(output, key, {
        enumerable: true,
        value: copyBoundedRenderJson(command, descriptor.value, budget, depth + 1),
      });
    }
    return Object.freeze(output);
  } finally {
    budget.active.delete(value);
  }
}

function expectedDerivedDestination(parent: string, modId: string): string {
  return parent === "/" ? `/${modId}` : `${parent}/${modId}`;
}

function normalizeRenderRequest(value: unknown): Readonly<Xcom2ProjectFoundryRenderRequest> {
  const command = XCOM2_PROJECT_FOUNDRY_RENDERER_COMMANDS.renderPreview;
  const record = exactDataRecord(
    command,
    "request",
    value,
    ["sourceGrant", "destinationParentGrant", "modId"],
    "render request",
  );
  const sourceGrant = normalizeSourceGrant(command, "request", record.sourceGrant);
  const destinationParentGrant = normalizeDestinationGrant(
    command,
    "request",
    record.destinationParentGrant,
  );
  if (!validModId(record.modId) || sourceGrant.identity === destinationParentGrant.identity) {
    throw protocolError(command, "request", "render request fields violate the native contract");
  }
  return Object.freeze({ sourceGrant, destinationParentGrant, modId: record.modId });
}

function normalizeApplyRequest(value: unknown): Readonly<Xcom2ProjectFoundryApplyRequest> {
  const command = XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND;
  const record = exactDataRecord(
    command,
    "request",
    value,
    [
      "schemaVersion",
      "sourceGrant",
      "destinationParentGrant",
      "operationGrant",
      "modId",
      "approvedPlanDigest",
    ],
    "apply request",
  );
  const sourceGrant = normalizeSourceGrant(command, "request", record.sourceGrant);
  const destinationParentGrant = normalizeDestinationGrant(
    command,
    "request",
    record.destinationParentGrant,
  );
  const operationGrant = normalizeOperationGrant(command, "request", record.operationGrant);
  if (
    record.schemaVersion !== XCOM2_PROJECT_FOUNDRY_APPLY_SCHEMA_VERSION ||
    !validModId(record.modId) ||
    !safeText(record.approvedPlanDigest) ||
    !SHA256.test(record.approvedPlanDigest) ||
    operationGrant.derivedDestination !==
      expectedDerivedDestination(destinationParentGrant.parent, record.modId) ||
    new Set([sourceGrant.identity, destinationParentGrant.identity, operationGrant.identity])
      .size !== 3
  ) {
    throw protocolError(command, "request", "apply request fields violate the native contract");
  }
  return Object.freeze({
    schemaVersion: XCOM2_PROJECT_FOUNDRY_APPLY_SCHEMA_VERSION,
    sourceGrant,
    destinationParentGrant,
    operationGrant,
    modId: record.modId,
    approvedPlanDigest: record.approvedPlanDigest,
  });
}

function normalizeNativeApplyResult(
  value: unknown,
  request: Readonly<Xcom2ProjectFoundryApplyRequest>,
): Readonly<Xcom2ProjectFoundryApplyResult> {
  const command = XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND;
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw protocolError(command, "response", "apply result must be an exact data object");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw protocolError(command, "response", "apply result must be a plain data object");
    }
    const resultDescriptor = Object.getOwnPropertyDescriptor(value, "result");
    if (!resultDescriptor || !("value" in resultDescriptor) || !resultDescriptor.enumerable) {
      throw protocolError(command, "response", "apply result tag must be an enumerable field");
    }

    if (resultDescriptor.value === "created") {
      const receipt = exactDataRecord(
        command,
        "response",
        value,
        [
          "result",
          "planDigest",
          "finalProjectLocation",
          "sourceCommit",
          "sourceTree",
          "committedDirectories",
          "committedFiles",
        ],
        "created receipt",
      );
      if (
        receipt.result !== "created" ||
        receipt.planDigest !== request.approvedPlanDigest ||
        receipt.finalProjectLocation !== request.operationGrant.derivedDestination ||
        !canonicalLinuxPath(receipt.finalProjectLocation) ||
        receipt.sourceCommit !== XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT ||
        receipt.sourceTree !== XCOM2_PROJECT_FOUNDRY_SOURCE_TREE ||
        receipt.committedDirectories !== EXPECTED_COMMITTED_DIRECTORIES ||
        receipt.committedFiles !== EXPECTED_COMMITTED_FILES
      ) {
        throw protocolError(command, "response", "created receipt violates the apply contract");
      }
      return Object.freeze({
        result: "created",
        planDigest: request.approvedPlanDigest,
        finalProjectLocation: request.operationGrant.derivedDestination,
        sourceCommit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
        sourceTree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
        committedDirectories: EXPECTED_COMMITTED_DIRECTORIES,
        committedFiles: EXPECTED_COMMITTED_FILES,
      });
    }

    if (resultDescriptor.value === "refused") {
      const refusal = exactDataRecord(
        command,
        "response",
        value,
        ["result", "phase", "reason"],
        "apply refusal",
      );
      if (
        refusal.result !== "refused" ||
        refusal.phase !== "pre-commit" ||
        !safeText(refusal.reason) ||
        !APPLY_REFUSAL_REASONS.has(refusal.reason)
      ) {
        throw protocolError(command, "response", "apply refusal violates the apply contract");
      }
      return Object.freeze({
        result: "refused",
        phase: "pre-commit",
        reason: refusal.reason,
      });
    }

    if (resultDescriptor.value === "failed") {
      const failure = exactDataRecord(
        command,
        "response",
        value,
        ["result", "phase", "reason", "cleanupStatus"],
        "apply failure",
      );
      if (
        failure.result !== "failed" ||
        failure.phase !== "pre-commit" ||
        !safeText(failure.reason) ||
        !APPLY_PRE_COMMIT_FAILURE_REASONS.has(failure.reason) ||
        (failure.cleanupStatus !== "verified-complete" && failure.cleanupStatus !== "not-verified")
      ) {
        throw protocolError(command, "response", "apply failure violates the apply contract");
      }
      return Object.freeze({
        result: "failed",
        phase: "pre-commit",
        reason: failure.reason,
        cleanupStatus: failure.cleanupStatus,
      });
    }

    if (resultDescriptor.value === "created-recovery-required") {
      const recovery = exactDataRecord(
        command,
        "response",
        value,
        ["result", "phase", "planDigest", "finalProjectLocation", "reason"],
        "apply recovery receipt",
      );
      if (
        recovery.result !== "created-recovery-required" ||
        recovery.phase !== "post-commit" ||
        recovery.planDigest !== request.approvedPlanDigest ||
        recovery.finalProjectLocation !== request.operationGrant.derivedDestination ||
        !canonicalLinuxPath(recovery.finalProjectLocation) ||
        !safeText(recovery.reason) ||
        !APPLY_POST_COMMIT_FAILURE_REASONS.has(recovery.reason)
      ) {
        throw protocolError(
          command,
          "response",
          "apply recovery receipt violates the apply contract",
        );
      }
      return Object.freeze({
        result: "created-recovery-required",
        phase: "post-commit",
        planDigest: request.approvedPlanDigest,
        finalProjectLocation: request.operationGrant.derivedDestination,
        reason: recovery.reason,
      });
    }

    throw protocolError(command, "response", "apply result tag is unsupported");
  } catch {
    // Native payloads, proxies, accessors, and inspection exceptions never cross this boundary.
    throw protocolError(command, "response", "apply result could not be safely inspected");
  }
}

function normalizeNativeRenderResult(
  value: unknown,
  request: Readonly<Xcom2ProjectFoundryRenderRequest>,
): TauriXcom2ProjectFoundryNativeRenderResult {
  const command = XCOM2_PROJECT_FOUNDRY_RENDERER_COMMANDS.renderPreview;
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw protocolError(command, "response", "render result must be an exact data object");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw protocolError(command, "response", "render result must be a plain data object");
    }
    const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
    if (!kindDescriptor || !("value" in kindDescriptor) || !kindDescriptor.enumerable) {
      throw protocolError(command, "response", "render result kind must be an enumerable field");
    }

    if (kindDescriptor.value === "refused") {
      const refusal = exactDataRecord(
        command,
        "response",
        value,
        ["kind", "code"],
        "render refusal",
      );
      if (!safeText(refusal.code) || !RENDER_REFUSAL_CODES.has(refusal.code)) {
        throw protocolError(command, "response", "render refusal code is unsupported");
      }
      return Object.freeze({
        kind: "refused",
        code: refusal.code as Xcom2ProjectFoundryPreviewRefusalCode,
      });
    }

    const rendered = exactDataRecord(
      command,
      "response",
      value,
      ["kind", "operationGrant", "planBody"],
      "render result",
    );
    if (rendered.kind !== "rendered") {
      throw protocolError(command, "response", "render result kind is unsupported");
    }
    const operationGrant = normalizeOperationGrant(command, "response", rendered.operationGrant);
    if (
      operationGrant.derivedDestination !==
        expectedDerivedDestination(request.destinationParentGrant.parent, request.modId) ||
      operationGrant.identity === request.sourceGrant.identity ||
      operationGrant.identity === request.destinationParentGrant.identity
    ) {
      throw protocolError(command, "response", "render operation grant bindings are inconsistent");
    }
    const planBody = copyBoundedRenderJson(command, rendered.planBody, {
      active: new Set<object>(),
      nodes: 0,
      stringBytes: 0,
    });
    return Object.freeze({ kind: "rendered", operationGrant, planBody });
  } catch {
    // Provider objects and thrown proxy/accessor causes never cross the adapter boundary.
    throw protocolError(command, "response", "render result could not be safely inspected");
  }
}

function normalizeDestinationSelection(
  command: string,
  value: unknown,
  selectedRoot: string,
  modId: string,
): Readonly<{
  destinationParentGrant: Readonly<Xcom2ProjectFoundryDestinationParentSelectionGrant>;
  operationGrant: Readonly<Xcom2ProjectFoundryOperationGrant>;
}> {
  const record = exactDataRecord(
    command,
    "response",
    value,
    ["destinationParentGrant", "operationGrant"],
    "destination selection",
  );
  const destinationParentGrant = normalizeDestinationGrant(
    command,
    "response",
    record.destinationParentGrant,
  );
  const operationGrant = normalizeOperationGrant(command, "response", record.operationGrant);
  if (
    destinationParentGrant.parent !== selectedRoot ||
    operationGrant.derivedDestination !== expectedDerivedDestination(selectedRoot, modId) ||
    destinationParentGrant.identity === operationGrant.identity
  ) {
    throw protocolError(command, "response", "destination selection bindings are inconsistent");
  }
  return Object.freeze({ destinationParentGrant, operationGrant });
}

function normalizeEvidence(value: unknown): Readonly<Xcom2ProjectFoundrySourceObjectEvidence> {
  const command = XCOM2_PROJECT_FOUNDRY_COMMANDS.resolveSourceObject;
  const record = exactDataRecord(
    command,
    "response",
    value,
    ["commit", "tree", "fingerprintResult"],
    "source evidence",
  );
  if (
    record.commit !== XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT ||
    record.tree !== XCOM2_PROJECT_FOUNDRY_SOURCE_TREE ||
    !safeText(record.fingerprintResult) ||
    !FINGERPRINT_RESULTS.has(record.fingerprintResult)
  ) {
    throw protocolError(command, "response", "source evidence violates the pinned-object contract");
  }
  return Object.freeze({
    commit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
    tree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
    fingerprintResult:
      record.fingerprintResult as Xcom2ProjectFoundrySourceObjectEvidence["fingerprintResult"],
  });
}

function safeNativeRejection(error: unknown): string | null {
  try {
    const candidate =
      typeof error === "string" ? error : error instanceof Error ? error.message : null;
    return candidate !== null && SAFE_NATIVE_REJECTIONS.has(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

async function invokeFoundry(command: string, args?: Record<string, unknown>): Promise<unknown> {
  try {
    return await invoke<unknown>(command, args);
  } catch (error) {
    const code = safeNativeRejection(error);
    throw new TauriAdapterError(
      command,
      code
        ? `Native Project Foundry command rejected: ${code}`
        : "Native Project Foundry command failed",
    );
  }
}

async function selectDirectory(
  selection: "source-repository" | "destination-parent",
): Promise<string> {
  let result: unknown;
  try {
    result = await open(DIRECTORY_DIALOG_OPTIONS);
  } catch {
    throw new TauriAdapterError(DIALOG_COMMAND, "Native Project Foundry directory dialog failed");
  }
  if (result === null) throw new TauriProjectFoundrySelectionCancelledError(selection);
  if (!canonicalLinuxPath(result)) {
    throw protocolError(
      DIALOG_COMMAND,
      "response",
      "directory selection is not a canonical Linux path",
    );
  }
  return result;
}

/** Strict production bridge for the read-only native Project Foundry preview protocol. */
export class TauriXcom2ProjectFoundryAdapter implements TauriXcom2ProjectFoundryComposition {
  readonly selectors = Object.freeze({
    selectSourceRepository: (): Promise<Xcom2ProjectFoundrySourceSelectionGrant> =>
      this.selectSourceRepository(),
    selectDestinationParent: (
      modId?: string,
    ): Promise<{
      readonly destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant;
      readonly operationGrant: Xcom2ProjectFoundryOperationGrant;
    }> => this.selectDestinationParent(modId),
  });

  readonly source = Object.freeze({
    resolvePinnedObject: (
      grant: Xcom2ProjectFoundrySourceSelectionGrant,
    ): Promise<Xcom2ProjectFoundrySourceObjectEvidence> => this.resolvePinnedObject(grant),
  });

  readonly destination = Object.freeze({
    inspectDerivedDestination: (
      destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant,
      operationGrant: Xcom2ProjectFoundryOperationGrant,
    ): Promise<Xcom2ProjectFoundryDestinationState> =>
      this.inspectDerivedDestination(destinationParentGrant, operationGrant),
  });

  readonly grants = Object.freeze({ revokeAll: (): Promise<void> => this.revokeAll() });

  async selectSourceRepository(): Promise<Xcom2ProjectFoundrySourceSelectionGrant> {
    const command = XCOM2_PROJECT_FOUNDRY_COMMANDS.authorizeSourceRepository;
    const selectedRoot = await selectDirectory("source-repository");
    const request = Object.freeze({ selectedRoot });
    const response = await invokeFoundry(command, Object.freeze({ request }));
    const grant = normalizeSourceGrant(command, "response", response);
    if (grant.repository !== selectedRoot) {
      throw protocolError(
        command,
        "response",
        "source grant does not bind the selected repository",
      );
    }
    return grant;
  }

  async selectDestinationParent(modId?: string): Promise<{
    readonly destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant;
    readonly operationGrant: Xcom2ProjectFoundryOperationGrant;
  }> {
    const command = XCOM2_PROJECT_FOUNDRY_COMMANDS.authorizeDestinationParent;
    if (!validModId(modId)) {
      throw protocolError(command, "request", "ModId must be exact and valid before selection");
    }
    const selectedRoot = await selectDirectory("destination-parent");
    const request = Object.freeze({ selectedRoot, modId });
    const response = await invokeFoundry(command, Object.freeze({ request }));
    return normalizeDestinationSelection(command, response, selectedRoot, modId);
  }

  /** Selects and authorizes only the parent; no ModId or operation authority is sent. */
  async selectDestinationParentSelection(): Promise<Xcom2ProjectFoundryDestinationParentSelectionGrant> {
    const command = XCOM2_PROJECT_FOUNDRY_RENDERER_COMMANDS.authorizeDestinationParentSelection;
    const selectedRoot = await selectDirectory("destination-parent");
    const request = Object.freeze({ selectedRoot });
    const response = await invokeFoundry(command, Object.freeze({ request }));
    const grant = normalizeDestinationGrant(command, "response", response);
    if (grant.parent !== selectedRoot) {
      throw protocolError(
        command,
        "response",
        "destination grant does not bind the selected parent",
      );
    }
    return grant;
  }

  /** Invokes the authoritative renderer and returns only bounded provider-neutral JSON. */
  async renderPreview(
    request: Readonly<Xcom2ProjectFoundryRenderRequest>,
  ): Promise<TauriXcom2ProjectFoundryNativeRenderResult> {
    const command = XCOM2_PROJECT_FOUNDRY_RENDERER_COMMANDS.renderPreview;
    const immutableRequest = normalizeRenderRequest(request);
    const response = await invokeFoundry(command, Object.freeze({ request: immutableRequest }));
    return normalizeNativeRenderResult(response, immutableRequest);
  }

  async resolvePinnedObject(
    grant: Xcom2ProjectFoundrySourceSelectionGrant,
  ): Promise<Xcom2ProjectFoundrySourceObjectEvidence> {
    const command = XCOM2_PROJECT_FOUNDRY_COMMANDS.resolveSourceObject;
    const immutableGrant = normalizeSourceGrant(command, "request", grant);
    const request = Object.freeze({ grant: immutableGrant });
    return normalizeEvidence(await invokeFoundry(command, Object.freeze({ request })));
  }

  async inspectDerivedDestination(
    destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant,
    operationGrant: Xcom2ProjectFoundryOperationGrant,
  ): Promise<Xcom2ProjectFoundryDestinationState> {
    const command = XCOM2_PROJECT_FOUNDRY_COMMANDS.inspectDestination;
    const destination = normalizeDestinationGrant(command, "request", destinationParentGrant);
    const operation = normalizeOperationGrant(command, "request", operationGrant);
    if (
      destination.identity === operation.identity ||
      !operation.derivedDestination.startsWith(
        destination.parent === "/" ? "/" : `${destination.parent}/`,
      )
    ) {
      throw protocolError(command, "request", "destination grant bindings are inconsistent");
    }
    const child = operation.derivedDestination.slice(
      destination.parent === "/" ? 1 : destination.parent.length + 1,
    );
    if (
      !validModId(child) ||
      operation.derivedDestination !== expectedDerivedDestination(destination.parent, child)
    ) {
      throw protocolError(command, "request", "derived destination is not the exact granted child");
    }
    const request = Object.freeze({
      destinationParentGrant: destination,
      operationGrant: operation,
    });
    const response = await invokeFoundry(command, Object.freeze({ request }));
    if (
      typeof response !== "string" ||
      !DESTINATION_STATES.has(response as Xcom2ProjectFoundryDestinationState)
    ) {
      throw protocolError(command, "response", "destination state is unsupported");
    }
    return response as Xcom2ProjectFoundryDestinationState;
  }

  async revokeAll(): Promise<void> {
    const command = XCOM2_PROJECT_FOUNDRY_COMMANDS.revokeAll;
    const response = await invokeFoundry(command);
    if (response !== null && response !== undefined) {
      throw protocolError(command, "response", "revocation acknowledgement must be empty");
    }
  }
}

export { TauriXcom2ProjectFoundryAdapter as TauriProjectFoundryAdapter };

/** Renderer-capable composition exported for controller migration without changing App wiring. */
export class TauriXcom2ProjectFoundryRendererAdapter implements TauriXcom2ProjectFoundryRendererComposition {
  private readonly bridge = new TauriXcom2ProjectFoundryAdapter();

  readonly selectors = Object.freeze({
    selectSourceRepository: (): Promise<Xcom2ProjectFoundrySourceSelectionGrant> =>
      this.selectSourceRepository(),
    selectDestinationParent: (): Promise<Xcom2ProjectFoundryDestinationParentSelectionGrant> =>
      this.selectDestinationParent(),
  });

  readonly renderer = Object.freeze({
    renderPreview: (
      request: Readonly<Xcom2ProjectFoundryRenderRequest>,
    ): Promise<TauriXcom2ProjectFoundryNativeRenderResult> => this.renderPreview(request),
  });

  readonly grants = Object.freeze({
    revokeOperation: (): Promise<void> => this.revokeOperation(),
    revokeAll: (): Promise<void> => this.revokeAll(),
  });

  selectSourceRepository(): Promise<Xcom2ProjectFoundrySourceSelectionGrant> {
    return this.bridge.selectSourceRepository();
  }

  selectDestinationParent(): Promise<Xcom2ProjectFoundryDestinationParentSelectionGrant> {
    return this.bridge.selectDestinationParentSelection();
  }

  renderPreview(
    request: Readonly<Xcom2ProjectFoundryRenderRequest>,
  ): Promise<TauriXcom2ProjectFoundryNativeRenderResult> {
    return this.bridge.renderPreview(request);
  }

  /** Consumes exactly one approved native preview operation. */
  async apply(
    request: Readonly<Xcom2ProjectFoundryApplyRequest>,
  ): Promise<Xcom2ProjectFoundryApplyResult> {
    const immutableRequest = normalizeApplyRequest(request);
    const response = await invokeFoundry(
      XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND,
      Object.freeze({ request: immutableRequest }),
    );
    return normalizeNativeApplyResult(response, immutableRequest);
  }

  async revokeOperation(): Promise<void> {
    const command = XCOM2_PROJECT_FOUNDRY_RENDERER_COMMANDS.revokeOperation;
    const response = await invokeFoundry(command);
    if (response !== null && response !== undefined) {
      throw protocolError(command, "response", "revocation acknowledgement must be empty");
    }
  }

  revokeAll(): Promise<void> {
    return this.bridge.revokeAll();
  }
}

export { TauriXcom2ProjectFoundryRendererAdapter as TauriProjectFoundryRendererAdapter };

export function createTauriXcom2ProjectFoundryComposition(): TauriXcom2ProjectFoundryComposition {
  return new TauriXcom2ProjectFoundryAdapter();
}

export function createTauriXcom2ProjectFoundryRendererComposition(): TauriXcom2ProjectFoundryRendererComposition {
  return new TauriXcom2ProjectFoundryRendererAdapter();
}

export const createTauriProjectFoundryComposition = createTauriXcom2ProjectFoundryComposition;
export const createTauriProjectFoundryRendererComposition =
  createTauriXcom2ProjectFoundryRendererComposition;
