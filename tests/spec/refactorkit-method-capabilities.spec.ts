import { describe, expect, expectTypeOf, it } from "vitest";

import {
  normalizeRefactorKitMethodCapabilities,
  type RefactorKitCapabilities,
  type RefactorKitDiagnosticsV2MethodFeatures,
  type RefactorKitMethodCapability,
} from "../../packages/contracts/src/refactorkit";

const DIAGNOSTICS_FEATURES = {
  requestCorrelation: true,
  semanticLease: true,
  savedDiskAuthority: true,
  immutableEditorOverlay: true,
  exactUtf16Ranges: true,
  structuredReadiness: true,
  compilerAttestation: true,
  boundedResponse: true,
} as const;

function diagnosticsV2Method(): Record<string, unknown> {
  return {
    name: "diagnostics.v2",
    stability: "additive-api-0.2",
    requiresProject: true,
    writesWorkspace: false,
    features: { ...DIAGNOSTICS_FEATURES },
  };
}

function genericMethod(name = "symbol.search"): Record<string, unknown> {
  return {
    name,
    stability: "beta-contract",
    requiresProject: true,
    writesWorkspace: false,
  };
}

function expectInvalidMethodCapabilities(candidate: unknown): void {
  expect(() => normalizeRefactorKitMethodCapabilities(candidate)).toThrow(
    "Invalid RefactorKit method capability metadata",
  );
}

function legacyCapabilities(): RefactorKitCapabilities {
  return {
    api: "refactorkit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.6.2",
    javaImportExternalClass: {
      supported: true,
      targetDirectory: true,
      preview: true,
      apply: true,
      rollback: true,
      stability: "experimental",
    },
  };
}

describe("@REQ-REFACTORKIT-TS-001 RefactorKit per-operation method capabilities", () => {
  it("represents the closed diagnostics.v2 feature vocabulary in the public contract", () => {
    expectTypeOf<keyof RefactorKitDiagnosticsV2MethodFeatures>().toEqualTypeOf<
      | "requestCorrelation"
      | "semanticLease"
      | "savedDiskAuthority"
      | "immutableEditorOverlay"
      | "exactUtf16Ranges"
      | "structuredReadiness"
      | "compilerAttestation"
      | "boundedResponse"
    >();
    expectTypeOf<keyof RefactorKitMethodCapability>().toEqualTypeOf<
      "name" | "stability" | "requiresProject" | "writesWorkspace" | "features"
    >();
  });

  it("strictly normalizes and independently clones a diagnostics.v2 advertisement", () => {
    const source = diagnosticsV2Method();
    const sourceFeatures = source.features as Record<string, boolean>;

    const normalized = normalizeRefactorKitMethodCapabilities([source]);

    expect(normalized).toEqual([diagnosticsV2Method()]);
    expect(normalized?.[0]).not.toBe(source);
    expect(normalized?.[0]?.features).not.toBe(sourceFeatures);
    sourceFeatures.requestCorrelation = false;
    expect(normalized?.[0]?.features?.requestCorrelation).toBe(true);
  });

  it("preserves provider order for normalized non-diagnostics methods and boolean features", () => {
    const methods = [
      genericMethod("symbol.definition"),
      {
        ...genericMethod("typescript.semantic.start"),
        stability: "experimental",
        features: { explicitToolchain: true, futureOptionalEvidence: false },
      },
    ];

    expect(normalizeRefactorKitMethodCapabilities(methods)).toEqual(methods);
  });

  it("keeps legitimate RefactorKit 0.6.2 capabilities compatible without inventing methods", () => {
    const legacy = legacyCapabilities();

    expect(legacy.methods).toBeUndefined();
    expect(normalizeRefactorKitMethodCapabilities(undefined)).toBeUndefined();
  });

  it("fails closed on duplicate method names", () => {
    expectInvalidMethodCapabilities([
      genericMethod("symbol.search"),
      genericMethod("symbol.search"),
    ]);
  });

  it.each([
    ["non-array collection", {}],
    ["non-object method", ["diagnostics.v2"]],
    ["unknown method field", [{ ...genericMethod(), unexpected: true }]],
    ["missing stability", [{ name: "symbol.search", requiresProject: true, writesWorkspace: false }]],
    ["missing requiresProject", [{ name: "symbol.search", stability: "beta-contract", writesWorkspace: false }]],
    ["missing writesWorkspace", [{ name: "symbol.search", stability: "beta-contract", requiresProject: true }]],
    ["empty name", [{ ...genericMethod(), name: "" }]],
    ["wrongly typed stability", [{ ...genericMethod(), stability: 2 }]],
    ["wrongly typed requiresProject", [{ ...genericMethod(), requiresProject: "true" }]],
    ["wrongly typed writesWorkspace", [{ ...genericMethod(), writesWorkspace: 0 }]],
  ])("fails closed on %s", (_case, candidate) => {
    expectInvalidMethodCapabilities(candidate);
  });

  it.each([
    ["null", null],
    ["an array", [true]],
    ["an empty object", {}],
    ["a non-boolean feature", { explicitToolchain: "true" }],
  ])("fails closed when generic method features use %s", (_case, features) => {
    expectInvalidMethodCapabilities([{ ...genericMethod(), features }]);
  });

  it.each([
    ["wrong stability", { stability: "experimental" }],
    ["no project requirement", { requiresProject: false }],
    ["unsafe workspace writes", { writesWorkspace: true }],
    [
      "a missing closed feature",
      {
        features: Object.fromEntries(
          Object.entries(DIAGNOSTICS_FEATURES).filter(([name]) => name !== "boundedResponse"),
        ),
      },
    ],
    ["an extra feature", { features: { ...DIAGNOSTICS_FEATURES, fallbackOutput: true } }],
    [
      "a false required feature",
      { features: { ...DIAGNOSTICS_FEATURES, structuredReadiness: false } },
    ],
  ])("rejects diagnostics.v2 with %s", (_case, change) => {
    expectInvalidMethodCapabilities([{ ...diagnosticsV2Method(), ...change }]);
  });
});
