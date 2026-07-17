import { describe, expect, expectTypeOf, it } from "vitest";

import {
  XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PROJECT_FILE_LABEL,
  XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_TITLE,
  XCOM2_MODULE_SCAN_LIMITS,
  type Xcom2ModuleConfigurationDiagnosticPresentation,
  type Xcom2ModuleConfigurationReadCorrelation,
  type Xcom2ModuleConfigurationReadResult,
  type Xcom2ModuleConfigurationStopCode,
} from "../../packages/contracts/src";
import {
  evaluateXcom2ModuleActivation,
  evaluateXcom2ProjectActivation,
  mapXcom2ModuleConfigurationDiagnosticPresentation,
  XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PRESENTATIONS,
} from "../../packages/web-core/src";

const approvedPresentations = {
  "configuration-unreadable": {
    title: "XCOM 2 project configuration needs attention",
    projectFileLabel: ".ide/xcom2.json",
    summary: "The IDE could not safely read the XCOM 2 project configuration.",
    remediation:
      "Make .ide a regular directory and .ide/xcom2.json a readable regular file, with neither entry a symbolic link, then refresh the workspace.",
    supportIdentifier: "configuration-unreadable",
  },
  "configuration-too-large": {
    title: "XCOM 2 project configuration needs attention",
    projectFileLabel: ".ide/xcom2.json",
    summary: "The XCOM 2 project configuration exceeds the 64 KiB limit.",
    remediation: "Reduce .ide/xcom2.json to 64 KiB or less, then refresh the workspace.",
    supportIdentifier: "configuration-too-large",
  },
  "configuration-invalid-utf8": {
    title: "XCOM 2 project configuration needs attention",
    projectFileLabel: ".ide/xcom2.json",
    summary: "The XCOM 2 project configuration is not valid UTF-8.",
    remediation: "Save .ide/xcom2.json as UTF-8, then refresh the workspace.",
    supportIdentifier: "configuration-invalid-utf8",
  },
  "configuration-invalid-json": {
    title: "XCOM 2 project configuration needs attention",
    projectFileLabel: ".ide/xcom2.json",
    summary: "The XCOM 2 project configuration is not valid JSON.",
    remediation:
      "Correct the JSON syntax so the file contains one complete JSON object, then refresh the workspace.",
    supportIdentifier: "configuration-invalid-json",
  },
  "configuration-invalid-schema": {
    title: "XCOM 2 project configuration needs attention",
    projectFileLabel: ".ide/xcom2.json",
    summary: "The XCOM 2 project configuration does not match the activation v1 structure.",
    remediation:
      "Use exactly these fields once: numeric version, text target, and the moduleRoots list; remove all other fields, then refresh the workspace.",
    supportIdentifier: "configuration-invalid-schema",
  },
  "configuration-unsupported-version": {
    title: "XCOM 2 project configuration needs attention",
    projectFileLabel: ".ide/xcom2.json",
    summary: "This XCOM 2 project configuration version is not supported.",
    remediation: "Set version to 1, then refresh the workspace.",
    supportIdentifier: "configuration-unsupported-version",
  },
  "configuration-unsupported-target": {
    title: "XCOM 2 project configuration needs attention",
    projectFileLabel: ".ide/xcom2.json",
    summary: "This XCOM 2 project target is not supported.",
    remediation: 'Set target to "wotc", then refresh the workspace.',
    supportIdentifier: "configuration-unsupported-target",
  },
  "configuration-invalid-module-roots": {
    title: "XCOM 2 project configuration needs attention",
    projectFileLabel: ".ide/xcom2.json",
    summary: "The configured module roots are not valid for this workspace.",
    remediation:
      "Provide 1–64 unique, exact-case workspace-relative paths to existing directories, with no symbolic links, then refresh the workspace.",
    supportIdentifier: "configuration-invalid-module-roots",
  },
} as const satisfies Readonly<
  Record<Xcom2ModuleConfigurationStopCode, Xcom2ModuleConfigurationDiagnosticPresentation>
>;

const correlation = Object.freeze({
  workspaceId: "workspace:authorized",
  workspaceGeneration: 7,
  activationGeneration: 11,
  configurationReadId: "configuration-read:11",
}) satisfies Xcom2ModuleConfigurationReadCorrelation;

function strongOptionARecognition() {
  return evaluateXcom2ModuleActivation({
    workspaceId: correlation.workspaceId,
    workspaceGeneration: correlation.workspaceGeneration,
    scanId: "module-scan:11",
    scanGeneration: 5,
    completeness: "complete",
    issues: [],
    observations: [
      {
        evidenceKind: "x2proj",
        moduleRoot: "mods/Survivor",
        relativePath: "mods/Survivor/Survivor.x2proj",
      },
      {
        evidenceKind: "xcommod",
        moduleRoot: "mods/Survivor",
        relativePath: "mods/Survivor/Survivor.XComMod",
      },
    ],
    limits: XCOM2_MODULE_SCAN_LIMITS,
  });
}

