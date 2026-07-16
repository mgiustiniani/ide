import { describe, expect, expectTypeOf, it } from "vitest";

import {
  XCOM2_MODULE_EVIDENCE_KINDS,
  XCOM2_MODULE_SCAN_LIMITS,
  type Xcom2ModuleEvidenceKind,
  type Xcom2ModuleEvidenceObservation,
  type Xcom2ModuleScanIssue,
  type Xcom2ModuleScanRequest,
  type Xcom2ModuleScanSnapshot,
} from "../../packages/contracts/src/domain/xcom2-module-activation";
import {
  evaluateXcom2ModuleActivation,
  selectActiveXcom2ModuleDecisions,
} from "../../packages/web-core/src/xcom2/module-activation";

const correlation = Object.freeze({
  workspaceId: "workspace:authorized",
  workspaceGeneration: 7,
  scanId: "xcom2-module-scan:7",
  scanGeneration: 3,
});

function observation(
  evidenceKind: Xcom2ModuleEvidenceKind,
  moduleRoot = "mods/example",
  relativePath = `mods/example/evidence-${evidenceKind}`,
): Xcom2ModuleEvidenceObservation {
  return { evidenceKind, moduleRoot, relativePath };
}

function scan(
  observations: readonly Xcom2ModuleEvidenceObservation[],
  overrides: Partial<Xcom2ModuleScanSnapshot> = {},
): Xcom2ModuleScanSnapshot {
  return {
    ...correlation,
    completeness: "complete",
    issues: [],
    limits: XCOM2_MODULE_SCAN_LIMITS,
    observations,
    ...overrides,
  };
}

