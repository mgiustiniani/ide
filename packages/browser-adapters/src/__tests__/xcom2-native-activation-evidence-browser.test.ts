import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  XCOM2_MODULE_SCAN_LIMITS,
  type Xcom2NativeActivationAcknowledgment,
  type Xcom2NativeActivationLifecycleEvent,
} from "@ide/contracts";
import type {
  Xcom2NativeActivationEvidenceBeginRequest,
  Xcom2NativeActivationEvidencePort,
} from "@ide/web-core/ports";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserXcom2NativeActivationEvidenceAdapter,
  BrowserXcom2NativeActivationEvidenceUnavailableError,
  BrowserXcom2ProjectBuildRecipeInspectionAdapter,
  BrowserXcom2SetupAdapter,
  BrowserXcom2SetupMonitorAdapter,
  createBrowserAdapters,
} from "../index";

const WORKSPACE_ID = "workspace-secret-native-activation-71f3";
const SCAN_ID = "scan-secret-native-activation-a92c";
const CONFIGURATION_READ_ID = "configuration-secret-native-activation-b47e";
const ATTEMPT_RECEIPT = "receipt-secret-native-activation-c58f";
const EVIDENCE_HANDLES = [
  "handle-secret-native-activation-d69a",
  "handle-secret-native-activation-e70b",
] as const;
const UNAVAILABLE_MESSAGE =
  "XCOM 2 native activation evidence requires desktop-only native services and is unavailable in a browser.";

const beginRequest = {
  workspaceId: WORKSPACE_ID,
  workspaceGeneration: 873_421,
  scanId: SCAN_ID,
  scanGeneration: 948_215,
  configurationReadId: CONFIGURATION_READ_ID,
  limits: XCOM2_MODULE_SCAN_LIMITS,
} satisfies Xcom2NativeActivationEvidenceBeginRequest;

const acknowledgment = {
  activationAttemptReceipt: ATTEMPT_RECEIPT,
  evidenceHandles: EVIDENCE_HANDLES,
} satisfies Xcom2NativeActivationAcknowledgment;

const lifecycleEvent = {
  kind: "newer-activation-generation",
  activationGeneration: 772_091,
} satisfies Xcom2NativeActivationLifecycleEvent;

const SECRET_VALUES = [
  WORKSPACE_ID,
  SCAN_ID,
  CONFIGURATION_READ_ID,
  ATTEMPT_RECEIPT,
  ...EVIDENCE_HANDLES,
  String(beginRequest.workspaceGeneration),
  String(beginRequest.scanGeneration),
  String(lifecycleEvent.activationGeneration),
] as const;

const FORBIDDEN_RESULT_FIELDS = [
  "candidate",
  "scan",
  "configuration",
  "acknowledgment",
  "activationAttemptReceipt",
  "evidenceHandle",
  "evidenceHandles",
  "authority",
  "decision",
  "lifecycle",
  "state",
  "kind",
  "success",
  "ok",
  "value",
] as const;

type RejectionCase = readonly [
  operation: string,
  invoke: (adapter: Xcom2NativeActivationEvidencePort) => Promise<unknown>,
];

const rejectionCases = [
  ["begin", (adapter) => adapter.begin(beginRequest)],
  ["acknowledge", (adapter) => adapter.acknowledge(acknowledgment)],
  ["revoke", (adapter) => adapter.revoke(lifecycleEvent)],
] satisfies readonly RejectionCase[];

function rejectionText(error: BrowserXcom2NativeActivationEvidenceUnavailableError): string {
  return [error.name, error.code, error.message, error.stack ?? "", JSON.stringify(error)].join(
    "\n",
  );
}

