import { describe, expect, it } from "vitest";

import {
  canPlanXcom2Setup,
  deriveXcom2ProgressPercentage,
  isSteamByteCount,
  XCOM2_FEATURE_DESCRIPTOR,
  XCOM2_STEAM_PRODUCTS,
  type Xcom2SteamProductStatus,
} from "../xcom2";

describe("XCOM 2 feature metadata", () => {
  it("keeps the first-party feature built in, experimental, and non-removable", () => {
    expect(XCOM2_FEATURE_DESCRIPTOR).toMatchObject({
      id: "ide.xcom2-wotc",
      builtIn: true,
      removable: false,
      status: "experimental",
    });
    expect(XCOM2_FEATURE_DESCRIPTOR.commands.map((command) => command.id)).toContain(
      "ide.xcom2-wotc.planOperationalSetup",
    );
    expect(XCOM2_FEATURE_DESCRIPTOR.settings).toEqual([
      { id: "ide.xcom2-wotc.setupMonitor", displayName: "XCOM 2 Setup Monitor" },
    ]);
    expect("panels" in XCOM2_FEATURE_DESCRIPTOR).toBe(false);
  });

  it("identifies the game and development-tool Steam products", () => {
    expect(XCOM2_STEAM_PRODUCTS.game.appId).toBe(268500);
    expect(XCOM2_STEAM_PRODUCTS.wotcDevelopmentTools.appId).toBe(602410);
    expect(XCOM2_STEAM_PRODUCTS.vanillaDevelopmentTools).toMatchObject({
      appId: 299990,
      role: "related-evidence",
    });
  });
});

function productStatus(
  product: (typeof XCOM2_STEAM_PRODUCTS)[keyof typeof XCOM2_STEAM_PRODUCTS],
  complete: boolean,
  stable = complete,
): Xcom2SteamProductStatus {
  return {
    product,
    lifecycle: complete ? "installed" : "downloading",
    installDirectoryPresent: complete,
    downloadDirectoryPresent: !complete,
    complete,
    completionReasons: [],
    stable,
    stabilityReasons: [],
    mutationBlocked: true,
    mutationBlockedReasons: ["Monitor snapshots cannot authorize mutation"],
    checkedAt: "2026-07-12T00:00:00.000Z",
  };
}

describe("XCOM 2 monitor availability", () => {
  it("allows planning only when all required products are complete and stable", () => {
    const game = productStatus(XCOM2_STEAM_PRODUCTS.game, true);
    const tools = productStatus(XCOM2_STEAM_PRODUCTS.wotcDevelopmentTools, true);

    expect(canPlanXcom2Setup([game, tools])).toBe(true);
    expect(canPlanXcom2Setup([game])).toBe(false);
    expect(
      canPlanXcom2Setup([
        game,
        productStatus(XCOM2_STEAM_PRODUCTS.wotcDevelopmentTools, true, false),
      ]),
    ).toBe(false);
  });

  it("does not require the related vanilla development tools", () => {
    expect(
      canPlanXcom2Setup([
        productStatus(XCOM2_STEAM_PRODUCTS.game, true),
        productStatus(XCOM2_STEAM_PRODUCTS.wotcDevelopmentTools, true),
        productStatus(XCOM2_STEAM_PRODUCTS.vanillaDevelopmentTools, false),
      ]),
    ).toBe(true);
  });
});

describe("Steam byte-count and percentage invariants", () => {
  it("accepts only non-negative safe integers or canonical decimal strings", () => {
    expect(isSteamByteCount(0)).toBe(true);
    expect(isSteamByteCount(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isSteamByteCount("9007199254740992")).toBe(true);

    expect(isSteamByteCount(-1)).toBe(false);
    expect(isSteamByteCount(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isSteamByteCount("01")).toBe(false);
    expect(isSteamByteCount("1.5")).toBe(false);
  });

  it("derives percentages without losing precision for large decimal strings", () => {
    expect(deriveXcom2ProgressPercentage(1, 4)).toBe(25);
    expect(deriveXcom2ProgressPercentage("9007199254740992", "18014398509481984")).toBe(50);
  });

  it("clamps progress and omits percentages with invalid denominators", () => {
    expect(deriveXcom2ProgressPercentage(150, 100)).toBe(100);
    expect(deriveXcom2ProgressPercentage(0, 0)).toBeUndefined();
    expect(deriveXcom2ProgressPercentage(1, "invalid")).toBeUndefined();
  });
});
