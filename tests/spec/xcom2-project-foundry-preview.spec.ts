import { createHash } from "node:crypto";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  XCOM2_PROJECT_FOUNDRY_PACK_ID,
  XCOM2_PROJECT_FOUNDRY_PLAN_SCHEMA_VERSION,
  XCOM2_PROJECT_FOUNDRY_PLATFORM,
  XCOM2_PROJECT_FOUNDRY_PUBLICATION_STATUS,
  XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
  XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
  type Xcom2ProjectFoundryDigestBoundPlan,
  type Xcom2ProjectFoundryPreviewRequest,
} from "../../packages/contracts/src/domain/xcom2-project-foundry";
import {
  createXcom2ProjectFoundryPreviewRequest,
  deriveXcom2ProjectFoundryProjectGuid,
  digestXcom2ProjectFoundryPlan,
  previewXcom2ProjectFoundry,
  validateXcom2ProjectFoundryModId,
} from "../../packages/web-core/src/xcom2/project-foundry";
import {
  APPROVED_FOUNDRY_ABSENCES,
  APPROVED_FOUNDRY_DIRECTORIES,
  APPROVED_FOUNDRY_FILES,
  APPROVED_FOUNDRY_WARNINGS,
  APPROVED_SOLUTION_ESCAPED_PREVIEW,
  APPROVED_X2PROJ_ESCAPED_PREVIEW,
} from "./support/xcom2-project-foundry-approved-fixture";

const expectedBoundPlan = {
  schemaVersion: 1,
  canonicalization: "RFC 8785",
  digestAlgorithm: "SHA-256",
  packId: "ide.xcom2.empt-v1_4",
  platform: "Linux desktop only",
  publicationStatus: "Non-publishable",
  source: {
    repository: "/scenario/empt-v1_4",
    grantIdentity: "source-grant-foundry-preview-001",
    commit: "d968be3c32b250376723563a743a120770ec5c95",
    tree: "cc8823fa99c0d292c4fe48a8b9463ff790176371",
    fingerprintResult: "Verified",
    policy:
      "Committed Git objects only; working-tree modifications and untracked files are ignored",
  },
  project: {
    modId: "FoundryPreviewFixture",
    guid: "{30DF67AA-2360-5109-80CF-02CB38BED26F}",
  },
  destination: {
    parent: "/scenario/foundry-output",
    parentGrantIdentity: "destination-parent-grant-foundry-preview-001",
    derivedAbsentDestination: "/scenario/foundry-output/FoundryPreviewFixture",
    operationGrantIdentity: "operation-grant-foundry-preview-001",
  },
  symlinks: "none",
  directories: APPROVED_FOUNDRY_DIRECTORIES,
  files: APPROVED_FOUNDRY_FILES,
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
  absences: APPROVED_FOUNDRY_ABSENCES,
  warnings: APPROVED_FOUNDRY_WARNINGS,
} as const satisfies Xcom2ProjectFoundryDigestBoundPlan;

function mutableRequestInput() {
  return {
    sourceGrant: {
      kind: "source-repository" as const,
      repository: "/scenario/empt-v1_4",
      identity: "source-grant-foundry-preview-001",
    },
    destinationParentGrant: {
      kind: "destination-parent" as const,
      parent: "/scenario/foundry-output",
      identity: "destination-parent-grant-foundry-preview-001",
    },
    operationGrant: {
      kind: "preview-operation" as const,
      derivedDestination: "/scenario/foundry-output/FoundryPreviewFixture",
      identity: "operation-grant-foundry-preview-001",
    },
    sourceObject: {
      commit: "d968be3c32b250376723563a743a120770ec5c95",
      tree: "cc8823fa99c0d292c4fe48a8b9463ff790176371",
      fingerprintResult: "Verified" as const,
    },
    destinationState: "absent" as const,
    modId: "FoundryPreviewFixture",
  };
}

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function canonicalizeRfc8785(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("RFC 8785 excludes non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeRfc8785).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeRfc8785(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("RFC 8785 input must be JSON data");
}

function independentlyDigest(value: unknown): string {
  return createHash("sha256").update(canonicalizeRfc8785(value), "utf8").digest("hex");
}

function reverseObjectInsertionOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectInsertionOrder);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, child]) => [key, reverseObjectInsertionOrder(child)]),
  );
}

type JsonPath = readonly (string | number)[];

function leafPaths(value: unknown, parent: JsonPath = []): JsonPath[] {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => leafPaths(child, [...parent, index]));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      leafPaths(child, [...parent, key]),
    );
  }
  return [parent];
}

