import type { ApplyRefactorKitPlanResult, RefactorKitPatchPlan } from "@ide/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExternalJavaImportPreviewDialog } from "../ExternalJavaImportPreviewDialog";

function plan(overrides: Partial<RefactorKitPatchPlan> = {}): RefactorKitPatchPlan {
  return {
    planId: "plan-1",
    status: "ready",
    summary: "Create imported class",
    confidence: 0.92,
    riskLevel: "low",
    evidence: [
      {
        kind: "package-match",
        summary: "Matched selected source tree",
        path: "src/main/java",
        detail: "Strong match",
      },
    ],
    affectedFiles: [
      { change: "create", path: "src/main/java/demo/Imported.java", primary: true },
      { change: "edit", path: "src/main/java/demo/Registry.java", primary: false },
    ],
    placement: { moduleName: "app", sourceRoot: "src/main/java", packageName: "demo" },
    packageChanges: [
      { path: "src/main/java/demo/Imported.java", fromPackage: null, toPackage: "demo" },
    ],
    renderedDiff: '<script>alert("not html")</script>\n+ class Imported {}',
    structuredDiff: [
      {
        path: "src/main/java/demo/Imported.java",
        change: "create",
        hunks: [
          { oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ["+class Imported {}"] },
        ],
      },
    ],
    warnings: ["Review generated imports"],
    diagnosticsAfterPreview: [
      {
        severity: "warning",
        message: "Dependency unresolved",
        path: "Imported.java",
        line: 2,
        code: "JAVA-1",
      },
    ],
    provenance: {
      sourceKind: "clipboard",
      sourceUrl: null,
      detectedLicense: "MIT",
      licensePolicy: "warn",
      notices: ["Keep copyright notice"],
    },
    unresolvedDependencies: ["org.example.Missing"],
    conflicts: [{ kind: "name", summary: "Possible class collision", path: "demo/Imported.java" }],
    refusalReasons: [],
    applyEligibility: { eligible: true, blockers: [] },
    staleness: { stale: false, reasons: [] },
    provider: "RefactorKit",
    providerVersion: "2.0",
    workspaceId: "workspace-1",
    workspaceGeneration: 4,
    selectionGeneration: 7,
    requestId: "request-1",
    ...overrides,
  };
}

const result: ApplyRefactorKitPlanResult = {
  transactionId: "tx-42",
  planId: "plan-1",
  changedFiles: [{ change: "create", path: "src/main/java/demo/Imported.java", primary: true }],
  primaryFile: "src/main/java/demo/Imported.java",
  diagnostics: [],
  provider: "RefactorKit",
  providerVersion: "2.0",
};

function renderDialog(
  props: Partial<React.ComponentProps<typeof ExternalJavaImportPreviewDialog>> = {},
) {
  const onCancel = vi.fn();
  const onApply = vi.fn();
  const currentPlan = props.plan === undefined ? plan() : props.plan;
  const view = render(
    <ExternalJavaImportPreviewDialog
      status="preview"
      selectedTargetDirectory="src/main/java/demo"
      plan={currentPlan}
      onCancel={onCancel}
      onApply={onApply}
      {...props}
    />,
  );
  return { ...view, onCancel, onApply, currentPlan };
}

