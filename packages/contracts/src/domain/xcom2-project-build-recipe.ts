/** Provider-neutral contracts for exact review of one blocked XCOM 2 project build recipe. */

export const XCOM2_PROJECT_BUILD_RECIPE_SCHEMA_VERSION = 1 as const;
export const XCOM2_PROJECT_BUILD_RECIPE_ACTIONS = Object.freeze(["default"] as const);
export const XCOM2_PROJECT_BUILD_RECIPE_SCRIPT_PATH = ".scripts/build.ps1" as const;

export const XCOM2_PROJECT_BUILD_RECIPE_ARGUMENT_ROLES = Object.freeze([
  "source-directory",
  "sdk-directory",
  "game-directory",
  "configuration",
  "build-prefix",
  "highlander-source",
  "highlander-runtime",
] as const);

export const XCOM2_PROJECT_BUILD_RECIPE_PREREQUISITE_ROLES = Object.freeze([
  "sdk-directory",
  "game-directory",
  "build-prefix",
  "build-tool",
  "highlander-runtime",
] as const);

export const XCOM2_PROJECT_BUILD_RECIPE_LIMITS = Object.freeze({
  maximumIdentityBytes: 256,
  maximumRelativePathBytes: 4096,
  maximumScriptBytes: 1024 * 1024,
  maximumNoticeBytes: 16 * 1024,
} as const);

export type Xcom2ProjectBuildRecipeAction = (typeof XCOM2_PROJECT_BUILD_RECIPE_ACTIONS)[number];
export type Xcom2ProjectBuildRecipeArgumentRole =
  (typeof XCOM2_PROJECT_BUILD_RECIPE_ARGUMENT_ROLES)[number];
export type Xcom2ProjectBuildRecipePrerequisiteRole =
  (typeof XCOM2_PROJECT_BUILD_RECIPE_PREREQUISITE_ROLES)[number];

export interface Xcom2ProjectBuildRecipeWorkspace {
  id: string;
  generation: number;
}

export interface Xcom2ProjectBuildRecipeModule {
  id: string;
  root: string;
  activationGeneration: number;
  entryType: "directory";
  containsSymlink: false;
}

export interface Xcom2ProjectBuildRecipeScript {
  relativePath: typeof XCOM2_PROJECT_BUILD_RECIPE_SCRIPT_PATH;
  entryType: "regular-file";
  containsSymlink: false;
  trust: "untrusted-project-input";
  sha256: string;
  byteSize: number;
}

export interface Xcom2ProjectBuildRecipeNotice {
  identity: string;
  text: string;
  sha256: string;
}

export interface Xcom2ProjectBuildRecipeProvenance {
  project: "X2ModBuildCommon";
  license: "MIT";
  notice: Xcom2ProjectBuildRecipeNotice;
}

export interface Xcom2ProjectBuildRecipeArgument {
  role: Xcom2ProjectBuildRecipeArgumentRole;
  valueState: "current-module" | "unresolved" | "declared" | "project-local";
  value: string;
}

export interface Xcom2ProjectBuildRecipeBuildPrefixDependency {
  identity: "pfx_copy";
  state: "unresolved";
}

export interface Xcom2ProjectBuildRecipeHighlanderSourceDependency {
  identity: string;
  relativePath: string;
  state: "project-local";
  entryType: "directory";
  containsSymlink: false;
}

export interface Xcom2ProjectBuildRecipeHighlanderRuntimeDependency {
  identity: string;
  state: "unresolved";
}

export interface Xcom2ProjectBuildRecipeDependencies {
  buildPrefix: Xcom2ProjectBuildRecipeBuildPrefixDependency;
  highlanderSource: Xcom2ProjectBuildRecipeHighlanderSourceDependency;
  highlanderRuntime: Xcom2ProjectBuildRecipeHighlanderRuntimeDependency;
}

export interface Xcom2ProjectBuildRecipeUnresolvedPrerequisite {
  role: Xcom2ProjectBuildRecipePrerequisiteRole;
  identity: string;
  state: "unresolved";
}

/** Closed native inspection candidate. It contains metadata only, never script bytes or commands. */
export interface Xcom2ProjectBuildRecipeCandidate {
  schemaVersion: typeof XCOM2_PROJECT_BUILD_RECIPE_SCHEMA_VERSION;
  canonicalization: "RFC 8785";
  digestAlgorithm: "SHA-256";
  workspace: Xcom2ProjectBuildRecipeWorkspace;
  module: Xcom2ProjectBuildRecipeModule;
  inspectionGeneration: number;
  script: Xcom2ProjectBuildRecipeScript;
  provenance: Xcom2ProjectBuildRecipeProvenance;
  action: Xcom2ProjectBuildRecipeAction;
  arguments: Xcom2ProjectBuildRecipeArgument[];
  dependencies: Xcom2ProjectBuildRecipeDependencies;
  unresolvedPrerequisites: Xcom2ProjectBuildRecipeUnresolvedPrerequisite[];
  executionBlocked: true;
}

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type Xcom2ProjectBuildRecipeBoundFacts = DeepReadonly<Xcom2ProjectBuildRecipeCandidate>;

