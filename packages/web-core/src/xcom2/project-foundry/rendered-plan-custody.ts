import {
  XCOM2_PROJECT_FOUNDRY_PACK_ID,
  XCOM2_PROJECT_FOUNDRY_PLAN_SCHEMA_VERSION,
  XCOM2_PROJECT_FOUNDRY_PLATFORM,
  XCOM2_PROJECT_FOUNDRY_PUBLICATION_STATUS,
  XCOM2_PROJECT_FOUNDRY_RENDERED_PLAN_INVALID_CODE,
  XCOM2_PROJECT_FOUNDRY_RENDERED_PLAN_INVALID_SUMMARY,
  XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
  XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
  type Xcom2ProjectFoundryOperationGrant,
  type Xcom2ProjectFoundryRenderRequest,
  type Xcom2ProjectFoundryRenderedPlanBody,
  type Xcom2ProjectFoundryRenderedPlanValidationResult,
} from "@ide/contracts";

import {
  bytesToHex,
  canonicalizeJsonRfc8785,
  sha256,
  sha256Hex,
  utf8Bytes,
  uuidV5,
} from "./deterministic-data";
import {
  FOUNDRY_RENDERED_WARNINGS,
  foundryRenderedAbsences,
  foundryRenderedDirectories,
  foundryRenderedFiles,
} from "./rendered-plan-recipe";

const URL_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
const MOD_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,47}$/u;
const WINDOWS_DEVICE_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GRANT_IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SOURCE_POLICY =
  "Committed Git objects only; working-tree modifications and untracked files are ignored";

const SAFE_INVALID = Object.freeze({
  kind: "refused",
  code: XCOM2_PROJECT_FOUNDRY_RENDERED_PLAN_INVALID_CODE,
  summary: XCOM2_PROJECT_FOUNDRY_RENDERED_PLAN_INVALID_SUMMARY,
} as const);

type JsonRecord = Record<string, unknown>;

function deepFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function strictCloneJson<T>(value: T, active = new Set<object>()): T {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite JSON number");
    return value;
  }
  if (typeof value !== "object") throw new TypeError("Non-JSON value");
  if (active.has(value)) throw new TypeError("Cyclic JSON value");

  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError("Non-plain array");
      const ownKeys = Reflect.ownKeys(value);
      if (
        ownKeys.some(
          (key) =>
            typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)),
        )
      ) {
        throw new TypeError("Array has unknown properties");
      }
      const output: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index))
          throw new TypeError("Sparse array");
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) throw new TypeError("Array accessor");
        output.push(strictCloneJson(descriptor.value, active));
      }
      return output as T;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError("Non-plain object");
    const output: JsonRecord = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError("Symbol property");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("Non-data JSON property");
      }
      output[key] = strictCloneJson(descriptor.value, active);
    }
    return output as T;
  } finally {
    active.delete(value);
  }
}

function record(value: unknown): JsonRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonRecord;
}

function hasExactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function canonicalAbsolutePath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\\")) return false;
  if (value.length > 1 && value.endsWith("/")) return false;
  return value
    .split("/")
    .slice(1)
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && GRANT_IDENTITY_PATTERN.test(value);
}

function validModId(value: unknown): value is string {
  return (
    typeof value === "string" && MOD_ID_PATTERN.test(value) && !WINDOWS_DEVICE_PATTERN.test(value)
  );
}

function validateSourceGrant(
  value: unknown,
): value is Xcom2ProjectFoundryRenderRequest["sourceGrant"] {
  const grant = record(value);
  return Boolean(
    grant &&
    hasExactKeys(grant, ["kind", "repository", "identity"]) &&
    grant.kind === "source-repository" &&
    canonicalAbsolutePath(grant.repository) &&
    validIdentity(grant.identity),
  );
}

function validateDestinationGrant(
  value: unknown,
): value is Xcom2ProjectFoundryRenderRequest["destinationParentGrant"] {
  const grant = record(value);
  return Boolean(
    grant &&
    hasExactKeys(grant, ["kind", "parent", "identity"]) &&
    grant.kind === "destination-parent" &&
    canonicalAbsolutePath(grant.parent) &&
    validIdentity(grant.identity),
  );
}

function validateRequest(value: unknown): value is Xcom2ProjectFoundryRenderRequest {
  const request = record(value);
  return Boolean(
    request &&
    hasExactKeys(request, ["sourceGrant", "destinationParentGrant", "modId"]) &&
    validateSourceGrant(request.sourceGrant) &&
    validateDestinationGrant(request.destinationParentGrant) &&
    validModId(request.modId),
  );
}

function derivedDestination(parent: string, modId: string): string {
  return `${parent === "/" ? "" : parent}/${modId}`;
}

function expectedGuid(modId: string): string {
  const name = `urn:ide:project-foundry:${XCOM2_PROJECT_FOUNDRY_PACK_ID}:${XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT}:${modId}`;
  return `{${uuidV5(URL_NAMESPACE, name).toUpperCase()}}`;
}

function validateStringArray(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => typeof entry === "string" && entry === expected[index])
  );
}