describe("ExternalJavaImportPreviewDialog", () => {
  it("renders all backend evidence, escaped diffs, and a multi-file primary marker", () => {
    const { container } = renderDialog();
    for (const text of [
      "src/main/java/demo",
      "app",
      "src/main/java",
      "demo",
      "Imported.java",
      "Registry.java",
      "Review generated imports",
      "Dependency unresolved",
      "org.example.Missing",
      "Possible class collision",
      "Matched selected source tree",
      "Keep copyright notice",
    ])
      expect(screen.getAllByText((content) => content.includes(text)).length).toBeGreaterThan(0);
    expect(screen.getByText("Primary file")).toBeDefined();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText((content) => content.includes("<script>alert"))).toBeDefined();
  });

  it("requires per-plan acknowledgement for unknown or high-risk licenses and applies the exact plan", async () => {
    const risky = plan({
      planId: "risky-1",
      riskLevel: "high",
      provenance: {
        sourceKind: "clipboard",
        sourceUrl: null,
        detectedLicense: null,
        licensePolicy: "warn",
        notices: [],
      },
    });
    const { onApply, rerender } = renderDialog({ plan: risky });
    const apply = screen.getByRole("button", { name: "Apply Import" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    await userEvent.click(screen.getByRole("checkbox"));
    expect(apply.disabled).toBe(false);
    await userEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith(risky);

    const next = plan({ planId: "risky-2", riskLevel: "unknown" });
    rerender(
      <ExternalJavaImportPreviewDialog
        status="preview"
        selectedTargetDirectory="src"
        plan={next}
        onCancel={vi.fn()}
        onApply={onApply}
      />,
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Apply Import" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it.each([
    ["refused", plan({ status: "refused", refusalReasons: ["Unsafe rewrite"] })],
    ["preview", plan({ staleness: { stale: true, reasons: ["Workspace changed"] } })],
    [
      "preview",
      plan({ applyEligibility: { eligible: false, blockers: ["Conflict requires resolution"] } }),
    ],
  ] as const)("disables Apply for %s or blocked plans", (status, blockedPlan) => {
    renderDialog({ status, plan: blockedPlan });
    expect(
      (screen.getByRole("button", { name: "Apply Import" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it.each([
    ["refused", "refused", "Backend refused an unsafe placement"],
    ["refused", "stale", "Workspace generation is stale"],
    ["error", "error", "Backend preview failed"],
  ] as const)(
    "retains full %s/%s backend evidence while reporting reasons and disabling Apply",
    (dialogStatus, planStatus, reason) => {
      const nonReadyPlan = plan({
        status: planStatus,
        riskLevel: "high",
        refusalReasons: planStatus === "refused" ? [reason] : [],
        staleness: {
          stale: planStatus === "stale",
          reasons: planStatus === "stale" ? [reason] : [],
        },
        applyEligibility: { eligible: false, blockers: ["Backend apply blocker"] },
        provenance: {
          sourceKind: "clipboard",
          sourceUrl: null,
          detectedLicense: "GPL-3.0-only",
          licensePolicy: "warn",
          notices: ["Copyleft obligations apply"],
        },
      });

      renderDialog({
        status: dialogStatus,
        plan: nonReadyPlan,
        errorMessage: planStatus === "error" ? reason : undefined,
      });

      for (const section of [
        "Plan and placement",
        "Affected files",
        "Package changes",
        "Diff",
        "Evidence and risk",
        "Warnings",
        "Diagnostics",
        "Provenance and license",
        "Unresolved dependencies",
        "Conflicts",
        "Refusal reasons",
        "Staleness",
        "Apply blockers",
      ])
        expect(screen.getByRole("heading", { name: section })).toBeDefined();

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain(reason);
      expect(screen.getByText("GPL-3.0-only")).toBeDefined();
      expect(screen.getByText("Copyleft obligations apply")).toBeDefined();
      expect(screen.getByText("org.example.Missing")).toBeDefined();
      expect(screen.getByText("Possible class collision", { exact: false })).toBeDefined();
      expect(screen.getByText("Matched selected source tree", { exact: false })).toBeDefined();
      expect(screen.getAllByText("Backend apply blocker").length).toBeGreaterThan(0);
      expect(
        (screen.getByRole("button", { name: "Apply Import" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    },
  );

  it("shows a local reason-only refusal accessibly without fabricating plan evidence", () => {
    renderDialog({
      status: "refused",
      plan: null,
      errorMessage: "Clipboard does not contain a Java class.",
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "Clipboard does not contain a Java class.",
    );
    expect(screen.queryByRole("heading", { name: "Plan and placement" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Provenance and license" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Apply Import" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("supports Cancel and Escape", async () => {
    const { onCancel } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("shows the applied transaction and primary file", () => {
    renderDialog({ status: "applied", result });
    expect(screen.getByText((content) => content.includes("tx-42"))).toBeDefined();
    expect(
      screen.getAllByText((content) => content.includes("src/main/java/demo/Imported.java")).length,
    ).toBeGreaterThan(0);
  });

  it.each([
    ["loading", "Generating a safe RefactorKit preview"],
    ["unavailable", "RefactorKit import is unavailable"],
    ["applying", "Applying the approved import transaction"],
    ["error", "Backend failed"],
  ] as const)("presents the %s state", (status, message) => {
    renderDialog({
      status,
      plan: null,
      unavailableReason: "Capability missing",
      errorMessage: "Backend failed",
    });
    expect(screen.getByText((content) => content.includes(message))).toBeDefined();
  });
});