/** Immutable reviewed facts with TypeScript-owned deterministic digest custody. */
export type Xcom2ProjectBuildRecipe = Xcom2ProjectBuildRecipeBoundFacts & {
  readonly recipeDigest: string;
};

export interface Xcom2ProjectBuildRecipePlatformCapability {
  readonly review: "available" | "unavailable";
  readonly approval: "available" | "unavailable";
  readonly execution: "unavailable";
}

export interface Xcom2ProjectBuildRecipeCapabilities {
  readonly browser: Readonly<Xcom2ProjectBuildRecipePlatformCapability>;
  readonly native: Readonly<Xcom2ProjectBuildRecipePlatformCapability>;
}

export type Xcom2ProjectBuildRecipeReviewResult =
  | {
      readonly kind: "ready";
      readonly recipe: Readonly<Xcom2ProjectBuildRecipe>;
      readonly capabilities: Readonly<Xcom2ProjectBuildRecipeCapabilities>;
    }
  | { readonly kind: "refused"; readonly code: "recipe-invalid" };

/** Exact approval payload. The recipe digest and every reviewed metadata fact travel together. */
export interface Xcom2ProjectBuildRecipeApprovalRequest {
  readonly recipeDigest: string;
  readonly recipe: Readonly<Xcom2ProjectBuildRecipe>;
}

export type Xcom2ProjectBuildRecipeAuthorityState =
  | {
      readonly kind: "approved";
      readonly authority: "volatile-one-shot";
      readonly consumed: false;
      readonly request: Readonly<Xcom2ProjectBuildRecipeApprovalRequest>;
    }
  | {
      readonly kind: "consumed";
      readonly authority: "volatile-one-shot";
      readonly consumed: true;
    }
  | {
      readonly kind: "revoked";
      readonly authority: "volatile-one-shot";
      readonly consumed: false;
    };

export type Xcom2ProjectBuildRecipeApprovalDecision =
  | {
      readonly kind: "approved";
      readonly request: Readonly<Xcom2ProjectBuildRecipeApprovalRequest>;
      readonly state: Readonly<
        Extract<Xcom2ProjectBuildRecipeAuthorityState, { kind: "approved" }>
      >;
    }
  | {
      readonly kind: "refused";
      readonly code: "review-not-ready" | "approval-already-decided";
    };

export type Xcom2ProjectBuildRecipeReconciliationEvent =
  | { readonly kind: "workspace-refresh" }
  | { readonly kind: "current-review"; readonly review: Xcom2ProjectBuildRecipeReviewResult };

export type Xcom2ProjectBuildRecipeReconciliationDecision =
  | {
      readonly kind: "retained";
      readonly state: Readonly<
        Extract<Xcom2ProjectBuildRecipeAuthorityState, { kind: "approved" }>
      >;
    }
  | {
      readonly kind: "revoked";
      readonly code: "workspace-refresh" | "recipe-changed";
      readonly state: Readonly<Extract<Xcom2ProjectBuildRecipeAuthorityState, { kind: "revoked" }>>;
    }
  | {
      readonly kind: "refused";
      readonly code: "authority-unavailable";
      readonly state: Readonly<Xcom2ProjectBuildRecipeAuthorityState>;
    };

export interface Xcom2ProjectBuildRecipeCurrentIdentity {
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly moduleId: string;
  readonly moduleRoot: string;
  readonly activationGeneration: number;
  readonly inspectionGeneration: number;
}

/** Metadata-only future-use request. It does not describe an executable or invoke a build. */
export interface Xcom2ProjectBuildRecipeConsumptionRequest {
  readonly action: Xcom2ProjectBuildRecipeAction;
  readonly recipeDigest: string;
  readonly current: Readonly<Xcom2ProjectBuildRecipeCurrentIdentity>;
}

export type Xcom2ProjectBuildRecipeConsumptionDecision =
  | {
      readonly kind: "authorized";
      readonly action: "default";
      readonly recipeDigest: string;
      readonly state: Readonly<
        Extract<Xcom2ProjectBuildRecipeAuthorityState, { kind: "consumed" }>
      >;
    }
  | {
      readonly kind: "refused";
      readonly code:
        "request-invalid" | "stale-authority" | "authority-consumed" | "authority-revoked";
      readonly state: Readonly<Xcom2ProjectBuildRecipeAuthorityState>;
    };