function changeLeaf(root: unknown, path: JsonPath): void {
  let owner = root as Record<string | number, unknown>;
  for (const segment of path.slice(0, -1)) {
    owner = owner[segment] as Record<string | number, unknown>;
  }
  const key = path.at(-1)!;
  const current = owner[key];
  if (typeof current === "string") owner[key] = `${current}#changed`;
  else if (typeof current === "number") owner[key] = current + 1;
  else if (typeof current === "boolean") owner[key] = !current;
  else owner[key] = "changed";
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    key,
    ...collectKeys(child),
  ]);
}

function readyPlan() {
  const request = createXcom2ProjectFoundryPreviewRequest(mutableRequestInput());
  const result = previewXcom2ProjectFoundry(request);
  if (result.kind !== "ready") throw new Error(`Expected ready preview, received ${result.code}`);
  return { request, plan: result.plan };
}

describe("@REQ-XCOM2-PROJECT-FOUNDRY-001 pure deterministic Project Foundry preview", () => {
  it.each(["A", "a", "A0", "Mod_1", "FoundryPreviewFixture", `A${"z".repeat(47)}`])(
    "accepts exact case-preserved ASCII ModId %s",
    (candidate) => {
      expect(validateXcom2ProjectFoundryModId(candidate)).toEqual({
        kind: "accepted",
        modId: candidate,
      });
    },
  );

  it.each([
    "",
    "1Alpha",
    "_Alpha",
    "Alpha-Beta",
    "Alpha.Beta",
    " Alpha",
    "Alpha ",
    "Alpha/Beta",
    "Alpha\\Beta",
    "Mód",
    "A\nB",
    `A${"z".repeat(48)}`,
  ])("refuses invalid ModId without trimming, normalizing, or sanitizing %j", (candidate) => {
    expect(validateXcom2ProjectFoundryModId(candidate)).toEqual({
      kind: "refused",
      code: "mod-id-invalid",
    });
  });

  it.each([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
  ])("refuses Windows device ModId %s case-insensitively", (deviceName) => {
    for (const candidate of [deviceName, deviceName.toLowerCase(), deviceName.toUpperCase()]) {
      expect(validateXcom2ProjectFoundryModId(candidate)).toEqual({
        kind: "refused",
        code: "mod-id-windows-device",
      });
    }
  });

  it.each(["CONSOLE", "CON_", "COM0", "COM10", "LPT0", "LPT10"])(
    "does not over-refuse non-device ModId %s",
    (candidate) => {
      expect(validateXcom2ProjectFoundryModId(candidate)).toEqual({
        kind: "accepted",
        modId: candidate,
      });
    },
  );

  it("derives the exact uppercase-braced UUIDv5 fixture from the approved URL namespace name", () => {
    expect(deriveXcom2ProjectFoundryProjectGuid("FoundryPreviewFixture")).toBe(
      "{30DF67AA-2360-5109-80CF-02CB38BED26F}",
    );
    expect(deriveXcom2ProjectFoundryProjectGuid("foundryPreviewFixture")).not.toBe(
      "{30DF67AA-2360-5109-80CF-02CB38BED26F}",
    );
  });

  it("copies mutable selector results into an isolated deeply immutable provider-neutral request", () => {
    const input = mutableRequestInput();
    const before = structuredClone(input);

    const request = createXcom2ProjectFoundryPreviewRequest(input);

    expect(input).toEqual(before);
    expect(request).not.toBe(input);
    expect(request.sourceGrant).not.toBe(input.sourceGrant);
    expect(request.destinationParentGrant).not.toBe(input.destinationParentGrant);
    expect(request.operationGrant).not.toBe(input.operationGrant);
    assertDeepFrozen(request);

    input.sourceGrant.repository = "/changed/source";
    input.destinationParentGrant.parent = "/changed/parent";
    input.operationGrant.identity = "changed-operation";
    input.sourceObject.commit = "changed-commit";
    input.modId = "Changed";

    expect(request).toEqual(before);
    expect(() => {
      (request.sourceGrant as { repository: string }).repository = "/mutation/refused";
    }).toThrow(TypeError);
    expectTypeOf(request).toEqualTypeOf<Readonly<Xcom2ProjectFoundryPreviewRequest>>();
  });

  it("returns the complete display-safe immutable 12-directory and 27-file exact preview", () => {
    const requestInput = mutableRequestInput();
    const request = createXcom2ProjectFoundryPreviewRequest(requestInput);
    const before = structuredClone(request);

    const result = previewXcom2ProjectFoundry(request);

    expect(request).toEqual(before);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error(`Unexpected refusal: ${result.code}`);

    const expectedDigest = independentlyDigest(expectedBoundPlan);
    expect(result.plan).toEqual({ ...expectedBoundPlan, planDigest: expectedDigest });
    expect(result.plan.directories).toHaveLength(12);
    expect(
      result.plan.directories.filter(({ state }: { readonly state: string }) => state === "empty"),
    ).toEqual([
      { path: "FoundryPreviewFixture/Content", mode: "0755", state: "empty" },
      { path: "FoundryPreviewFixture/ContentForCook", mode: "0755", state: "empty" },
    ]);
    expect(result.plan.files).toHaveLength(27);
    expect(result.plan.files.every(({ mode }: { readonly mode: string }) => mode === "0644")).toBe(
      true,
    );
    expect(
      result.plan.files.every(({ sha256 }: { readonly sha256: string }) =>
        /^[0-9a-f]{64}$/u.test(sha256),
      ),
    ).toBe(true);
    expect(result.plan.generatedPreviews).toEqual(expectedBoundPlan.generatedPreviews);
    expect(result.plan.absences).toEqual(APPROVED_FOUNDRY_ABSENCES);
    expect(result.plan.warnings).toEqual(APPROVED_FOUNDRY_WARNINGS);
    expect(result.plan.planDigest).toMatch(/^[0-9a-f]{64}$/u);
    assertDeepFrozen(result);

    requestInput.sourceGrant.identity = "changed-after-preview";
    expect(result.plan.source.grantIdentity).toBe("source-grant-foundry-preview-001");
    expect(() => {
      (result.plan.files as unknown as unknown[]).push({});
    }).toThrow(TypeError);
  });

  it("binds all exact identities and approved pack constants into the displayed digest payload", () => {
    const { plan } = readyPlan();

    expect(plan).toMatchObject({
      schemaVersion: XCOM2_PROJECT_FOUNDRY_PLAN_SCHEMA_VERSION,
      packId: XCOM2_PROJECT_FOUNDRY_PACK_ID,
      platform: XCOM2_PROJECT_FOUNDRY_PLATFORM,
      publicationStatus: XCOM2_PROJECT_FOUNDRY_PUBLICATION_STATUS,
      source: {
        repository: "/scenario/empt-v1_4",
        grantIdentity: "source-grant-foundry-preview-001",
        commit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
        tree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
      },
      project: {
        modId: "FoundryPreviewFixture",
        guid: "{30DF67AA-2360-5109-80CF-02CB38BED26F}",
      },
      destination: {
        parent: "/scenario/foundry-output",
        parentGrantIdentity: "destination-parent-grant-foundry-preview-001",
        derivedAbsentDestination: "/scenario/foundry-output/FoundryPreviewFixture",
        operationGrantIdentity: "operation-grant-foundry-preview-001",
      },
    });
  });

  it("uses SHA-256 over RFC 8785 canonical JSON and ignores object insertion order", () => {
    const { plan } = readyPlan();
    const { planDigest: _displayedDigest, ...boundPlan } = plan;
    const reordered = reverseObjectInsertionOrder(boundPlan) as Xcom2ProjectFoundryDigestBoundPlan;

    expect(digestXcom2ProjectFoundryPlan(boundPlan)).toBe(independentlyDigest(boundPlan));
    expect(digestXcom2ProjectFoundryPlan(reordered)).toBe(plan.planDigest);
    expect(canonicalizeRfc8785(reordered)).toBe(canonicalizeRfc8785(boundPlan));
  });

  it("changes the canonical digest when any individual bound leaf value changes", () => {
    const { plan } = readyPlan();
    const { planDigest, ...boundPlan } = plan;
    const paths = leafPaths(boundPlan);

    expect(paths.length).toBeGreaterThan(150);
    for (const path of paths) {
      const changed = structuredClone(boundPlan) as Xcom2ProjectFoundryDigestBoundPlan;
      changeLeaf(changed, path);
      expect(digestXcom2ProjectFoundryPlan(changed), path.join(".")).not.toBe(planDigest);
    }
  });

  it("contains no Apply, write, process, build action, or later-lifecycle field", () => {
    const { request, plan } = readyPlan();
    const forbiddenField =
      /^(?:apply|write|process|build|execute|command|stage|journal|recovery|remove|launch|deploy|cook|package|network|shell)$/iu;

    expect(collectKeys(request).filter((key) => forbiddenField.test(key))).toEqual([]);
    expect(collectKeys(plan).filter((key) => forbiddenField.test(key))).toEqual([]);
    expectTypeOf(previewXcom2ProjectFoundry).parameters.toEqualTypeOf<
      [Readonly<Xcom2ProjectFoundryPreviewRequest>]
    >();
  });
});
