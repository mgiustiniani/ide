import React from "react";
import { render, screen, within } from "@testing-library/react";
import type {
  Xcom2ModuleActivationDecision,
  Xcom2ModuleActivationSnapshot,
  Xcom2ProjectActivationDecision,
  Xcom2ProjectActivationSnapshot,
} from "@ide/contracts";
import { describe, expect, it } from "vitest";
import {
  XCOM2_PROJECT_RECOGNITION_LIMITATION,
  Xcom2ProjectRecognitionPanel,
} from "./Xcom2ProjectRecognitionPanel";

const recognitionLimitation =
  "Recognition only: no Build, Problems, Logs, language support, actions, or bottom contribution.";

const primaryDecision: Xcom2ModuleActivationDecision = {
  moduleRoot: "Mods/Primary",
  state: "active",
  confidence: "high",
  reasons: [
    { evidenceKind: "x2proj", relativePath: "Mods/Primary/Primary.x2proj" },
    { evidenceKind: "engine-config", relativePath: "Mods/Primary/Config/XComEngine.ini" },
    {
      evidenceKind: "unrealscript-layout",
      relativePath: "Mods/Primary/Src/Primary/Classes",
    },
  ],
};

const secondaryDecision: Xcom2ModuleActivationDecision = {
  moduleRoot: "Mods/Secondary",
  state: "needs-confirmation",
  confidence: "medium",
  reasons: [
    { evidenceKind: "xcommod", relativePath: "Mods/Secondary/Secondary.xcommod" },
    {
      evidenceKind: "x2mbc-script-pair",
      relativePath: "Mods/Secondary/Src/Secondary/Classes/Secondary.uc",
    },
  ],
};

const configuredDecision: Xcom2ProjectActivationDecision = {
  moduleRoot: "mods/IntentOnly",
  state: "active",
  source: "configured",
  activationConfidence: "explicit",
  recognitionConfidence: "none",
  reasons: [{ kind: "configuration", target: "wotc" }],
};

const combinedDecision: Xcom2ProjectActivationDecision = {
  moduleRoot: "mods/Combined",
  state: "active",
  source: "configured-and-recognized",
  activationConfidence: "explicit",
  recognitionConfidence: "high",
  reasons: [
    {
      kind: "recognition",
      evidenceKind: "x2proj",
      relativePath: "mods/Combined/Zeta.x2proj",
    },
    { kind: "configuration", target: "wotc" },
    {
      kind: "recognition",
      evidenceKind: "xcommod",
      relativePath: "mods/Combined/Combined.xcommod",
    },
    {
      kind: "recognition",
      evidenceKind: "engine-config",
      relativePath: "mods/Combined/Config/XComEngine.ini",
    },
  ],
};

const recognizedProjectDecision: Xcom2ProjectActivationDecision = {
  moduleRoot: primaryDecision.moduleRoot,
  state: "active",
  source: "recognized",
  activationConfidence: "high",
  recognitionConfidence: "high",
  reasons: primaryDecision.reasons.map((reason) => ({ kind: "recognition", ...reason })),
};

function snapshot(
  overrides: Partial<Xcom2ModuleActivationSnapshot> = {},
): Xcom2ModuleActivationSnapshot {
  return {
    workspaceId: "workspace-xcom2",
    workspaceGeneration: 7,
    scanId: "scan-11",
    scanGeneration: 11,
    state: "active",
    confidence: "high",
    completeness: "partial",
    issues: [],
    limits: {
      maximumDepth: 8,
      maximumEncounteredEntries: 20_000,
    },
    decisions: [primaryDecision, secondaryDecision],
    ...overrides,
  };
}

function projectSnapshot(
  decisions: readonly Xcom2ProjectActivationDecision[],
  overrides: Partial<Xcom2ProjectActivationSnapshot> = {},
): Xcom2ProjectActivationSnapshot {
  return {
    workspaceId: "workspace-xcom2",
    workspaceGeneration: 7,
    activationGeneration: 13,
    configurationReadId: "configuration-read-13",
    scanId: "scan-11",
    scanGeneration: 11,
    state: "active",
    recognitionConfidence: "high",
    decisions,
    ...overrides,
  };
}

