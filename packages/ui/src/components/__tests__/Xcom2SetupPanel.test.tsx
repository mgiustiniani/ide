import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  Xcom2SetupMonitorSnapshot,
  Xcom2SetupPlan,
  Xcom2SetupTransactionDetail,
  Xcom2SteamProductStatus,
} from "@ide/contracts";
import { XCOM2_STEAM_PRODUCTS } from "@ide/contracts";
import { describe, expect, it, vi } from "vitest";
import { Xcom2SetupPanel, formatXcom2ByteCount } from "../Xcom2SetupPanel";

const checkedAt = "2026-07-11T18:30:00.000Z";

function productStatus(
  product: (typeof XCOM2_STEAM_PRODUCTS)[keyof typeof XCOM2_STEAM_PRODUCTS],
  overrides: Partial<Xcom2SteamProductStatus> = {},
): Xcom2SteamProductStatus {
  return {
    product,
    lifecycle: "installed",
    stateFlags: 4,
    bytesDownloaded: 1_073_741_824,
    bytesToDownload: 1_073_741_824,
    bytesStaged: 1_073_741_824,
    bytesToStage: 1_073_741_824,
    downloadPercentage: 100,
    stagingPercentage: 100,
    sizeOnDisk: 1_073_741_824,
    installDirectoryPresent: true,
    downloadDirectoryPresent: false,
    manifestLastModifiedAt: checkedAt,
    manifestProvenance: {
      source: "steam-appmanifest",
      displayPath: "Steam manifest (redacted)",
      pathRedacted: true,
    },
    complete: true,
    completionReasons: ["All expected bytes are present"],
    stable: true,
    stabilityReasons: ["No active download detected"],
    mutationBlocked: false,
    mutationBlockedReasons: [],
    checkedAt,
    ...overrides,
  };
}

function snapshot(overrides: Partial<Xcom2SetupMonitorSnapshot> = {}): Xcom2SetupMonitorSnapshot {
  return {
    workspaceId: "workspace-xcom",
    generation: 5,
    steamRoot: {
      source: "platform-default",
      displayRoot: "Steam library (redacted)",
      pathRedacted: true,
    },
    products: [
      productStatus(XCOM2_STEAM_PRODUCTS.game),
      productStatus(XCOM2_STEAM_PRODUCTS.wotcDevelopmentTools),
      productStatus(XCOM2_STEAM_PRODUCTS.vanillaDevelopmentTools),
    ],
    overallState: "ready",
    canPlanSetup: false,
    canApplySetup: false,
    blockers: [],
    warnings: [],
    checkedAt,
    ...overrides,
  };
}

const digestA = "a".repeat(64);
const digestB = "b".repeat(64);

