import { createHash } from "node:crypto";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  Xcom2ProjectFoundryDestinationParentSelectionGrant,
  Xcom2ProjectFoundryDigestBoundPlan,
  Xcom2ProjectFoundryOperationGrant,
  Xcom2ProjectFoundryPreviewPlan,
  Xcom2ProjectFoundrySourceSelectionGrant,
} from "../../packages/contracts/src/domain/xcom2-project-foundry";
import * as foundryCore from "../../packages/web-core/src/xcom2/project-foundry";
import {
  FOUNDRY_PREVIEW_FIXTURE_BODY,
  MOD_1_BODY,
  RENDERED_FIXTURES,
} from "./support/xcom2-project-foundry-rendered-fixtures";

const SAFE_RENDERED_PLAN_INVALID_SUMMARY = "The project preview could not be validated.";

interface ExpectedRenderRequest {
  readonly sourceGrant: Readonly<Xcom2ProjectFoundrySourceSelectionGrant>;
  readonly destinationParentGrant: Readonly<Xcom2ProjectFoundryDestinationParentSelectionGrant>;
  readonly modId: string;
}

interface ExpectedNativeRenderedPlan {
  readonly kind: "rendered";
  readonly operationGrant: Readonly<Xcom2ProjectFoundryOperationGrant>;
  readonly planBody: Readonly<Xcom2ProjectFoundryDigestBoundPlan>;
}

type ExpectedValidationResult =
  | {
      readonly kind: "ready";
      readonly operationGrant: Readonly<Xcom2ProjectFoundryOperationGrant>;
      readonly plan: Readonly<Xcom2ProjectFoundryPreviewPlan>;
    }
  | {
      readonly kind: "refused";
      readonly code: "rendered-plan-invalid";
      readonly summary: typeof SAFE_RENDERED_PLAN_INVALID_SUMMARY;
    };

const correctionCore = foundryCore as typeof foundryCore & {
  createXcom2ProjectFoundryRenderRequest(
    input: ExpectedRenderRequest,
  ): Readonly<ExpectedRenderRequest>;
  validateAndDigestXcom2ProjectFoundryRenderedPlan(
    request: Readonly<ExpectedRenderRequest>,
    rendered: unknown,
  ): ExpectedValidationResult;
};