function validateDirectories(value: unknown, modId: string): boolean {
  if (!Array.isArray(value) || value.length !== 12) return false;
  const expected = new Map(foundryRenderedDirectories(modId).map((entry) => [entry.path, entry]));
  const seen = new Set<string>();
  for (const item of value) {
    const directory = record(item);
    if (!directory || !hasExactKeys(directory, ["path", "mode", "state"])) return false;
    if (typeof directory.path !== "string" || seen.has(directory.path)) return false;
    const recipe = expected.get(directory.path);
    if (!recipe || directory.mode !== "0755" || directory.state !== recipe.state) return false;
    seen.add(directory.path);
  }
  return seen.size === expected.size;
}

function validateFiles(value: unknown, modId: string): Map<string, JsonRecord> | undefined {
  if (!Array.isArray(value) || value.length !== 27) return undefined;
  const expected = new Map(foundryRenderedFiles(modId).map((entry) => [entry.path, entry]));
  const files = new Map<string, JsonRecord>();
  for (const item of value) {
    const file = record(item);
    if (!file || !hasExactKeys(file, ["path", "classification", "mode", "bytes", "sha256"])) {
      return undefined;
    }
    if (typeof file.path !== "string" || files.has(file.path)) return undefined;
    const recipe = expected.get(file.path);
    if (
      !recipe ||
      file.classification !== recipe.classification ||
      file.mode !== "0644" ||
      typeof file.bytes !== "number" ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes <= 0 ||
      typeof file.sha256 !== "string" ||
      !SHA256_PATTERN.test(file.sha256)
    ) {
      return undefined;
    }
    if (
      recipe.copiedIntegrity &&
      (file.bytes !== recipe.copiedIntegrity.bytes || file.sha256 !== recipe.copiedIntegrity.sha256)
    ) {
      return undefined;
    }
    files.set(file.path, file);
  }
  return files.size === expected.size ? files : undefined;
}

function decodedPreviewBytes(preview: JsonRecord): Uint8Array {
  const escaped = preview.escapedBytePreview as string;
  if (escaped.includes("\r") || escaped.endsWith("\n")) throw new TypeError("Invalid LF preview");
  const body = utf8Bytes(`${escaped.replaceAll("\\t", "\t").replaceAll("\\u0020", " ")}\n`);
  if (preview.byteOrderMark !== "present") return body;
  const output = new Uint8Array(body.length + 3);
  output.set([0xef, 0xbb, 0xbf]);
  output.set(body, 3);
  return output;
}

function generatedPreviewHasCurrentIdentity(
  preview: JsonRecord,
  modId: string,
  guid: string,
): boolean {
  const content = preview.escapedBytePreview as string;
  if (preview.path === `${modId}/${modId}.x2proj`) {
    return (
      content.includes(`<Guid>${guid}</Guid>`) &&
      content.includes(`<Name>${modId}</Name>`) &&
      content.includes(`Localization\\${modId}.int`) &&
      content.includes(`Src\\${modId}\\Classes\\X2DLCInfo_${modId}.uc`)
    );
  }
  return (
    preview.path === `${modId}.XCOM_sln` &&
    content.includes(`= "${modId}", "${modId}\\${modId}.x2proj", "${guid}"`) &&
    content.includes(`${guid}.Debug|XCOM 2.ActiveCfg`)
  );
}

function validateGeneratedPreviews(
  value: unknown,
  modId: string,
  guid: string,
  files: ReadonlyMap<string, JsonRecord>,
): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const expectations = new Map<string, "present" | "absent">([
    [`${modId}/${modId}.x2proj`, "present"],
    [`${modId}.XCOM_sln`, "absent"],
  ]);
  const seen = new Set<string>();
  for (const item of value) {
    const preview = record(item);
    if (
      !preview ||
      !hasExactKeys(preview, [
        "path",
        "encoding",
        "byteOrderMark",
        "lineEndings",
        "escapedBytePreview",
      ]) ||
      typeof preview.path !== "string" ||
      seen.has(preview.path) ||
      preview.encoding !== "UTF-8" ||
      preview.lineEndings !== "LF" ||
      typeof preview.escapedBytePreview !== "string" ||
      preview.byteOrderMark !== expectations.get(preview.path) ||
      !generatedPreviewHasCurrentIdentity(preview, modId, guid)
    ) {
      return false;
    }
    const file = files.get(preview.path);
    if (!file) return false;
    const bytes = decodedPreviewBytes(preview);
    if (file.bytes !== bytes.length || file.sha256 !== bytesToHex(sha256(bytes))) return false;
    seen.add(preview.path);
  }
  return seen.size === expectations.size;
}