function transaction(
  overrides: Partial<Xcom2SetupTransactionDetail> = {},
): Xcom2SetupTransactionDetail {
  return {
    transactionId: "tx-native-1",
    planId: "plan-native-1",
    planVersion: 1,
    workspaceId: "workspace-xcom",
    workspaceGeneration: 5,
    createdAt: checkedAt,
    updatedAt: checkedAt,
    state: "awaiting-approval",
    executable: true,
    approvedStepIds: ["configure-sdk-offline-mode", "quarantine-tle-sources", "create-sdk-alias"],
    approvedOperationIds: Array.from({ length: 15 }, (_, index) => `operation-${index + 1}`),
    approvedCapabilities: ["patch-sdk-configuration", "quarantine-sdk-file", "manage-sdk-symlink"],
    reviewedOperationDigest: { algorithm: "sha256", digest: digestA },
    journal: {
      scope: "local-machine",
      managedBy: "native",
      redactedLocation: "Native journal (redacted)",
    },
    applyAvailability: { allowed: true, blockers: [] },
    rollbackAvailable: false,
    conflictReasons: [],
    recoveryGuidance: [],
    operations: [
      ...Array.from({ length: 2 }, (_, index) => ({
        operationId: `operation-${index + 1}`,
        stepId: "configure-sdk-offline-mode" as const,
        kind: "atomic-text-config-patch" as const,
        capability: "patch-sdk-configuration" as const,
        summary: "Patch Day0 configuration",
        target: {
          targetId: `day0-${index + 1}`,
          scope: "steam-sdk" as const,
          redactedLabel: "SDK configuration (redacted)",
        },
        support: "supported" as const,
        rollbackSupport: "full" as const,
        status: "previewed" as const,
        journalStatus: "recorded" as const,
        hashValidationStatus: "matched" as const,
        originalHash: { algorithm: "sha256" as const, digest: "1".repeat(64) },
        resultHash: { algorithm: "sha256" as const, digest: "2".repeat(64) },
      })),
      {
        operationId: "operation-3",
        stepId: "configure-sdk-offline-mode",
        kind: "atomic-text-config-patch",
        capability: "patch-sdk-configuration",
        summary: "Patch SourceControl and GameAssetDatabase configuration",
        target: {
          targetId: "source-control",
          scope: "steam-sdk",
          redactedLabel: "SourceControl configuration (redacted)",
        },
        support: "supported",
        rollbackSupport: "full",
        status: "previewed",
        journalStatus: "recorded",
        hashValidationStatus: "matched",
        originalHash: { algorithm: "sha256", digest: "1".repeat(64) },
        resultHash: { algorithm: "sha256", digest: "2".repeat(64) },
      },
      ...Array.from({ length: 11 }, (_, index) => ({
        operationId: `operation-${index + 4}`,
        stepId: "quarantine-tle-sources" as const,
        kind: "quarantine-restore-file" as const,
        capability: "quarantine-sdk-file" as const,
        summary: "Quarantine audited TLE file",
        target: {
          targetId: `tle-${index + 1}`,
          scope: "steam-sdk" as const,
          redactedLabel: "TLE file (redacted)",
        },
        support: "supported" as const,
        rollbackSupport: "full" as const,
        status: "previewed" as const,
        journalStatus: "recorded" as const,
        hashValidationStatus: "matched" as const,
        originalHash: { algorithm: "sha256" as const, digest: "1".repeat(64) },
        resultHash: { algorithm: "sha256" as const, digest: "2".repeat(64) },
      })),
      {
        operationId: "operation-15",
        stepId: "create-sdk-alias",
        kind: "create-restore-symlink",
        capability: "manage-sdk-symlink",
        summary: "Create CookedPCConsole symlink",
        target: {
          targetId: "cooked-pc-console",
          scope: "steam-sdk",
          redactedLabel: "CookedPCConsole link (redacted)",
        },
        support: "supported",
        rollbackSupport: "full",
        status: "previewed",
        journalStatus: "recorded",
        hashValidationStatus: "not-applicable",
      },
    ],
    externalActions: [],
    ...overrides,
  };
}

