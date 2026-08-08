import {
  XCOM2_PROJECT_BUILD_RECIPE_ARGUMENT_ROLES,
  XCOM2_PROJECT_BUILD_RECIPE_LIMITS,
  XCOM2_PROJECT_BUILD_RECIPE_PREREQUISITE_ROLES,
  XCOM2_PROJECT_BUILD_RECIPE_SCRIPT_PATH,
  type Xcom2ProjectBuildRecipeApprovalDecision,
  type Xcom2ProjectBuildRecipeApprovalRequest,
  type Xcom2ProjectBuildRecipeAuthorityState,
  type Xcom2ProjectBuildRecipeCandidate,
  type Xcom2ProjectBuildRecipeConsumptionDecision,
  type Xcom2ProjectBuildRecipeConsumptionRequest,
  type Xcom2ProjectBuildRecipeReconciliationDecision,
  type Xcom2ProjectBuildRecipeReconciliationEvent,
  type Xcom2ProjectBuildRecipeReviewResult,
} from "./xcom2-project-build-recipe";

const SHA256 = /^[a-f0-9]{64}$/u;
const WINDOWS_DRIVE = /^[A-Za-z]:/u;
const EXCLUDED_PATH_SEGMENTS = new Set([
  "content",
  "script",
  "vendor",
  "build",
  "log",
  "asset",
  "assets",
]);

export const XCOM2_PROJECT_BUILD_RECIPE_CAPABILITIES = deepFreeze({
  browser: { review: "unavailable", approval: "unavailable", execution: "unavailable" },
  native: { review: "available", approval: "available", execution: "unavailable" },
} as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function frozenClone<T>(value: T): Readonly<T> {
  return deepFreeze(structuredClone(value));
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError("JSON strings must contain valid Unicode scalar values");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError("JSON strings must contain valid Unicode scalar values");
    }
  }
}