function renderLegacy(
  activeDecisions: readonly Xcom2ModuleActivationDecision[] = [primaryDecision],
) {
  return render(
    <Xcom2ProjectRecognitionPanel snapshot={snapshot()} activeDecisions={activeDecisions} />,
  );
}

function renderProject(
  activeProjectDecisions: readonly Xcom2ProjectActivationDecision[],
  options: {
    readonly projectOverrides?: Partial<Xcom2ProjectActivationSnapshot>;
    readonly recognitionOverrides?: Partial<Xcom2ModuleActivationSnapshot>;
  } = {},
) {
  return render(
    <Xcom2ProjectRecognitionPanel
      snapshot={snapshot()}
      activeDecisions={[primaryDecision]}
      projectSnapshot={projectSnapshot(activeProjectDecisions, options.projectOverrides)}
      recognitionSnapshot={snapshot(options.recognitionOverrides)}
      activeProjectDecisions={activeProjectDecisions}
    />,
  );
}

function definitionList(region: HTMLElement): {
  readonly terms: (string | null)[];
  readonly descriptions: (string | null)[];
} {
  const details = region.querySelector("dl");
  expect(details).not.toBeNull();
  return {
    terms: Array.from(details?.querySelectorAll("dt") ?? [], (term) => term.textContent),
    descriptions: Array.from(
      details?.querySelectorAll("dd") ?? [],
      (description) => description.textContent,
    ),
  };
}

function tableRows(table: HTMLElement): (string | undefined)[][] {
  return Array.from(table.querySelectorAll("tbody tr"), (row) =>
    Array.from(row.querySelectorAll("td"), (cell) => cell.textContent?.trim()),
  );
}

