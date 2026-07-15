import {
  XCOM2_STEAM_PRODUCTS,
  deriveXcom2ProgressPercentage,
  isSteamByteCount,
  type SteamByteCount,
  type Xcom2ManifestProvenance,
  type Xcom2ProductLifecycle,
  type Xcom2SetupMonitorEvent,
  type Xcom2SetupMonitorEventCause,
  type Xcom2SetupMonitorListener,
  type Xcom2SetupMonitorSnapshot,
  type Xcom2SetupOverallState,
  type Xcom2SteamProductIdentifier,
  type Xcom2SteamProductStatus,
  type Xcom2SteamRootProvenance,
} from "@ide/contracts";
import type { Xcom2SetupMonitorPort } from "@ide/web-core/ports";

import { TauriAdapterError, invokeTauri, toTauriAdapterError } from "./errors";

const GET_COMMAND = "get_xcom2_setup_monitor_snapshot";
const REFRESH_COMMAND = "refresh_xcom2_setup_monitor_snapshot";
const POLL_COMMAND = "poll_xcom2_setup_monitor_events";
const PRODUCT_BY_APP_ID = new Map<number, Xcom2SteamProductIdentifier>([
  [XCOM2_STEAM_PRODUCTS.game.appId, XCOM2_STEAM_PRODUCTS.game],
  [XCOM2_STEAM_PRODUCTS.wotcDevelopmentTools.appId, XCOM2_STEAM_PRODUCTS.wotcDevelopmentTools],
  [
    XCOM2_STEAM_PRODUCTS.vanillaDevelopmentTools.appId,
    XCOM2_STEAM_PRODUCTS.vanillaDevelopmentTools,
  ],
]);
const REQUIRED_APP_IDS = [
  XCOM2_STEAM_PRODUCTS.game.appId,
  XCOM2_STEAM_PRODUCTS.wotcDevelopmentTools.appId,
] as const;
const LIFECYCLES = new Set<Xcom2ProductLifecycle>([
  "not-found",
  "queued",
  "downloading",
  "staging",
  "paused",
  "verifying",
  "installed",
  "incomplete",
  "unknown",
]);
const OVERALL_STATES = new Set<Xcom2SetupOverallState>([
  "not-found",
  "downloading",
  "staging",
  "paused",
  "verifying",
  "ready",
  "incomplete",
  "unknown",
]);

export interface Xcom2SetupMonitorPollOptions {
  pollIntervalMs?: number;
  hiddenPollIntervalMs?: number;
  maxBackoffMs?: number;
  pollLimit?: number;
}

interface Subscription {
  active: boolean;
  listener: Xcom2SetupMonitorListener;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(command: string, message: string, response: unknown): TauriAdapterError {
  return new TauriAdapterError(command, `Invalid ${command} response: ${message}`, response);
}

function record(
  command: string,
  response: unknown,
  value: unknown = response,
): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(command, "expected object", response);
  return value;
}

function text(command: string, response: unknown, value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw invalid(command, `invalid string ${field}`, response);
  return value;
}

function optionalText(
  command: string,
  response: unknown,
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(command, response, value, field);
}

function bool(command: string, response: unknown, value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw invalid(command, `invalid boolean ${field}`, response);
  return value;
}

function nonNegativeInteger(
  command: string,
  response: unknown,
  value: unknown,
  field: string,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalid(command, `invalid non-negative safe integer ${field}`, response);
  }
  return value;
}

function timestamp(command: string, response: unknown, value: unknown, field: string): string {
  const source = text(command, response, value, field);
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds))
    throw invalid(command, `invalid timestamp ${field}`, response);
  return new Date(milliseconds).toISOString();
}

function stringList(
  command: string,
  response: unknown,
  value: unknown,
  field: string,
): readonly string[] {
  if (!Array.isArray(value)) throw invalid(command, `invalid string array ${field}`, response);
  return value.map((item, index) => text(command, response, item, `${field}[${index}]`));
}

