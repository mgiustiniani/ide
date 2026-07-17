import { describe, expect, expectTypeOf, it } from "vitest";

import {
  XCOM2_MODULE_CONFIGURATION_LIMITS,
  XCOM2_MODULE_CONFIGURATION_PATH,
  XCOM2_MODULE_CONFIGURATION_SCHEMA,
  type Xcom2ModuleConfiguration,
  type Xcom2ModuleConfigurationReadCorrelation,
  type Xcom2ModuleConfigurationReadRequest,
  type Xcom2ModuleConfigurationReadResult,
  type Xcom2ModuleConfigurationStopCode,
  type Xcom2ProjectActivationDecision,
  type Xcom2ProjectActivationSnapshot,
} from "../../packages/contracts/src/domain/xcom2-module-configuration-activation";
import {
  type Xcom2ModuleActivationSnapshot,
  type Xcom2ModuleEvidenceKind,
  type Xcom2ModuleEvidenceObservation,
  XCOM2_MODULE_SCAN_LIMITS,
} from "../../packages/contracts/src/domain/xcom2-module-activation";
import { evaluateXcom2ModuleActivation as recognizeXcom2Modules } from "../../packages/web-core/src/xcom2/module-activation";
import { evaluateXcom2ProjectActivation } from "../../packages/web-core/src/xcom2/module-configuration-activation";

const readCorrelation = Object.freeze({
  workspaceId: "workspace:authorized",
  workspaceGeneration: 7,
  activationGeneration: 11,
  configurationReadId: "xcom2-configuration-read:11",
}) satisfies Xcom2ModuleConfigurationReadCorrelation;

const scanCorrelation = Object.freeze({
  workspaceId: readCorrelation.workspaceId,
  workspaceGeneration: readCorrelation.workspaceGeneration,
  scanId: "xcom2-module-scan:11",
  scanGeneration: 5,
});

const request: Xcom2ModuleConfigurationReadRequest = readCorrelation;

function configuration(moduleRoots: readonly string[]): Xcom2ModuleConfiguration {
  return { version: 1, target: "wotc", moduleRoots };
}

function absent(): Xcom2ModuleConfigurationReadResult {
  return { ...readCorrelation, kind: "absent" };
}

function ready(moduleRoots: readonly string[]): Xcom2ModuleConfigurationReadResult {
  return { ...readCorrelation, kind: "ready", configuration: configuration(moduleRoots) };
}

function stopped(code: Xcom2ModuleConfigurationStopCode): Xcom2ModuleConfigurationReadResult {
  return { ...readCorrelation, kind: "stopped", code };
}

function observation(
  evidenceKind: Xcom2ModuleEvidenceKind,
  moduleRoot: string,
  relativePath: string,
): Xcom2ModuleEvidenceObservation {
  return { evidenceKind, moduleRoot, relativePath };
}

function recognition(
  observations: readonly Xcom2ModuleEvidenceObservation[],
): Readonly<Xcom2ModuleActivationSnapshot> {
  return recognizeXcom2Modules({
    ...scanCorrelation,
    completeness: "complete",
    issues: [],
    limits: XCOM2_MODULE_SCAN_LIMITS,
    observations,
  });
}

function accepted(
  configResult: Xcom2ModuleConfigurationReadResult,
  recognized = recognition([]),
): Readonly<Xcom2ProjectActivationSnapshot> {
  const evaluation = evaluateXcom2ProjectActivation(request, configResult, recognized);
  if (evaluation.kind !== "accepted") throw new Error(`Expected accepted, got ${evaluation.kind}`);
  return evaluation.snapshot;
}

function reasonSummary(decision: Readonly<Xcom2ProjectActivationDecision>) {
  return decision.reasons.map((reason) =>
    reason.kind === "configuration"
      ? `configuration:${reason.target}`
      : `${reason.evidenceKind}:${reason.relativePath}`,
  );
}

