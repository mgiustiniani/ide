import assert from "node:assert/strict";
import { createRequire, register } from "node:module";

import { act, fireEvent, render, within, type RenderResult } from "@testing-library/react";

interface StoryDom {
  readonly window: Window & typeof globalThis;
}

interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface NativeCall {
  readonly sequence: number;
  readonly command: string;
  readonly workspaceId: string;
  readonly lifecycle?: XcomLifecycle;
  readonly lifecycleGeneration?: number;
  readonly args?: Readonly<Record<string, string | number | boolean>>;
}

type XcomLifecycle = "monitor" | "transaction";
type TimerState = "scheduled" | "fired" | "cancelled";

interface TimerRecord {
  readonly timerId: number;
  readonly lifecycle: XcomLifecycle | "other";
  readonly generation: number;
  readonly delayMs: number;
  readonly dueAtMs: number;
  state: TimerState;
}

interface LifecycleRecord {
  readonly lifecycle: XcomLifecycle;
  readonly generation: number;
  readonly openedAtMs: number;
  cancelledAtMs?: number;
}

interface ScheduledTimer extends TimerRecord {
  readonly callback: (...args: unknown[]) => void;
  readonly args: readonly unknown[];
}

const FIXED_TIME = "2026-07-16T12:00:00.000Z";
const POLL_INTERVAL_MS = 250;
const XCOM_COMMANDS = new Set([
  "get_xcom2_setup_monitor_snapshot",
  "refresh_xcom2_setup_monitor_snapshot",
  "poll_xcom2_setup_monitor_events",
  "prepare_xcom2_setup_transaction",
  "apply_xcom2_setup_transaction",
  "get_xcom2_setup_transaction",
  "list_xcom2_setup_transactions",
  "cancel_xcom2_setup_transaction",
  "rollback_xcom2_setup_transaction",
  "recover_xcom2_setup_transaction",
  "poll_xcom2_setup_transaction_events",
]);

register(new URL("./story-css-loader.js", import.meta.url), import.meta.url);

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  readonly JSDOM: new (html: string, options: { url: string }) => StoryDom;
};
const storyReact = createRequire(import.meta.url)("react") as {
  createElement(type: unknown, props: Record<string, unknown> | null): React.ReactNode;
};

let harnessSequence = 0;

function xcomProduct(appId: 268500 | 602410, name: string): Record<string, unknown> {
  return {
    product: {
      appId,
      name,
      kind: appId === 268500 ? "game" : "development-tools",
      role: "required",
    },
    lifecycle: "not-found",
    installDirectoryPresent: false,
    downloadDirectoryPresent: false,
    complete: false,
    completionReasons: ["Product is not installed."],
    stable: false,
    stabilityReasons: ["No stable installation is available."],
    mutationBlocked: true,
    mutationBlockedReasons: ["Read-only monitor."],
    checkedAt: FIXED_TIME,
  };
}

