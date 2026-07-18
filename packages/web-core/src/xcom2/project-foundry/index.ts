import {
  XCOM2_PROJECT_FOUNDRY_PACK_ID,
  XCOM2_PROJECT_FOUNDRY_PLAN_SCHEMA_VERSION,
  XCOM2_PROJECT_FOUNDRY_PLATFORM,
  XCOM2_PROJECT_FOUNDRY_PUBLICATION_STATUS,
  XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES,
  XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
  XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
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

const URL_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
const MOD_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,47}$/u;
const WINDOWS_DEVICE_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu;
const GIT_OBJECT_ID_PATTERN = /^[0-9a-f]{40}$/u;
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

/** Derive the deterministic uppercase-braced URL-namespace UUIDv5 for a valid ModId. */
export function deriveXcom2ProjectFoundryProjectGuid(modId: string): string {
  if (validateXcom2ProjectFoundryModId(modId).kind !== "accepted") {
    throw new TypeError("A valid Project Foundry ModId is required");
  }
  const name = `urn:ide:project-foundry:${XCOM2_PROJECT_FOUNDRY_PACK_ID}:${XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT}:${modId}`;
  return `{${uuidV5(URL_NAMESPACE, name).toUpperCase()}}`;
}

/** Copy selector data into a provider-neutral, deeply immutable request. */
export function createXcom2ProjectFoundryPreviewRequest(
  input: Xcom2ProjectFoundryPreviewRequest,
): Readonly<Xcom2ProjectFoundryPreviewRequest> {
  return deepFreeze(cloneJsonData(input));
}

/** Digest JSON plan data with SHA-256 over its RFC 8785 canonical representation. */
export function digestXcom2ProjectFoundryPlan(plan: Xcom2ProjectFoundryDigestBoundPlan): string {
  return sha256Hex(canonicalizeJsonRfc8785(plan));
}

/** Validate all bound evidence and return the immutable display-only Foundry plan. */
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

export { canonicalizeJsonRfc8785, sha1, sha256, sha256Hex, uuidV5 } from "./deterministic-data";
