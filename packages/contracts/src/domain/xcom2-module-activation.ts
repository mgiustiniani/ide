/**
 * Provider-neutral contracts for the bounded XCOM 2 convention-evidence scan and
 * its pure module-activation decision. Scanner implementations own filesystem authority.
 */

export const XCOM2_MODULE_EVIDENCE_KINDS = Object.freeze([
  "x2proj",
  "xcommod",
  "x2mbc-script-pair",
  "engine-config",
  "unrealscript-layout",
] as const);

export type Xcom2ModuleEvidenceKind = (typeof XCOM2_MODULE_EVIDENCE_KINDS)[number];

/** The fixed first-slice bounds: workspace root depth is zero. */
export interface Xcom2ModuleScanLimits {
  readonly maximumDepth: 8;
  readonly maximumEncounteredEntries: 20_000;
}

export const XCOM2_MODULE_SCAN_LIMITS: Readonly<Xcom2ModuleScanLimits> = Object.freeze({
  maximumDepth: 8,
  maximumEncounteredEntries: 20_000,
});

/** Correlation that a consumer must match against the current workspace activation. */
export interface Xcom2ModuleScanCorrelation {
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly scanId: string;
  readonly scanGeneration: number;
}

/** One-shot request for the dedicated read-only metadata/name scanner. */
export interface Xcom2ModuleScanRequest extends Xcom2ModuleScanCorrelation {
  readonly limits: Readonly<Xcom2ModuleScanLimits>;
}

export type Xcom2ModuleScanCompleteness = "complete" | "partial";

export type Xcom2ModuleScanIssueKind =
  | "unreadable-entry"
  | "unreadable-subtree"
  | "depth-limit-reached"
  | "encountered-entry-limit-reached";

/** A display-safe limitation observed within the authorized workspace. */
export interface Xcom2ModuleScanIssue {
  readonly kind: Xcom2ModuleScanIssueKind;
  readonly relativePath: string;
}

/**
 * One accepted evidence path. `moduleRoot` and `relativePath` are canonical,
 * workspace-relative paths established by the scanner from the exact convention pattern.
 * A paired X2ModBuildCommon match is represented by its two ordered evidence paths.
 */
export interface Xcom2ModuleEvidenceObservation {
  readonly evidenceKind: Xcom2ModuleEvidenceKind;
  readonly moduleRoot: string;
  readonly relativePath: string;
}

/** Immutable scanner result candidate consumed by the pure evaluator. */
export interface Xcom2ModuleScanSnapshot extends Xcom2ModuleScanCorrelation {
  readonly completeness: Xcom2ModuleScanCompleteness;
  readonly issues: readonly Readonly<Xcom2ModuleScanIssue>[];
  readonly limits: Readonly<Xcom2ModuleScanLimits>;
  readonly observations: readonly Readonly<Xcom2ModuleEvidenceObservation>[];
}

export type Xcom2ModuleActivationState = "inactive" | "needs-confirmation" | "active";
export type Xcom2ModuleActivationConfidence = "none" | "medium" | "high";

/** One deterministically ordered convention-evidence reason. */
export interface Xcom2ModuleActivationReason {
  readonly evidenceKind: Xcom2ModuleEvidenceKind;
  readonly relativePath: string;
}

/** A decision exists only for an inferred canonical module root. */
export interface Xcom2ModuleActivationDecision {
  readonly moduleRoot: string;
  readonly state: Exclude<Xcom2ModuleActivationState, "inactive">;
  readonly confidence: Exclude<Xcom2ModuleActivationConfidence, "none">;
  readonly reasons: readonly Readonly<Xcom2ModuleActivationReason>[];
}

/** Correlated recognition state retaining scan completeness, limitations, and bounds. */
export interface Xcom2ModuleActivationSnapshot extends Xcom2ModuleScanCorrelation {
  readonly state: Xcom2ModuleActivationState;
  readonly confidence: Xcom2ModuleActivationConfidence;
  readonly completeness: Xcom2ModuleScanCompleteness;
  readonly issues: readonly Readonly<Xcom2ModuleScanIssue>[];
  readonly limits: Readonly<Xcom2ModuleScanLimits>;
  readonly decisions: readonly Readonly<Xcom2ModuleActivationDecision>[];
}