function utf8Bytes(value: string): Uint8Array {
  assertWellFormedUnicode(value);
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let point = value.charCodeAt(index);
    if (point >= 0xd800 && point <= 0xdbff) {
      const low = value.charCodeAt((index += 1));
      point = 0x10000 + ((point - 0xd800) << 10) + (low - 0xdc00);
    }
    if (point <= 0x7f) bytes.push(point);
    else if (point <= 0x7ff) bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f));
    else if (point <= 0xffff) {
      bytes.push(0xe0 | (point >>> 12), 0x80 | ((point >>> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      bytes.push(
        0xf0 | (point >>> 18),
        0x80 | ((point >>> 12) & 0x3f),
        0x80 | ((point >>> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function canonicalizeJsonRfc8785(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertWellFormedUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("RFC 8785 excludes non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJsonRfc8785).join(",")}]`;
  if (!isRecord(value)) throw new TypeError("RFC 8785 input must contain only JSON data");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJsonRfc8785(value[key])}`)
    .join(",")}}`;
}

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;
const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function paddedWords(bytes: Uint8Array): Uint32Array {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const words = new Uint32Array(paddedLength / 4);
  for (let index = 0; index < bytes.length; index += 1) {
    words[index >>> 2] |= bytes[index] << (24 - (index & 3) * 8);
  }
  words[bytes.length >>> 2] |= 0x80 << (24 - (bytes.length & 3) * 8);
  const bitLength = bytes.length * 8;
  words[words.length - 2] = Math.floor(bitLength / 0x1_0000_0000);
  words[words.length - 1] = bitLength;
  return words;
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

function sha256Hex(value: string): string {
  const input = paddedWords(utf8Bytes(value));
  const hash: number[] = [...SHA256_INITIAL];
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < input.length; offset += 16) {
    for (let index = 0; index < 16; index += 1) schedule[index] = input[offset + index];
    for (let index = 16; index < 64; index += 1) {
      const x = schedule[index - 15];
      const y = schedule[index - 2];
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + schedule[index]) | 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) | 0;
    }
    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }
  return hash.map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

function boundedString(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    value === value.normalize("NFC") &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    utf8Bytes(value).length <= maximumBytes
  );
}

function identity(value: unknown): value is string {
  return boundedString(value, XCOM2_PROJECT_BUILD_RECIPE_LIMITS.maximumIdentityBytes);
}

function generation(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function relativePath(value: unknown, allowRoot = false): value is string {
  if (!boundedString(value, XCOM2_PROJECT_BUILD_RECIPE_LIMITS.maximumRelativePathBytes)) {
    return false;
  }
  if (allowRoot && value === ".") return true;
  if (
    value === "." ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes("//") ||
    WINDOWS_DRIVE.test(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        !EXCLUDED_PATH_SEGMENTS.has(segment.toLowerCase()),
    );
}

function validWorkspace(value: unknown): boolean {
  return (
    hasExactKeys(value, ["id", "generation"]) && identity(value.id) && generation(value.generation)
  );
}

function validModule(value: unknown): boolean {
  return (
    hasExactKeys(value, ["id", "root", "activationGeneration", "entryType", "containsSymlink"]) &&
    identity(value.id) &&
    relativePath(value.root, true) &&
    generation(value.activationGeneration) &&
    value.entryType === "directory" &&
    value.containsSymlink === false
  );
}

function validScript(value: unknown): boolean {
  return (
    hasExactKeys(value, [
      "relativePath",
      "entryType",
      "containsSymlink",
      "trust",
      "sha256",
      "byteSize",
    ]) &&
    value.relativePath === XCOM2_PROJECT_BUILD_RECIPE_SCRIPT_PATH &&
    value.entryType === "regular-file" &&
    value.containsSymlink === false &&
    value.trust === "untrusted-project-input" &&
    typeof value.sha256 === "string" &&
    SHA256.test(value.sha256) &&
    Number.isSafeInteger(value.byteSize) &&
    (value.byteSize as number) >= 1 &&
    (value.byteSize as number) <= XCOM2_PROJECT_BUILD_RECIPE_LIMITS.maximumScriptBytes
  );
}

function validProvenance(value: unknown): boolean {
  if (
    !hasExactKeys(value, ["project", "license", "notice"]) ||
    value.project !== "X2ModBuildCommon" ||
    value.license !== "MIT" ||
    !hasExactKeys(value.notice, ["identity", "text", "sha256"])
  )
    return false;
  const notice = value.notice;
  return (
    identity(notice.identity) &&
    boundedString(notice.text, XCOM2_PROJECT_BUILD_RECIPE_LIMITS.maximumNoticeBytes) &&
    typeof notice.sha256 === "string" &&
    SHA256.test(notice.sha256) &&
    notice.sha256 === sha256Hex(notice.text)
  );
}

function validDependencies(value: unknown): boolean {
  if (
    !hasExactKeys(value, ["buildPrefix", "highlanderSource", "highlanderRuntime"]) ||
    !hasExactKeys(value.buildPrefix, ["identity", "state"]) ||
    !hasExactKeys(value.highlanderSource, [
      "identity",
      "relativePath",
      "state",
      "entryType",
      "containsSymlink",
    ]) ||
    !hasExactKeys(value.highlanderRuntime, ["identity", "state"])
  )
    return false;
  return (
    value.buildPrefix.identity === "pfx_copy" &&
    value.buildPrefix.state === "unresolved" &&
    identity(value.highlanderSource.identity) &&
    relativePath(value.highlanderSource.relativePath) &&
    value.highlanderSource.state === "project-local" &&
    value.highlanderSource.entryType === "directory" &&
    value.highlanderSource.containsSymlink === false &&
    identity(value.highlanderRuntime.identity) &&
    value.highlanderRuntime.state === "unresolved"
  );
}

const EXPECTED_ARGUMENT_STATES = [
  "current-module",
  "unresolved",
  "unresolved",
  "declared",
  "unresolved",
  "project-local",
  "unresolved",
] as const;

function validArguments(value: unknown, candidate: Record<string, unknown>): boolean {
  if (!Array.isArray(value) || value.length !== XCOM2_PROJECT_BUILD_RECIPE_ARGUMENT_ROLES.length)
    return false;
  const module = candidate.module as Record<string, unknown>;
  const dependencies = candidate.dependencies as Record<string, Record<string, unknown>>;
  const expectedValues = [
    module.root,
    "separate-machine-authorization-required",
    "separate-machine-authorization-required",
    "Default",
    "pfx_copy",
    dependencies.highlanderSource.relativePath,
    dependencies.highlanderRuntime.identity,
  ];
  return value.every(
    (argument, index) =>
      hasExactKeys(argument, ["role", "valueState", "value"]) &&
      argument.role === XCOM2_PROJECT_BUILD_RECIPE_ARGUMENT_ROLES[index] &&
      argument.valueState === EXPECTED_ARGUMENT_STATES[index] &&
      argument.value === expectedValues[index] &&
      identity(argument.value),
  );
}

function validPrerequisites(value: unknown, candidate: Record<string, unknown>): boolean {
  if (
    !Array.isArray(value) ||
    value.length !== XCOM2_PROJECT_BUILD_RECIPE_PREREQUISITE_ROLES.length
  )
    return false;
  const dependencies = candidate.dependencies as Record<string, Record<string, unknown>>;
  const expectedIdentities = [
    "sdk-directory",
    "game-directory",
    "pfx_copy",
    undefined,
    dependencies.highlanderRuntime.identity,
  ];
  return value.every((prerequisite, index) => {
    if (
      !hasExactKeys(prerequisite, ["role", "identity", "state"]) ||
      prerequisite.role !== XCOM2_PROJECT_BUILD_RECIPE_PREREQUISITE_ROLES[index] ||
      prerequisite.state !== "unresolved" ||
      !identity(prerequisite.identity)
    )
      return false;
    const expectedIdentity = expectedIdentities[index];
    return expectedIdentity === undefined || prerequisite.identity === expectedIdentity;
  });
}

function validCandidate(value: unknown): value is Xcom2ProjectBuildRecipeCandidate {
  if (
    !hasExactKeys(value, [
      "schemaVersion",
      "canonicalization",
      "digestAlgorithm",
      "workspace",
      "module",
      "inspectionGeneration",
      "script",
      "provenance",
      "action",
      "arguments",
      "dependencies",
      "unresolvedPrerequisites",
      "executionBlocked",
    ]) ||
    value.schemaVersion !== 1 ||
    value.canonicalization !== "RFC 8785" ||
    value.digestAlgorithm !== "SHA-256" ||
    !validWorkspace(value.workspace) ||
    !validModule(value.module) ||
    !generation(value.inspectionGeneration) ||
    !validScript(value.script) ||
    !validProvenance(value.provenance) ||
    value.action !== "default" ||
    !validDependencies(value.dependencies) ||
    value.executionBlocked !== true
  )
    return false;
  return (
    validArguments(value.arguments, value) &&
    validPrerequisites(value.unresolvedPrerequisites, value)
  );
}

function invalidReview(): Xcom2ProjectBuildRecipeReviewResult {
  return deepFreeze({ kind: "refused", code: "recipe-invalid" } as const);
}

/** Validate closed inspection metadata and take immutable RFC 8785/SHA-256 digest custody. */
export function reviewXcom2ProjectBuildRecipe(
  candidate: unknown,
): Xcom2ProjectBuildRecipeReviewResult {
  if (!validCandidate(candidate)) return invalidReview();
  const boundFacts = frozenClone(candidate);
  const recipeDigest = sha256Hex(canonicalizeJsonRfc8785(boundFacts));
  return deepFreeze({
    kind: "ready",
    recipe: { ...boundFacts, recipeDigest },
    capabilities: XCOM2_PROJECT_BUILD_RECIPE_CAPABILITIES,
  });
}

function sameCapabilities(value: unknown): boolean {
  return (
    hasExactKeys(value, ["browser", "native"]) &&
    hasExactKeys(value.browser, ["review", "approval", "execution"]) &&
    hasExactKeys(value.native, ["review", "approval", "execution"]) &&
    value.browser.review === "unavailable" &&
    value.browser.approval === "unavailable" &&
    value.browser.execution === "unavailable" &&
    value.native.review === "available" &&
    value.native.approval === "available" &&
    value.native.execution === "unavailable"
  );
}

function validatedReadyReview(
  value: unknown,
): Extract<Xcom2ProjectBuildRecipeReviewResult, { kind: "ready" }> | undefined {
  if (
    !hasExactKeys(value, ["kind", "recipe", "capabilities"]) ||
    value.kind !== "ready" ||
    !sameCapabilities(value.capabilities) ||
    !hasExactKeys(value.recipe, [
      "schemaVersion",
      "canonicalization",
      "digestAlgorithm",
      "workspace",
      "module",
      "inspectionGeneration",
      "script",
      "provenance",
      "action",
      "arguments",
      "dependencies",
      "unresolvedPrerequisites",
      "executionBlocked",
      "recipeDigest",
    ]) ||
    typeof value.recipe.recipeDigest !== "string" ||
    !SHA256.test(value.recipe.recipeDigest)
  )
    return undefined;
  const { recipeDigest, ...candidate } = value.recipe;
  const reviewed = reviewXcom2ProjectBuildRecipe(candidate);
  return reviewed.kind === "ready" && reviewed.recipe.recipeDigest === recipeDigest
    ? reviewed
    : undefined;
}

function isAuthorityState(value: unknown): value is Xcom2ProjectBuildRecipeAuthorityState {
  if (!isRecord(value) || value.authority !== "volatile-one-shot") return false;
  if (value.kind === "approved") {
    return (
      value.consumed === false &&
      hasExactKeys(value, ["kind", "authority", "consumed", "request"]) &&
      isRecord(value.request)
    );
  }
  if (value.kind === "consumed")
    return value.consumed === true && hasExactKeys(value, ["kind", "authority", "consumed"]);
  return (
    value.kind === "revoked" &&
    value.consumed === false &&
    hasExactKeys(value, ["kind", "authority", "consumed"])
  );
}

/** Approve a ready review once; this creates metadata authority but performs no operation. */
export function approveXcom2ProjectBuildRecipe(
  reviewOrState: unknown,
): Xcom2ProjectBuildRecipeApprovalDecision {
  if (isAuthorityState(reviewOrState)) {
    return deepFreeze({ kind: "refused", code: "approval-already-decided" } as const);
  }
  const review = validatedReadyReview(reviewOrState);
  if (!review) return deepFreeze({ kind: "refused", code: "review-not-ready" } as const);
  const request = deepFreeze({
    recipeDigest: review.recipe.recipeDigest,
    recipe: review.recipe,
  } satisfies Xcom2ProjectBuildRecipeApprovalRequest);
  const state = deepFreeze({
    kind: "approved",
    authority: "volatile-one-shot",
    consumed: false,
    request,
  } as const);
  return deepFreeze({ kind: "approved", request, state } as const);
}

function revokedState() {
  return deepFreeze({ kind: "revoked", authority: "volatile-one-shot", consumed: false } as const);
}

/** Reconcile current metadata synchronously; refresh and every digest change revoke authority. */
export function reconcileXcom2ProjectBuildRecipeApproval(
  state: Readonly<Xcom2ProjectBuildRecipeAuthorityState>,
  event: Readonly<Xcom2ProjectBuildRecipeReconciliationEvent>,
): Xcom2ProjectBuildRecipeReconciliationDecision {
  if (state.kind !== "approved")
    return deepFreeze({ kind: "refused", code: "authority-unavailable", state } as const);
  if (event.kind === "workspace-refresh") {
    return deepFreeze({
      kind: "revoked",
      code: "workspace-refresh",
      state: revokedState(),
    } as const);
  }
  const review = validatedReadyReview(event.review);
  if (!review || review.recipe.recipeDigest !== state.request.recipeDigest) {
    return deepFreeze({ kind: "revoked", code: "recipe-changed", state: revokedState() } as const);
  }
  return deepFreeze({ kind: "retained", state } as const);
}

function validConsumptionRequest(
  value: unknown,
): value is Xcom2ProjectBuildRecipeConsumptionRequest {
  return (
    hasExactKeys(value, ["action", "recipeDigest", "current"]) &&
    value.action === "default" &&
    typeof value.recipeDigest === "string" &&
    SHA256.test(value.recipeDigest) &&
    hasExactKeys(value.current, [
      "workspaceId",
      "workspaceGeneration",
      "moduleId",
      "moduleRoot",
      "activationGeneration",
      "inspectionGeneration",
    ]) &&
    identity(value.current.workspaceId) &&
    generation(value.current.workspaceGeneration) &&
    identity(value.current.moduleId) &&
    relativePath(value.current.moduleRoot, true) &&
    generation(value.current.activationGeneration) &&
    generation(value.current.inspectionGeneration)
  );
}

/** Consume one exact authority token. Authorization is a decision only; no build consumer exists. */
export function consumeXcom2ProjectBuildRecipeApproval(
  state: Readonly<Xcom2ProjectBuildRecipeAuthorityState>,
  request: unknown,
): Xcom2ProjectBuildRecipeConsumptionDecision {
  if (state.kind === "consumed")
    return deepFreeze({ kind: "refused", code: "authority-consumed", state } as const);
  if (state.kind === "revoked")
    return deepFreeze({ kind: "refused", code: "authority-revoked", state } as const);
  if (!validConsumptionRequest(request))
    return deepFreeze({ kind: "refused", code: "request-invalid", state } as const);
  const recipe = state.request.recipe;
  const current = request.current;
  const matches =
    request.recipeDigest === state.request.recipeDigest &&
    current.workspaceId === recipe.workspace.id &&
    current.workspaceGeneration === recipe.workspace.generation &&
    current.moduleId === recipe.module.id &&
    current.moduleRoot === recipe.module.root &&
    current.activationGeneration === recipe.module.activationGeneration &&
    current.inspectionGeneration === recipe.inspectionGeneration;
  if (!matches)
    return deepFreeze({ kind: "refused", code: "stale-authority", state: revokedState() } as const);
  return deepFreeze({
    kind: "authorized",
    action: "default",
    recipeDigest: state.request.recipeDigest,
    state: { kind: "consumed", authority: "volatile-one-shot", consumed: true },
  } as const);
}
