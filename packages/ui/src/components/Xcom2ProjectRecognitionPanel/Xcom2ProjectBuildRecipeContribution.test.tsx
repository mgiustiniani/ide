import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Xcom2ModuleActivationSnapshot, Xcom2ProjectActivationDecision } from "@ide/contracts";
import { describe, expect, it, vi } from "vitest";
import type {
  Xcom2ProjectBuildRecipeContributionPresentation,
  Xcom2ProjectBuildRecipeReviewPresentation,
  Xcom2ProjectBuildRecipeViewState,
} from "./Xcom2ProjectBuildRecipeContribution";
import { Xcom2ProjectRecognitionPanel } from "./Xcom2ProjectRecognitionPanel";

const moduleDecision: Xcom2ProjectActivationDecision = {
  moduleRoot: "mods/Current",
  state: "active",
  source: "configured-and-recognized",
  activationConfidence: "explicit",
  recognitionConfidence: "high",
  reasons: [
    { kind: "configuration", target: "wotc" },
    {
      kind: "recognition",
      evidenceKind: "x2proj",
      relativePath: "mods/Current/Current.x2proj",
    },
  ],
};

const recognitionSnapshot: Xcom2ModuleActivationSnapshot = {
  workspaceId: "workspace-1",
  workspaceGeneration: 2,
  scanId: "scan-1",
  scanGeneration: 3,
  state: "active",
  confidence: "high",
  completeness: "complete",
  issues: [],
  limits: { maximumDepth: 8, maximumEncounteredEntries: 20_000 },
  decisions: [],
};

const safeReview: Xcom2ProjectBuildRecipeReviewPresentation = {
  scriptSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  scriptByteSize: 103,
  provenance: "X2ModBuildCommon",
  license: "MIT",
  noticeIdentity: "Applicable attribution: X2ModBuildCommon contributors.",
  action: "Default",
  arguments: [
    { role: "source-directory", valueState: "current-module" },
    { role: "sdk-directory", valueState: "unresolved" },
    { role: "game-directory", valueState: "unresolved" },
    { role: "configuration", valueState: "declared" },
    { role: "build-prefix", valueState: "unresolved" },
    { role: "highlander-source", valueState: "project-local" },
    { role: "highlander-runtime", valueState: "unresolved" },
  ],
  unresolvedPrerequisites: [
    { role: "sdk-directory", state: "unresolved" },
    { role: "game-directory", state: "unresolved" },
    { role: "build-prefix", state: "unresolved" },
    { role: "build-tool", state: "unresolved" },
    { role: "highlander-runtime", state: "unresolved" },
  ],
};

type AvailableState = Exclude<Xcom2ProjectBuildRecipeViewState, { readonly kind: "unavailable" }>;

function availableContribution(
  viewState: AvailableState,
  callbacks: {
    readonly onOpenReview?: () => void;
    readonly onApproveExactRecipe?: () => void;
    readonly onDiscardReview?: () => void;
  } = {},
): Xcom2ProjectBuildRecipeContributionPresentation {
  return {
    moduleRoot: moduleDecision.moduleRoot,
    viewState,
    onOpenReview: callbacks.onOpenReview ?? vi.fn(),
    onApproveExactRecipe: callbacks.onApproveExactRecipe ?? vi.fn(),
    onDiscardReview: callbacks.onDiscardReview ?? vi.fn(),
  };
}

function renderPanel(
  buildRecipeContribution?: Readonly<Xcom2ProjectBuildRecipeContributionPresentation>,
) {
  return render(
    <Xcom2ProjectRecognitionPanel
      snapshot={recognitionSnapshot}
      activeDecisions={[]}
      recognitionSnapshot={recognitionSnapshot}
      activeProjectDecisions={[moduleDecision]}
      buildRecipeContribution={buildRecipeContribution}
    />,
  );
}

function matchingModule(): HTMLElement {
  return screen.getByRole("region", {
    name: "Configured and recognized module mods/Current",
  });
}

function tableRows(table: HTMLElement): string[][] {
  return Array.from(table.querySelectorAll("tbody tr"), (row) =>
    Array.from(row.querySelectorAll("td"), (cell) => cell.textContent?.trim() ?? ""),
  );
}

