/** Provider-neutral contracts for the approved Project Foundry preview boundary. */

export const XCOM2_PROJECT_FOUNDRY_PACK_ID = "ide.xcom2.empt-v1_4" as const;
export const XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT =
  "d968be3c32b250376723563a743a120770ec5c95" as const;
export const XCOM2_PROJECT_FOUNDRY_SOURCE_TREE =
  "cc8823fa99c0d292c4fe48a8b9463ff790176371" as const;
export const XCOM2_PROJECT_FOUNDRY_PLATFORM = "Linux desktop only" as const;
export const XCOM2_PROJECT_FOUNDRY_PUBLICATION_STATUS = "Non-publishable" as const;
export const XCOM2_PROJECT_FOUNDRY_PLAN_SCHEMA_VERSION = 1 as const;

export const XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES = Object.freeze([
  "mod-id-invalid",
  "mod-id-windows-device",
  "source-commit-missing",
  "source-commit-unreadable",
  "source-commit-mismatched",
  "source-commit-fingerprint-invalid",
  "source-tree-missing",
  "source-tree-unreadable",
  "source-tree-mismatched",
  "source-tree-fingerprint-invalid",
  "source-blob-missing",
  "source-blob-unreadable",
  "source-blob-mismatched",
  "source-blob-fingerprint-invalid",
  "source-grant-invalid",
  "destination-parent-unavailable",
  "destination-parent-grant-invalid",
  "derived-destination-present",
  "derived-destination-mismatched",
  "operation-grant-invalid",
] as const);

export type Xcom2ProjectFoundryPreviewRefusalCode =
  (typeof XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES)[number];

export interface Xcom2ProjectFoundrySourceSelectionGrant {
  readonly kind: "source-repository";
  readonly repository: string;
  readonly identity: string;
}

export interface Xcom2ProjectFoundryDestinationParentSelectionGrant {
  readonly kind: "destination-parent";
  readonly parent: string;
  readonly identity: string;
}

export interface Xcom2ProjectFoundryOperationGrant {
  readonly kind: "preview-operation";
  readonly derivedDestination: string;
  readonly identity: string;
}

export interface Xcom2ProjectFoundrySourceObjectEvidence {
  readonly commit: string;
  readonly tree: string;
  readonly fingerprintResult:
    | "Verified"
    | `source-${"commit" | "tree" | "blob"}-${
        "missing" | "unreadable" | "mismatched" | "fingerprint-invalid"}`;
}

export type Xcom2ProjectFoundryDestinationState =
  "absent" | "parent-unavailable" | "present" | "mismatched";

export interface Xcom2ProjectFoundryPreviewRequest {
  readonly sourceGrant: Readonly<Xcom2ProjectFoundrySourceSelectionGrant>;
  readonly destinationParentGrant: Readonly<Xcom2ProjectFoundryDestinationParentSelectionGrant>;
  readonly operationGrant: Readonly<Xcom2ProjectFoundryOperationGrant>;
  readonly sourceObject: Readonly<Xcom2ProjectFoundrySourceObjectEvidence>;
  readonly destinationState: Xcom2ProjectFoundryDestinationState;
  readonly modId: string;
}

export interface Xcom2ProjectFoundryDirectoryPreview {
  readonly path: string;
  readonly mode: "0755";
  readonly state: "contains entries" | "empty";
}

export interface Xcom2ProjectFoundryFilePreview {
  readonly path: string;
  readonly classification: "copied" | "transformed" | "generated";
  readonly mode: "0644";
  readonly bytes: number;
  readonly sha256: string;
}

export interface Xcom2ProjectFoundryGeneratedPreview {
  readonly path: string;
  readonly encoding: "UTF-8";
  readonly byteOrderMark: "present" | "absent";
  readonly lineEndings: "LF";
  readonly escapedBytePreview: string;
}

