import type {
  Xcom2ModuleActivationConfidence,
  Xcom2ModuleActivationReason,
  Xcom2ModuleActivationState,
  Xcom2ModuleScanCorrelation,
} from "./xcom2-module-activation";

/** The one native-authorized, project-owned activation file. */
export const XCOM2_MODULE_CONFIGURATION_PATH = ".ide/xcom2.json" as const;

/** The exact activation-only schema identity. */
export const XCOM2_MODULE_CONFIGURATION_SCHEMA = Object.freeze({
  version: 1,
  target: "wotc",
} as const);

/** Fixed v1 input and portable-root bounds. */
export const XCOM2_MODULE_CONFIGURATION_LIMITS = Object.freeze({
  maximumFileBytes: 64 * 1024,
  minimumModuleRoots: 1,
  maximumModuleRoots: 64,
  maximumModuleRootBytes: 4096,
} as const);

export interface Xcom2ModuleConfiguration {
  readonly version: 1;
  readonly target: "wotc";
  readonly moduleRoots: readonly string[];
}

/** Correlation owned by one feature-activation generation and one configuration read. */
export interface Xcom2ModuleConfigurationReadCorrelation {
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly activationGeneration: number;
  readonly configurationReadId: string;
}

/**
 * Provider-neutral request. The native boundary owns the workspace root, fixed file path,
 * schema enforcement, and filesystem containment; callers provide none of those authorities.
 */
export type Xcom2ModuleConfigurationReadRequest = Readonly<Xcom2ModuleConfigurationReadCorrelation>;

/** Presentation-safe categories: no path, file content, provider error, or secret crosses the core. */
export type Xcom2ModuleConfigurationStopCode =
  | "configuration-unreadable"
  | "configuration-too-large"
  | "configuration-invalid-utf8"
  | "configuration-invalid-json"
  | "configuration-invalid-schema"
  | "configuration-unsupported-version"
  | "configuration-unsupported-target"
  | "configuration-invalid-module-roots";

export type Xcom2ModuleConfigurationReadResult =
  | (Readonly<Xcom2ModuleConfigurationReadCorrelation> & {
      readonly kind: "absent";
    })
  | (Readonly<Xcom2ModuleConfigurationReadCorrelation> & {
      readonly kind: "ready";
      readonly configuration: Readonly<Xcom2ModuleConfiguration>;
    })
  | (Readonly<Xcom2ModuleConfigurationReadCorrelation> & {
      readonly kind: "stopped";
      readonly code: Xcom2ModuleConfigurationStopCode;
    });

export type Xcom2ProjectActivationSource =
  "configured" | "recognized" | "configured-and-recognized";
export type Xcom2ProjectActivationConfidence = "explicit" | "high";
export type Xcom2ProjectRecognitionConfidence = Xcom2ModuleActivationConfidence;

export interface Xcom2ProjectConfigurationReason {
  readonly kind: "configuration";
  readonly target: "wotc";
}

export interface Xcom2ProjectRecognitionReason extends Xcom2ModuleActivationReason {
  readonly kind: "recognition";
}

export type Xcom2ProjectActivationReason =
  Xcom2ProjectConfigurationReason | Xcom2ProjectRecognitionReason;

export type Xcom2ProjectActivationDecision =
  | {
      readonly moduleRoot: string;
      readonly state: "needs-confirmation";
      readonly source: "recognized";
      readonly recognitionConfidence: "medium";
      readonly reasons: readonly Readonly<Xcom2ProjectRecognitionReason>[];
    }
  | {
      readonly moduleRoot: string;
      readonly state: "active";
      readonly source: Xcom2ProjectActivationSource;
      readonly activationConfidence: Xcom2ProjectActivationConfidence;
      readonly recognitionConfidence: Xcom2ProjectRecognitionConfidence;
      readonly reasons: readonly Readonly<Xcom2ProjectActivationReason>[];
    };

export interface Xcom2ProjectActivationDiagnostic {
  readonly code: Xcom2ModuleConfigurationStopCode;
}

/** One jointly correlated, immutable project-activation candidate. */
export interface Xcom2ProjectActivationSnapshot
  extends Xcom2ModuleConfigurationReadCorrelation, Xcom2ModuleScanCorrelation {
  readonly state: Xcom2ModuleActivationState;
  readonly recognitionConfidence: Xcom2ProjectRecognitionConfidence;
  readonly decisions: readonly Readonly<Xcom2ProjectActivationDecision>[];
  readonly diagnostic?: Readonly<Xcom2ProjectActivationDiagnostic>;
}

export type Xcom2ProjectActivationCorrelationMismatch =
  "configuration-correlation-mismatch" | "recognition-correlation-mismatch";

/** A stale candidate is rejected rather than converted into a state that could revoke current state. */
export type Xcom2ProjectActivationEvaluation =
  | {
      readonly kind: "accepted";
      readonly snapshot: Readonly<Xcom2ProjectActivationSnapshot>;
    }
  | {
      readonly kind: "rejected";
      readonly reason: Xcom2ProjectActivationCorrelationMismatch;
    };