describe("XCOM 2 project build recipe activity contribution", () => {
  it("preserves the existing project activity card when no contribution is supplied", () => {
    const { container } = renderPanel();

    expect(matchingModule()).toBeDefined();
    expect(screen.queryByText("Default Build recipe", { exact: true })).toBeNull();
    expect(container.querySelectorAll("button, [role='button']")).toHaveLength(0);
    expect(screen.getByText(/Recognition only: no Build, Problems, Logs/iu)).toBeDefined();
  });

  it("reports unavailable honestly without exposing a review action or invoking callbacks", () => {
    renderPanel({
      moduleRoot: moduleDecision.moduleRoot,
      viewState: { kind: "unavailable", code: "browser-unavailable" },
    });

    expect(screen.getByRole("status").textContent).toBe(
      "Build recipe review is unavailable in the browser.",
    );
    expect(screen.queryByRole("button", { name: "Default Build recipe" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Default Build recipe" })).toBeNull();
    expect(screen.queryByText(/approved|succeeded|successful/iu)).toBeNull();
  });

  it("exposes the exact accessible module action only for a matching supported module", () => {
    const onOpenReview = vi.fn();
    const { rerender } = renderPanel(availableContribution({ kind: "idle" }, { onOpenReview }));

    const action = within(matchingModule()).getByRole("button", {
      name: "Default Build recipe",
    });
    expect(action.tabIndex).toBeGreaterThanOrEqual(0);
    action.focus();
    fireEvent.click(action);
    expect(onOpenReview).toHaveBeenCalledTimes(1);
    expect(onOpenReview).toHaveBeenCalledWith();

    rerender(
      <Xcom2ProjectRecognitionPanel
        snapshot={recognitionSnapshot}
        activeDecisions={[]}
        recognitionSnapshot={recognitionSnapshot}
        activeProjectDecisions={[moduleDecision]}
        buildRecipeContribution={{
          ...availableContribution({ kind: "idle" }),
          moduleRoot: "mods/Other",
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Default Build recipe" })).toBeNull();
  });

  it("renders inspecting as busy and blocked without starting another inspection", () => {
    const onOpenReview = vi.fn();
    renderPanel(availableContribution({ kind: "inspecting" }, { onOpenReview }));

    const action = screen.getByRole("button", { name: "Default Build recipe" });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    expect(action.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Execution blocked");
    fireEvent.click(action);
    expect(onOpenReview).not.toHaveBeenCalled();
  });

  it("presents only bounded review metadata, ordered roles and ordered unresolved prerequisites", () => {
    const forbidden = {
      rawCommand: "pwsh .scripts/build.ps1 -Sdk C:\\secret-sdk",
      scriptBytes: "STORY_BUILD_SCRIPT_CANARY_MUST_NOT_RUN",
      executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      absolutePath: "/home/person/private/game",
      sdkValue: "C:\\private-sdk",
      gameValue: "D:\\private-game",
      prefixValue: "/private/prefix",
      proprietaryValue: "proprietary-game-byte",
    };
    const reviewWithForbiddenExtraFields = {
      ...safeReview,
      ...forbidden,
    } as Xcom2ProjectBuildRecipeReviewPresentation;
    const { container } = renderPanel(
      availableContribution({ kind: "review-ready", review: reviewWithForbiddenExtraFields }),
    );

    const review = screen.getByRole("region", { name: "Default Build recipe" });
    expect(within(review).getByText(".scripts/build.ps1", { exact: true })).toBeDefined();
    expect(within(review).getByText(safeReview.scriptSha256, { exact: true })).toBeDefined();
    expect(within(review).getByText("103", { exact: true })).toBeDefined();
    expect(within(review).getByText("Default", { exact: true })).toBeDefined();
    expect(
      within(review).getByText("X2ModBuildCommon, MIT-licensed", { exact: true }),
    ).toBeDefined();
    expect(within(review).getByText(safeReview.noticeIdentity, { exact: true })).toBeDefined();
    expect(within(review).getByText("Execution blocked", { exact: true })).toBeDefined();
    expect(review.textContent).toContain("untrusted project input");
    expect(review.textContent).toContain("will not be executed");

    expect(
      tableRows(
        within(review).getByRole("table", {
          name: "Default Build recipe structured arguments",
        }),
      ),
    ).toEqual(safeReview.arguments.map(({ role, valueState }) => [role, valueState]));
    expect(
      tableRows(
        within(review).getByRole("table", {
          name: "Default Build recipe unresolved prerequisites",
        }),
      ),
    ).toEqual(safeReview.unresolvedPrerequisites.map(({ role, state }) => [role, state]));

    for (const value of Object.values(forbidden))
      expect(container.textContent).not.toContain(value);
    for (const name of ["Build", "Run", "Deploy", "Cook", "Launch", "Execute"]) {
      expect(within(review).queryByRole("button", { name })).toBeNull();
      expect(within(review).queryByRole("link", { name })).toBeNull();
    }
    expect(
      within(review)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim()),
    ).toEqual(["Approve exact recipe", "Discard"]);
  });

  it("fails closed on unsafe presentation metadata without leaking it or exposing approval", () => {
    const onApproveExactRecipe = vi.fn();
    const absoluteNotice = "C:\\Users\\person\\private\\NOTICE.txt";
    renderPanel(
      availableContribution(
        {
          kind: "review-ready",
          review: { ...safeReview, noticeIdentity: absoluteNotice },
        },
        { onApproveExactRecipe },
      ),
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "Build recipe review was refused because its safe metadata is invalid.",
    );
    expect(document.body.textContent).not.toContain(absoluteNotice);
    expect(screen.queryByRole("button", { name: "Approve exact recipe" })).toBeNull();
    expect(onApproveExactRecipe).not.toHaveBeenCalled();
  });

  it("disables approval before calling the explicit callback and starts it only once", () => {
    let disabledAtCallback = false;
    const onApproveExactRecipe = vi.fn(() => {
      disabledAtCallback = (
        screen.getByRole("button", { name: "Approve exact recipe" }) as HTMLButtonElement
      ).disabled;
    });
    renderPanel(
      availableContribution({ kind: "review-ready", review: safeReview }, { onApproveExactRecipe }),
    );

    const approveButton = screen.getByRole("button", {
      name: "Approve exact recipe",
    }) as HTMLButtonElement;
    fireEvent.click(approveButton);
    fireEvent.click(approveButton);

    expect(disabledAtCallback).toBe(true);
    expect(approveButton.disabled).toBe(true);
    expect(onApproveExactRecipe).toHaveBeenCalledTimes(1);
    expect(onApproveExactRecipe).toHaveBeenCalledWith();
  });

  it("distinguishes approval from execution success and keeps every execution action absent", () => {
    const onApproveExactRecipe = vi.fn();
    renderPanel(
      availableContribution({ kind: "approved", review: safeReview }, { onApproveExactRecipe }),
    );

    expect(screen.getByRole("status").textContent?.trim()).toBe(
      "Recipe approved; execution remains unavailable",
    );
    expect(screen.getByText("Execution blocked", { exact: true })).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Approve exact recipe" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Approve exact recipe" }));
    expect(onApproveExactRecipe).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(
      /(?:Build|Run) (?:succeeded|successful|complete)/iu,
    );
    expect(screen.queryByRole("button", { name: /^(?:Build|Run|Execute)$/u })).toBeNull();
  });

  it.each([
    [
      { kind: "revoked", code: "recipe-changed" } as const,
      "Exact recipe approval was revoked because the reviewed recipe changed.",
    ],
    [
      { kind: "refused", code: "recipe-invalid" } as const,
      "Build recipe review was refused because its safe metadata is invalid.",
    ],
    [
      { kind: "error", code: "inspection-failed" } as const,
      "Build recipe inspection could not be completed safely.",
    ],
  ])("renders a bounded %s message without raw error details", (viewState, expected) => {
    renderPanel(availableContribution(viewState));

    expect(screen.getByRole("alert").textContent).toBe(expected);
    expect(document.body.textContent).not.toContain("C:\\Users\\person\\secret");
    expect(document.body.textContent).not.toContain("stack trace");
    expect(screen.getByRole("button", { name: "Default Build recipe" })).toBeDefined();
  });
});
