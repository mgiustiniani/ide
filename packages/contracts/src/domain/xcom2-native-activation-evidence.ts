import type { Xcom2ModuleScanSnapshot } from "./xcom2-module-activation";
import type {
  Xcom2ModuleConfigurationReadResult,
  Xcom2ProjectActivationEvaluation,
} from "./xcom2-module-configuration-activation";

/** Bounds for provider-neutral opaque native receipts retained by the reusable core. */
export const XCOM2_NATIVE_ACTIVATION_EVIDENCE_LIMITS = Object.freeze({
  maximumOpaqueIdBytes: 256,
  maximumEvidenceHandles: 64,
} as const);

export type Xcom2ActivationAttemptReceipt = string;
export type Xcom2ActivationEvidenceHandle = string;

export interface Xcom2NativeActivationCorrelation {
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly activationGeneration: number;
  readonly activationAttemptReceipt: Xcom2ActivationAttemptReceipt;
}

/** One native-owned root-to-receipt association. Neither field grants authority by itself. */
export interface Xcom2NativeActivationEvidenceHandle {
  readonly moduleRoot: string;
  readonly evidenceHandle: Xcom2ActivationEvidenceHandle;
}

/** Existing scanner facts plus the native activation attempt and opaque per-root receipts. */
export interface Xcom2NativeModuleScanSnapshot
  extends Xcom2ModuleScanSnapshot, Xcom2NativeActivationCorrelation {
  readonly evidenceHandles: readonly Readonly<Xcom2NativeActivationEvidenceHandle>[];
}

type Xcom2NativeConfigurationCommon = Xcom2NativeActivationCorrelation & {
  readonly configurationReadId: string;
  readonly evidenceHandles: readonly Readonly<Xcom2NativeActivationEvidenceHandle>[];
};

/** Existing configuration facts plus the same native activation attempt and per-root receipts. */
export type Xcom2NativeModuleConfigurationReadResult =
  | (Xcom2NativeConfigurationCommon & {
      readonly kind: "absent";
    })
  | (Xcom2NativeConfigurationCommon & {
      readonly kind: "ready";
      readonly configuration: Extract<
        Xcom2ModuleConfigurationReadResult,
        { readonly kind: "ready" }
      >["configuration"];
    })
  | (Xcom2NativeConfigurationCommon & {
      readonly kind: "stopped";
      readonly code: Extract<
        Xcom2ModuleConfigurationReadResult,
        { readonly kind: "stopped" }
      >["code"];
    });

export interface Xcom2NativeActivationCandidate {
  readonly scan: Readonly<Xcom2NativeModuleScanSnapshot>;
  readonly configuration: Readonly<Xcom2NativeModuleConfigurationReadResult>;
}

export type Xcom2NativeActivationCurrent = Xcom2NativeActivationCorrelation;

/** The complete frontend-to-native acknowledgment payload. */
export interface Xcom2NativeActivationAcknowledgment {
  readonly activationAttemptReceipt: Xcom2ActivationAttemptReceipt;
  readonly evidenceHandles: readonly Xcom2ActivationEvidenceHandle[];
}

export interface Xcom2NativeSelectedActivationModule {
  readonly moduleRoot: string;
  readonly evidenceHandle: Xcom2ActivationEvidenceHandle;
}

export type Xcom2NativeActivationRevocationCode =
  | "workspace-refresh"
  | "workspace-switch-started"
  | "workspace-activation-started"
  | "workspace-activation-failed"
  | "activation-attempt-failed"
  | "newer-activation-generation"
  | "app-exit"
  | "cached-react-restoration"
  | "candidate-invalid"
  | "mixed-activation-attempt";

export type Xcom2NativeActivationEvidenceState =
  | {
      readonly kind: "pending";
      readonly workspaceId: string;
      readonly workspaceGeneration: number;
      readonly activationGeneration: number;
      readonly activationAttemptReceipt: Xcom2ActivationAttemptReceipt;
      readonly scan: Readonly<Xcom2NativeModuleScanSnapshot>;
      readonly configuration: Readonly<Xcom2NativeModuleConfigurationReadResult>;
    }
  | {
      readonly kind: "acknowledged";
      readonly workspaceId: string;
      readonly workspaceGeneration: number;
      readonly activationGeneration: number;
      readonly activationAttemptReceipt: Xcom2ActivationAttemptReceipt;
      readonly acknowledgment: Readonly<Xcom2NativeActivationAcknowledgment>;
      readonly selectedModules: readonly Readonly<Xcom2NativeSelectedActivationModule>[];
    }
  | {
      readonly kind: "revoked";
      readonly code: Xcom2NativeActivationRevocationCode;
    };

