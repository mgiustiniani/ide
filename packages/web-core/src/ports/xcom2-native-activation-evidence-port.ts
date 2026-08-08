import type {
  Xcom2ModuleScanLimits,
  Xcom2NativeActivationAcknowledgment,
  Xcom2NativeActivationAcknowledgmentDecision,
  Xcom2NativeActivationCandidate,
  Xcom2NativeActivationLifecycleDecision,
  Xcom2NativeActivationLifecycleEvent,
} from "@ide/contracts";

/** Correlation for one native-owned activation attempt in the current workspace. */
export interface Xcom2NativeActivationEvidenceBeginRequest {
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly scanId: string;
  readonly scanGeneration: number;
  readonly configurationReadId: string;
  readonly limits: Readonly<Xcom2ModuleScanLimits>;
}

/** Provider-neutral lifecycle boundary for native-owned XCOM activation evidence. */
export interface Xcom2NativeActivationEvidencePort {
  readonly begin: (
    request: Readonly<Xcom2NativeActivationEvidenceBeginRequest>,
  ) => Promise<Readonly<Xcom2NativeActivationCandidate>>;

  readonly acknowledge: (
    acknowledgment: Readonly<Xcom2NativeActivationAcknowledgment>,
  ) => Promise<Readonly<Xcom2NativeActivationAcknowledgmentDecision>>;

  readonly revoke: (
    event: Readonly<Xcom2NativeActivationLifecycleEvent>,
  ) => Promise<Readonly<Xcom2NativeActivationLifecycleDecision>>;
}