describe("Xcom2ProjectRecognitionPanel", () => {
  it("retains the exact legacy five fields, table headers, and ordered recognition evidence", () => {
    renderLegacy();

    expect(screen.getByRole("heading", { name: "XCOM 2 Project" })).toBeDefined();
    const moduleRegion = screen.getByRole("region", { name: "Recognized module Mods/Primary" });
    expect(definitionList(moduleRegion)).toEqual({
      terms: ["module root", "state", "confidence", "completeness", "limitation"],
      descriptions: ["Mods/Primary", "active", "high", "partial", recognitionLimitation],
    });
    expect(XCOM2_PROJECT_RECOGNITION_LIMITATION).toBe(recognitionLimitation);

    const table = within(moduleRegion).getByRole("table", {
      name: "Recognition evidence for Mods/Primary",
    });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent?.trim()),
    ).toEqual(["kind", "workspace-relative path"]);
    expect(tableRows(table)).toEqual([
      ["x2proj", "Mods/Primary/Primary.x2proj"],
      ["engine-config", "Mods/Primary/Config/XComEngine.ini"],
      ["unrealscript-layout", "Mods/Primary/Src/Primary/Classes"],
    ]);
  });

  it("renders configuration-only activation with the exact seven fields and reason", () => {
    renderProject([configuredDecision], {
      recognitionOverrides: { confidence: "none", completeness: "complete" },
    });

    const moduleRegion = screen.getByRole("region", {
      name: "Configured module mods/IntentOnly",
    });
    expect(definitionList(moduleRegion)).toEqual({
      terms: [
        "target",
        "module root",
        "state",
        "source",
        "activation confidence",
        "recognition confidence",
        "limitation",
      ],
      descriptions: [
        "wotc",
        "mods/IntentOnly",
        "active",
        "configured",
        "explicit",
        "none",
        recognitionLimitation,
      ],
    });

    const table = within(moduleRegion).getByRole("table", {
      name: "Activation reasons for mods/IntentOnly",
    });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent?.trim()),
    ).toEqual(["kind", "workspace-relative path"]);
    expect(tableRows(table)).toEqual([["explicit-configuration", ".ide/xcom2.json"]]);
  });

  it("puts configuration first, preserves supplied recognition-reason order, and preserves module input order", () => {
    renderProject([combinedDecision, configuredDecision]);

    expect(
      screen
        .getAllByRole("region", { name: /^(Configured|Configured and recognized) module /u })
        .map((region) => region.getAttribute("aria-label")),
    ).toEqual([
      "Configured and recognized module mods/Combined",
      "Configured module mods/IntentOnly",
    ]);

    const table = screen.getByRole("table", {
      name: "Activation reasons for mods/Combined",
    });
    expect(tableRows(table)).toEqual([
      ["explicit-configuration", ".ide/xcom2.json"],
      ["x2proj", "mods/Combined/Zeta.x2proj"],
      ["xcommod", "mods/Combined/Combined.xcommod"],
      ["engine-config", "mods/Combined/Config/XComEngine.ini"],
    ]);
  });

  it("renders a project recognized-only decision with the exact legacy five fields and table", () => {
    renderProject([recognizedProjectDecision], {
      recognitionOverrides: { completeness: "partial" },
    });

    const moduleRegion = screen.getByRole("region", { name: "Recognized module Mods/Primary" });
    expect(definitionList(moduleRegion)).toEqual({
      terms: ["module root", "state", "confidence", "completeness", "limitation"],
      descriptions: ["Mods/Primary", "active", "high", "partial", recognitionLimitation],
    });
    const table = within(moduleRegion).getByRole("table", {
      name: "Recognition evidence for Mods/Primary",
    });
    expect(tableRows(table)).toEqual([
      ["x2proj", "Mods/Primary/Primary.x2proj"],
      ["engine-config", "Mods/Primary/Config/XComEngine.ini"],
      ["unrealscript-layout", "Mods/Primary/Src/Primary/Classes"],
    ]);
  });

  it("renders the safe project diagnostic and every scan issue as alerts", () => {
    const { rerender } = renderProject([configuredDecision], {
      projectOverrides: { diagnostic: { code: "configuration-invalid-json" } },
      recognitionOverrides: {
        issues: [
          { kind: "unreadable-entry", relativePath: "Mods/Blocked.x2proj" },
          { kind: "depth-limit-reached", relativePath: "Mods/Deep/Nested" },
        ],
      },
    });

    expect(screen.getAllByRole("alert").map((alert) => alert.textContent?.trim())).toEqual([
      "configuration: configuration-invalid-json",
      "unreadable-entry: Mods/Blocked.x2proj",
      "depth-limit-reached: Mods/Deep/Nested",
    ]);

    rerender(
      <Xcom2ProjectRecognitionPanel
        snapshot={snapshot({ issues: [] })}
        activeDecisions={[primaryDecision]}
        projectSnapshot={projectSnapshot([configuredDecision])}
        recognitionSnapshot={snapshot({ issues: [] })}
        activeProjectDecisions={[configuredDecision]}
      />,
    );
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(screen.queryByText(/no issues|issue-free|all entries readable/iu)).toBeNull();
  });

  it("does not mutate host input while preserving multiple legacy modules in supplied order", () => {
    const legacyDecisions = [secondaryDecision, primaryDecision];
    const recognition = snapshot({
      issues: [{ kind: "unreadable-subtree", relativePath: "Mods/Restricted" }],
    });
    const projectDecisions = [combinedDecision, configuredDecision];
    const project = projectSnapshot(projectDecisions);
    const before = structuredClone({ legacyDecisions, recognition, projectDecisions, project });

    const { container } = render(
      <Xcom2ProjectRecognitionPanel
        snapshot={recognition}
        activeDecisions={legacyDecisions}
        projectSnapshot={project}
        recognitionSnapshot={recognition}
        activeProjectDecisions={projectDecisions}
      />,
    );

    expect({ legacyDecisions, recognition, projectDecisions, project }).toEqual(before);
    expect(
      container.querySelectorAll(
        'button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]',
      ),
    ).toHaveLength(0);
  });

  it("renders multiple legacy recognized modules in the supplied order with no actions", () => {
    const { container } = renderLegacy([secondaryDecision, primaryDecision]);

    expect(
      screen
        .getAllByRole("region", { name: /^Recognized module /u })
        .map((region) => region.getAttribute("aria-label")),
    ).toEqual(["Recognized module Mods/Secondary", "Recognized module Mods/Primary"]);
    expect(
      screen
        .getAllByRole("table")
        .map((table) => table.querySelector("caption")?.textContent?.trim()),
    ).toEqual(["Recognition evidence for Mods/Secondary", "Recognition evidence for Mods/Primary"]);
    expect(
      container.querySelectorAll(
        'button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]',
      ),
    ).toHaveLength(0);
  });
});