function scalarArgs(
  args: Record<string, unknown> | undefined,
): Readonly<Record<string, string | number | boolean>> | undefined {
  if (!args) return undefined;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

class DeterministicStoryClock {
  readonly #timers = new Map<number, ScheduledTimer>();
  readonly #records: TimerRecord[] = [];
  readonly #lifecycles: LifecycleRecord[] = [];
  readonly #currentGeneration = new Map<XcomLifecycle, number>();
  readonly #nextGeneration = new Map<XcomLifecycle, number>();
  #nextTimerId = 0;
  #nowMs = 0;

  setTimeout = (
    callback: (...args: unknown[]) => void,
    delay: number | undefined,
    ...args: unknown[]
  ): number => {
    assert.equal(typeof callback, "function", "The deterministic clock accepts callbacks only");
    const normalizedDelay = Math.max(0, Number.isFinite(delay) ? Math.floor(delay ?? 0) : 0);
    const lifecycle = this.#classify(new Error().stack ?? "");
    const generation = lifecycle === "other" ? 0 : this.#generationFor(lifecycle);
    const timer: ScheduledTimer = {
      timerId: ++this.#nextTimerId,
      lifecycle,
      generation,
      delayMs: normalizedDelay,
      dueAtMs: this.#nowMs + normalizedDelay,
      state: "scheduled",
      callback,
      args,
    };
    this.#timers.set(timer.timerId, timer);
    this.#records.push(timer);
    return timer.timerId;
  };

  clearTimeout = (timerId: number | undefined): void => {
    if (timerId === undefined) return;
    const timer = this.#timers.get(Number(timerId));
    if (!timer) return;
    timer.state = "cancelled";
    this.#timers.delete(timer.timerId);
    if (timer.lifecycle !== "other") {
      const lifecycle = this.#lifecycles.find(
        (candidate) =>
          candidate.lifecycle === timer.lifecycle && candidate.generation === timer.generation,
      );
      if (lifecycle && lifecycle.cancelledAtMs === undefined) lifecycle.cancelledAtMs = this.#nowMs;
      if (this.#currentGeneration.get(timer.lifecycle) === timer.generation) {
        this.#currentGeneration.delete(timer.lifecycle);
      }
    }
  };

  async advanceBy(milliseconds: number): Promise<void> {
    assert.ok(Number.isSafeInteger(milliseconds) && milliseconds >= 0);
    const target = this.#nowMs + milliseconds;
    while (true) {
      const next = [...this.#timers.values()]
        .filter((timer) => timer.dueAtMs <= target)
        .sort((left, right) => left.dueAtMs - right.dueAtMs || left.timerId - right.timerId)[0];
      if (!next) break;
      this.#nowMs = next.dueAtMs;
      this.#timers.delete(next.timerId);
      next.state = "fired";
      await act(async () => {
        next.callback(...next.args);
        await flushMicrotasks();
      });
    }
    this.#nowMs = target;
    await act(async () => flushMicrotasks());
  }

  currentGeneration(lifecycle: XcomLifecycle): number | undefined {
    return this.#currentGeneration.get(lifecycle);
  }

  activeTimers(lifecycle: XcomLifecycle): readonly TimerRecord[] {
    return [...this.#timers.values()].filter(
      (timer) => timer.lifecycle === lifecycle && timer.state === "scheduled",
    );
  }

  lifecycles(lifecycle: XcomLifecycle): readonly LifecycleRecord[] {
    return this.#lifecycles.filter((record) => record.lifecycle === lifecycle);
  }

  records(): readonly Readonly<TimerRecord>[] {
    return this.#records.map((record) => ({
      timerId: record.timerId,
      lifecycle: record.lifecycle,
      generation: record.generation,
      delayMs: record.delayMs,
      dueAtMs: record.dueAtMs,
      state: record.state,
    }));
  }

  cancelAll(): void {
    for (const timerId of [...this.#timers.keys()]) this.clearTimeout(timerId);
  }

  #generationFor(lifecycle: XcomLifecycle): number {
    const current = this.#currentGeneration.get(lifecycle);
    if (current !== undefined) return current;
    const generation = (this.#nextGeneration.get(lifecycle) ?? 0) + 1;
    this.#nextGeneration.set(lifecycle, generation);
    this.#currentGeneration.set(lifecycle, generation);
    this.#lifecycles.push({ lifecycle, generation, openedAtMs: this.#nowMs });
    return generation;
  }

  #classify(stack: string): XcomLifecycle | "other" {
    if (stack.includes("xcom2-setup-monitor-tauri")) return "monitor";
    if (stack.includes("xcom2-setup-tauri")) return "transaction";
    return "other";
  }
}

async function flushMicrotasks(rounds = 30): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

/**
 * Deterministic jsdom boundary around the real desktop App and its real typed Tauri adapters.
 * The command backend is in-process; no native GUI, E2E, real IPC, Steam, or filesystem is used.
 */
export class Xcom2MachineSettingsHarness {
  readonly #globalDescriptors = new Map<string, PropertyDescriptor | undefined>();
  readonly #clock = new DeterministicStoryClock();
  readonly #calls: NativeCall[] = [];
  readonly #workspaces: Record<string, Readonly<Record<string, unknown>>>;
  #dom?: StoryDom;
  #surface?: RenderResult;
  #activeWorkspaceId: string;
  #sequence = 0;
  #disposed = false;
  #openBaseline?: readonly NativeCall[];
  #manualRefreshBaseline?: readonly NativeCall[];
  #reopenBaseline?: readonly NativeCall[];
  #closedTranscript?: string;