function byteCount(
  command: string,
  response: unknown,
  value: unknown,
  field: string,
): SteamByteCount | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isSteamByteCount(value)) throw invalid(command, `invalid byte count ${field}`, response);
  return value;
}

function unsafeAbsolutePath(value: string): boolean {
  return /^(?:[/\\]|[A-Za-z]:[/\\]|file:)/i.test(value.trim());
}

function safeDisplay(
  command: string,
  response: unknown,
  value: unknown,
  field: string,
): string | undefined {
  const result = optionalText(command, response, value, field);
  if (result !== undefined && unsafeAbsolutePath(result)) {
    throw invalid(command, `absolute path is forbidden in ${field}`, response);
  }
  return result;
}

function normalizePercentage(
  command: string,
  response: unknown,
  value: unknown,
  completed: SteamByteCount | undefined,
  total: SteamByteCount | undefined,
  field: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw invalid(command, `invalid percentage ${field}`, response);
  }
  const derived = deriveXcom2ProgressPercentage(completed, total);
  if (derived === undefined || Math.abs(derived - value) > 0.001) {
    throw invalid(command, `${field} does not match byte counters`, response);
  }
  return derived;
}

function normalizeProductIdentifier(
  command: string,
  response: unknown,
  value: unknown,
): Xcom2SteamProductIdentifier {
  const item = record(command, response, value);
  const appId = nonNegativeInteger(command, response, item.appId, "product.appId");
  const expected = PRODUCT_BY_APP_ID.get(appId);
  if (
    !expected ||
    item.name !== expected.name ||
    item.kind !== expected.kind ||
    item.role !== expected.role
  ) {
    throw invalid(command, `unsupported or altered product identity ${appId}`, response);
  }
  return expected;
}

function normalizeManifestProvenance(
  command: string,
  response: unknown,
  value: unknown,
): Xcom2ManifestProvenance | undefined {
  if (value === undefined || value === null) return undefined;
  const provenance = record(command, response, value);
  if (provenance.source !== "steam-appmanifest" || provenance.pathRedacted !== true) {
    throw invalid(command, "invalid or unredacted manifest provenance", response);
  }
  const displayPath = safeDisplay(
    command,
    response,
    provenance.displayPath,
    "manifestProvenance.displayPath",
  );
  return {
    source: "steam-appmanifest",
    pathRedacted: true,
    ...(displayPath === undefined ? {} : { displayPath }),
  };
}