describe("@REQ-XCOM2-MODULE-ACTIVATION-001 bounded convention evidence activation", () => {
  it("does not treat a generic workspace, repository, project, or directory name as evidence", () => {
    const result = evaluateXcom2ModuleActivation(
      scan([], {
        workspaceId: "workspace:xcom-project-repository-directory",
      }),
    );

    expect(result).toEqual({
      workspaceId: "workspace:xcom-project-repository-directory",
      workspaceGeneration: 7,
      scanId: "xcom2-module-scan:7",
      scanGeneration: 3,
      state: "inactive",
      confidence: "none",
      completeness: "complete",
      issues: [],
      limits: { maximumDepth: 8, maximumEncounteredEntries: 20_000 },
      decisions: [],
    });
  });

  it.each([
    ["x2proj", ["mods/example/MyMod.x2proj"]],
    ["xcommod", ["mods/example/MyMod.XComMod"]],
    [
      "x2mbc-script-pair",
      ["mods/example/.scripts/X2ModBuildCommon", "mods/example/.scripts/build.ps1"],
    ],
    ["engine-config", ["mods/example/Config/XComEngine.ini"]],
    ["unrealscript-layout", ["mods/example/Src/Core/Classes/Example.uc"]],
  ] as const)(
    "keeps the lone %s kind at needs-confirmation with medium confidence",
    (kind, paths) => {
      const result = evaluateXcom2ModuleActivation(
        scan(paths.map((relativePath) => observation(kind, "mods/example", relativePath))),
      );

      expect(result.state).toBe("needs-confirmation");
      expect(result.confidence).toBe("medium");
      expect(result.decisions).toEqual([
        {
          moduleRoot: "mods/example",
          state: "needs-confirmation",
          confidence: "medium",
          reasons: paths.map((relativePath) => ({ evidenceKind: kind, relativePath })),
        },
      ]);
      expect(selectActiveXcom2ModuleDecisions(result)).toEqual([]);
    },
  );

  it("activates a corroborated fixture and orders reasons by canonical kind then lexical path", () => {
    const result = evaluateXcom2ModuleActivation(
      scan([
        observation("unrealscript-layout", "mods/example", "mods/example/Src/Z/Classes/Z.uc"),
        observation("x2proj", "mods/example", "mods/example/Zeta.x2proj"),
        observation("engine-config", "mods/example", "mods/example/Config/XComEngine.ini"),
        observation("x2proj", "mods/example", "mods/example/Alpha.x2proj"),
        observation("xcommod", "mods/example", "mods/example/Example.XComMod"),
      ]),
    );

    expect(result.state).toBe("active");
    expect(result.confidence).toBe("high");
    expect(result.decisions[0]).toEqual({
      moduleRoot: "mods/example",
      state: "active",
      confidence: "high",
      reasons: [
        { evidenceKind: "x2proj", relativePath: "mods/example/Alpha.x2proj" },
        { evidenceKind: "x2proj", relativePath: "mods/example/Zeta.x2proj" },
        { evidenceKind: "xcommod", relativePath: "mods/example/Example.XComMod" },
        {
          evidenceKind: "engine-config",
          relativePath: "mods/example/Config/XComEngine.ini",
        },
        {
          evidenceKind: "unrealscript-layout",
          relativePath: "mods/example/Src/Z/Classes/Z.uc",
        },
      ],
    });
  });

  it("does not activate from duplicate evidence in one family", () => {
    const result = evaluateXcom2ModuleActivation(
      scan([
        observation("x2proj", "mods/example", "mods/example/Zeta.x2proj"),
        observation("x2proj", "mods/example", "mods/example/Alpha.x2proj"),
      ]),
    );

    expect(result.decisions).toEqual([
      {
        moduleRoot: "mods/example",
        state: "needs-confirmation",
        confidence: "medium",
        reasons: [
          { evidenceKind: "x2proj", relativePath: "mods/example/Alpha.x2proj" },
          { evidenceKind: "x2proj", relativePath: "mods/example/Zeta.x2proj" },
        ],
      },
    ]);
  });

  it("evaluates multiple and nested canonical module roots independently without bubbling evidence", () => {
    const result = evaluateXcom2ModuleActivation(
      scan([
        observation("x2proj", "mods/outer", "mods/outer/Outer.x2proj"),
        observation("xcommod", "mods/outer/nested", "mods/outer/nested/Nested.XComMod"),
        observation(
          "engine-config",
          "mods/outer/nested",
          "mods/outer/nested/Config/XComEngine.ini",
        ),
        observation("x2proj", "mods/sibling", "mods/sibling/Sibling.x2proj"),
        observation("xcommod", "mods/sibling", "mods/sibling/Sibling.XComMod"),
      ]),
    );

    expect(result.decisions.map(({ moduleRoot, state }) => ({ moduleRoot, state }))).toEqual([
      { moduleRoot: "mods/outer", state: "needs-confirmation" },
      { moduleRoot: "mods/outer/nested", state: "active" },
      { moduleRoot: "mods/sibling", state: "active" },
    ]);
    expect(result.decisions[0]?.reasons).toEqual([
      { evidenceKind: "x2proj", relativePath: "mods/outer/Outer.x2proj" },
    ]);
  });

  it("retains a partial scan and every issue while strong observed corroboration stays active and weak evidence stays unconfirmed", () => {
    const issues = [
      { kind: "unreadable-subtree", relativePath: "vendor/locked" },
      { kind: "depth-limit-reached", relativePath: "deep/module/path" },
    ] as const satisfies readonly Xcom2ModuleScanIssue[];
    const result = evaluateXcom2ModuleActivation(
      scan(
        [
          observation("x2proj", "mods/active", "mods/active/Active.x2proj"),
          observation("xcommod", "mods/active", "mods/active/Active.XComMod"),
          observation("engine-config", "mods/weak", "mods/weak/Config/XComEngine.ini"),
        ],
        { completeness: "partial", issues },
      ),
    );

    expect(result.completeness).toBe("partial");
    expect(result.issues).toEqual(issues);
    expect(result.decisions.map(({ moduleRoot, state }) => ({ moduleRoot, state }))).toEqual([
      { moduleRoot: "mods/active", state: "active" },
      { moduleRoot: "mods/weak", state: "needs-confirmation" },
    ]);
    expect(selectActiveXcom2ModuleDecisions(result).map(({ moduleRoot }) => moduleRoot)).toEqual([
      "mods/active",
    ]);
  });

  it("retains exact limits and generation correlation in an immutable snapshot isolated from later input mutation", () => {
    const limits = { maximumDepth: 8 as const, maximumEncounteredEntries: 20_000 as const };
    const issues = [{ kind: "encountered-entry-limit-reached" as const, relativePath: "mods" }];
    const observations = [
      {
        evidenceKind: "x2proj" as const,
        moduleRoot: "mods/example",
        relativePath: "mods/example/Example.x2proj",
      },
      {
        evidenceKind: "xcommod" as const,
        moduleRoot: "mods/example",
        relativePath: "mods/example/Example.XComMod",
      },
    ];
    const input = scan(observations, { completeness: "partial", issues, limits });
    const before = structuredClone(input);

    const result = evaluateXcom2ModuleActivation(input);

    expect(input).toEqual(before);
    observations.push({
      evidenceKind: "x2proj",
      moduleRoot: "mods/later",
      relativePath: "mods/later/Later.x2proj",
    });
    issues[0]!.relativePath = "changed";
    limits.maximumDepth = 8;

    expect(result).toMatchObject({
      ...correlation,
      completeness: "partial",
      issues: [{ kind: "encountered-entry-limit-reached", relativePath: "mods" }],
      limits: { maximumDepth: 8, maximumEncounteredEntries: 20_000 },
    });
    expect(result.decisions).toHaveLength(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issues)).toBe(true);
    expect(Object.isFrozen(result.issues[0])).toBe(true);
    expect(Object.isFrozen(result.limits)).toBe(true);
    expect(Object.isFrozen(result.decisions)).toBe(true);
    expect(Object.isFrozen(result.decisions[0])).toBe(true);
    expect(Object.isFrozen(result.decisions[0]?.reasons)).toBe(true);
    expect(Object.isFrozen(result.decisions[0]?.reasons[0])).toBe(true);
    expect(() =>
      (result.decisions as unknown as Array<unknown>).push({ state: "needs-confirmation" }),
    ).toThrow(TypeError);

    const activeDecisions = selectActiveXcom2ModuleDecisions(result);
    expect(Object.isFrozen(activeDecisions)).toBe(true);
    expect(() => (activeDecisions as unknown as Array<unknown>).push({ state: "active" })).toThrow(
      TypeError,
    );
  });

  it("publishes only the five convention kinds and a fixed bounded provider-neutral request", () => {
    const request = {
      ...correlation,
      limits: XCOM2_MODULE_SCAN_LIMITS,
    } satisfies Xcom2ModuleScanRequest;

    expect(XCOM2_MODULE_EVIDENCE_KINDS).toEqual([
      "x2proj",
      "xcommod",
      "x2mbc-script-pair",
      "engine-config",
      "unrealscript-layout",
    ]);
    expect(request.limits).toEqual({ maximumDepth: 8, maximumEncounteredEntries: 20_000 });
    expect(Object.isFrozen(XCOM2_MODULE_EVIDENCE_KINDS)).toBe(true);
    expect(Object.isFrozen(XCOM2_MODULE_SCAN_LIMITS)).toBe(true);
    expectTypeOf<Xcom2ModuleEvidenceKind>().not.toEqualTypeOf<"machine-settings">();
    expectTypeOf(request).not.toHaveProperty("provider");
    expectTypeOf(request).not.toHaveProperty("settingsEvidence");
    expectTypeOf(request).not.toHaveProperty("content");
    expectTypeOf(request).not.toHaveProperty("manualConfirmation");
  });
});
