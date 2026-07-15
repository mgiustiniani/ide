import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { XCOM2_STEAM_PRODUCTS } from "@ide/contracts";

import { BrowserXcom2SetupMonitorAdapter, createBrowserAdapters } from "../index";

const PROGRESS_FIELDS = [
  "stateFlags",
  "bytesDownloaded",
  "bytesToDownload",
  "bytesStaged",
  "bytesToStage",
  "downloadPercentage",
  "stagingPercentage",
  "sizeOnDisk",
  "manifestLastModifiedAt",
  "manifestProvenance",
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BrowserXcom2SetupMonitorAdapter", () => {
  it("reports fixed required products as unavailable without progress or success", async () => {
    const snapshot = await new BrowserXcom2SetupMonitorAdapter().getSnapshot();

    expect(snapshot).toMatchObject({
      workspaceId: "browser-unavailable",
      generation: 0,
      steamRoot: { source: "unknown", pathRedacted: true },
      overallState: "not-found",
      canPlanSetup: false,
      canApplySetup: false,
    });
    expect(snapshot.blockers).toEqual([
      expect.stringMatching(
        /steam manifest.*download monitoring.*desktop-only.*unavailable.*browser/i,
      ),
    ]);
    expect(snapshot.products.map(({ product }) => product)).toEqual([
      XCOM2_STEAM_PRODUCTS.game,
      XCOM2_STEAM_PRODUCTS.wotcDevelopmentTools,
    ]);

    for (const status of snapshot.products) {
      expect(status).toMatchObject({
        lifecycle: "not-found",
        installDirectoryPresent: false,
        downloadDirectoryPresent: false,
        complete: false,
        stable: false,
        mutationBlocked: true,
      });
      expect(status.completionReasons).not.toHaveLength(0);
      expect(status.stabilityReasons).not.toHaveLength(0);
      expect(status.mutationBlockedReasons).not.toHaveLength(0);
      for (const field of PROGRESS_FIELDS) expect(status).not.toHaveProperty(field);
    }

    expect(Date.parse(snapshot.checkedAt)).not.toBeNaN();
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toMatch(/(?:[A-Za-z]:[\\/]|file:|\/home\/)/);
  });

  it("refresh returns the same truthful current snapshot", async () => {
    const adapter = new BrowserXcom2SetupMonitorAdapter();
    const current = await adapter.getSnapshot();

    await expect(adapter.refresh()).resolves.toBe(current);
    await expect(adapter.refresh()).resolves.toEqual(current);
  });

  it("immediately emits once and provides an idempotent unsubscribe without I/O", () => {
    const storageGetSpy = vi.spyOn(globalThis.localStorage, "getItem");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const listener = vi.fn();
    const adapter = new BrowserXcom2SetupMonitorAdapter();

    const unsubscribe = adapter.subscribe(listener);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      type: "snapshot",
      cause: "initial",
      sequence: 1,
      snapshot: expect.objectContaining({
        overallState: "not-found",
        canPlanSetup: false,
        canApplySetup: false,
      }),
    });
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageGetSpy).not.toHaveBeenCalled();
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("contains no native or Tauri imports", () => {
    const sourcePath = process.cwd().endsWith("packages/browser-adapters")
      ? resolve(process.cwd(), "src/xcom2-setup-monitor-browser.ts")
      : process.cwd().endsWith("apps/web")
        ? resolve(
            process.cwd(),
            "../../packages/browser-adapters/src/xcom2-setup-monitor-browser.ts",
          )
        : resolve(process.cwd(), "packages/browser-adapters/src/xcom2-setup-monitor-browser.ts");
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toMatch(/@tauri-apps\/api|node:(?:fs|child_process)|invokeTauri/);
  });

  it("is exported by the browser factory", () => {
    expect(createBrowserAdapters().xcom2SetupMonitorAdapter).toBeInstanceOf(
      BrowserXcom2SetupMonitorAdapter,
    );
  });
});
