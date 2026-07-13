import {
  XCOM2_STEAM_PRODUCTS,
  type Xcom2SetupMonitorSnapshot,
  type Xcom2SetupPrepareRequest,
  type Xcom2SteamProductStatus,
} from "@ide/contracts";
import { describe, expect, it } from "vitest";

import { createXcom2SetupPlan } from "./setup-planner";

const checkedAt = "2026-07-11T20:00:00.000Z";

function product(
  key: keyof typeof XCOM2_STEAM_PRODUCTS,
  complete: boolean,
): Xcom2SteamProductStatus {
  const identity = XCOM2_STEAM_PRODUCTS[key];
  return {
    product: identity,
    lifecycle: complete ? "installed" : "downloading",
    installDirectoryPresent: complete,
    downloadDirectoryPresent: !complete,
    complete,
    completionReasons: [complete ? "Complete" : "Download is incomplete"],
    stable: complete,
    stabilityReasons: [complete ? "Stable" : "Steam is writing download data"],
    mutationBlocked: true,
    mutationBlockedReasons: ["Setup application is not available in the monitor slice"],
    checkedAt,
  };
}

function snapshot(ready: boolean): Xcom2SetupMonitorSnapshot {
  return {
    workspaceId: "workspace-xcom",
    generation: 4,
    steamRoot: {
      source: "platform-default",
      displayRoot: "Primary Steam library",
      pathRedacted: true,
    },
    products: [
      product("game", ready),
      product("wotcDevelopmentTools", ready),
      product("vanillaDevelopmentTools", false),
    ],
    overallState: ready ? "ready" : "downloading",
    canPlanSetup: ready,
    canApplySetup: false,
    blockers: ready ? [] : ["Required downloads are incomplete"],
    warnings: [],
    checkedAt,
  };
}

describe("createXcom2SetupPlan", () => {
  it("creates a waiting plan without executable steps while downloads are incomplete", () => {
    const plan = createXcom2SetupPlan(snapshot(false), "2026-07-11T20:01:00Z");

    expect(plan).toMatchObject({
      version: 1,
      workspaceId: "workspace-xcom",
      workspaceGeneration: 4,
      state: "waiting-for-download",
      dryRun: true,
      canApply: false,
      generatedAt: "2026-07-11T20:01:00.000Z",
    });
    expect(plan.steps).toHaveLength(14);
    expect(plan.steps.every((step) => !step.executable)).toBe(true);
    expect(plan.steps.every((step) => step.disposition === "blocked")).toBe(true);
    expect(plan.blockers.join(" ")).toContain("Download is incomplete");
  });

  it("creates an ordered review plan when required products are complete and stable", () => {
    const plan = createXcom2SetupPlan(snapshot(true), "2026-07-11T20:01:00Z");

    expect(plan.state).toBe("planned");
    expect(plan.blockers).toEqual([]);
    expect(plan.steps.map((step) => step.id)).toEqual([
      "verify-downloads",
      "discover-tools",
      "authorize-external-roots",
      "backup-sdk-files",
      "remove-day-zero-references",
      "quarantine-tle-sources",
      "configure-sdk-offline-mode",
      "link-cooked-pc-console",
      "verify-proton-shortcut",
      "provision-proton-prefix",
      "create-build-prefix-copy",
      "create-sdk-alias",
      "write-workspace-configuration",
      "verify-operational-readiness",
    ]);
    expect(plan.steps[0]?.disposition).toBe("already-satisfied");
    expect(plan.dryRun).toBe(true);
    expect(plan.canApply).toBe(false);
    expect(plan.steps.every((step) => step.executable === false)).toBe(true);
    expect(plan.steps.some((step) => step.disposition === "requires-approval")).toBe(true);
    expect(plan.steps.some((step) => step.disposition === "requires-user-action")).toBe(true);
    expect(plan.warnings.at(-1)).toContain("dry-run only");
  });

  it("keeps the reviewable dry-run eligible for native preparation, never direct apply", () => {
    const readySnapshot = snapshot(true);
    const plan = createXcom2SetupPlan(readySnapshot);
    const prepareRequest: Xcom2SetupPrepareRequest = { plan };

    expect(readySnapshot).toMatchObject({ canPlanSetup: true, canApplySetup: false });
    expect(prepareRequest.plan).toBe(plan);
    expect(prepareRequest.plan.state).toBe("planned");
    expect(prepareRequest.plan.canApply).toBe(false);
  });

  it("does not allow optional vanilla SDK state to block a WOTC plan", () => {
    const plan = createXcom2SetupPlan(snapshot(true));

    expect(plan.state).toBe("planned");
    expect(plan.steps[0]?.disposition).toBe("already-satisfied");
  });

  it("does not plan from inconsistent monitor availability", () => {
    const inconsistentSnapshot = { ...snapshot(true), canPlanSetup: false };
    const plan = createXcom2SetupPlan(inconsistentSnapshot);

    expect(plan.state).toBe("waiting-for-download");
    expect(plan.canApply).toBe(false);
  });
});
