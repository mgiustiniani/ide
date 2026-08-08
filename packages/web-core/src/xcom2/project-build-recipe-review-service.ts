import {
  approveXcom2ProjectBuildRecipe,
  consumeXcom2ProjectBuildRecipeApproval,
  reconcileXcom2ProjectBuildRecipeApproval,
  reviewXcom2ProjectBuildRecipe,
  type Xcom2ProjectBuildRecipeApprovalDecision,
  type Xcom2ProjectBuildRecipeAuthorityState,
  type Xcom2ProjectBuildRecipeConsumptionDecision,
  type Xcom2ProjectBuildRecipeConsumptionRequest,
  type Xcom2ProjectBuildRecipeReviewResult,
} from "@ide/contracts";

import type {
  Xcom2ProjectBuildRecipeInspectionPort,
  Xcom2ProjectBuildRecipeInspectionRequest,
} from "../ports/xcom2-project-build-recipe-inspection-port";

export interface Xcom2ProjectBuildRecipeReviewState {
  readonly review?: Readonly<Xcom2ProjectBuildRecipeReviewResult>;
  readonly authority?: Readonly<Xcom2ProjectBuildRecipeAuthorityState>;
}

export type Xcom2ProjectBuildRecipeServiceConsumptionDecision =
  | Xcom2ProjectBuildRecipeConsumptionDecision
  | {
      readonly kind: "refused";
      readonly code: "authority-unavailable";
      readonly state: undefined;
    };

export interface Xcom2ProjectBuildRecipeReviewService {
  readonly state: Readonly<Xcom2ProjectBuildRecipeReviewState>;
  review(
    request: Readonly<Xcom2ProjectBuildRecipeInspectionRequest>,
  ): Promise<Xcom2ProjectBuildRecipeReviewResult>;
  approve(): Xcom2ProjectBuildRecipeApprovalDecision;
  refresh(): void;
  consumeApproval(): Xcom2ProjectBuildRecipeServiceConsumptionDecision;
}

function immutableState(
  review?: Readonly<Xcom2ProjectBuildRecipeReviewResult>,
  authority?: Readonly<Xcom2ProjectBuildRecipeAuthorityState>,
): Readonly<Xcom2ProjectBuildRecipeReviewState> {
  return Object.freeze({
    ...(review === undefined ? {} : { review }),
    ...(authority === undefined ? {} : { authority }),
  });
}

function revokeForRefresh(
  authority: Readonly<Xcom2ProjectBuildRecipeAuthorityState> | undefined,
): Readonly<Xcom2ProjectBuildRecipeAuthorityState> | undefined {
  if (authority === undefined) return undefined;
  return reconcileXcom2ProjectBuildRecipeApproval(authority, {
    kind: "workspace-refresh",
  }).state;
}

function consumptionRequest(
  authority: Readonly<Xcom2ProjectBuildRecipeAuthorityState>,
): Readonly<Xcom2ProjectBuildRecipeConsumptionRequest> | undefined {
  if (authority.kind !== "approved") return undefined;

  const recipe = authority.request.recipe;
  return Object.freeze({
    action: recipe.action,
    recipeDigest: authority.request.recipeDigest,
    current: Object.freeze({
      workspaceId: recipe.workspace.id,
      workspaceGeneration: recipe.workspace.generation,
      moduleId: recipe.module.id,
      moduleRoot: recipe.module.root,
      activationGeneration: recipe.module.activationGeneration,
      inspectionGeneration: recipe.inspectionGeneration,
    }),
  });
}

/**
 * Coordinate metadata-only inspection with the pure exact-recipe policy.
 * This service owns volatile approval state and intentionally exposes no execution capability.
 */
export function createXcom2ProjectBuildRecipeReviewService(
  port: Xcom2ProjectBuildRecipeInspectionPort,
): Xcom2ProjectBuildRecipeReviewService {
  let state = immutableState();
  let reviewEpoch = 0;

  const service: Xcom2ProjectBuildRecipeReviewService = {
    get state() {
      return state;
    },

    async review(request) {
      const epoch = ++reviewEpoch;
      const authority = revokeForRefresh(state.authority);
      state = immutableState(undefined, authority);

      const candidate = await port.inspect(
        Object.freeze({
          workspaceId: request.workspaceId,
          generation: request.generation,
          moduleRoot: request.moduleRoot,
        }),
      );
      const review = reviewXcom2ProjectBuildRecipe(candidate);

      if (epoch === reviewEpoch) state = immutableState(review, authority);
      return review;
    },

    approve() {
      const decision = approveXcom2ProjectBuildRecipe(state.authority ?? state.review);
      if (decision.kind === "approved") state = immutableState(state.review, decision.state);
      return decision;
    },

    refresh() {
      reviewEpoch += 1;
      state = immutableState(undefined, revokeForRefresh(state.authority));
    },

    consumeApproval() {
      const authority = state.authority;
      if (authority === undefined) {
        return Object.freeze({
          kind: "refused",
          code: "authority-unavailable",
          state: undefined,
        } as const);
      }

      const decision = consumeXcom2ProjectBuildRecipeApproval(
        authority,
        consumptionRequest(authority),
      );
      state = immutableState(state.review, decision.state);
      return decision;
    },
  };

  return Object.freeze(service);
}