function validatePlanBody(
  value: unknown,
  request: Readonly<Xcom2ProjectFoundryRenderRequest>,
  operationGrant: JsonRecord,
): value is Xcom2ProjectFoundryRenderedPlanBody {
  const plan = record(value);
  if (
    !plan ||
    !hasExactKeys(plan, [
      "schemaVersion",
      "canonicalization",
      "digestAlgorithm",
      "packId",
      "platform",
      "publicationStatus",
      "source",
      "project",
      "destination",
      "symlinks",
      "directories",
      "files",
      "generatedPreviews",
      "absences",
      "warnings",
    ]) ||
    plan.schemaVersion !== XCOM2_PROJECT_FOUNDRY_PLAN_SCHEMA_VERSION ||
    plan.canonicalization !== "RFC 8785" ||
    plan.digestAlgorithm !== "SHA-256" ||
    plan.packId !== XCOM2_PROJECT_FOUNDRY_PACK_ID ||
    plan.platform !== XCOM2_PROJECT_FOUNDRY_PLATFORM ||
    plan.publicationStatus !== XCOM2_PROJECT_FOUNDRY_PUBLICATION_STATUS ||
    plan.symlinks !== "none"
  ) {
    return false;
  }

  const source = record(plan.source);
  if (
    !source ||
    !hasExactKeys(source, [
      "repository",
      "grantIdentity",
      "commit",
      "tree",
      "fingerprintResult",
      "policy",
    ]) ||
    source.repository !== request.sourceGrant.repository ||
    source.grantIdentity !== request.sourceGrant.identity ||
    source.commit !== XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT ||
    source.tree !== XCOM2_PROJECT_FOUNDRY_SOURCE_TREE ||
    source.fingerprintResult !== "Verified" ||
    source.policy !== SOURCE_POLICY
  ) {
    return false;
  }

  const project = record(plan.project);
  const guid = expectedGuid(request.modId);
  if (
    !project ||
    !hasExactKeys(project, ["modId", "guid"]) ||
    project.modId !== request.modId ||
    project.guid !== guid
  ) {
    return false;
  }

  const expectedDestination = derivedDestination(
    request.destinationParentGrant.parent,
    request.modId,
  );
  const destination = record(plan.destination);
  if (
    !destination ||
    !hasExactKeys(destination, [
      "parent",
      "parentGrantIdentity",
      "derivedAbsentDestination",
      "operationGrantIdentity",
    ]) ||
    destination.parent !== request.destinationParentGrant.parent ||
    destination.parentGrantIdentity !== request.destinationParentGrant.identity ||
    destination.derivedAbsentDestination !== expectedDestination ||
    destination.operationGrantIdentity !== operationGrant.identity
  ) {
    return false;
  }

  const files = validateFiles(plan.files, request.modId);
  if (
    !validateDirectories(plan.directories, request.modId) ||
    !files ||
    !validateGeneratedPreviews(plan.generatedPreviews, request.modId, guid, files) ||
    !validateStringArray(plan.absences, foundryRenderedAbsences(request.modId)) ||
    !validateStringArray(plan.warnings, FOUNDRY_RENDERED_WARNINGS)
  ) {
    return false;
  }

  return true;
}

/** Copy the provider-neutral selector input into a closed, deeply immutable render request. */
export function createXcom2ProjectFoundryRenderRequest(
  input: Xcom2ProjectFoundryRenderRequest,
): Readonly<Xcom2ProjectFoundryRenderRequest> {
  const copy = strictCloneJson(input);
  if (!validateRequest(copy)) throw new TypeError("Invalid Project Foundry render request");
  return deepFreeze(copy);
}

/** Strictly validate one closed native render and take immutable RFC 8785/SHA-256 custody. */
export function validateAndDigestXcom2ProjectFoundryRenderedPlan(
  request: Readonly<Xcom2ProjectFoundryRenderRequest>,
  rendered: unknown,
): Xcom2ProjectFoundryRenderedPlanValidationResult {
  try {
    const requestCopy = strictCloneJson(request);
    const renderedCopy = strictCloneJson(rendered);
    if (!validateRequest(requestCopy)) return SAFE_INVALID;

    const result = record(renderedCopy);
    if (!result || !hasExactKeys(result, ["kind", "operationGrant", "planBody"])) {
      return SAFE_INVALID;
    }
    const operationGrant = record(result.operationGrant);
    const expectedDestination = derivedDestination(
      requestCopy.destinationParentGrant.parent,
      requestCopy.modId,
    );
    if (
      result.kind !== "rendered" ||
      !operationGrant ||
      !hasExactKeys(operationGrant, ["kind", "derivedDestination", "identity"]) ||
      operationGrant.kind !== "preview-operation" ||
      operationGrant.derivedDestination !== expectedDestination ||
      !validIdentity(operationGrant.identity) ||
      operationGrant.identity === requestCopy.sourceGrant.identity ||
      operationGrant.identity === requestCopy.destinationParentGrant.identity ||
      !validatePlanBody(result.planBody, requestCopy, operationGrant)
    ) {
      return SAFE_INVALID;
    }

    const planBody = result.planBody as Xcom2ProjectFoundryRenderedPlanBody;
    const planDigest = sha256Hex(canonicalizeJsonRfc8785(planBody));
    return deepFreeze({
      kind: "ready",
      operationGrant: result.operationGrant as Readonly<Xcom2ProjectFoundryOperationGrant>,
      plan: { ...planBody, planDigest },
    });
  } catch {
    return SAFE_INVALID;
  }
}
