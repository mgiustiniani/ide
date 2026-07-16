import React from "react";
import { render, screen, within } from "@testing-library/react";
import type { Xcom2ModuleActivationDecision, Xcom2ModuleActivationSnapshot } from "@ide/contracts";
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

describe("Xcom2ProjectRecognitionPanel", () => {
  it("renders the exact five definition fields and recognition limitation", () => {
    render(
      <Xcom2ProjectRecognitionPanel snapshot={snapshot()} activeDecisions={[primaryDecision]} />,
    );

    expect(screen.getByRole("heading", { name: "XCOM 2 Project" })).toBeDefined();
    const moduleRegion = screen.getByRole("region", { name: "Recognized module Mods/Primary" });
    const details = moduleRegion.querySelector("dl");
    expect(details).not.toBeNull();
    const terms = Array.from(details?.querySelectorAll("dt") ?? [], (term) => term.textContent);
    const descriptions = Array.from(
      details?.querySelectorAll("dd") ?? [],
      (description) => description.textContent,
    );

    expect(terms).toEqual(["module root", "state", "confidence", "completeness", "limitation"]);
    expect(descriptions).toEqual([
      "Mods/Primary",
      "active",
      "high",
      "partial",
      recognitionLimitation,
    ]);
    expect(XCOM2_PROJECT_RECOGNITION_LIMITATION).toBe(recognitionLimitation);
  });

  it("preserves exact table headers and ordered evidence rows", () => {
    render(
      <Xcom2ProjectRecognitionPanel snapshot={snapshot()} activeDecisions={[primaryDecision]} />,
    );

    const table = screen.getByRole("table", {
      name: "Recognition evidence for Mods/Primary",
    });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent?.trim()),
    ).toEqual(["kind", "workspace-relative path"]);
    expect(
      Array.from(table.querySelectorAll("tbody tr"), (row) =>
        Array.from(row.querySelectorAll("td"), (cell) => cell.textContent?.trim()),
      ),
    ).toEqual([
      ["x2proj", "Mods/Primary/Primary.x2proj"],
      ["engine-config", "Mods/Primary/Config/XComEngine.ini"],
      ["unrealscript-layout", "Mods/Primary/Src/Primary/Classes"],
    ]);
  });

  it("renders multiple recognized modules in the supplied order", () => {
    render(
      <Xcom2ProjectRecognitionPanel
        snapshot={snapshot()}
        activeDecisions={[secondaryDecision, primaryDecision]}
      />,
    );

    const moduleRegions = screen.getAllByRole("region", { name: /^Recognized module /u });
    expect(moduleRegions.map((region) => region.getAttribute("aria-label"))).toEqual([
      "Recognized module Mods/Secondary",
      "Recognized module Mods/Primary",
    ]);
    expect(
      screen
        .getAllByRole("table")
        .map((table) => table.querySelector("caption")?.textContent?.trim()),
    ).toEqual(["Recognition evidence for Mods/Secondary", "Recognition evidence for Mods/Primary"]);
  });

  it("renders every scan issue as an alert and no issue UI for an empty issue list", () => {
    const { rerender } = render(
      <Xcom2ProjectRecognitionPanel
        snapshot={snapshot({
          issues: [
            { kind: "unreadable-entry", relativePath: "Mods/Blocked.x2proj" },
            { kind: "depth-limit-reached", relativePath: "Mods/Deep/Nested" },
          ],
        })}
        activeDecisions={[primaryDecision]}
      />,
    );

    expect(screen.getAllByRole("alert").map((alert) => alert.textContent?.trim())).toEqual([
      "unreadable-entry: Mods/Blocked.x2proj",
      "depth-limit-reached: Mods/Deep/Nested",
    ]);

    rerender(
      <Xcom2ProjectRecognitionPanel
        snapshot={snapshot({ issues: [] })}
        activeDecisions={[primaryDecision]}
      />,
    );

    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(screen.queryByText(/no issues|issue-free|all entries readable/iu)).toBeNull();
  });

  it("exposes zero interactive actions", () => {
    const { container } = render(
      <Xcom2ProjectRecognitionPanel
        snapshot={snapshot({
          issues: [{ kind: "unreadable-subtree", relativePath: "Mods/Restricted" }],
        })}
        activeDecisions={[primaryDecision, secondaryDecision]}
      />,
    );

    expect(
      container.querySelectorAll(
        'button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]',
      ),
    ).toHaveLength(0);
    expect(
      screen
        .getAllByText(/build|problems|logs|language support|actions/iu)
        .map((limitation) => limitation.textContent),
    ).toEqual([recognitionLimitation, recognitionLimitation]);
  });
});