function acceptedDiagnostic(result: Xcom2ModuleConfigurationReadResult) {
  const evaluation = evaluateXcom2ProjectActivation(
    correlation,
    result,
    strongOptionARecognition(),
  );
  if (evaluation.kind !== "accepted" || !evaluation.snapshot.diagnostic) {
    throw new Error("Expected an accepted activation snapshot with a diagnostic");
  }
  return evaluation.snapshot;
}

describe("@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001 safe diagnostic presentation", () => {
  it("maps every stop code to the exhaustive approved fixed copy", () => {
    expect(XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_TITLE).toBe(
      "XCOM 2 project configuration needs attention",
    );
    expect(XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PROJECT_FILE_LABEL).toBe(".ide/xcom2.json");
    expect(XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PRESENTATIONS).toEqual(approvedPresentations);

    for (const code of Object.keys(approvedPresentations) as Xcom2ModuleConfigurationStopCode[]) {
      expect(mapXcom2ModuleConfigurationDiagnosticPresentation(code)).toEqual(
        approvedPresentations[code],
      );
    }

    expectTypeOf<
      keyof typeof XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PRESENTATIONS
    >().toEqualTypeOf<Xcom2ModuleConfigurationStopCode>();
    expectTypeOf(mapXcom2ModuleConfigurationDiagnosticPresentation).parameters.toEqualTypeOf<
      [Xcom2ModuleConfigurationStopCode]
    >();
    expectTypeOf(mapXcom2ModuleConfigurationDiagnosticPresentation).returns.toEqualTypeOf<
      Readonly<Xcom2ModuleConfigurationDiagnosticPresentation>
    >();
  });

  it("returns deterministic deeply frozen presentations that cannot retain interpolated details", () => {
    for (const code of Object.keys(approvedPresentations) as Xcom2ModuleConfigurationStopCode[]) {
      const first = mapXcom2ModuleConfigurationDiagnosticPresentation(code);
      const second = mapXcom2ModuleConfigurationDiagnosticPresentation(code);

      expect(first).toBe(second);
      expect(first).toBe(XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PRESENTATIONS[code]);
      expect(Object.isFrozen(first)).toBe(true);
      expect(() => {
        (first as { summary: string }).summary = "CONFIG-SOURCE-MUST-NOT-APPEAR";
      }).toThrow(TypeError);
    }
    expect(Object.isFrozen(XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PRESENTATIONS)).toBe(true);

    const renderedCopy = JSON.stringify(XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PRESENTATIONS);
    expect(renderedCopy).not.toContain("CONFIG-SOURCE-MUST-NOT-APPEAR");
    expect(renderedCopy).not.toContain("/home/scenario-owner/private-workspace");
    expect(renderedCopy).not.toMatch(/(?:^|["\s])\/(?:home|tmp|Users|var)\//u);
    expect(renderedCopy).not.toMatch(
      /\b(?:interpolat|leak|canary|parser|provider|native|cause|secret)/iu,
    );
  });

  it("presents typed failures without weakening strong Option A survival or granting invalid ready authority", () => {
    const stoppedSnapshot = acceptedDiagnostic({
      ...correlation,
      kind: "stopped",
      code: "configuration-invalid-json",
    });

    expect(stoppedSnapshot.decisions).toMatchObject([
      {
        moduleRoot: "mods/Survivor",
        state: "active",
        source: "recognized",
        activationConfidence: "high",
      },
    ]);
    expect(
      mapXcom2ModuleConfigurationDiagnosticPresentation(stoppedSnapshot.diagnostic!.code),
    ).toBe(XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PRESENTATIONS["configuration-invalid-json"]);

    const invalidReadySnapshot = acceptedDiagnostic({
      ...correlation,
      kind: "ready",
      configuration: {
        version: 1,
        target: "wotc",
        moduleRoots: ["mods/configured", "../outside"],
      },
    });

    expect(invalidReadySnapshot.decisions).toMatchObject([
      {
        moduleRoot: "mods/Survivor",
        state: "active",
        source: "recognized",
        activationConfidence: "high",
      },
    ]);
    expect(invalidReadySnapshot.decisions).not.toContainEqual(
      expect.objectContaining({ source: "configured" }),
    );
    expect(
      mapXcom2ModuleConfigurationDiagnosticPresentation(invalidReadySnapshot.diagnostic!.code),
    ).toBe(
      XCOM2_MODULE_CONFIGURATION_DIAGNOSTIC_PRESENTATIONS["configuration-invalid-module-roots"],
    );
  });
});