  constructor(coldWorkspaceName: string, switchedWorkspaceName = "generic-switched") {
    this.#activeWorkspaceId = coldWorkspaceName;
    this.#workspaces = {
      [coldWorkspaceName]: this.#workspace(coldWorkspaceName),
      [switchedWorkspaceName]: this.#workspace(switchedWorkspaceName),
    };
    assert.equal(Object.keys(this.#workspaces).length, 2);
    assert.equal(JSON.stringify(this.#workspaces).toLowerCase().includes("xcom"), false);
  }

  async start(): Promise<void> {
    assert.equal(this.#surface, undefined, "The XCOM Settings harness has already started");
    this.#installDom();
    Object.defineProperty(this.#dom!.window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: (command: string, args?: Record<string, unknown>) => this.#invoke(command, args),
      } satisfies TauriInternals,
    });

    const appUrl = new URL("../../../apps/desktop/src/App.tsx", import.meta.url);
    appUrl.searchParams.set("xcomSettingsStoryHarness", String(++harnessSequence));
    const appModule = (await import(appUrl.href)) as { App: () => React.ReactNode };
    this.#surface = render(storyReact.createElement(appModule.App, null));
    await this.settle();
  }

  async settle(): Promise<void> {
    await act(async () => flushMicrotasks());
  }

  assertHarnessBoundary(): void {
    assert.ok(this.#surface);
    assert.ok(this.#dom);
    assert.equal(
      typeof (this.#dom.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__,
      "object",
    );
  }

  assertSettingsClosed(): void {
    assert.equal(this.#requireSurface().queryByRole("dialog", { name: "Settings" }), null);
  }

  assertWorkspaceReady(workspaceName: string): void {
    assert.equal(this.#activeWorkspaceId, workspaceName);
    assert.ok(this.#requireSurface().getByText(`Workspace: ${workspaceName}`));
  }

  async switchWorkspace(workspaceName: string): Promise<void> {
    assert.ok(this.#workspaces[workspaceName], `Unknown generic workspace ${workspaceName}`);
    this.assertSettingsClosed();
    fireEvent.click(
      this.#requireSurface().getByRole("option", { name: new RegExp(workspaceName, "u") }),
    );
    await this.settle();
    this.assertWorkspaceReady(workspaceName);
    this.assertSettingsClosed();
  }

  assertNoClosedMonitorReads(): void {
    this.#assertCommandCounts(
      ["get_xcom2_setup_monitor_snapshot", "refresh_xcom2_setup_monitor_snapshot"],
      [0, 0],
      "Settings-closed monitor transcript",
    );
  }

  assertNoClosedTransactionReads(): void {
    this.#assertCommandCounts(
      ["list_xcom2_setup_transactions", "get_xcom2_setup_transaction"],
      [0, 0],
      "Settings-closed transaction transcript",
    );
  }

  assertNoClosedPollOrSubscriptions(): void {
    this.#assertCommandCounts(
      ["poll_xcom2_setup_monitor_events", "poll_xcom2_setup_transaction_events"],
      [0, 0],
      "Settings-closed event-poll transcript",
    );
    assert.deepEqual(this.#clock.lifecycles("monitor"), []);
    assert.deepEqual(this.#clock.lifecycles("transaction"), []);
  }

  assertNoXcomContributions(): void {
    const surface = this.#requireSurface();
    const primaryActivity = surface.getByRole("navigation", { name: "Primary activity" });
    const activityTabs = within(primaryActivity).queryAllByRole("tab", { name: /xcom/iu });
    assert.equal(activityTabs.length, 0, "XCOM unexpectedly appeared in the activity bar");
    const toolWindows = surface.getByRole("tablist", { name: "Tool windows" });
    const bottomTabs = within(toolWindows).queryAllByRole("tab", { name: /xcom/iu });
    assert.equal(bottomTabs.length, 0, "XCOM unexpectedly appeared in the bottom panel");
  }

  async openMachineSettings(workspaceName: string, reopen = false): Promise<void> {
    this.assertWorkspaceReady(workspaceName);
    this.assertSettingsClosed();
    if (reopen) this.#reopenBaseline = this.xcomCalls();
    else this.#openBaseline = this.xcomCalls();
    fireEvent.click(this.#requireSurface().getByRole("button", { name: /^Settings$/u }));
    await this.settle();
    const dialog = this.#requireSurface().getByRole("dialog", { name: "Settings" });
    const settingsSections = within(dialog).getByRole("navigation", {
      name: "Settings sections",
    });
    const sectionTabs = within(settingsSections).getByRole("tablist");
    fireEvent.click(within(sectionTabs).getByRole("tab", { name: /^XCOM 2/iu }));
    await this.settle();
    this.#xcomSettingsSection();
  }

  assertFirstLifecycleActive(): void {
    this.#assertLifecycleState(1, [1], []);
  }

  assertLifecycleOwnsOneTimerEach(): void {
    for (const lifecycle of ["monitor", "transaction"] as const) {
      const active = this.#clock.activeTimers(lifecycle);
      assert.equal(active.length, 1, `${lifecycle} must own exactly one poll timer`);
      assert.equal(active[0]?.generation, this.#clock.lifecycles(lifecycle).at(-1)?.generation);
      assert.equal(active[0]?.delayMs, 0);
    }
  }

  assertFirstOpenLoads(): void {
    assert.ok(this.#openBaseline);
    this.#assertDelta(this.#openBaseline, "get_xcom2_setup_monitor_snapshot", 1);
    this.#assertDelta(this.#openBaseline, "refresh_xcom2_setup_monitor_snapshot", 0);
    this.#assertDelta(this.#openBaseline, "list_xcom2_setup_transactions", 1);
    this.#assertDelta(this.#openBaseline, "get_xcom2_setup_transaction", 0);
  }

  assertSettingsDoesNotActivateXcom(): void {
    this.assertNoXcomContributions();
    assert.equal(this.#activeWorkspaceId, "generic-switched");
    const xcomSettingsSection = this.#xcomSettingsSection();
    assert.equal(
      within(xcomSettingsSection).queryByRole("status", { name: /module active/iu }),
      null,
    );
  }

  async manualRefresh(): Promise<void> {
    this.#manualRefreshBaseline = this.xcomCalls();
    const xcomSettingsSection = this.#xcomSettingsSection();
    const monitorActions = within(xcomSettingsSection).getByRole("group", {
      name: "XCOM 2 setup monitor actions",
    });
    fireEvent.click(within(monitorActions).getByRole("button", { name: "Refresh now" }));
    await this.settle();
  }

  assertManualRefreshCalls(): void {
    assert.ok(this.#manualRefreshBaseline);
    this.#assertDelta(this.#manualRefreshBaseline, "refresh_xcom2_setup_monitor_snapshot", 1);
    this.#assertDelta(this.#manualRefreshBaseline, "list_xcom2_setup_transactions", 1);
    this.#assertDelta(this.#manualRefreshBaseline, "get_xcom2_setup_monitor_snapshot", 0);
  }

  assertNoDuplicateFirstLifecycle(): void {
    this.#assertLifecycleState(1, [1], []);
    this.assertLifecycleOwnsOneTimerEach();
  }

  async closeSettings(): Promise<void> {
    const dialog = this.#requireSurface().getByRole("dialog", { name: "Settings" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close settings" }));
    await this.settle();
    this.assertSettingsClosed();
    this.#closedTranscript = JSON.stringify(this.xcomCalls());
  }

  assertLifecyclesCancelled(): void {
    this.#assertLifecycleState(1, [], [1]);
    assert.equal(this.#clock.activeTimers("monitor").length, 0);
    assert.equal(this.#clock.activeTimers("transaction").length, 0);
  }

  async advanceFivePollIntervals(): Promise<void> {
    await this.#clock.advanceBy(POLL_INTERVAL_MS * 5);
  }

  assertClosedTranscriptImmutable(): void {
    assert.ok(this.#closedTranscript);
    assert.equal(JSON.stringify(this.xcomCalls()), this.#closedTranscript);
  }

  assertReopenedLifecycleActive(): void {
    this.#assertLifecycleState(2, [2], [1]);
  }

  assertEarlierGenerationsCancelled(): void {
    for (const lifecycle of ["monitor", "transaction"] as const) {
      const records = this.#clock.lifecycles(lifecycle);
      assert.equal(records.length, 2);
      assert.notEqual(records[0]?.cancelledAtMs, undefined);
      assert.equal(records[1]?.cancelledAtMs, undefined);
    }
  }

  assertReopenLoads(): void {
    assert.ok(this.#reopenBaseline);
    this.#assertDelta(this.#reopenBaseline, "get_xcom2_setup_monitor_snapshot", 1);
    this.#assertDelta(this.#reopenBaseline, "refresh_xcom2_setup_monitor_snapshot", 0);
    this.#assertDelta(this.#reopenBaseline, "list_xcom2_setup_transactions", 1);
    this.#assertDelta(this.#reopenBaseline, "get_xcom2_setup_transaction", 0);
  }

  assertNoEarlierGenerationDuplicates(): void {
    this.assertReopenedLifecycleActive();
    this.assertReopenLoads();
    const calls = this.xcomCalls();
    const reopenStart = this.#reopenBaseline?.length ?? 0;
    assert.equal(
      calls
        .slice(reopenStart)
        .some((call) => call.workspaceId !== "generic-switched" || call.lifecycleGeneration !== 2),
      false,
    );
    this.#assertCommandCounts(
      [
        "get_xcom2_setup_monitor_snapshot",
        "refresh_xcom2_setup_monitor_snapshot",
        "poll_xcom2_setup_monitor_events",
        "prepare_xcom2_setup_transaction",
        "apply_xcom2_setup_transaction",
        "get_xcom2_setup_transaction",
        "list_xcom2_setup_transactions",
        "cancel_xcom2_setup_transaction",
        "rollback_xcom2_setup_transaction",
        "recover_xcom2_setup_transaction",
        "poll_xcom2_setup_transaction_events",
      ],
      [2, 1, 0, 0, 0, 0, 3, 0, 0, 0, 0],
      "Complete exact open, refresh, close, and reopen transcript",
    );
    for (const lifecycle of ["monitor", "transaction"] as const) {
      assert.deepEqual(
        this.#clock
          .records()
          .filter((timer) => timer.lifecycle === lifecycle)
          .map(({ generation, delayMs, state }) => ({ generation, delayMs, state })),
        [
          { generation: 1, delayMs: 0, state: "cancelled" },
          { generation: 2, delayMs: 0, state: "scheduled" },
        ],
        `${lifecycle} timer generations`,
      );
    }
  }

  xcomCalls(): readonly NativeCall[] {
    return this.#calls
      .filter((call) => XCOM_COMMANDS.has(call.command))
      .map((call) => ({ ...call }));
  }

  evidence(): Readonly<Record<string, unknown>> {
    return {
      requirementId: "REQ-XCOM2-MACHINE-SETTINGS-001",
      kind: "tauri-harness",
      rendering: "real production apps/desktop/src/App.tsx in jsdom",
      controllers: "real production desktop application controllers",
      adapters: ["TauriXcom2SetupMonitorAdapter", "TauriXcom2SetupAdapter"],
      backend: "fake in-process __TAURI_INTERNALS__.invoke command backend",
      clock: "deterministic harness-owned fake clock",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
      realIpc: false,
      liveSteam: false,
      realFilesystem: false,
      xcomNativeCalls: this.xcomCalls(),
      subscriptionGenerations: {
        monitor: this.#clock.lifecycles("monitor"),
        transaction: this.#clock.lifecycles("transaction"),
      },
      timerGenerations: this.#clock.records(),
    };
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#surface) {
      await act(async () => {
        this.#surface?.unmount();
        await flushMicrotasks();
      });
    }
    for (const lifecycle of ["monitor", "transaction"] as const) {
      assert.equal(this.#clock.activeTimers(lifecycle).length, 0, `${lifecycle} timer leaked`);
      assert.equal(
        this.#clock
          .lifecycles(lifecycle)
          .every((generation) => generation.cancelledAtMs !== undefined),
        true,
        `${lifecycle} subscription generation leaked`,
      );
    }
    this.#surface = undefined;
    this.#clock.cancelAll();
    this.#dom?.window.close();
    this.#dom = undefined;
    for (const [name, descriptor] of [...this.#globalDescriptors].reverse()) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }

  async #invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
    const lifecycle = command.includes("xcom2_setup_monitor")
      ? "monitor"
      : command.includes("xcom2_setup_transaction")
        ? "transaction"
        : undefined;
    const lifecycleGeneration = lifecycle
      ? (this.#clock.currentGeneration(lifecycle) ?? 0)
      : undefined;
    const call: NativeCall = {
      sequence: ++this.#sequence,
      command,
      workspaceId: this.#activeWorkspaceId,
      ...(lifecycle ? { lifecycle, lifecycleGeneration } : {}),
      ...(scalarArgs(args) ? { args: scalarArgs(args) } : {}),
    };
    this.#calls.push(call);

    switch (command) {
      case "ensure_current_workspace":
        return this.#workspaces[this.#activeWorkspaceId];
      case "list_workspaces":
        return {
          currentWorkspaceId: this.#activeWorkspaceId,
          workspaces: Object.values(this.#workspaces),
        };
      case "switch_workspace": {
        const workspaceId = String(args?.workspaceId);
        assert.ok(this.#workspaces[workspaceId], `Unknown switched workspace ${workspaceId}`);
        this.#activeWorkspaceId = workspaceId;
        return this.#workspaces[workspaceId];
      }
      case "list_directory":
        return {
          name: this.#activeWorkspaceId,
          path: `/story/${this.#activeWorkspaceId}`,
          type: "directory",
          children: [],
        };
      case "get_pi_agent_settings":
        return {
          enabled: false,
          provider: "pi",
          preferredIntegration: "rpc",
          fallbackIntegrations: [],
        };
      case "get_pi_agent_status":
        return {
          provider: "pi",
          enabled: false,
          available: false,
          availability: "not-installed",
          preferredIntegration: "rpc",
          fallbackIntegrations: [],
          checkedAt: FIXED_TIME,
        };
      case "list_pi_agent_commands":
        return { provider: "pi", integration: "rpc", commands: [] };
      case "list_agent_runs":
      case "poll_java_language_service_events":
        return [];
      case "get_pi_agent_session_messages":
        return {
          workspaceId: this.#activeWorkspaceId,
          sessionId: "generic-story-session",
          provider: "pi",
          integration: "rpc",
          messages: [],
        };
      case "get_java_language_service_status":
      case "stop_java_language_service":
        return {
          available: true,
          lifecycle: command === "stop_java_language_service" ? "stopped" : "ready",
          provider: "jdtls",
          workspaceId: this.#activeWorkspaceId,
          workspaceRoot: `/story/${this.#activeWorkspaceId}`,
          generation: 1,
          capabilities: {
            documentSync: true,
            diagnostics: false,
            completion: false,
            hover: false,
            definition: false,
            references: false,
            documentSymbols: false,
            workspaceSymbols: false,
            rename: false,
            codeActions: false,
            formatting: false,
            signatureHelp: false,
          },
          checkedAt: FIXED_TIME,
        };
      case "open_java_language_document":
      case "change_java_language_document":
      case "save_java_language_document":
      case "close_java_language_document":
        return undefined;
      case "get_refactorkit_status":
        return { available: false, checkedAt: FIXED_TIME };
      case "get_refactorkit_capabilities":
        return {
          api: "refactorkit",
          apiVersion: "0.2",
          provider: "refactorkit",
          providerVersion: "unavailable",
          javaImportExternalClass: {
            supported: false,
            targetDirectory: false,
            preview: false,
            apply: false,
            rollback: false,
            stability: "experimental",
          },
          safety: {
            previewBeforeApply: false,
            snapshotValidation: false,
            transactionRollback: false,
            workspaceScopedWrites: false,
          },
        };
      case "get_xcom2_setup_monitor_snapshot":
      case "refresh_xcom2_setup_monitor_snapshot":
        return this.#snapshot();
      case "list_xcom2_setup_transactions":
      case "poll_xcom2_setup_monitor_events":
      case "poll_xcom2_setup_transaction_events":
        return [];
      default:
        throw new Error(`The XCOM Settings Story backend does not implement ${command}`);
    }
  }

  #snapshot(): Readonly<Record<string, unknown>> {
    return {
      workspaceId: this.#activeWorkspaceId,
      generation: 1,
      steamRoot: { source: "unknown", pathRedacted: true },
      products: [
        xcomProduct(268500, "XCOM 2"),
        xcomProduct(602410, "XCOM 2: War of the Chosen Development Tools"),
      ],
      overallState: "not-found",
      canPlanSetup: false,
      canApplySetup: false,
      blockers: ["Required products are not installed."],
      warnings: [],
      checkedAt: FIXED_TIME,
    };
  }

  #workspace(name: string): Readonly<Record<string, unknown>> {
    return { id: name, name, rootPath: `/story/${name}` };
  }

  #installDom(): void {
    this.#dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://desktop.story.invalid",
    });
    const window = this.#dom.window;
    Object.defineProperty(window.document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 720,
        height: 720,
        left: 0,
        right: 1280,
        top: 0,
        width: 1280,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    const globals: ReadonlyArray<readonly [string, unknown]> = [
      ["window", window],
      ["document", window.document],
      ["navigator", window.navigator],
      ["Node", window.Node],
      ["Element", window.Element],
      ["HTMLElement", window.HTMLElement],
      ["HTMLButtonElement", window.HTMLButtonElement],
      ["HTMLInputElement", window.HTMLInputElement],
      ["HTMLTextAreaElement", window.HTMLTextAreaElement],
      ["MouseEvent", window.MouseEvent],
      ["KeyboardEvent", window.KeyboardEvent],
      ["Event", window.Event],
      ["CustomEvent", window.CustomEvent],
      ["getComputedStyle", window.getComputedStyle.bind(window)],
      ["setTimeout", this.#clock.setTimeout],
      ["clearTimeout", this.#clock.clearTimeout],
      [
        "requestAnimationFrame",
        (callback: FrameRequestCallback) => (queueMicrotask(() => callback(0)), 0),
      ],
      ["cancelAnimationFrame", () => undefined],
      [
        "ResizeObserver",
        class {
          observe(): void {}
          unobserve(): void {}
          disconnect(): void {}
        },
      ],
      [
        "IntersectionObserver",
        class {
          observe(): void {}
          unobserve(): void {}
          disconnect(): void {}
        },
      ],
      ["React", storyReact],
      ["IS_REACT_ACT_ENVIRONMENT", true],
    ];
    for (const [name, value] of globals) {
      this.#globalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
    Object.defineProperties(window, {
      setTimeout: { configurable: true, value: this.#clock.setTimeout },
      clearTimeout: { configurable: true, value: this.#clock.clearTimeout },
      matchMedia: {
        configurable: true,
        value: () => ({
          matches: false,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }),
      },
    });
  }

  #xcomSettingsSection(): HTMLElement {
    const dialog = this.#requireSurface().getByRole("dialog", { name: "Settings" });
    const settingsSections = within(dialog).getByRole("navigation", {
      name: "Settings sections",
    });
    const sectionTabs = within(settingsSections).getByRole("tablist");
    const xcomTab = within(sectionTabs).getByRole("tab", { name: /^XCOM 2/iu });
    assert.equal(xcomTab.getAttribute("aria-selected"), "true");
    return within(dialog).getByRole("region", { name: "XCOM 2 WOTC Setup" });
  }

  #assertLifecycleState(
    expectedCount: number,
    activeGenerations: readonly number[],
    cancelledGenerations: readonly number[],
  ): void {
    for (const lifecycle of ["monitor", "transaction"] as const) {
      const records = this.#clock.lifecycles(lifecycle);
      assert.equal(records.length, expectedCount, `${lifecycle} lifecycle generations`);
      assert.deepEqual(
        records
          .filter((record) => record.cancelledAtMs === undefined)
          .map((record) => record.generation),
        activeGenerations,
      );
      assert.deepEqual(
        records
          .filter((record) => record.cancelledAtMs !== undefined)
          .map((record) => record.generation),
        cancelledGenerations,
      );
    }
  }

  #assertCommandCounts(
    commands: readonly string[],
    expected: readonly number[],
    message: string,
  ): void {
    const actual = commands.map((command) =>
      this.xcomCalls().filter((call) => call.command === command),
    );
    assert.deepEqual(
      actual.map((calls) => calls.length),
      expected,
      `${message}; complete exact observed XCOM calls: ${JSON.stringify(this.xcomCalls())}`,
    );
  }

  #assertDelta(baseline: readonly NativeCall[], command: string, expected: number): void {
    const calls = this.xcomCalls()
      .slice(baseline.length)
      .filter((call) => call.command === command);
    assert.equal(
      calls.length,
      expected,
      `${command} delta; exact observed calls: ${JSON.stringify(calls)}`,
    );
    if (expected > 0) {
      const lifecycle = command.includes("monitor") ? "monitor" : "transaction";
      const expectedGeneration = this.#clock.lifecycles(lifecycle).at(-1)?.generation;
      assert.ok(expectedGeneration, `${lifecycle} lifecycle must exist before its command`);
      assert.equal(
        calls.every((call) => call.lifecycleGeneration === expectedGeneration),
        true,
        `${command} escaped lifecycle generation ${expectedGeneration}: ${JSON.stringify(calls)}`,
      );
    }
  }

  #requireSurface(): RenderResult {
    assert.ok(this.#surface, "The XCOM Settings production App has not been rendered");
    return this.#surface;
  }
}