async function captureRejection(
  invoke: RejectionCase[1],
): Promise<BrowserXcom2NativeActivationEvidenceUnavailableError> {
  try {
    await invoke(new BrowserXcom2NativeActivationEvidenceAdapter());
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserXcom2NativeActivationEvidenceUnavailableError);
    return error as BrowserXcom2NativeActivationEvidenceUnavailableError;
  }

  throw new Error("Expected the browser-native activation evidence operation to reject.");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BrowserXcom2NativeActivationEvidenceAdapter", () => {
  it.each(rejectionCases)(
    "statically rejects %s with the same typed browser-only error and no fabricated result",
    async (_operation, invoke) => {
      const error = await captureRejection(invoke);

      expect(error).toMatchObject({
        name: "BrowserXcom2NativeActivationEvidenceUnavailableError",
        code: "BROWSER_XCOM2_NATIVE_ACTIVATION_EVIDENCE_UNAVAILABLE",
        message: UNAVAILABLE_MESSAGE,
      });
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
      expect(Object.keys(error).sort()).toEqual(["code", "name"]);

      const rendered = rejectionText(error);
      for (const secret of SECRET_VALUES) expect(rendered).not.toContain(secret);
      for (const field of FORBIDDEN_RESULT_FIELDS) expect(field in error).toBe(false);
    },
  );

  it("performs zero filesystem, network, storage, timer, polling, or native calls", async () => {
    const capabilitySpies = [
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.spyOn(XMLHttpRequest.prototype, "open"),
      vi.spyOn(Storage.prototype, "getItem"),
      vi.spyOn(Storage.prototype, "setItem"),
      vi.spyOn(Storage.prototype, "removeItem"),
      vi.spyOn(globalThis, "setTimeout"),
      vi.spyOn(globalThis, "setInterval"),
      vi.spyOn(globalThis, "requestAnimationFrame"),
    ];
    const [
      fetchSpy,
      webSocketSpy,
      eventSourceSpy,
      workerSpy,
      openFileSpy,
      saveFileSpy,
      directorySpy,
      indexedDbOpenSpy,
      cacheOpenSpy,
      tauriInvokeSpy,
      tauriCoreInvokeSpy,
      tauriIpcSpy,
    ] = capabilitySpies;

    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("WebSocket", webSocketSpy);
    vi.stubGlobal("EventSource", eventSourceSpy);
    vi.stubGlobal("Worker", workerSpy);
    vi.stubGlobal("showOpenFilePicker", openFileSpy);
    vi.stubGlobal("showSaveFilePicker", saveFileSpy);
    vi.stubGlobal("showDirectoryPicker", directorySpy);
    vi.stubGlobal("indexedDB", { open: indexedDbOpenSpy });
    vi.stubGlobal("caches", { open: cacheOpenSpy });
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: tauriInvokeSpy });
    vi.stubGlobal("__TAURI__", { core: { invoke: tauriCoreInvokeSpy } });
    vi.stubGlobal("__TAURI_IPC__", tauriIpcSpy);

    for (const [, invoke] of rejectionCases) {
      await expect(
        invoke(new BrowserXcom2NativeActivationEvidenceAdapter()),
      ).rejects.toBeInstanceOf(BrowserXcom2NativeActivationEvidenceUnavailableError);
    }

    expect(capabilitySpies.reduce((count, spy) => count + spy.mock.calls.length, 0)).toBe(0);
  });

  it("imports only browser-safe contracts and contains no hidden capability access", () => {
    const source = readFileSync(
      resolve(__dirname, "../xcom2-native-activation-evidence-browser.ts"),
      "utf8",
    );
    const imports = Array.from(source.matchAll(/from\s+["']([^"']+)["']/g), ([, path]) => path);

    expect(imports).toEqual(["@ide/contracts", "@ide/web-core/ports"]);
    expect(source).not.toMatch(
      /@tauri-apps\/api|__TAURI|node:(?:fs|child_process|net|http|https)|\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|Worker|localStorage|sessionStorage|indexedDB|caches|setTimeout|setInterval|requestAnimationFrame|showOpenFilePicker|showSaveFilePicker|showDirectoryPicker)\b/,
    );
  });

  it("exports the adapter and error and wires the adapter through the browser factory", () => {
    const error = new BrowserXcom2NativeActivationEvidenceUnavailableError();
    const adapters = createBrowserAdapters();

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(UNAVAILABLE_MESSAGE);
    expect(adapters.xcom2NativeActivationEvidenceAdapter).toBeInstanceOf(
      BrowserXcom2NativeActivationEvidenceAdapter,
    );
    expect(Object.keys(adapters.xcom2NativeActivationEvidenceAdapter)).toEqual([]);
  });

  it("keeps the existing browser XCOM no-contribution adapters wired unchanged", async () => {
    const adapters = createBrowserAdapters();

    expect(adapters.xcom2ProjectBuildRecipeInspectionAdapter).toBeInstanceOf(
      BrowserXcom2ProjectBuildRecipeInspectionAdapter,
    );
    expect(adapters.xcom2SetupAdapter).toBeInstanceOf(BrowserXcom2SetupAdapter);
    expect(adapters.xcom2SetupMonitorAdapter).toBeInstanceOf(BrowserXcom2SetupMonitorAdapter);

    const snapshot = await adapters.xcom2SetupMonitorAdapter.getSnapshot();
    expect(snapshot).toMatchObject({
      overallState: "not-found",
      canPlanSetup: false,
      canApplySetup: false,
    });
    expect(
      Object.keys(adapters).filter((key) => /contribution|authority|lifecycle|success/i.test(key)),
    ).toEqual([]);
  });
});