describe("Xcom2SetupPanel", () => {
  it("identifies the built-in experimental feature and unavailable extension lifecycle", () => {
    render(<Xcom2SetupPanel snapshot={snapshot()} />);

    expect(screen.getByRole("heading", { name: "XCOM 2 WOTC Setup" })).toBeDefined();
    expect(screen.getByText("Built-in · Experimental")).toBeDefined();
    expect(screen.getByText(/ide\.xcom2-wotc/)).toBeDefined();
    expect(
      screen.getByText(/Extension install and remove lifecycle is not available yet/),
    ).toBeDefined();
    expect(screen.queryByText(/non-removable|generic plugin runtime/i)).toBeNull();
  });

  it("renders separate game, WOTC SDK, and optional vanilla tools cards", () => {
    render(<Xcom2SetupPanel snapshot={snapshot()} />);

    const products = screen.getByLabelText("Monitored Steam products");
    expect(within(products).getByRole("heading", { name: "XCOM 2" })).toBeDefined();
    expect(
      within(products).getByRole("heading", {
        name: "XCOM 2: War of the Chosen Development Tools",
      }),
    ).toBeDefined();
    expect(
      within(products).getByRole("heading", { name: "XCOM 2 Development Tools" }),
    ).toBeDefined();
    expect(products.textContent).toContain("Steam AppID 268500 · Required");
    expect(products.textContent).toContain("Steam AppID 602410 · Required");
    expect(products.textContent).toContain("Steam AppID 299990 · Related / optional evidence");
  });

  it("shows live game and SDK download progress, bytes, evidence, presence, and blockers", () => {
    const game = productStatus(XCOM2_STEAM_PRODUCTS.game, {
      lifecycle: "downloading",
      stateFlags: "1026",
      bytesDownloaded: 536_870_912,
      bytesToDownload: 1_073_741_824,
      downloadPercentage: 50,
      bytesStaged: 268_435_456,
      bytesToStage: 1_073_741_824,
      stagingPercentage: 25,
      installDirectoryPresent: false,
      downloadDirectoryPresent: true,
      complete: false,
      completionReasons: ["Game download has not completed"],
      stable: false,
      stabilityReasons: ["Steam is writing download data"],
      mutationBlocked: true,
      mutationBlockedReasons: ["Wait for the game download"],
    });
    const sdk = productStatus(XCOM2_STEAM_PRODUCTS.wotcDevelopmentTools, {
      lifecycle: "staging",
      downloadPercentage: 80,
      stagingPercentage: 40,
      complete: false,
      stable: false,
      mutationBlocked: true,
      mutationBlockedReasons: ["SDK staging is active"],
    });
    render(
      <Xcom2SetupPanel
        snapshot={snapshot({
          products: [game, sdk],
          overallState: "downloading",
          blockers: ["Required Steam downloads are incomplete"],
        })}
      />,
    );

    expect(screen.getByRole("status", { name: "XCOM 2 lifecycle: Downloading" })).toBeDefined();
    expect(
      screen.getByRole("status", {
        name: /War of the Chosen Development Tools lifecycle: Staging/,
      }),
    ).toBeDefined();
    const gameDownload = screen.getByRole("progressbar", { name: "XCOM 2 download progress" });
    expect(gameDownload.getAttribute("aria-valuenow")).toBe("50");
    expect(gameDownload.getAttribute("aria-valuetext")).toBe("50%");
    expect(screen.getByText("512 MB downloaded / 1 GB total")).toBeDefined();
    expect(screen.getByText("256 MB staged / 1 GB total")).toBeDefined();
    expect(screen.getByText("1026")).toBeDefined();
    expect(screen.getByText("Game download has not completed")).toBeDefined();
    expect(screen.getByText("Steam is writing download data")).toBeDefined();
    expect(screen.getByText("Wait for the game download")).toBeDefined();
    expect(screen.getByText("Required Steam downloads are incomplete")).toBeDefined();
    expect(
      screen.getByText(/Setup mutation blocked: Required Steam downloads are incomplete/),
    ).toBeDefined();
  });

  it("reports installed and unreported products without inventing local paths", () => {
    render(
      <Xcom2SetupPanel
        snapshot={snapshot({ products: [productStatus(XCOM2_STEAM_PRODUCTS.game)] })}
      />,
    );

    expect(screen.getByRole("status", { name: "XCOM 2 lifecycle: Installed" })).toBeDefined();
    expect(
      screen.getAllByText("No status was reported for this product in the current snapshot."),
    ).toHaveLength(2);
    expect(screen.getAllByRole("status", { name: /lifecycle: Not Found/ })).toHaveLength(2);
    expect(screen.getByText(/Steam manifest \(redacted\) \(path redacted\)/)).toBeDefined();
    expect(screen.getByText(/Steam library \(redacted\) \(path redacted\)/)).toBeDefined();
  });

  it("enables host-owned dry-run planning and never exposes apply or rollback controls", () => {
    const onPlanSetup = vi.fn();
    const { rerender } = render(
      <Xcom2SetupPanel snapshot={snapshot()} onPlanSetup={onPlanSetup} />,
    );

    const planButton = screen.getByRole("button", { name: "Plan Setup" }) as HTMLButtonElement;
    expect(planButton.disabled).toBe(false);
    expect(screen.getByText("True · dry-run")).toBeDefined();
    expect(screen.getByText("False · monitor snapshot is read-only")).toBeDefined();
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /rollback/i })).toBeNull();

    fireEvent.click(planButton);
    expect(onPlanSetup).toHaveBeenCalledTimes(1);

    rerender(<Xcom2SetupPanel snapshot={snapshot()} />);
    expect(planButton.disabled).toBe(true);
  });

  it("renders an export-safe ordered dry-run plan without executable controls", () => {
    const setupPlan: Xcom2SetupPlan = {
      version: 1,
      planId: "workspace-xcom:5:snapshot",
      workspaceId: "workspace-xcom",
      workspaceGeneration: 5,
      sourceCheckedAt: checkedAt,
      state: "waiting-for-download",
      dryRun: true,
      canApply: false,
      steps: [
        {
          id: "verify-downloads",
          title: "Verify game and SDK downloads",
          disposition: "blocked",
          summary: "Wait for Steam to finish.",
          blockers: ["SDK download is incomplete"],
          executable: false,
        },
      ],
      blockers: ["Required products are incomplete"],
      warnings: ["Dry-run only"],
      generatedAt: checkedAt,
    };

    render(<Xcom2SetupPanel snapshot={snapshot()} plan={setupPlan} />);

    expect(screen.getByRole("heading", { name: "Operational setup plan" })).toBeDefined();
    expect(screen.getByText(/Waiting For Download · dry-run only/)).toBeDefined();
    expect(screen.getByText("No mutations")).toBeDefined();
    expect(screen.getByLabelText("Operational setup steps").textContent).toContain(
      "Verify game and SDK downloads",
    );
    expect(screen.getByText(/Required products are incomplete/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /apply|rollback|resume/i })).toBeNull();
  });

  it("invokes the host refresh callback and disables refresh when unavailable or loading", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<Xcom2SetupPanel snapshot={snapshot()} onRefresh={onRefresh} />);
    const refresh = screen.getByRole("button", { name: "Refresh now" }) as HTMLButtonElement;
    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(<Xcom2SetupPanel snapshot={snapshot()} onRefresh={onRefresh} isLoading />);
    expect(refresh.disabled).toBe(true);
    rerender(<Xcom2SetupPanel snapshot={snapshot()} />);
    expect(refresh.disabled).toBe(true);
  });

  it("renders loading, error, stale, and no-Steam states accessibly", () => {
    const { rerender } = render(<Xcom2SetupPanel isLoading error="Steam monitor unavailable" />);
    expect(screen.getByText("Loading Steam setup status…")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toContain("Steam monitor unavailable");

    rerender(
      <Xcom2SetupPanel snapshot={snapshot({ overallState: "not-found", products: [] })} isStale />,
    );
    expect(screen.getByText(/Stale data:/)).toBeDefined();
    expect(screen.getByText(/Steam products not found/)).toBeDefined();
    expect(screen.getByText(/Steam may be unavailable/)).toBeDefined();
    rerender(<Xcom2SetupPanel />);
    expect(screen.getByText("Setup state unavailable until Steam data is loaded.")).toBeDefined();
  });

  it("provides a keyboard-scrollable region and explicit accessible progress labels", () => {
    render(<Xcom2SetupPanel snapshot={snapshot()} />);
    const details = screen.getByLabelText("XCOM 2 setup monitor details");
    expect(details.getAttribute("tabindex")).toBe("0");
    expect(details.className).toContain("overflow-auto");
    expect(screen.getAllByRole("progressbar")).toHaveLength(6);
    expect(
      screen
        .getByRole("progressbar", { name: "XCOM 2 staging progress" })
        .getAttribute("aria-valuetext"),
    ).toBe("100%");
  });

  it("prepares blocked native transactions without fabricating apply", () => {
    const onPrepare = vi.fn();
    render(
      <Xcom2SetupPanel
        snapshot={snapshot({ overallState: "downloading" })}
        currentTransaction={transaction({
          state: "waiting-for-download",
          reviewedOperationDigest: undefined,
          applyAvailability: {
            allowed: false,
            blockers: ["Required Steam download is incomplete"],
          },
          externalActions: [
            {
              actionId: "download",
              stepId: "verify-downloads",
              kind: "steam-download",
              title: "Complete WOTC SDK download",
              guidance: "Use Steam and refresh when complete",
              status: "in-progress",
            },
          ],
        })}
        onPrepare={onPrepare}
        onApply={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Prepare SDK Setup" }));
    expect(onPrepare).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Apply blocked by native state/).parentElement?.textContent).toContain(
      "Required Steam download is incomplete",
    );
    expect(screen.getByText(/External downloads and grants/)).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Apply SDK Setup" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("summarizes the exact 15-operation SDK scope and excludes external setup work", () => {
    render(<Xcom2SetupPanel currentTransaction={transaction()} onApply={vi.fn()} />);

    const scope = screen.getByRole("region", {
      name: "Exact SDK transaction scope · 15 reversible operations",
    });
    expect(scope.textContent).toContain("2 Day0 configuration patches");
    expect(scope.textContent).toContain("1 SourceControl / GameAssetDatabase configuration patch");
    expect(scope.textContent).toContain("11 TLE file quarantines");
    expect(scope.textContent).toContain("1 CookedPCConsole symlink creation");
    expect(scope.textContent).toContain("Protontricks");
    expect(scope.textContent).toContain("Steam shortcut creation");
    expect(scope.textContent).toContain("Proton prefix setup");
    expect(scope.textContent).toContain("package-manager commands");
    expect(screen.getByText("Captured in the native journal")).toBeDefined();
    expect(
      screen.getByText(/Exact bytes, full hashes, file modes, and path inventory/),
    ).toBeDefined();
  });

  it("shows safe build labels while redacting baseline fingerprints and embedded hashes", () => {
    const operations = transaction().operations.map((operation, index) => ({
      ...operation,
      summary:
        index === 0
          ? `Native patch for SDK build 12345 manifest ${"f".repeat(64)}`
          : operation.summary,
      target: {
        ...operation.target,
        targetId: `steam-sdk:${"e".repeat(64)}`,
        redactedLabel: "XCOM 2 SDK build 12345",
      },
    }));
    render(<Xcom2SetupPanel currentTransaction={transaction({ operations })} />);

    expect(screen.getByText(/XCOM 2 SDK build 12345\. Fingerprints remain redacted/)).toBeDefined();
    expect(screen.getByRole("table", { name: "Native reviewed operations" }).textContent).toContain(
      "manifest [redacted hash]",
    );
    expect(document.body.textContent).not.toContain("f".repeat(64));
    expect(document.body.textContent).not.toContain("e".repeat(64));
  });

  it("keeps apply disabled without executable native evidence or the exact audited scope", () => {
    const { rerender } = render(
      <Xcom2SetupPanel currentTransaction={transaction({ executable: false })} onApply={vi.fn()} />,
    );
    expect(
      (screen.getByRole("button", { name: "Apply SDK Setup" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    rerender(
      <Xcom2SetupPanel
        currentTransaction={transaction({ operations: transaction().operations.slice(0, 14) })}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("required 15-operation SDK scope");
    expect(
      (screen.getByRole("button", { name: "Apply SDK Setup" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: /force/i })).toBeNull();
  });

  it("shows the complete approval digest, abbreviates only operation hashes, and applies the exact binding", async () => {
    const onApply = vi.fn();
    const onCopyDigest = vi.fn();
    render(
      <Xcom2SetupPanel
        currentTransaction={transaction()}
        onApply={onApply}
        onCopyDigest={onCopyDigest}
      />,
    );

    const digestField = screen.getByLabelText("Complete approval digest");
    expect(digestField.textContent?.trim()).toBe(digestA);
    expect(digestField.className).toContain("break-all");
    expect(screen.queryByText("sha256:aaaaaaaa…aaaaaaaa")).toBeNull();
    const operations = screen.getByRole("table", { name: "Native reviewed operations" });
    expect(operations.textContent).toContain("Atomic Text Config Patch");
    expect(operations.textContent).toContain("Patch Day0 configuration");
    expect(operations.textContent).toContain("SDK configuration (redacted)");
    expect(operations.textContent).toContain("11111111…11111111");
    expect(operations.textContent).toContain("22222222…22222222");

    fireEvent.click(screen.getByRole("button", { name: "Copy Digest" }));
    expect(onCopyDigest).toHaveBeenCalledWith(digestA);
    await waitFor(() => expect(screen.getByText("Approval digest copied.")).toBeDefined());

    const apply = screen.getByRole("button", {
      name: "Apply SDK Setup",
    }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    const acknowledgement = screen.getByRole("checkbox", {
      name: /I reviewed transaction/,
    });
    expect(
      acknowledgement.getAttribute("aria-label") ?? acknowledgement.parentElement?.textContent,
    ).toContain("tx-native-1");
    expect(
      acknowledgement.getAttribute("aria-label") ?? acknowledgement.parentElement?.textContent,
    ).toContain(digestA);
    fireEvent.click(acknowledgement);
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith("tx-native-1", digestA);
  });

  it("does not allow a shortened approval digest to satisfy review", () => {
    const shortenedDigest = "aaaaaaaa…aaaaaaaa";
    render(
      <Xcom2SetupPanel
        currentTransaction={transaction({
          reviewedOperationDigest: { algorithm: "sha256", digest: shortenedDigest },
        })}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Complete approval digest").textContent?.trim()).toBe(
      shortenedDigest,
    );
    expect(screen.getByRole("alert").textContent).toContain("complete 64-character");
    expect(screen.queryByRole("checkbox", { name: /I reviewed transaction/ })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Apply SDK Setup" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("resets approval acknowledgement whenever transaction or digest changes", () => {
    const { rerender } = render(
      <Xcom2SetupPanel currentTransaction={transaction()} onApply={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed transaction/ }));
    expect(
      (screen.getByRole("button", { name: "Apply SDK Setup" }) as HTMLButtonElement).disabled,
    ).toBe(false);

    rerender(
      <Xcom2SetupPanel
        currentTransaction={transaction({
          reviewedOperationDigest: { algorithm: "sha256", digest: digestB },
        })}
        onApply={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Apply SDK Setup" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("requires rollback review and presents a repeatable rolled-back/new cycle", () => {
    const onRollback = vi.fn();
    const applied = transaction({
      state: "applied",
      rollbackAvailable: true,
      applyAvailability: { allowed: false, blockers: [] },
    });
    const { rerender } = render(
      <Xcom2SetupPanel currentTransaction={applied} onRollback={onRollback} />,
    );

    expect(screen.queryByRole("button", { name: "Confirm Restore Vanilla SDK" })).toBeNull();
    expect(
      screen.getByText(/External edits cause a conflict and are not overwritten/),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Restore Vanilla SDK" }));
    const confirm = screen.getByRole("button", {
      name: "Confirm Restore Vanilla SDK",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /restoration stops on external edits/ }));
    fireEvent.click(confirm);
    expect(onRollback).toHaveBeenCalledWith("tx-native-1");

    rerender(
      <Xcom2SetupPanel
        currentTransaction={transaction({ state: "rolled-back", rollbackAvailable: false })}
        onPrepare={vi.fn()}
      />,
    );
    expect(screen.getByText(/Vanilla SDK baseline restored/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Prepare Again" })).toBeDefined();
    rerender(
      <Xcom2SetupPanel
        currentTransaction={transaction({ transactionId: "tx-native-2" })}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getAllByText("tx-native-2").length).toBeGreaterThan(0);
  });

  it("shows conflict recovery and only valid cancel/recovery controls", () => {
    const onRecover = vi.fn();
    const { rerender } = render(
      <Xcom2SetupPanel
        currentTransaction={transaction({
          state: "rollback-conflict",
          rollbackAvailable: false,
          conflictReasons: ["External edit detected"],
          recoveryGuidance: ["Review the external edit before retrying"],
        })}
        onRecover={onRecover}
        onCancel={vi.fn()}
        onRollback={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("External edit detected");
    expect(screen.queryByRole("button", { name: "Recover transaction" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel transaction" })).toBeNull();
    expect(screen.queryByRole("button", { name: /restore|rollback/i })).toBeNull();

    rerender(
      <Xcom2SetupPanel
        currentTransaction={transaction({ state: "recovery-required" })}
        onRecover={onRecover}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Recover transaction" }));
    expect(onRecover).toHaveBeenCalledWith("tx-native-1");

    const onCancel = vi.fn();
    rerender(<Xcom2SetupPanel currentTransaction={transaction()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel transaction" }));
    expect(onCancel).toHaveBeenCalledWith("tx-native-1");
    expect(screen.queryByRole("button", { name: "Recover transaction" })).toBeNull();
  });

  it("renders accessible transaction progress, history, and redacts unsafe paths", () => {
    render(
      <Xcom2SetupPanel
        currentTransaction={transaction({
          recoveryGuidance: ["Inspect /home/private/game/config.ini"],
        })}
        transactions={[
          transaction(),
          transaction({ transactionId: "tx-old", state: "rolled-back" }),
        ]}
        transactionProgressEvent={{
          transactionId: "tx-native-1",
          sequence: 2,
          occurredAt: checkedAt,
          kind: "operation-progress",
          state: "applying",
          terminal: false,
          completedOperations: 1,
          totalOperations: 2,
          message: "Updated C:\\Users\\secret\\config.ini",
        }}
      />,
    );
    expect(screen.getByText(/1 of 2 operations/).textContent).toContain("1 of 2 operations");
    expect(screen.getByLabelText("Setup transaction history").textContent).toContain("tx-old");
    expect(screen.queryByText(/home\/private|Users\\secret/)).toBeNull();
    expect(screen.getAllByText(/\[redacted path\]/).length).toBeGreaterThan(0);
  });

  it("formats byte counts without unsafe numeric conversion", () => {
    expect(formatXcom2ByteCount(undefined)).toBe("Unknown");
    expect(formatXcom2ByteCount(0)).toBe("0 B");
    expect(formatXcom2ByteCount("1125899906842624")).toBe("1 PB");
  });
});
