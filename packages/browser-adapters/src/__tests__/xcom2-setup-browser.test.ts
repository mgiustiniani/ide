import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserXcom2SetupAdapter,
  BrowserXcom2SetupUnavailableError,
  createBrowserAdapters,
} from "../index";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BrowserXcom2SetupAdapter", () => {
  it.each([
    ["prepare", (adapter: BrowserXcom2SetupAdapter) => adapter.prepare({} as never)],
    ["approve", (adapter: BrowserXcom2SetupAdapter) => adapter.approve({} as never)],
    ["apply", (adapter: BrowserXcom2SetupAdapter) => adapter.apply({} as never)],
    ["cancel", (adapter: BrowserXcom2SetupAdapter) => adapter.cancel({} as never)],
    ["rollback", (adapter: BrowserXcom2SetupAdapter) => adapter.rollback({} as never)],
    ["recover", (adapter: BrowserXcom2SetupAdapter) => adapter.recover({} as never)],
  ] as const)("rejects %s with a typed desktop-only error", async (operation, invoke) => {
    const promise = invoke(new BrowserXcom2SetupAdapter());

    await expect(promise).rejects.toBeInstanceOf(BrowserXcom2SetupUnavailableError);
    await expect(promise).rejects.toMatchObject({
      name: "BrowserXcom2SetupUnavailableError",
      code: "BROWSER_XCOM2_SETUP_UNAVAILABLE",
      operation,
      message: expect.stringMatching(/cannot .*xcom 2 setup transaction.*browser.*desktop-only/is),
    });
  });

  it("getTransaction explicitly reports native unavailability without a fake transaction", async () => {
    const result = await new BrowserXcom2SetupAdapter().getTransaction({
      transactionId: "does-not-exist",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "native-unavailable",
        message: expect.stringMatching(/desktop-only.*unavailable.*browser/i),
        recoveryGuidance: [expect.stringMatching(/desktop application/i)],
      },
    });
    expect(result).not.toHaveProperty("value");
    expect(result.ok || result.error).not.toHaveProperty("transaction");
  });

  it("listTransactions explicitly reports native unavailability without an empty fake history", async () => {
    const result = await new BrowserXcom2SetupAdapter().listTransactions({
      workspaceId: "workspace-1",
      limit: 10,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "native-unavailable",
        message: expect.stringMatching(/desktop-only.*unavailable.*browser/i),
      },
    });
    expect(result).not.toHaveProperty("value");
    expect(result.ok || result.error).not.toHaveProperty("transaction");
  });

  it("emits no simulated mutation events and returns an idempotent unsubscribe without I/O", () => {
    const storageGetSpy = vi.spyOn(globalThis.localStorage, "getItem");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const listener = vi.fn();

    const unsubscribe = new BrowserXcom2SetupAdapter().subscribe(
      { workspaceId: "workspace-1" },
      listener,
    );

    expect(listener).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageGetSpy).not.toHaveBeenCalled();
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it("contains no native, filesystem, network, timer, or Tauri implementation imports", () => {
    const source = readFileSync(resolve(__dirname, "../xcom2-setup-browser.ts"), "utf8");

    expect(source).not.toMatch(
      /@tauri-apps\/api|node:(?:fs|child_process|net)|invokeTauri|\bfetch\s*\(|\bset(?:Timeout|Interval)\s*\(/,
    );
  });

  it("is exported by the browser factory", () => {
    expect(createBrowserAdapters().xcom2SetupAdapter).toBeInstanceOf(BrowserXcom2SetupAdapter);
  });
});
