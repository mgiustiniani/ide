// ---------------------------------------------------------------------------
// @ide/contracts – XCOM 2: War of the Chosen setup-monitor contracts
// ---------------------------------------------------------------------------
// Export-safe, provider-neutral contracts for the built-in, plugin-shaped,
// read-only Steam monitor. Adapters own Steam discovery and all local paths.

/** Stable identifier of the built-in XCOM 2 feature. */
export const XCOM2_FEATURE_ID = "ide.xcom2-wotc" as const;

export type Xcom2FeatureStatus = "experimental";

export interface Xcom2FeatureContribution {
  readonly id: string;
  readonly displayName: string;
}

/** Descriptor shape consumable by a future generic feature/plugin registry. */
export interface Xcom2FeatureDescriptor {
  readonly id: typeof XCOM2_FEATURE_ID;
  readonly apiVersion: string;
  readonly displayName: string;
  readonly fileExtensions: readonly string[];
  readonly commands: readonly Xcom2FeatureContribution[];
  /** Machine-level setup UI contributed to the application Settings surface. */
  readonly settings: readonly Xcom2FeatureContribution[];
  readonly requiredCapabilities: readonly string[];
  readonly builtIn: true;
  readonly removable: false;
  readonly status: Xcom2FeatureStatus;
}

export const XCOM2_FEATURE_DESCRIPTOR: Xcom2FeatureDescriptor = {
  id: XCOM2_FEATURE_ID,
  apiVersion: "1",
  displayName: "XCOM 2: War of the Chosen",
  fileExtensions: [".ini", ".int", ".uc", ".uci"],
  commands: [
    { id: "ide.xcom2-wotc.refreshSetupMonitor", displayName: "Refresh XCOM 2 Setup Monitor" },
    { id: "ide.xcom2-wotc.planOperationalSetup", displayName: "Plan XCOM 2 Operational Setup" },
  ],
  settings: [{ id: "ide.xcom2-wotc.setupMonitor", displayName: "XCOM 2 Setup Monitor" }],
  requiredCapabilities: ["steam.discovery.read", "filesystem.metadata.read"],
  builtIn: true,
  removable: false,
  status: "experimental",
};

export type SteamProductKind = "game" | "development-tools";
export type Xcom2SteamProductRole = "required" | "related-evidence";

/** Public Steam identity; it contains no local installation information. */
export interface Xcom2SteamProductIdentifier {
  readonly appId: number;
  readonly name: string;
  readonly kind: SteamProductKind;
  readonly role: Xcom2SteamProductRole;
}

export const XCOM2_STEAM_APP_ID = 268500 as const;
export const XCOM2_WOTC_DEVELOPMENT_TOOLS_APP_ID = 602410 as const;
export const XCOM2_VANILLA_DEVELOPMENT_TOOLS_APP_ID = 299990 as const;

export const XCOM2_STEAM_PRODUCTS = {
  game: {
    appId: XCOM2_STEAM_APP_ID,
    name: "XCOM 2",
    kind: "game",
    role: "required",
  },
  wotcDevelopmentTools: {
    appId: XCOM2_WOTC_DEVELOPMENT_TOOLS_APP_ID,
    name: "XCOM 2: War of the Chosen Development Tools",
    kind: "development-tools",
    role: "required",
  },
  vanillaDevelopmentTools: {
    appId: XCOM2_VANILLA_DEVELOPMENT_TOOLS_APP_ID,
    name: "XCOM 2 Development Tools",
    kind: "development-tools",
    role: "related-evidence",
  },
} as const satisfies Record<string, Xcom2SteamProductIdentifier>;

export type Xcom2ProductLifecycle =
  | "not-found"
  | "queued"
  | "downloading"
  | "staging"
  | "paused"
  | "verifying"
  | "installed"
  | "incomplete"
  | "unknown";

/**
 * Non-negative byte count. Numbers must be safe integers; decimal strings are
 * used when a provider value could exceed JavaScript's safe integer range.
 */
export type SteamByteCount = number | string;

/** Display-safe evidence that identifies where metadata came from, not its contents. */
export interface Xcom2ManifestProvenance {
  readonly source: "steam-appmanifest";
  /** Redacted or user-safe label only. Never place an absolute local path here. */
  readonly displayPath?: string;
  /** Makes the export policy explicit to snapshot consumers. */
  readonly pathRedacted: true;
}