export interface Xcom2ProjectFoundryDigestBoundPlan {
  readonly schemaVersion: typeof XCOM2_PROJECT_FOUNDRY_PLAN_SCHEMA_VERSION;
  readonly canonicalization: "RFC 8785";
  readonly digestAlgorithm: "SHA-256";
  readonly packId: typeof XCOM2_PROJECT_FOUNDRY_PACK_ID;
  readonly platform: typeof XCOM2_PROJECT_FOUNDRY_PLATFORM;
  readonly publicationStatus: typeof XCOM2_PROJECT_FOUNDRY_PUBLICATION_STATUS;
  readonly source: {
    readonly repository: string;
    readonly grantIdentity: string;
    readonly commit: typeof XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT;
    readonly tree: typeof XCOM2_PROJECT_FOUNDRY_SOURCE_TREE;
    readonly fingerprintResult: "Verified";
    readonly policy: "Committed Git objects only; working-tree modifications and untracked files are ignored";
  };
  readonly project: {
    readonly modId: string;
    readonly guid: string;
  };
  readonly destination: {
    readonly parent: string;
    readonly parentGrantIdentity: string;
    readonly derivedAbsentDestination: string;
    readonly operationGrantIdentity: string;
  };
  readonly symlinks: "none";
  readonly directories: readonly Xcom2ProjectFoundryDirectoryPreview[];
  readonly files: readonly Xcom2ProjectFoundryFilePreview[];
  readonly generatedPreviews: readonly Xcom2ProjectFoundryGeneratedPreview[];
  readonly absences: readonly string[];
  readonly warnings: readonly string[];
}

export interface Xcom2ProjectFoundryPreviewPlan extends Xcom2ProjectFoundryDigestBoundPlan {
  readonly planDigest: string;
}

export type Xcom2ProjectFoundryModIdValidationResult =
  | { readonly kind: "accepted"; readonly modId: string }
  | {
      readonly kind: "refused";
      readonly code: "mod-id-invalid" | "mod-id-windows-device";
    };

export type Xcom2ProjectFoundryPreviewResult =
  | { readonly kind: "ready"; readonly plan: Readonly<Xcom2ProjectFoundryPreviewPlan> }
  | { readonly kind: "refused"; readonly code: Xcom2ProjectFoundryPreviewRefusalCode };

/** Provider-neutral contracts for one-shot Apply of one still-live exact preview. */

export const XCOM2_PROJECT_FOUNDRY_APPLY_SCHEMA_VERSION = 1 as const;

export const XCOM2_PROJECT_FOUNDRY_APPLY_REFUSAL_CODES = Object.freeze([
  "preview-not-ready",
  "preview-stale",
  "source-grant-mismatched",
  "destination-parent-grant-mismatched",
  "operation-grant-mismatched",
  "mod-id-invalid",
  "mod-id-mismatched",
  "approved-plan-digest-invalid",
  "approved-plan-digest-mismatched",
  "apply-authority-consumed",
  "created-receipt-invalid",
] as const);

export const XCOM2_PROJECT_FOUNDRY_APPLY_FAILURE_PHASES = Object.freeze([
  "pre-commit",
  "post-commit",
] as const);

export type Xcom2ProjectFoundryApplyRefusalCode =
  (typeof XCOM2_PROJECT_FOUNDRY_APPLY_REFUSAL_CODES)[number];

export type Xcom2ProjectFoundryApplyFailurePhase =
  (typeof XCOM2_PROJECT_FOUNDRY_APPLY_FAILURE_PHASES)[number];

export interface Xcom2ProjectFoundryApplyCurrentSelection {
  readonly sourceGrant: Readonly<Xcom2ProjectFoundrySourceSelectionGrant>;
  readonly destinationParentGrant: Readonly<Xcom2ProjectFoundryDestinationParentSelectionGrant>;
  readonly operationGrant: Readonly<Xcom2ProjectFoundryOperationGrant>;
  readonly modId: string;
}

export interface Xcom2ProjectFoundryApplyRequest extends Xcom2ProjectFoundryApplyCurrentSelection {
  readonly schemaVersion: typeof XCOM2_PROJECT_FOUNDRY_APPLY_SCHEMA_VERSION;
  readonly approvedPlanDigest: string;
}

export interface Xcom2ProjectFoundryCreatedReceipt {
  readonly result: "created";
  readonly planDigest: string;
  readonly finalProjectLocation: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly committedDirectories: number;
  readonly committedFiles: number;
}

export interface Xcom2ProjectFoundryApplyRefusal {
  readonly result: "refused";
  readonly phase: "pre-commit";
  readonly reason: string;
}

export interface Xcom2ProjectFoundryApplyFailure {
  readonly result: "failed";
  readonly phase: "pre-commit";
  readonly reason: string;
}

export interface Xcom2ProjectFoundryCreatedRecoveryRequired {
  readonly result: "created-recovery-required";
  readonly phase: "post-commit";
  readonly planDigest: string;
  readonly finalProjectLocation: string;
  readonly reason: string;
}

export type Xcom2ProjectFoundryApplyResult =
  | Xcom2ProjectFoundryCreatedReceipt
  | Xcom2ProjectFoundryApplyRefusal
  | Xcom2ProjectFoundryApplyFailure
  | Xcom2ProjectFoundryCreatedRecoveryRequired;