function normalizeProduct(
  command: string,
  response: unknown,
  value: unknown,
): Xcom2SteamProductStatus {
  const item = record(command, response, value);
  if (!LIFECYCLES.has(item.lifecycle as Xcom2ProductLifecycle)) {
    throw invalid(command, "unsupported product lifecycle", response);
  }
  const lifecycle = item.lifecycle as Xcom2ProductLifecycle;
  const product = normalizeProductIdentifier(command, response, item.product);
  const bytesDownloaded = byteCount(command, response, item.bytesDownloaded, "bytesDownloaded");
  const bytesToDownload = byteCount(command, response, item.bytesToDownload, "bytesToDownload");
  const bytesStaged = byteCount(command, response, item.bytesStaged, "bytesStaged");
  const bytesToStage = byteCount(command, response, item.bytesToStage, "bytesToStage");
  const installDirectoryPresent = bool(
    command,
    response,
    item.installDirectoryPresent,
    "installDirectoryPresent",
  );
  const downloadDirectoryPresent = bool(
    command,
    response,
    item.downloadDirectoryPresent,
    "downloadDirectoryPresent",
  );
  const complete = bool(command, response, item.complete, "complete");
  const stable = bool(command, response, item.stable, "stable");
  const mutationBlocked = bool(command, response, item.mutationBlocked, "mutationBlocked");
  const completionReasons = stringList(
    command,
    response,
    item.completionReasons,
    "completionReasons",
  );
  const stabilityReasons = stringList(command, response, item.stabilityReasons, "stabilityReasons");
  const mutationBlockedReasons = stringList(
    command,
    response,
    item.mutationBlockedReasons,
    "mutationBlockedReasons",
  );
  const manifestProvenance = normalizeManifestProvenance(
    command,
    response,
    item.manifestProvenance,
  );

  const stateFlags = byteCount(command, response, item.stateFlags, "stateFlags");
  const sizeOnDisk = byteCount(command, response, item.sizeOnDisk, "sizeOnDisk");
  const downloadIncomplete = counterIncomplete(bytesDownloaded, bytesToDownload);
  const stagingIncomplete = counterIncomplete(bytesStaged, bytesToStage);
  if (
    complete !== (lifecycle === "installed") ||
    (stable && !complete) ||
    (lifecycle === "installed" && !installDirectoryPresent) ||
    (complete && (downloadDirectoryPresent || downloadIncomplete || stagingIncomplete)) ||
    !mutationBlocked ||
    mutationBlockedReasons.length === 0 ||
    completionReasons.length === 0 ||
    stabilityReasons.length === 0
  ) {
    throw invalid(
      command,
      "inconsistent lifecycle, completeness, stability, or mutation state",
      response,
    );
  }
  if (
    lifecycle === "not-found" &&
    (manifestProvenance !== undefined ||
      installDirectoryPresent ||
      downloadDirectoryPresent ||
      stateFlags !== undefined ||
      bytesDownloaded !== undefined ||
      bytesToDownload !== undefined ||
      bytesStaged !== undefined ||
      bytesToStage !== undefined ||
      sizeOnDisk !== undefined ||
      item.manifestLastModifiedAt !== undefined)
  ) {
    throw invalid(command, "not-found product contains present metadata", response);
  }
  if (lifecycle !== "not-found" && manifestProvenance === undefined) {
    throw invalid(command, "manifest-backed lifecycle lacks provenance", response);
  }
  if (
    (lifecycle === "downloading" && !downloadIncomplete) ||
    (lifecycle === "staging" && !stagingIncomplete)
  ) {
    throw invalid(command, "active lifecycle lacks corresponding incomplete counters", response);
  }

  const downloadPercentage = normalizePercentage(
    command,
    response,
    item.downloadPercentage,
    bytesDownloaded,
    bytesToDownload,
    "downloadPercentage",
  );
  const stagingPercentage = normalizePercentage(
    command,
    response,
    item.stagingPercentage,
    bytesStaged,
    bytesToStage,
    "stagingPercentage",
  );
  const manifestLastModifiedAt =
    item.manifestLastModifiedAt === undefined || item.manifestLastModifiedAt === null
      ? undefined
      : timestamp(command, response, item.manifestLastModifiedAt, "manifestLastModifiedAt");
  return {
    product,
    lifecycle,
    installDirectoryPresent,
    downloadDirectoryPresent,
    complete,
    completionReasons,
    stable,
    stabilityReasons,
    mutationBlocked,
    mutationBlockedReasons,
    checkedAt: timestamp(command, response, item.checkedAt, "product.checkedAt"),
    ...(manifestProvenance === undefined ? {} : { manifestProvenance }),
    ...(stateFlags === undefined ? {} : { stateFlags }),
    ...(bytesDownloaded === undefined ? {} : { bytesDownloaded }),
    ...(bytesToDownload === undefined ? {} : { bytesToDownload }),
    ...(bytesStaged === undefined ? {} : { bytesStaged }),
    ...(bytesToStage === undefined ? {} : { bytesToStage }),
    ...(sizeOnDisk === undefined ? {} : { sizeOnDisk }),
    ...(downloadPercentage === undefined ? {} : { downloadPercentage }),
    ...(stagingPercentage === undefined ? {} : { stagingPercentage }),
    ...(manifestLastModifiedAt === undefined ? {} : { manifestLastModifiedAt }),
  };
}

function counterIncomplete(
  completed: SteamByteCount | undefined,
  total: SteamByteCount | undefined,
): boolean {
  return (
    completed !== undefined &&
    total !== undefined &&
    BigInt(total) > 0n &&
    BigInt(completed) < BigInt(total)
  );
}