describe("@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001 configured project activation", () => {
  it("delegates an absent configuration to the existing Option A recognition decision", () => {
    const recognized = recognition([
      observation("x2proj", "mods/recognized", "mods/recognized/Recognized.x2proj"),
      observation("xcommod", "mods/recognized", "mods/recognized/Recognized.XComMod"),
    ]);

    const result = accepted(absent(), recognized);

    expect(result).toMatchObject({
      ...readCorrelation,
      ...scanCorrelation,
      state: "active",
      recognitionConfidence: "high",
      decisions: [
        {
          moduleRoot: "mods/recognized",
          state: "active",
          source: "recognized",
          activationConfidence: "high",
          recognitionConfidence: "high",
        },
      ],
    });
    expect(result.diagnostic).toBeUndefined();
    expect(reasonSummary(result.decisions[0]!)).toEqual([
      "x2proj:mods/recognized/Recognized.x2proj",
      "xcommod:mods/recognized/Recognized.XComMod",
    ]);
  });

  it("activates a configuration-only root explicitly while recognition confidence remains none", () => {
    const result = accepted(ready(["mods/IntentOnly"]));

    expect(result.state).toBe("active");
    expect(result.recognitionConfidence).toBe("none");
    expect(result.decisions).toEqual([
      {
        moduleRoot: "mods/IntentOnly",
        state: "active",
        source: "configured",
        activationConfidence: "explicit",
        recognitionConfidence: "none",
        reasons: [{ kind: "configuration", target: "wotc" }],
      },
    ]);
  });

  it("combines configured roots with weak and strong Option A observations without conflating confidence", () => {
    const recognized = recognition([
      observation("engine-config", "mods/weak", "mods/weak/Config/XComEngine.ini"),
      observation("x2proj", "mods/strong", "mods/strong/Strong.x2proj"),
      observation("xcommod", "mods/strong", "mods/strong/Strong.XComMod"),
      observation("x2proj", "mods/recognized", "mods/recognized/Only.x2proj"),
    ]);

    const result = accepted(ready(["mods/weak", "mods/strong"]), recognized);

    expect(result.recognitionConfidence).toBe("high");
    expect(result.decisions).toMatchObject([
      {
        moduleRoot: "mods/recognized",
        state: "needs-confirmation",
        source: "recognized",
        recognitionConfidence: "medium",
      },
      {
        moduleRoot: "mods/strong",
        state: "active",
        source: "configured-and-recognized",
        activationConfidence: "explicit",
        recognitionConfidence: "high",
      },
      {
        moduleRoot: "mods/weak",
        state: "active",
        source: "configured-and-recognized",
        activationConfidence: "explicit",
        recognitionConfidence: "medium",
      },
    ]);
    expect(result.decisions[0]).not.toHaveProperty("activationConfidence");
  });

  it("treats multiple and nested configured roots as additive independent decisions in lexical order", () => {
    const result = accepted(
      ready(["mods/zeta", "mods/outer/nested", ".", "mods/outer", "mods/alpha"]),
    );

    expect(result.decisions.map(({ moduleRoot }) => moduleRoot)).toEqual([
      ".",
      "mods/alpha",
      "mods/outer",
      "mods/outer/nested",
      "mods/zeta",
    ]);
    expect(result.decisions.every(({ source }) => source === "configured")).toBe(true);
  });

  it("accepts the inclusive 64-root boundary without merging independent roots", () => {
    const roots = Array.from(
      { length: 64 },
      (_, index) => `mods/root-${String(index).padStart(2, "0")}`,
    );

    const result = accepted(ready([...roots].reverse()));

    expect(result.decisions).toHaveLength(64);
    expect(result.decisions.map(({ moduleRoot }) => moduleRoot)).toEqual(roots);
  });

  it("lets strong Option A recognition survive a stopped configuration with only a safe typed diagnostic", () => {
    const recognized = recognition([
      observation("x2proj", "mods/survivor", "mods/survivor/Survivor.x2proj"),
      observation("xcommod", "mods/survivor", "mods/survivor/Survivor.XComMod"),
    ]);

    const result = accepted(stopped("configuration-invalid-json"), recognized);

    expect(result.decisions).toMatchObject([
      {
        moduleRoot: "mods/survivor",
        state: "active",
        source: "recognized",
        activationConfidence: "high",
      },
    ]);
    expect(result.diagnostic).toEqual({ code: "configuration-invalid-json" });
    expect(result.diagnostic).not.toHaveProperty("message");
    expect(result.diagnostic).not.toHaveProperty("path");
    expect(result.diagnostic).not.toHaveProperty("content");
  });

  it("rejects an invalid ready root set atomically instead of granting authority to its valid subset", () => {
    const forged = {
      ...readCorrelation,
      kind: "ready",
      configuration: configuration(["mods/valid", "../outside"]),
    } satisfies Xcom2ModuleConfigurationReadResult;
    const recognized = recognition([
      observation("x2proj", "mods/survivor", "mods/survivor/Survivor.x2proj"),
      observation("xcommod", "mods/survivor", "mods/survivor/Survivor.XComMod"),
    ]);

    const result = accepted(forged, recognized);

    expect(result.decisions.map(({ moduleRoot }) => moduleRoot)).toEqual(["mods/survivor"]);
    expect(result.decisions).not.toContainEqual(expect.objectContaining({ source: "configured" }));
    expect(result.diagnostic).toEqual({ code: "configuration-invalid-module-roots" });
  });

  it.each([
    ["file URI-like root", "file:/inside"],
    ["C0 control", "mods/c0\ninside"],
    ["C1 control", "mods/c1\u009finside"],
  ] as const)("rejects a forged ready %s atomically", (_case, invalidRoot) => {
    const forged = {
      ...readCorrelation,
      kind: "ready",
      configuration: configuration(["Mods/日本語/β", invalidRoot]),
    } satisfies Xcom2ModuleConfigurationReadResult;

    const result = accepted(forged);

    expect(result.state).toBe("inactive");
    expect(result.decisions).toEqual([]);
    expect(result.diagnostic).toEqual({ code: "configuration-invalid-module-roots" });
  });

  it("continues to grant configured authority to a portable Unicode root", () => {
    const result = accepted(ready(["Mods/日本語/β"]));

    expect(result.decisions).toEqual([
      {
        moduleRoot: "Mods/日本語/β",
        state: "active",
        source: "configured",
        activationConfidence: "explicit",
        recognitionConfidence: "none",
        reasons: [{ kind: "configuration", target: "wotc" }],
      },
    ]);
    expect(result.diagnostic).toBeUndefined();
  });

  it("rejects a forged ready root containing a lone high UTF-16 surrogate atomically", () => {
    const forged = {
      ...readCorrelation,
      kind: "ready",
      configuration: configuration(["\uD800"]),
    } satisfies Xcom2ModuleConfigurationReadResult;

    const result = accepted(forged);

    expect(result.state).toBe("inactive");
    expect(result.decisions).toEqual([]);
    expect(result.diagnostic).toEqual({ code: "configuration-invalid-module-roots" });
  });

  it.each([
    ["no roots", []],
    ["more than 64 roots", Array.from({ length: 65 }, (_, index) => `mods/root-${index}`)],
    ["duplicate roots", ["mods/duplicate", "mods/duplicate"]],
  ] as const)("grants no configured authority for %s", (_case, moduleRoots) => {
    const result = accepted(ready(moduleRoots));

    expect(result.state).toBe("inactive");
    expect(result.decisions).toEqual([]);
    expect(result.diagnostic).toEqual({ code: "configuration-invalid-module-roots" });
  });

  it("grants no configured authority to a forged target other than exact wotc", () => {
    const forged = {
      ...readCorrelation,
      kind: "ready",
      configuration: { version: 1, target: "vanilla", moduleRoots: ["mods/invalid-target"] },
    } as unknown as Xcom2ModuleConfigurationReadResult;

    const result = accepted(forged);

    expect(result.state).toBe("inactive");
    expect(result.decisions).toEqual([]);
    expect(result.diagnostic).toEqual({ code: "configuration-unsupported-target" });
  });

  it("places the configuration reason before unchanged Option A kind and lexical reason order", () => {
    const recognized = recognition([
      observation("engine-config", "mods/combined", "mods/combined/Config/XComEngine.ini"),
      observation("x2proj", "mods/combined", "mods/combined/Zeta.x2proj"),
      observation("x2proj", "mods/combined", "mods/combined/Alpha.x2proj"),
      observation("xcommod", "mods/combined", "mods/combined/Combined.XComMod"),
    ]);

    const result = accepted(ready(["mods/combined"]), recognized);

    expect(reasonSummary(result.decisions[0]!)).toEqual([
      "configuration:wotc",
      "x2proj:mods/combined/Alpha.x2proj",
      "x2proj:mods/combined/Zeta.x2proj",
      "xcommod:mods/combined/Combined.XComMod",
      "engine-config:mods/combined/Config/XComEngine.ini",
    ]);
  });

  it("returns a deeply immutable snapshot isolated from later input mutation", () => {
    const roots = ["mods/configured"];
    const configResult = ready(roots);
    const recognized = recognition([
      observation("x2proj", "mods/configured", "mods/configured/Configured.x2proj"),
    ]);
    const configBefore = structuredClone(configResult);
    const recognitionBefore = structuredClone(recognized);

    const evaluation = evaluateXcom2ProjectActivation(request, configResult, recognized);
    if (evaluation.kind !== "accepted") throw new Error("Expected accepted evaluation");
    const result = evaluation.snapshot;

    expect(configResult).toEqual(configBefore);
    expect(recognized).toEqual(recognitionBefore);
    roots.push("mods/later");
    expect(result.decisions).toHaveLength(1);
    expect(Object.isFrozen(evaluation)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.decisions)).toBe(true);
    expect(Object.isFrozen(result.decisions[0])).toBe(true);
    expect(Object.isFrozen(result.decisions[0]?.reasons)).toBe(true);
    expect(Object.isFrozen(result.decisions[0]?.reasons[0])).toBe(true);
    expect(() =>
      (result.decisions as unknown as Array<unknown>).push({ moduleRoot: "mods/later" }),
    ).toThrow(TypeError);
  });

  it.each([
    [
      "configuration result",
      (result: Xcom2ModuleConfigurationReadResult, recognized: Xcom2ModuleActivationSnapshot) => ({
        result: { ...result, activationGeneration: 10 },
        recognized,
        reason: "configuration-correlation-mismatch",
      }),
    ],
    [
      "recognition result",
      (result: Xcom2ModuleConfigurationReadResult, recognized: Xcom2ModuleActivationSnapshot) => ({
        result,
        recognized: { ...recognized, workspaceGeneration: 6 },
        reason: "recognition-correlation-mismatch",
      }),
    ],
  ] as const)("rejects the entire candidate when the %s is stale", (_case, mismatch) => {
    const candidate = mismatch(ready(["mods/stale"]), recognition([]));

    const evaluation = evaluateXcom2ProjectActivation(
      request,
      candidate.result,
      candidate.recognized,
    );

    expect(evaluation).toEqual({ kind: "rejected", reason: candidate.reason });
    expect(evaluation).not.toHaveProperty("snapshot");
    expect(Object.isFrozen(evaluation)).toBe(true);
  });

  it("publishes the exact activation-only v1 schema, fixed bounds, and safe stop vocabulary", () => {
    expect(XCOM2_MODULE_CONFIGURATION_PATH).toBe(".ide/xcom2.json");
    expect(XCOM2_MODULE_CONFIGURATION_SCHEMA).toEqual({ version: 1, target: "wotc" });
    expect(XCOM2_MODULE_CONFIGURATION_LIMITS).toEqual({
      maximumFileBytes: 64 * 1024,
      minimumModuleRoots: 1,
      maximumModuleRoots: 64,
      maximumModuleRootBytes: 4096,
    });
    expect(Object.isFrozen(XCOM2_MODULE_CONFIGURATION_SCHEMA)).toBe(true);
    expect(Object.isFrozen(XCOM2_MODULE_CONFIGURATION_LIMITS)).toBe(true);

    expectTypeOf<Xcom2ModuleConfiguration["version"]>().toEqualTypeOf<1>();
    expectTypeOf<Xcom2ModuleConfiguration["target"]>().toEqualTypeOf<"wotc">();
    expectTypeOf<Xcom2ModuleConfiguration["moduleRoots"]>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<Xcom2ModuleConfigurationStopCode>().toEqualTypeOf<
      | "configuration-unreadable"
      | "configuration-too-large"
      | "configuration-invalid-utf8"
      | "configuration-invalid-json"
      | "configuration-invalid-schema"
      | "configuration-unsupported-version"
      | "configuration-unsupported-target"
      | "configuration-invalid-module-roots"
    >();
  });

  it("keeps requests and activation decisions provider-neutral and free of execution or mutation authority", () => {
    expectTypeOf<Xcom2ModuleConfigurationReadRequest>().not.toHaveProperty("provider");
    expectTypeOf<Xcom2ModuleConfigurationReadRequest>().not.toHaveProperty("command");
    expectTypeOf<Xcom2ModuleConfigurationReadRequest>().not.toHaveProperty("tool");
    expectTypeOf<Xcom2ModuleConfigurationReadRequest>().not.toHaveProperty("workspaceRoot");
    expectTypeOf<Xcom2ModuleConfigurationReadRequest>().not.toHaveProperty("configurationPath");
    expectTypeOf<Xcom2ModuleConfigurationReadRequest>().not.toHaveProperty("externalRoot");
    expectTypeOf<Xcom2ModuleConfigurationReadRequest>().not.toHaveProperty("write");
    expectTypeOf<Xcom2ModuleConfiguration>().not.toHaveProperty("sdk");
    expectTypeOf<Xcom2ModuleConfiguration>().not.toHaveProperty("game");
    expectTypeOf<Xcom2ModuleConfiguration>().not.toHaveProperty("steam");
    expectTypeOf<Xcom2ModuleConfiguration>().not.toHaveProperty("proton");
    expectTypeOf<Xcom2ModuleConfiguration>().not.toHaveProperty("build");
    expectTypeOf<Xcom2ProjectActivationDecision>().not.toHaveProperty("command");
    expectTypeOf<Xcom2ProjectActivationDecision>().not.toHaveProperty("toolAuthority");
    expectTypeOf<Xcom2ProjectActivationDecision>().not.toHaveProperty("externalRootAuthority");
    expectTypeOf<Xcom2ProjectActivationDecision>().not.toHaveProperty("mutationAuthority");
  });
});