export type Xcom2ProjectFoundryApplyAuthority = "available" | "consumed";

export interface Xcom2ProjectFoundryApplyPreparation {
  readonly preview: Readonly<Xcom2ProjectFoundryPreviewResult>;
  readonly current: Readonly<Xcom2ProjectFoundryApplyCurrentSelection>;
  readonly approvedPlanDigest: string;
  readonly authority: Xcom2ProjectFoundryApplyAuthority;
  readonly stale: boolean;
}

export type Xcom2ProjectFoundryApplyPreparationResult =
  | { readonly kind: "ready"; readonly request: Readonly<Xcom2ProjectFoundryApplyRequest> }
  | { readonly kind: "refused"; readonly code: Xcom2ProjectFoundryApplyRefusalCode };

export type Xcom2ProjectFoundryApplyInvalidation = "source" | "destination" | "mod-id";

type Xcom2ProjectFoundryReadyPreview = Extract<
  Xcom2ProjectFoundryPreviewResult,
  { readonly kind: "ready" }
>;

export interface Xcom2ProjectFoundryEditingApplyState {
  readonly status: "editing";
  readonly authority: "available";
  readonly current: Readonly<Xcom2ProjectFoundryApplyCurrentSelection>;
  readonly invalidatedBy: Xcom2ProjectFoundryApplyInvalidation;
}

export interface Xcom2ProjectFoundryReadyApplyState {
  readonly status: "ready";
  readonly authority: "available";
  readonly current: Readonly<Xcom2ProjectFoundryApplyCurrentSelection>;
  readonly preview: Readonly<Xcom2ProjectFoundryReadyPreview>;
}

export interface Xcom2ProjectFoundryApplyingState {
  readonly status: "applying";
  readonly authority: "consumed";
  readonly preview: Readonly<Xcom2ProjectFoundryReadyPreview>;
  readonly request: Readonly<Xcom2ProjectFoundryApplyRequest>;
}

export interface Xcom2ProjectFoundryCreatedState {
  readonly status: "created";
  readonly authority: "consumed";
  readonly receipt: Readonly<Xcom2ProjectFoundryCreatedReceipt>;
}

export interface Xcom2ProjectFoundryRefusedApplyState {
  readonly status: "refused";
  readonly authority: "consumed";
  readonly refusal: Readonly<Xcom2ProjectFoundryApplyRefusal>;
}

export interface Xcom2ProjectFoundryFailedApplyState {
  readonly status: "failed";
  readonly authority: "consumed";
  readonly failure: Readonly<Xcom2ProjectFoundryApplyFailure>;
}

export interface Xcom2ProjectFoundryRecoveryRequiredApplyState {
  readonly status: "created-recovery-required";
  readonly authority: "consumed";
  readonly failure: Readonly<Xcom2ProjectFoundryCreatedRecoveryRequired>;
}

export type Xcom2ProjectFoundryApplyState =
  | Xcom2ProjectFoundryEditingApplyState
  | Xcom2ProjectFoundryReadyApplyState
  | Xcom2ProjectFoundryApplyingState
  | Xcom2ProjectFoundryCreatedState
  | Xcom2ProjectFoundryRefusedApplyState
  | Xcom2ProjectFoundryFailedApplyState
  | Xcom2ProjectFoundryRecoveryRequiredApplyState;

export type Xcom2ProjectFoundryApplyEvent =
  | {
      readonly kind: "source-selection-changed";
      readonly sourceGrant: Readonly<Xcom2ProjectFoundrySourceSelectionGrant>;
    }
  | {
      readonly kind: "destination-selection-changed";
      readonly destinationParentGrant: Readonly<Xcom2ProjectFoundryDestinationParentSelectionGrant>;
      readonly operationGrant: Readonly<Xcom2ProjectFoundryOperationGrant>;
    }
  | { readonly kind: "mod-id-changed"; readonly modId: string }
  | { readonly kind: "apply-requested"; readonly approvedPlanDigest: string }
  | { readonly kind: "apply-completed"; readonly result: Readonly<Xcom2ProjectFoundryApplyResult> };

export type Xcom2ProjectFoundryApplyStateDecision =
  | { readonly kind: "transitioned"; readonly state: Xcom2ProjectFoundryApplyState }
  | {
      readonly kind: "prepared";
      readonly state: Xcom2ProjectFoundryApplyingState;
      readonly request: Readonly<Xcom2ProjectFoundryApplyRequest>;
    }
  | {
      readonly kind: "refused";
      readonly code: Xcom2ProjectFoundryApplyRefusalCode;
      readonly state: Xcom2ProjectFoundryApplyState;
    };
