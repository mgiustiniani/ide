import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TauriAdapterError } from "./errors";
import { TauriXcom2SetupMonitorAdapter } from "./xcom2-setup-monitor-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);
const checkedAt = "2026-07-11T12:00:00Z";

const identities = {
  game: { appId: 268500, name: "XCOM 2", kind: "game", role: "required" },
  sdk: {
    appId: 602410,
    name: "XCOM 2: War of the Chosen Development Tools",
    kind: "development-tools",
    role: "required",
  },
  vanilla: {
    appId: 299990,
    name: "XCOM 2 Development Tools",
    kind: "development-tools",
    role: "related-evidence",
  },
};

function missing(product = identities.vanilla) {
  return {
    product,
    lifecycle: "not-found",
    installDirectoryPresent: false,
    downloadDirectoryPresent: false,
    complete: false,
    completionReasons: ["Steam appmanifest was not found"],
    stable: false,
    stabilityReasons: ["Product state is unavailable"],
    mutationBlocked: true,
    mutationBlockedReasons: ["Product is unavailable", "This built-in monitor is read-only"],
    checkedAt,
  };
}

function installed(product = identities.sdk, stable = true) {
  const evidence = {
    268500: {
      downloaded: 4516434416,
      staged: 7744572421,
      size: 80307041250,
      modified: "2026-07-11T21:53:23Z",
    },
    602410: {
      downloaded: 62170182016,
      staged: 98312248148,
      size: 99841776336,
      modified: "2026-07-12T06:25:08Z",
    },
    299990: {
      downloaded: 45815110176,
      staged: 70350735599,
      size: 70350735599,
      modified: "2026-07-11T17:37:10Z",
    },
  }[product.appId]!;
  return {
    product,
    manifestProvenance: {
      source: "steam-appmanifest",
      displayPath: `appmanifest_${product.appId}.acf`,
      pathRedacted: true,
    },
    lifecycle: "installed",
    stateFlags: 4,
    bytesDownloaded: evidence.downloaded,
    bytesToDownload: evidence.downloaded,
    downloadPercentage: 100,
    bytesStaged: evidence.staged,
    bytesToStage: evidence.staged,
    stagingPercentage: 100,
    sizeOnDisk: evidence.size,
    installDirectoryPresent: true,
    downloadDirectoryPresent: false,
    manifestLastModifiedAt: evidence.modified,
    complete: true,
    completionReasons: ["Steam reports a fully installed product with no pending byte counters"],
    stable,
    stabilityReasons: [
      stable ? "Manifest is complete and has no recent activity" : "Manifest changed recently",
    ],
    mutationBlocked: true,
    mutationBlockedReasons: ["This built-in monitor is read-only"],
    checkedAt,
  };
}

function downloading(product = identities.game) {
  return {
    product,
    manifestProvenance: {
      source: "steam-appmanifest",
      displayPath: `appmanifest_${product.appId}.acf`,
      pathRedacted: true,
    },
    lifecycle: "downloading",
    stateFlags: "9007199254740993",
    bytesDownloaded: "9007199254740993",
    bytesToDownload: "18014398509481986",
    downloadPercentage: 50,
    bytesStaged: 0,
    bytesToStage: 0,
    sizeOnDisk: "9007199254740993",
    installDirectoryPresent: false,
    downloadDirectoryPresent: true,
    manifestLastModifiedAt: checkedAt,
    complete: false,
    completionReasons: ["Download byte counters are incomplete"],
    stable: false,
    stabilityReasons: ["Manifest changed recently"],
    mutationBlocked: true,
    mutationBlockedReasons: ["Product is incomplete or unstable"],
    checkedAt,
  };
}

function activeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "workspace-1",
    generation: 7,
    steamRoot: {
      source: "platform-default",
      displayRoot: "Primary Steam library",
      pathRedacted: true,
    },
    products: [downloading(), installed(), missing()],
    overallState: "downloading",
    canPlanSetup: false,
    canApplySetup: false,
    blockers: ["XCOM 2 download or installation is incomplete", "XCOM 2 is not stable"],
    warnings: [],
    checkedAt,
    ...overrides,
  };
}

function readySnapshot(overrides: Record<string, unknown> = {}) {
  return activeSnapshot({
    products: [installed(identities.game), installed(), installed(identities.vanilla)],
    overallState: "ready",
    canPlanSetup: true,
    blockers: [],
    ...overrides,
  });
}

function blockedSnapshot(overrides: Record<string, unknown> = {}) {
  return activeSnapshot({
    products: [installed(identities.game), installed(identities.sdk, false), missing()],
    overallState: "incomplete",
    canPlanSetup: false,
    blockers: ["XCOM 2: War of the Chosen Development Tools is not stable"],
    ...overrides,
  });
}

function event(sequence: number, eventSnapshot = activeSnapshot(), cause = "poll") {
  return { type: "snapshot", cause, sequence, snapshot: eventSnapshot };
}