function canonicalizeRfc8785(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("RFC 8785 excludes non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeRfc8785).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("RFC 8785 input must be JSON data");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeRfc8785(record[key])}`)
    .join(",")}}`;
}

function independentlyDigest(value: unknown): string {
  return createHash("sha256").update(canonicalizeRfc8785(value), "utf8").digest("hex");
}

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    key,
    ...collectKeys(child),
  ]);
}

type ObjectPath = readonly (string | number)[];

function objectPaths(value: unknown, parent: ObjectPath = []): ObjectPath[] {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => objectPaths(child, [...parent, index]));
  }
  if (value === null || typeof value !== "object") return [];
  return [
    parent,
    ...Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      objectPaths(child, [...parent, key]),
    ),
  ];
}

function recordAt(root: unknown, path: ObjectPath): Record<string, unknown> {
  let current = root;
  for (const segment of path) current = (current as Record<string | number, unknown>)[segment];
  return current as Record<string, unknown>;
}

function matchingInput(index: number) {
  const fixture = RENDERED_FIXTURES[index];
  return {
    request: structuredClone(fixture.request) as ExpectedRenderRequest,
    rendered: structuredClone(fixture.rendered) as unknown as ExpectedNativeRenderedPlan,
  };
}

function validate(index: number): ExpectedValidationResult {
  const { request, rendered } = matchingInput(index);
  return correctionCore.validateAndDigestXcom2ProjectFoundryRenderedPlan(request, rendered);
}

function expectReady(result: ExpectedValidationResult) {
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") throw new Error(`Unexpected refusal: ${result.code}`);
  return result;
}

function expectSafeInvalid(result: ExpectedValidationResult): void {
  expect(result).toEqual({
    kind: "refused",
    code: "rendered-plan-invalid",
    summary: SAFE_RENDERED_PLAN_INVALID_SUMMARY,
  });
  expect(JSON.stringify(result)).not.toMatch(/renderer|parser|raw|internal|secret/iu);
  assertDeepFrozen(result);
}

function renderedPreviewBytes(preview: {
  readonly byteOrderMark: "present" | "absent";
  readonly escapedBytePreview: string;
}): Buffer {
  const content = `${preview.escapedBytePreview
    .replaceAll("\\t", "\t")
    .replaceAll("\\u0020", " ")}\n`;
  return Buffer.concat([
    preview.byteOrderMark === "present" ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0),
    Buffer.from(content, "utf8"),
  ]);
}

/**
 * Focused Spec BDD complements AT-X2-029 by specifying the corrected pure TypeScript
 * custody boundary. Rendering and operation-grant minting remain native responsibilities.
 */
describe("@REQ-XCOM2-PROJECT-FOUNDRY-001 ADR0010@0f1fcd5 rendered-plan custody", () => {
  it("creates only the provider-neutral source-grant, destination-parent-grant, and exact-ModId request", () => {
    const mutable = structuredClone(RENDERED_FIXTURES[0].request) as ExpectedRenderRequest;
    const before = structuredClone(mutable);
    const request = correctionCore.createXcom2ProjectFoundryRenderRequest(mutable);

    expect(request).toEqual(before);
    expect(Object.keys(request)).toEqual(["sourceGrant", "destinationParentGrant", "modId"]);
    expect(collectKeys(request)).not.toContain("operationGrant");
    expect(collectKeys(request)).not.toContain("sourceObject");
    expect(collectKeys(request)).not.toContain("destinationState");
    expect(request).not.toBe(mutable);
    expect(request.sourceGrant).not.toBe(mutable.sourceGrant);
    expect(request.destinationParentGrant).not.toBe(mutable.destinationParentGrant);
    assertDeepFrozen(request);
    expectTypeOf(request).toEqualTypeOf<Readonly<ExpectedRenderRequest>>();

    (mutable.sourceGrant as { repository: string }).repository = "/changed/source";
    (mutable.destinationParentGrant as { parent: string }).parent = "/changed/parent";
    (mutable as { modId: string }).modId = "Changed";
    expect(request).toEqual(before);
    expect(() => {
      (request as { modId: string }).modId = "MutationRefused";
    }).toThrow(TypeError);
  });

  it.each(RENDERED_FIXTURES)(
    "accepts independent complete native $label metadata and returns its full digest-bound frozen plan",
    (fixture) => {
      const request = structuredClone(fixture.request) as ExpectedRenderRequest;
      const rendered = structuredClone(fixture.rendered) as unknown as ExpectedNativeRenderedPlan;
      const requestBefore = structuredClone(request);
      const renderedBefore = structuredClone(rendered);

      const ready = expectReady(
        correctionCore.validateAndDigestXcom2ProjectFoundryRenderedPlan(request, rendered),
      );
      const expectedDigest = independentlyDigest(fixture.rendered.planBody);

      expect(request).toEqual(requestBefore);
      expect(rendered).toEqual(renderedBefore);
      expect(ready.operationGrant).toEqual(fixture.rendered.operationGrant);
      expect(ready.plan).toEqual({ ...fixture.rendered.planBody, planDigest: expectedDigest });
      expect(ready.plan.planDigest).toMatch(/^[0-9a-f]{64}$/u);
      expect(ready.plan.directories).toHaveLength(12);
      expect(ready.plan.files).toHaveLength(27);
      expect(ready.plan.generatedPreviews).toHaveLength(2);
      assertDeepFrozen(ready);

      (request.sourceGrant as { identity: string }).identity = "caller-mutated-source";
      (rendered.operationGrant as { identity: string }).identity = "native-buffer-mutated";
      (rendered.planBody.files as unknown as unknown[]).pop();
      expect(ready.plan).toEqual({ ...fixture.rendered.planBody, planDigest: expectedDigest });
      expect(() => {
        (ready.plan.files as unknown as unknown[]).push({});
      }).toThrow(TypeError);
    },
  );

  it("computes the exact full RFC 8785/SHA-256 fixture digests without trusting a native claimed digest", () => {
    const foundry = expectReady(validate(0));
    const mod1 = expectReady(validate(1));

    expect(foundry.plan.planDigest).toBe(
      "368ab11c085c3b6150975d542850cd4c69915550ead101e244a357eb7dca8dd6",
    );
    expect(mod1.plan.planDigest).toBe(
      "8a17773f057361183d953ab2aea492a5d23398336da99bb71821d9b39eb81779",
    );
    expect(foundry.plan.planDigest).not.toBe(mod1.plan.planDigest);

    for (const index of [0, 1]) {
      const { request, rendered } = matchingInput(index);
      (rendered as unknown as Record<string, unknown>).planDigest = "0".repeat(64);
      expectSafeInvalid(
        correctionCore.validateAndDigestXcom2ProjectFoundryRenderedPlan(request, rendered),
      );
    }
  });

  it.each(RENDERED_FIXTURES)(
    "rejects every unknown field at every object depth of the $label native result",
    (fixture) => {
      const paths = objectPaths(fixture.rendered);
      expect(paths.length).toBeGreaterThan(40);

      for (const path of paths) {
        const request = structuredClone(fixture.request) as ExpectedRenderRequest;
        const rendered = structuredClone(fixture.rendered) as unknown as ExpectedNativeRenderedPlan;
        recordAt(rendered, path).unknownNativeField = "must fail closed";
        expectSafeInvalid(
          correctionCore.validateAndDigestXcom2ProjectFoundryRenderedPlan(request, rendered),
        );
      }
    },
  );

  it.each(RENDERED_FIXTURES)(
    "rejects every missing field at every object depth of the $label native result",
    (fixture) => {
      const paths = objectPaths(fixture.rendered);
      let removedFields = 0;

      for (const path of paths) {
        const original = recordAt(fixture.rendered, path);
        for (const key of Object.keys(original)) {
          const request = structuredClone(fixture.request) as ExpectedRenderRequest;
          const rendered = structuredClone(
            fixture.rendered,
          ) as unknown as ExpectedNativeRenderedPlan;
          delete recordAt(rendered, path)[key];
          removedFields += 1;
          expectSafeInvalid(
            correctionCore.validateAndDigestXcom2ProjectFoundryRenderedPlan(request, rendered),
          );
        }
      }
      expect(removedFields).toBeGreaterThan(180);
    },
  );

  it("rejects changed schema, pack, platform, publication, source, mode, encoding, and topology constants", () => {
    const changes: readonly ((rendered: ExpectedNativeRenderedPlan) => void)[] = [
      (rendered) => ((rendered.planBody as { schemaVersion: number }).schemaVersion = 2),
      (rendered) => ((rendered.planBody as { canonicalization: string }).canonicalization = "JSON"),
      (rendered) => ((rendered.planBody as { digestAlgorithm: string }).digestAlgorithm = "SHA-1"),
      (rendered) => ((rendered.planBody as { packId: string }).packId = "other-pack"),
      (rendered) => ((rendered.planBody as { platform: string }).platform = "Windows"),
      (rendered) =>
        ((rendered.planBody as { publicationStatus: string }).publicationStatus = "Publishable"),
      (rendered) => ((rendered.planBody.source as { commit: string }).commit = "0".repeat(40)),
      (rendered) => ((rendered.planBody.source as { tree: string }).tree = "0".repeat(40)),
      (rendered) =>
        ((rendered.planBody.source as { fingerprintResult: string }).fingerprintResult = "Unknown"),
      (rendered) => ((rendered.planBody as { symlinks: string }).symlinks = "present"),
      (rendered) => ((rendered.planBody.directories[0] as { mode: string }).mode = "0777"),
      (rendered) => ((rendered.planBody.files[0] as { mode: string }).mode = "0755"),
      (rendered) => ((rendered.planBody.files[0] as { bytes: number }).bytes = -1),
      (rendered) => ((rendered.planBody.files[0] as { sha256: string }).sha256 = "0".repeat(64)),
      (rendered) =>
        ((rendered.planBody.generatedPreviews[0] as { encoding: string }).encoding = "UTF-16"),
      (rendered) =>
        ((rendered.planBody.generatedPreviews[0] as { lineEndings: string }).lineEndings = "CRLF"),
      (rendered) =>
        ((rendered.planBody.directories as unknown as unknown[])[0] =
          rendered.planBody.directories[1]),
      (rendered) =>
        ((rendered.planBody.files as unknown as unknown[])[0] = rendered.planBody.files[1]),
    ];

    for (const change of changes) {
      const { request, rendered } = matchingInput(1);
      change(rendered);
      expectSafeInvalid(
        correctionCore.validateAndDigestXcom2ProjectFoundryRenderedPlan(request, rendered),
      );
    }
  });

  it("binds the request grants and exact ModId to the native body and newly minted operation grant", () => {
    const changes: readonly ((input: {
      request: ExpectedRenderRequest;
      rendered: ExpectedNativeRenderedPlan;
    }) => void)[] = [
      ({ request }) => ((request.sourceGrant as { repository: string }).repository = "/other"),
      ({ request }) => ((request.sourceGrant as { identity: string }).identity = "other-source"),
      ({ request }) =>
        ((request.destinationParentGrant as { parent: string }).parent = "/other-parent"),
      ({ request }) =>
        ((request.destinationParentGrant as { identity: string }).identity = "other-parent-grant"),
      ({ request }) => ((request as { modId: string }).modId = "OtherMod"),
      ({ rendered }) =>
        ((rendered.operationGrant as { derivedDestination: string }).derivedDestination =
          "/scenario/foundry-output/OtherMod"),
      ({ rendered }) =>
        ((rendered.operationGrant as { identity: string }).identity = "other-operation"),
      ({ rendered }) =>
        ((rendered.planBody.source as { repository: string }).repository = "/other"),
      ({ rendered }) =>
        ((rendered.planBody.source as { grantIdentity: string }).grantIdentity = "other-source"),
      ({ rendered }) =>
        ((rendered.planBody.destination as { parent: string }).parent = "/other-parent"),
      ({ rendered }) =>
        ((rendered.planBody.destination as { parentGrantIdentity: string }).parentGrantIdentity =
          "other-parent-grant"),
      ({ rendered }) =>
        ((
          rendered.planBody.destination as { derivedAbsentDestination: string }
        ).derivedAbsentDestination = "/scenario/foundry-output/OtherMod"),
      ({ rendered }) =>
        ((
          rendered.planBody.destination as { operationGrantIdentity: string }
        ).operationGrantIdentity = "other-operation"),
      ({ rendered }) => ((rendered.planBody.project as { modId: string }).modId = "OtherMod"),
    ];

    for (const change of changes) {
      const input = matchingInput(1);
      change(input);
      expectSafeInvalid(
        correctionCore.validateAndDigestXcom2ProjectFoundryRenderedPlan(
          input.request,
          input.rendered,
        ),
      );
    }
  });

  it("accepts representative valid ModIds only when native supplies their corresponding complete body", () => {
    for (const candidate of ["A", "Mod_1", "FoundryPreviewFixture", `A${"z".repeat(47)}`]) {
      expect(foundryCore.validateXcom2ProjectFoundryModId(candidate)).toEqual({
        kind: "accepted",
        modId: candidate,
      });
    }

    expect(validate(0).kind).toBe("ready");
    expect(validate(1).kind).toBe("ready");

    const foundryRequest = structuredClone(RENDERED_FIXTURES[0].request) as ExpectedRenderRequest;
    const mod1Request = structuredClone(RENDERED_FIXTURES[1].request) as ExpectedRenderRequest;
    expectSafeInvalid(
      correctionCore.validateAndDigestXcom2ProjectFoundryRenderedPlan(
        foundryRequest,
        structuredClone(RENDERED_FIXTURES[1].rendered),
      ),
    );
    expectSafeInvalid(
      correctionCore.validateAndDigestXcom2ProjectFoundryRenderedPlan(
        mod1Request,
        structuredClone(RENDERED_FIXTURES[0].rendered),
      ),
    );

    for (const candidate of ["A", `A${"z".repeat(47)}`]) {
      const request = { ...structuredClone(foundryRequest), modId: candidate };
      for (const fixture of RENDERED_FIXTURES) {
        expectSafeInvalid(
          correctionCore.validateAndDigestXcom2ProjectFoundryRenderedPlan(
            request,
            structuredClone(fixture.rendered),
          ),
        );
      }
    }
  });

  it("uses exact independent Gherkin topology, metadata, paths, absences, and generated previews", () => {
    const foundry = expectReady(validate(0)).plan;
    const mod1 = expectReady(validate(1)).plan;

    expect(foundry).toMatchObject(FOUNDRY_PREVIEW_FIXTURE_BODY);
    expect(mod1).toMatchObject(MOD_1_BODY);
    expect(mod1.project).toEqual({
      modId: "Mod_1",
      guid: "{CC1DEF9C-4BBB-5DDD-9F27-E21521D1747C}",
    });
    expect(mod1.destination).toEqual({
      parent: "/scenario/foundry-output",
      parentGrantIdentity: "destination-parent-grant-foundry-preview-001",
      derivedAbsentDestination: "/scenario/foundry-output/Mod_1",
      operationGrantIdentity: "operation-grant-foundry-preview-002",
    });
    expect(mod1.directories.map(({ path }) => path)).toEqual(
      MOD_1_BODY.directories.map(({ path }) => path),
    );
    expect(mod1.files).toEqual(MOD_1_BODY.files);
    expect(mod1.absences).toEqual(MOD_1_BODY.absences);
    expect(mod1.warnings).toEqual(FOUNDRY_PREVIEW_FIXTURE_BODY.warnings);

    const serializedMod1 = JSON.stringify(mod1);
    expect(serializedMod1).not.toContain("FoundryPreviewFixture");
    expect(serializedMod1).toContain("Mod_1/Mod_1.x2proj");
    expect(serializedMod1).toContain("Mod_1.XCOM_sln");
    expect(serializedMod1).toContain("Mod_1/Src/Mod_1/Classes/X2DLCInfo_Mod_1.uc");
    expect(serializedMod1).toContain("every .XComMod file, including Mod_1/Mod_1.XComMod");
  });

  it.each(RENDERED_FIXTURES)(
    "keeps $label generated preview encoding, full size, and SHA-256 consistent with file metadata",
    (fixture) => {
      for (const preview of fixture.rendered.planBody.generatedPreviews) {
        const bytes = renderedPreviewBytes(preview);
        const file = fixture.rendered.planBody.files.find(({ path }) => path === preview.path);
        expect(file, preview.path).toBeDefined();
        expect(bytes.byteLength, preview.path).toBe(file?.bytes);
        expect(createHash("sha256").update(bytes).digest("hex"), preview.path).toBe(file?.sha256);
      }
    },
  );

  it("returns only the safe rendered-plan-invalid code and summary for malformed native data", () => {
    const malformedValues: readonly unknown[] = [
      null,
      [],
      "raw renderer parser secret",
      { kind: "rendered", rawReason: "internal native parser secret" },
      { ...structuredClone(RENDERED_FIXTURES[0].rendered), kind: "failed" },
    ];
    for (const rendered of malformedValues) {
      expectSafeInvalid(
        correctionCore.validateAndDigestXcom2ProjectFoundryRenderedPlan(
          structuredClone(RENDERED_FIXTURES[0].request),
          rendered,
        ),
      );
    }
  });

  it("removes frontend rendering and fixture-metadata authority from the production core API", () => {
    for (const forbiddenExport of [
      "createXcom2ProjectFoundryPreviewRequest",
      "previewXcom2ProjectFoundry",
      "deriveXcom2ProjectFoundryProjectGuid",
      "APPROVED_FOUNDRY_DIRECTORIES",
      "APPROVED_FOUNDRY_FILES",
      "APPROVED_FOUNDRY_ABSENCES",
      "APPROVED_FOUNDRY_WARNINGS",
      "APPROVED_X2PROJ_ESCAPED_PREVIEW",
      "APPROVED_SOLUTION_ESCAPED_PREVIEW",
    ]) {
      expect(foundryCore, forbiddenExport).not.toHaveProperty(forbiddenExport);
    }
    expect(foundryCore).toHaveProperty("createXcom2ProjectFoundryRenderRequest");
    expect(foundryCore).toHaveProperty("validateAndDigestXcom2ProjectFoundryRenderedPlan");
  });
});
