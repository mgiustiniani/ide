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
  consumeApproval(
    request: Readonly<Xcom2ProjectBuildRecipeInspectionRequest>,
  ): Promise<Xcom2ProjectBuildRecipeServiceConsumptionDecision>;
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

function exactInspectionRequest(
  request: Readonly<Xcom2ProjectBuildRecipeInspectionRequest>,
): Readonly<Xcom2ProjectBuildRecipeInspectionRequest> {
  return Object.freeze({
    workspaceId: request.workspaceId,
    generation: request.generation,
    moduleRoot: request.moduleRoot,
  });
}

function consumptionRequest(
  review: Extract<Xcom2ProjectBuildRecipeReviewResult, { kind: "ready" }>,
  request: Readonly<Xcom2ProjectBuildRecipeInspectionRequest>,
): Readonly<Xcom2ProjectBuildRecipeConsumptionRequest> {
  return Object.freeze({
    action: review.recipe.action,
    recipeDigest: review.recipe.recipeDigest,
    current: Object.freeze({
      workspaceId: request.workspaceId,
      workspaceGeneration: request.generation,
      moduleId: review.recipe.module.id,
      moduleRoot: request.moduleRoot,
      activationGeneration: review.recipe.module.activationGeneration,
      inspectionGeneration: review.recipe.inspectionGeneration,
    }),
  });
}

function revokedConsumptionDecision(
  state: Readonly<Extract<Xcom2ProjectBuildRecipeAuthorityState, { kind: "revoked" }>>,
): Xcom2ProjectBuildRecipeConsumptionDecision {
  return Object.freeze({
    kind: "refused",
    code: "authority-revoked",
    state,
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

      const candidate = await port.inspect(exactInspectionRequest(request));
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

    async consumeApproval(request) {
      const authority = state.authority;
      if (authority === undefined) {
        return Object.freeze({
          kind: "refused",
          code: "authority-unavailable",
          state: undefined,
        } as const);
      }
      if (authority.kind !== "approved") {
        return consumeXcom2ProjectBuildRecipeApproval(authority, undefined);
      }

      const revocation = reconcileXcom2ProjectBuildRecipeApproval(authority, {
        kind: "workspace-refresh",
      });
      if (revocation.kind !== "revoked") {
        const revokedState: Readonly<
          Extract<Xcom2ProjectBuildRecipeAuthorityState, { kind: "revoked" }>
        > = Object.freeze({
          kind: "revoked",
          authority: "volatile-one-shot",
          consumed: false,
        });
        state = immutableState(state.review, revokedState);
        return revokedConsumptionDecision(revokedState);
      }

      const pendingState = immutableState(state.review, revocation.state);
      state = pendingState;

      let freshReview: Xcom2ProjectBuildRecipeReviewResult;
      try {
        const candidate = await port.inspect(exactInspectionRequest(request));
        freshReview = reviewXcom2ProjectBuildRecipe(candidate);
      } catch {
        return revokedConsumptionDecision(revocation.state);
      }

      if (state !== pendingState) return revokedConsumptionDecision(revocation.state);

      const reconciliation = reconcileXcom2ProjectBuildRecipeApproval(authority, {
        kind: "current-review",
        review: freshReview,
      });
      if (reconciliation.kind !== "retained" || freshReview.kind !== "ready") {
        state = immutableState(freshReview, revocation.state);
        return revokedConsumptionDecision(revocation.state);
      }

      const decision = consumeXcom2ProjectBuildRecipeApproval(
        reconciliation.state,
        consumptionRequest(freshReview, request),
      );
      state = immutableState(freshReview, decision.state);
      return decision;
    },
  };

  return Object.freeze(service);
}
