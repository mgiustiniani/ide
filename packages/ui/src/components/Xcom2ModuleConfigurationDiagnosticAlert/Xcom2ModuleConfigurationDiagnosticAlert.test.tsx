import React from "react";
import { render, screen, within } from "@testing-library/react";
import type { Xcom2ModuleConfigurationDiagnosticPresentation } from "@ide/contracts";
import { describe, expect, it } from "vitest";
import { Xcom2ModuleConfigurationDiagnosticAlert } from "./Xcom2ModuleConfigurationDiagnosticAlert";

const diagnosticPresentation = {
  title: "XCOM 2 project configuration needs attention",
  projectFileLabel: ".ide/xcom2.json",
  summary: "The XCOM 2 project configuration is not valid JSON.",
  remediation:
    "Correct the JSON syntax so the file contains one complete JSON object, then refresh the workspace.",
  supportIdentifier: "configuration-invalid-json",
} as const satisfies Xcom2ModuleConfigurationDiagnosticPresentation;

function definitionList(alert: HTMLElement): {
  readonly terms: (string | null)[];
  readonly descriptions: (string | null)[];
} {
  return {
    terms: Array.from(alert.querySelectorAll("dt"), (term) => term.textContent),
    descriptions: Array.from(
      alert.querySelectorAll("dd"),
      (description) => description.textContent,
    ),
  };
}

describe("Xcom2ModuleConfigurationDiagnosticAlert", () => {
  it("renders one atomic, non-interactive alert with the complete supplied presentation", () => {
    const before = structuredClone(diagnosticPresentation);
    const { container } = render(
      <Xcom2ModuleConfigurationDiagnosticAlert {...diagnosticPresentation} />,
    );

    const alert = screen.getByRole("alert");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(alert.getAttribute("aria-atomic")).toBe("true");
    expect(
      within(alert).getByRole("heading", {
        name: "XCOM 2 project configuration needs attention",
      }),
    ).toBeDefined();
    expect(definitionList(alert)).toEqual({
      terms: ["Project file", "Summary", "Remediation", "Support identifier"],
      descriptions: [
        ".ide/xcom2.json",
        "The XCOM 2 project configuration is not valid JSON.",
        "Correct the JSON syntax so the file contains one complete JSON object, then refresh the workspace.",
        "configuration-invalid-json",
      ],
    });
    expect(Array.from(alert.querySelectorAll("code"), (code) => code.textContent)).toEqual([
      ".ide/xcom2.json",
      "configuration-invalid-json",
    ]);
    expect(within(alert).queryAllByRole("alert")).toHaveLength(0);
    expect(
      container.querySelectorAll(
        'button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]',
      ),
    ).toHaveLength(0);
    expect(diagnosticPresentation).toEqual(before);
  });
});