async function startPoll(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("TauriXcom2SetupMonitorAdapter snapshots", () => {
  beforeEach(() => invokeMock.mockReset());

  it("maps getSnapshot and refresh to exact no-argument commands", async () => {
    invokeMock.mockResolvedValue(activeSnapshot());
    const adapter = new TauriXcom2SetupMonitorAdapter();
    await adapter.getSnapshot();
    await adapter.refresh();
    expect(invokeMock.mock.calls).toEqual([
      ["get_xcom2_setup_monitor_snapshot", undefined],
      ["refresh_xcom2_setup_monitor_snapshot", undefined],
    ]);
  });

  it("normalizes a current-like active download without losing large byte precision", async () => {
    invokeMock.mockResolvedValueOnce(activeSnapshot());
    const result = await new TauriXcom2SetupMonitorAdapter().getSnapshot();
    expect(result).toMatchObject({
      workspaceId: "workspace-1",
      generation: 7,
      overallState: "downloading",
      steamRoot: {
        source: "platform-default",
        displayRoot: "Primary Steam library",
        pathRedacted: true,
      },
      canPlanSetup: false,
      canApplySetup: false,
    });
    expect(result.products[0]).toMatchObject({
      product: identities.game,
      lifecycle: "downloading",
      bytesDownloaded: "9007199254740993",
      bytesToDownload: "18014398509481986",
      downloadPercentage: 50,
      stateFlags: "9007199254740993",
      mutationBlocked: true,
    });
    expect(result.products[1]?.manifestLastModifiedAt).toBe("2026-07-12T06:25:08.000Z");
    expect(result.checkedAt).toBe("2026-07-11T12:00:00.000Z");
  });

  it("accepts ready planning evidence with exact live-shaped complete products", async () => {
    invokeMock.mockResolvedValueOnce(readySnapshot());
    const result = await new TauriXcom2SetupMonitorAdapter().getSnapshot();
    expect(result).toMatchObject({
      overallState: "ready",
      canPlanSetup: true,
      canApplySetup: false,
      blockers: [],
    });
    expect(result.products).toEqual([
      {
        ...installed(identities.game),
        manifestLastModifiedAt: "2026-07-11T21:53:23.000Z",
        checkedAt: "2026-07-11T12:00:00.000Z",
      },
      {
        ...installed(),
        manifestLastModifiedAt: "2026-07-12T06:25:08.000Z",
        checkedAt: "2026-07-11T12:00:00.000Z",
      },
      {
        ...installed(identities.vanilla),
        manifestLastModifiedAt: "2026-07-11T17:37:10.000Z",
        checkedAt: "2026-07-11T12:00:00.000Z",
      },
    ]);
  });

  it.each([
    ["active download", activeSnapshot(), "downloading"],
    ["blocked unstable SDK", blockedSnapshot(), "incomplete"],
    [
      "missing required game",
      activeSnapshot({
        products: [missing(identities.game), installed(), missing()],
        overallState: "not-found",
      }),
      "not-found",
    ],
  ])("accepts %s with planning and apply unavailable", async (_name, response, overallState) => {
    invokeMock.mockResolvedValueOnce(response);
    await expect(new TauriXcom2SetupMonitorAdapter().getSnapshot()).resolves.toMatchObject({
      overallState,
      canPlanSetup: false,
      canApplySetup: false,
    });
  });

  it.each([
    [
      "out-of-range percentage",
      () =>
        activeSnapshot({
          products: [{ ...downloading(), downloadPercentage: 101 }, installed(), missing()],
        }),
    ],
    [
      "percentage inconsistent with bytes",
      () =>
        activeSnapshot({
          products: [{ ...downloading(), downloadPercentage: 49 }, installed(), missing()],
        }),
    ],
    [
      "unsafe manifest path",
      () =>
        activeSnapshot({
          products: [
            {
              ...downloading(),
              manifestProvenance: {
                source: "steam-appmanifest",
                displayPath: "/home/user/appmanifest.acf",
                pathRedacted: true,
              },
            },
            installed(),
            missing(),
          ],
        }),
    ],
    [
      "unsafe Steam root",
      () =>
        activeSnapshot({
          steamRoot: {
            source: "platform-default",
            displayRoot: "C:\\Users\\me\\Steam",
            pathRedacted: true,
          },
        }),
    ],
    [
      "unredacted provenance",
      () => activeSnapshot({ steamRoot: { source: "platform-default", pathRedacted: false } }),
    ],
    [
      "unsafe byte number",
      () =>
        activeSnapshot({
          products: [
            { ...downloading(), bytesDownloaded: 9007199254740992 },
            installed(),
            missing(),
          ],
        }),
    ],
    ["malformed timestamp", () => activeSnapshot({ checkedAt: "today" })],
    [
      "complete downloading lifecycle",
      () =>
        activeSnapshot({
          products: [{ ...downloading(), complete: true }, installed(), missing()],
        }),
    ],
    [
      "stable incomplete product",
      () =>
        activeSnapshot({ products: [{ ...downloading(), stable: true }, installed(), missing()] }),
    ],
    [
      "not-found product with byte evidence",
      () =>
        activeSnapshot({
          products: [downloading(), installed(), { ...missing(), bytesDownloaded: 1 }],
        }),
    ],
    ["overall state conflict", () => activeSnapshot({ overallState: "ready" })],
    ["planning true while active", () => activeSnapshot({ canPlanSetup: true })],
    ["planning false while ready", () => readySnapshot({ canPlanSetup: false })],
    ["monitor apply unexpectedly available", () => readySnapshot({ canApplySetup: true })],
    [
      "duplicate required identity",
      () => activeSnapshot({ products: [downloading(), installed(identities.game), missing()] }),
    ],
    ["missing required SDK", () => activeSnapshot({ products: [downloading(), missing()] })],
    [
      "altered fixed identity",
      () =>
        activeSnapshot({
          products: [downloading({ ...identities.game, name: "Other" }), installed(), missing()],
        }),
    ],
  ])("rejects %s", async (_name, response) => {
    invokeMock.mockResolvedValueOnce(response());
    await expect(new TauriXcom2SetupMonitorAdapter().getSnapshot()).rejects.toBeInstanceOf(
      TauriAdapterError,
    );
  });
});

describe("TauriXcom2SetupMonitorAdapter polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "document");
  });

  it("uses one shared bounded polling loop, advances material sequence, and cleans up", async () => {
    invokeMock.mockResolvedValueOnce([event(1)]).mockResolvedValueOnce([event(1), event(3)]);
    const adapter = new TauriXcom2SetupMonitorAdapter({ pollIntervalMs: 50, pollLimit: 17 });
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = adapter.subscribe(first);
    const unsubscribeSecond = adapter.subscribe(second);
    await startPoll();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenLastCalledWith("poll_xcom2_setup_monitor_events", {
      afterSequence: 0,
      limit: 17,
    });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    unsubscribeFirst();
    await vi.advanceTimersByTimeAsync(50);
    expect(invokeMock).toHaveBeenLastCalledWith("poll_xcom2_setup_monitor_events", {
      afterSequence: 1,
      limit: 17,
    });
    expect(second).toHaveBeenCalledTimes(2);
    unsubscribeSecond();
    unsubscribeSecond();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("does not overlap or deliver an in-flight event after unsubscribe", async () => {
    let resolve!: (value: unknown) => void;
    invokeMock.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const listener = vi.fn();
    const unsubscribe = new TauriXcom2SetupMonitorAdapter({ pollIntervalMs: 50 }).subscribe(
      listener,
    );
    await startPoll();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    unsubscribe();
    resolve([event(1)]);
    await Promise.resolve();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  });

  it("backs off after malformed/failing polls and recovers", async () => {
    invokeMock.mockRejectedValueOnce("temporary failure").mockResolvedValueOnce([event(2)]);
    const listener = vi.fn();
    const adapter = new TauriXcom2SetupMonitorAdapter({ pollIntervalMs: 50, maxBackoffMs: 500 });
    const unsubscribe = adapter.subscribe(listener);
    await startPoll();
    await vi.advanceTimersByTimeAsync(99);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ sequence: 2 }));
    unsubscribe();
  });

  it("uses the visibility-aware hidden interval", async () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { visibilityState: "hidden" },
    });
    invokeMock.mockResolvedValue([]);
    const adapter = new TauriXcom2SetupMonitorAdapter({
      pollIntervalMs: 50,
      hiddenPollIntervalMs: 500,
    });
    const unsubscribe = adapter.subscribe(vi.fn());
    await startPoll();
    await vi.advanceTimersByTimeAsync(499);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("suppresses stale generation/workspace events while retaining current events", async () => {
    invokeMock
      .mockResolvedValueOnce(activeSnapshot())
      .mockResolvedValueOnce([
        event(1, activeSnapshot({ generation: 6 })),
        event(2, activeSnapshot({ workspaceId: "stale-workspace", generation: 8 })),
        event(3, activeSnapshot({ generation: 7 }), "refresh"),
      ]);
    const adapter = new TauriXcom2SetupMonitorAdapter({ pollIntervalMs: 50 });
    await adapter.getSnapshot();
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe(listener);
    await startPoll();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ cause: "refresh", sequence: 3 }),
    );
    unsubscribe();
  });

  it("advances past malformed material events and keeps polling", async () => {
    invokeMock.mockResolvedValueOnce([{ ...event(4), cause: "bad" }]).mockResolvedValueOnce([]);
    const adapter = new TauriXcom2SetupMonitorAdapter({ pollIntervalMs: 50 });
    const unsubscribe = adapter.subscribe(vi.fn());
    await startPoll();
    await vi.advanceTimersByTimeAsync(100);
    expect(invokeMock).toHaveBeenLastCalledWith("poll_xcom2_setup_monitor_events", {
      afterSequence: 4,
      limit: 64,
    });
    unsubscribe();
  });
});