export type Xcom2NativeActivationBeginRefusalCode =
  "candidate-invalid" | "mixed-activation-attempt";

export type Xcom2NativeActivationBeginDecision =
  | {
      readonly kind: "pending";
      readonly state: Readonly<Extract<Xcom2NativeActivationEvidenceState, { kind: "pending" }>>;
    }
  | {
      readonly kind: "refused";
      readonly code: Xcom2NativeActivationBeginRefusalCode;
      readonly state: Readonly<Extract<Xcom2NativeActivationEvidenceState, { kind: "revoked" }>>;
    };

export type Xcom2NativeActivationAcknowledgmentRefusalCode =
  | "authority-unavailable"
  | "evaluation-invalid"
  | "inactive"
  | "needs-confirmation"
  | "weak-evidence"
  | "incomplete-evidence"
  | "stale-correlation"
  | "duplicate-evidence-handle"
  | "unknown-evidence-handle";

export type Xcom2NativeActivationAcknowledgmentDecision =
  | {
      readonly kind: "acknowledged";
      readonly acknowledgment: Readonly<Xcom2NativeActivationAcknowledgment>;
      readonly state: Readonly<
        Extract<Xcom2NativeActivationEvidenceState, { kind: "acknowledged" }>
      >;
    }
  | {
      readonly kind: "refused";
      readonly code: Xcom2NativeActivationAcknowledgmentRefusalCode;
      readonly state: Readonly<Xcom2NativeActivationEvidenceState>;
    };

export type Xcom2NativeActivationLifecycleEvent =
  | { readonly kind: "workspace-refresh" }
  | { readonly kind: "workspace-switch-started" }
  | { readonly kind: "workspace-activation-started" }
  | { readonly kind: "workspace-activation-failed" }
  | { readonly kind: "activation-attempt-failed" }
  | { readonly kind: "app-exit" }
  | { readonly kind: "cached-react-restoration" }
  | {
      readonly kind: "newer-activation-generation";
      readonly activationGeneration: number;
    };

export type Xcom2NativeActivationLifecycleDecision =
  | {
      readonly kind: "revoked";
      readonly state: Readonly<Extract<Xcom2NativeActivationEvidenceState, { kind: "revoked" }>>;
    }
  | {
      readonly kind: "retained";
      readonly state: Readonly<Xcom2NativeActivationEvidenceState>;
    }
  | {
      readonly kind: "refused";
      readonly code: "event-invalid";
      readonly state: Readonly<Xcom2NativeActivationEvidenceState>;
    };

/** Native confirmation of the exact roots materialized from an opaque acknowledgment. */
export interface Xcom2NativeAcceptedActivationSnapshot extends Xcom2NativeActivationCorrelation {
  readonly modules: readonly Readonly<Xcom2NativeSelectedActivationModule>[];
}

/** Existing inspection identity: deliberately no receipt or evidence handle. */
export interface Xcom2NativeInspectionCurrent {
  readonly workspaceId: string;
  readonly generation: number;
  readonly moduleRoot: string;
}

export type Xcom2NativeInspectionAuthorizationDecision =
  | {
      readonly kind: "authorized";
      readonly workspaceId: string;
      readonly generation: number;
      readonly activationGeneration: number;
      readonly moduleRoot: string;
    }
  | {
      readonly kind: "refused";
      readonly code:
        | "request-invalid"
        | "authority-unavailable"
        | "stale-workspace"
        | "module-not-active"
        | "accepted-snapshot-invalid"
        | "accepted-snapshot-mismatch";
    };

/** Documents the trusted pure evaluator input accepted by acknowledgment selection. */
export type Xcom2NativeActivationEvaluation = Readonly<Xcom2ProjectActivationEvaluation>;