function aggregate(products: readonly Xcom2SteamProductStatus[]): Xcom2SetupOverallState {
  const required = products.filter((product) => product.product.role === "required");
  for (const state of [
    "downloading",
    "staging",
    "verifying",
    "paused",
    "incomplete",
    "unknown",
    "not-found",
  ] as const) {
    if (required.some((product) => product.lifecycle === state)) return state;
  }
  return required.every((product) => product.complete && product.stable) ? "ready" : "incomplete";
}

function normalizeSteamRoot(
  command: string,
  response: unknown,
  value: unknown,
): Xcom2SteamRootProvenance {
  const root = record(command, response, value);
  if (
    !["steam-client", "configured", "platform-default", "unknown"].includes(
      root.source as string,
    ) ||
    root.pathRedacted !== true
  ) {
    throw invalid(command, "invalid or unredacted Steam root provenance", response);
  }
  const displayRoot = safeDisplay(command, response, root.displayRoot, "steamRoot.displayRoot");
  return {
    source: root.source as Xcom2SteamRootProvenance["source"],
    pathRedacted: true,
    ...(displayRoot === undefined ? {} : { displayRoot }),
  };
}

function normalizeSnapshot(command: string, response: unknown): Xcom2SetupMonitorSnapshot {
  const item = record(command, response);
  if (!Array.isArray(item.products)) throw invalid(command, "invalid products array", response);
  const products = item.products.map((product) => normalizeProduct(command, response, product));
  const appIds = products.map((product) => product.product.appId);
  if (
    new Set(appIds).size !== appIds.length ||
    REQUIRED_APP_IDS.some((appId) => !appIds.includes(appId))
  ) {
    throw invalid(
      command,
      "duplicate product or missing required game/development-tools identity",
      response,
    );
  }
  if (!OVERALL_STATES.has(item.overallState as Xcom2SetupOverallState)) {
    throw invalid(command, "unsupported overall state", response);
  }
  const overallState = item.overallState as Xcom2SetupOverallState;
  if (overallState !== aggregate(products))
    throw invalid(command, "overall state conflicts with required products", response);
  const canPlanSetup = bool(command, response, item.canPlanSetup, "canPlanSetup");
  const canApplySetup = bool(command, response, item.canApplySetup, "canApplySetup");
  const requiredProductsReady = products
    .filter((product) => product.product.role === "required")
    .every((product) => product.complete && product.stable);
  const planningReady = overallState === "ready" && requiredProductsReady;
  if (canPlanSetup !== planningReady) {
    throw invalid(
      command,
      "canPlanSetup conflicts with aggregate and required product readiness",
      response,
    );
  }
  if (canApplySetup) {
    throw invalid(command, "monitor snapshots cannot authorize apply", response);
  }
  return {
    workspaceId: text(command, response, item.workspaceId, "workspaceId"),
    generation: nonNegativeInteger(command, response, item.generation, "generation"),
    steamRoot: normalizeSteamRoot(command, response, item.steamRoot),
    products,
    overallState,
    canPlanSetup,
    canApplySetup: false,
    blockers: stringList(command, response, item.blockers, "blockers"),
    warnings: stringList(command, response, item.warnings, "warnings"),
    checkedAt: timestamp(command, response, item.checkedAt, "checkedAt"),
  };
}

function normalizeCause(
  command: string,
  response: unknown,
  value: unknown,
): Xcom2SetupMonitorEventCause {
  if (value !== "initial" && value !== "poll" && value !== "refresh")
    throw invalid(command, "invalid event cause", response);
  return value;
}

export class TauriXcom2SetupMonitorAdapter implements Xcom2SetupMonitorPort {
  private readonly subscriptions = new Map<number, Subscription>();
  private readonly pollIntervalMs: number;
  private readonly hiddenPollIntervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly pollLimit: number;
  private nextSubscriptionId = 0;
  private sequence = 0;
  private failures = 0;
  private polling = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private currentSnapshot: Xcom2SetupMonitorSnapshot | undefined;