/** Export-safe status for one Steam product. */
export interface Xcom2SteamProductStatus {
  readonly product: Xcom2SteamProductIdentifier;
  readonly manifestProvenance?: Xcom2ManifestProvenance;
  readonly lifecycle: Xcom2ProductLifecycle;
  /** Uninterpreted Steam StateFlags evidence retained for diagnostics. */
  readonly stateFlags?: number | string;
  readonly bytesDownloaded?: SteamByteCount;
  readonly bytesToDownload?: SteamByteCount;
  readonly bytesStaged?: SteamByteCount;
  readonly bytesToStage?: SteamByteCount;
  /** Derived only from valid byte counts and always in the inclusive range 0–100. */
  readonly downloadPercentage?: number;
  /** Derived only from valid byte counts and always in the inclusive range 0–100. */
  readonly stagingPercentage?: number;
  readonly sizeOnDisk?: SteamByteCount;
  readonly installDirectoryPresent: boolean;
  readonly downloadDirectoryPresent: boolean;
  /** ISO-8601 timestamp; absent when no manifest was found. */
  readonly manifestLastModifiedAt?: string;
  readonly complete: boolean;
  /** Human-readable evidence supporting the completeness decision. */
  readonly completionReasons: readonly string[];
  readonly stable: boolean;
  /** Human-readable evidence supporting the stability decision. */
  readonly stabilityReasons: readonly string[];
  readonly mutationBlocked: boolean;
  /** Reasons mutation is blocked; non-empty while mutationBlocked is true. */
  readonly mutationBlockedReasons: readonly string[];
  /** ISO-8601 timestamp at which this status was checked. */
  readonly checkedAt: string;
}

export type Xcom2SetupOverallState =
  | "not-found"
  | "downloading"
  | "staging"
  | "paused"
  | "verifying"
  | "ready"
  | "incomplete"
  | "unknown";

/** Display-safe provenance for Steam discovery. */
export interface Xcom2SteamRootProvenance {
  readonly source: "steam-client" | "configured" | "platform-default" | "unknown";
  /** Redacted or user-safe label only. Never place an absolute local path here. */
  readonly displayRoot?: string;
  readonly pathRedacted: true;
}

/** Point-in-time, export-safe setup-monitor state for one workspace generation. */
export interface Xcom2SetupMonitorSnapshot {
  readonly workspaceId: string;
  /** Monotonically increasing monitor generation used to reject stale events. */
  readonly generation: number;
  /** Steam root discovery source with only an optional display-safe root label. */
  readonly steamRoot: Xcom2SteamRootProvenance;
  readonly products: readonly Xcom2SteamProductStatus[];
  readonly overallState: Xcom2SetupOverallState;
  /** True only when every required Steam product is present, complete, and stable. */
  readonly canPlanSetup: boolean;
  /** Monitor evidence can enable planning, but it can never authorize mutation. */
  readonly canApplySetup: false;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly checkedAt: string;
}

export type Xcom2SetupMonitorEventCause = "initial" | "poll" | "refresh";

/** Snapshot event; sequence must increase monotonically within a subscription. */
export interface Xcom2SetupMonitorSnapshotEvent {
  readonly type: "snapshot";
  readonly cause: Xcom2SetupMonitorEventCause;
  readonly sequence: number;
  readonly snapshot: Xcom2SetupMonitorSnapshot;
}

export type Xcom2SetupMonitorEvent = Xcom2SetupMonitorSnapshotEvent;
export type Xcom2SetupMonitorListener = (event: Xcom2SetupMonitorEvent) => void;
export type Xcom2SetupMonitorUnsubscribe = () => void;

/** Validate the transport representation used for a byte count. */
export function isSteamByteCount(value: unknown): value is SteamByteCount {
  return (
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value))
  );
}

/**
 * Derive a clamped percentage from valid byte counts.
 * Returns undefined for invalid values or a zero denominator.
 */
export function deriveXcom2ProgressPercentage(
  completed: SteamByteCount | undefined,
  total: SteamByteCount | undefined,
): number | undefined {
  if (!isSteamByteCount(completed) || !isSteamByteCount(total)) return undefined;

  const completedValue = BigInt(completed);
  const totalValue = BigInt(total);
  if (totalValue <= 0n) return undefined;

  const clampedCompleted = completedValue > totalValue ? totalValue : completedValue;
  // Preserve two decimal places without converting a potentially huge count to Number.
  return Number((clampedCompleted * 10_000n) / totalValue) / 100;
}

const XCOM2_REQUIRED_STEAM_APP_IDS: ReadonlySet<number> = new Set(
  Object.values(XCOM2_STEAM_PRODUCTS)
    .filter((product) => product.role === "required")
    .map((product) => product.appId),
);

/**
 * Derive monitor planning availability from product evidence. Every known
 * required product must be represented by complete and stable status evidence.
 */
export function canPlanXcom2Setup(products: readonly Xcom2SteamProductStatus[]): boolean {
  const readyRequiredAppIds = new Set(
    products
      .filter((status) => status.product.role === "required" && status.complete && status.stable)
      .map((status) => status.product.appId),
  );

  return [...XCOM2_REQUIRED_STEAM_APP_IDS].every((appId) => readyRequiredAppIds.has(appId));
}
