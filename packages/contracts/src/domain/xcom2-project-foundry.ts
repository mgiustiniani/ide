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