  constructor(options: Xcom2SetupMonitorPollOptions = {}) {
    this.pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 250);
    this.hiddenPollIntervalMs = Math.max(
      this.pollIntervalMs,
      options.hiddenPollIntervalMs ?? 1_000,
    );
    this.maxBackoffMs = Math.max(this.pollIntervalMs, options.maxBackoffMs ?? 5_000);
    this.pollLimit = Math.min(64, Math.max(1, Math.floor(options.pollLimit ?? 64)));
  }

  private async snapshot(command: string): Promise<Xcom2SetupMonitorSnapshot> {
    try {
      const result = normalizeSnapshot(command, await invokeTauri<unknown>(command));
      this.currentSnapshot = result;
      return result;
    } catch (error) {
      throw toTauriAdapterError(command, error);
    }
  }

  getSnapshot(): Promise<Xcom2SetupMonitorSnapshot> {
    return this.snapshot(GET_COMMAND);
  }
  refresh(): Promise<Xcom2SetupMonitorSnapshot> {
    return this.snapshot(REFRESH_COMMAND);
  }

  subscribe(listener: Xcom2SetupMonitorListener): () => void {
    const id = ++this.nextSubscriptionId;
    const subscription: Subscription = { active: true, listener };
    this.subscriptions.set(id, subscription);
    if (this.subscriptions.size === 1) this.schedule(0);
    return () => {
      if (!subscription.active) return;
      subscription.active = false;
      this.subscriptions.delete(id);
      if (this.subscriptions.size === 0 && this.timer !== undefined) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    };
  }

  private schedule(delay: number): void {
    if (this.subscriptions.size === 0 || this.polling || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.poll();
    }, delay);
  }

  private nextDelay(): number {
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    const base = hidden ? this.hiddenPollIntervalMs : this.pollIntervalMs;
    return Math.min(this.maxBackoffMs, base * 2 ** Math.min(this.failures, 5));
  }

  private emit(event: Xcom2SetupMonitorEvent): void {
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.active) continue;
      try {
        subscription.listener(event);
      } catch {
        /* Listener failures do not terminate monitoring. */
      }
    }
  }

  private normalizeEvent(response: unknown, value: unknown): Xcom2SetupMonitorEvent {
    const item = record(POLL_COMMAND, response, value);
    if (item.type !== "snapshot") throw invalid(POLL_COMMAND, "unsupported event type", response);
    return {
      type: "snapshot",
      cause: normalizeCause(POLL_COMMAND, response, item.cause),
      sequence: nonNegativeInteger(POLL_COMMAND, response, item.sequence, "event.sequence"),
      snapshot: normalizeSnapshot(POLL_COMMAND, item.snapshot),
    };
  }

  private isCurrent(snapshot: Xcom2SetupMonitorSnapshot): boolean {
    const current = this.currentSnapshot;
    if (!current) return true;
    return (
      snapshot.workspaceId === current.workspaceId && snapshot.generation >= current.generation
    );
  }

  private async poll(): Promise<void> {
    if (this.polling || this.subscriptions.size === 0) return;
    this.polling = true;
    try {
      const response = await invokeTauri<unknown>(POLL_COMMAND, {
        afterSequence: this.sequence,
        limit: this.pollLimit,
      });
      if (!Array.isArray(response)) throw invalid(POLL_COMMAND, "expected event array", response);
      for (const value of response) {
        const eventRecord = record(POLL_COMMAND, response, value);
        const eventSequence = nonNegativeInteger(
          POLL_COMMAND,
          response,
          eventRecord.sequence,
          "event.sequence",
        );
        if (eventSequence <= this.sequence) continue;
        this.sequence = eventSequence;
        const event = this.normalizeEvent(response, value);
        if (!this.isCurrent(event.snapshot)) continue;
        this.currentSnapshot = event.snapshot;
        this.emit(event);
      }
      this.failures = 0;
    } catch (error) {
      this.failures += 1;
      void toTauriAdapterError(POLL_COMMAND, error);
    } finally {
      this.polling = false;
      this.schedule(this.nextDelay());
    }
  }
}
