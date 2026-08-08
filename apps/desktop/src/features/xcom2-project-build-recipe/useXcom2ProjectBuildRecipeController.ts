import type {
  Xcom2NativeInspectionAuthorizationDecision,
  Xcom2NativeInspectionCurrent,
  Xcom2ProjectBuildRecipeReviewResult,
} from "@ide/contracts";
import {
  createXcom2ProjectBuildRecipeReviewService,
  type Xcom2ProjectBuildRecipeReviewService,
} from "@ide/web-core";
import type { Xcom2ProjectBuildRecipeInspectionPort } from "@ide/web-core/ports";
import type {
  Xcom2ProjectBuildRecipeContributionPresentation,
  Xcom2ProjectBuildRecipeReviewPresentation,
  Xcom2ProjectBuildRecipeViewState,
} from "@ide/ui";
import { useCallback, useRef, useState } from "react";

export interface Xcom2ProjectBuildRecipeCurrentModule {
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly moduleRoot: string;
}

export interface UseXcom2ProjectBuildRecipeControllerDependencies {
  readonly inspection: Xcom2ProjectBuildRecipeInspectionPort;
  readonly currentModule: Readonly<Xcom2ProjectBuildRecipeCurrentModule> | null;
  readonly authorizeInspection: (
    current: Readonly<Xcom2NativeInspectionCurrent>,
  ) => Readonly<Xcom2NativeInspectionAuthorizationDecision>;
}

export interface Xcom2ProjectBuildRecipeController {
  readonly contribution: Readonly<Xcom2ProjectBuildRecipeContributionPresentation> | null;
}

type AvailableViewState = Exclude<
  Xcom2ProjectBuildRecipeViewState,
  { readonly kind: "unavailable" }
>;

interface PublishedState {
  readonly contextKey: string;
  readonly viewState: Readonly<AvailableViewState>;
}

interface AuthorizedContext {
  readonly key: string;
  readonly request: Readonly<Xcom2NativeInspectionCurrent>;
  readonly activationGeneration: number;
}

const IDLE = Object.freeze({ kind: "idle" } as const);
const INSPECTING = Object.freeze({ kind: "inspecting" } as const);

function authorizeCurrent(
  currentModule: Readonly<Xcom2ProjectBuildRecipeCurrentModule> | null,
  authorizeInspection: UseXcom2ProjectBuildRecipeControllerDependencies["authorizeInspection"],
): Readonly<AuthorizedContext> | null {
  if (!currentModule) return null;
  const request = Object.freeze({
    workspaceId: currentModule.workspaceId,
    generation: currentModule.workspaceGeneration,
    moduleRoot: currentModule.moduleRoot,
  });
  const authorization = authorizeInspection(request);
  if (authorization.kind !== "authorized") return null;
  return Object.freeze({
    key: `${authorization.workspaceId}\u0000${authorization.generation}\u0000${authorization.activationGeneration}\u0000${authorization.moduleRoot}`,
    request,
    activationGeneration: authorization.activationGeneration,
  });
}

function safeReviewPresentation(
  review: Extract<Xcom2ProjectBuildRecipeReviewResult, { readonly kind: "ready" }>,
): Readonly<Xcom2ProjectBuildRecipeReviewPresentation> {
  const recipe = review.recipe;
  return Object.freeze({
    scriptSha256: recipe.script.sha256,
    scriptByteSize: recipe.script.byteSize,
    provenance: "X2ModBuildCommon",
    license: "MIT",
    noticeIdentity: recipe.provenance.notice.identity,
    noticeText: recipe.provenance.notice.text,
    action: "Default",
    arguments: Object.freeze(
      recipe.arguments.map(({ role, valueState }) => Object.freeze({ role, valueState })),
    ),
    unresolvedPrerequisites: Object.freeze(
      recipe.unresolvedPrerequisites.map(({ role, state }) => Object.freeze({ role, state })),
    ),
  });
}

/**
 * Metadata-only desktop controller for the current native-authorized module. It deliberately
 * owns no build consumer: approval is volatile local policy state and cannot execute anything.
 */
export function useXcom2ProjectBuildRecipeController(
  dependencies: UseXcom2ProjectBuildRecipeControllerDependencies,
): Xcom2ProjectBuildRecipeController {
  const serviceOwnerRef = useRef(dependencies.inspection);
  const serviceRef = useRef<Xcom2ProjectBuildRecipeReviewService>(
    createXcom2ProjectBuildRecipeReviewService(dependencies.inspection),
  );
  const contextKeyRef = useRef<string | null>(null);
  const epochRef = useRef(0);
  const approvalStartedRef = useRef(false);
  const [published, setPublished] = useState<Readonly<PublishedState> | null>(null);

  if (serviceOwnerRef.current !== dependencies.inspection) {
    serviceRef.current.refresh();
    serviceOwnerRef.current = dependencies.inspection;
    serviceRef.current = createXcom2ProjectBuildRecipeReviewService(dependencies.inspection);
    contextKeyRef.current = null;
    epochRef.current += 1;
    approvalStartedRef.current = false;
  }

  const authorized = authorizeCurrent(dependencies.currentModule, dependencies.authorizeInspection);
  const nextContextKey = authorized?.key ?? null;
  if (contextKeyRef.current !== nextContextKey) {
    // Plain service state is revoked synchronously during render, before stale callbacks can run.
    serviceRef.current.refresh();
    contextKeyRef.current = nextContextKey;
    epochRef.current += 1;
    approvalStartedRef.current = false;
  }

  const openReview = useCallback(async (): Promise<void> => {
    const context = authorizeCurrent(dependencies.currentModule, dependencies.authorizeInspection);
    if (!context || context.key !== contextKeyRef.current) return;

    const epoch = ++epochRef.current;
    approvalStartedRef.current = false;
    setPublished(Object.freeze({ contextKey: context.key, viewState: INSPECTING }));

    try {
      const review = await serviceRef.current.review(context.request);
      const current = authorizeCurrent(
        dependencies.currentModule,
        dependencies.authorizeInspection,
      );
      if (
        epoch !== epochRef.current ||
        !current ||
        current.key !== context.key ||
        current.activationGeneration !== context.activationGeneration
      ) {
        return;
      }
      const viewState: Readonly<AvailableViewState> =
        review.kind === "ready"
          ? Object.freeze({ kind: "review-ready", review: safeReviewPresentation(review) })
          : Object.freeze({ kind: "refused", code: "recipe-invalid" });
      setPublished(Object.freeze({ contextKey: context.key, viewState }));
    } catch {
      if (epoch === epochRef.current && context.key === contextKeyRef.current) {
        setPublished(
          Object.freeze({
            contextKey: context.key,
            viewState: Object.freeze({ kind: "error", code: "inspection-failed" }),
          }),
        );
      }
    }
  }, [dependencies.authorizeInspection, dependencies.currentModule]);

  const approveExactRecipe = useCallback((): void => {
    const context = authorizeCurrent(dependencies.currentModule, dependencies.authorizeInspection);
    if (!context || context.key !== contextKeyRef.current || approvalStartedRef.current) {
      return;
    }
    approvalStartedRef.current = true;
    const decision = serviceRef.current.approve();
    const review = serviceRef.current.state.review;
    if (decision.kind === "approved" && review?.kind === "ready") {
      setPublished(
        Object.freeze({
          contextKey: context.key,
          viewState: Object.freeze({
            kind: "approved",
            review: safeReviewPresentation(review),
          }),
        }),
      );
      return;
    }
    setPublished(
      Object.freeze({
        contextKey: context.key,
        viewState: Object.freeze({ kind: "refused", code: "approval-refused" }),
      }),
    );
  }, [dependencies.authorizeInspection, dependencies.currentModule]);

  const discardReview = useCallback((): void => {
    const context = authorizeCurrent(dependencies.currentModule, dependencies.authorizeInspection);
    serviceRef.current.refresh();
    epochRef.current += 1;
    approvalStartedRef.current = false;
    if (context && context.key === contextKeyRef.current) {
      setPublished(Object.freeze({ contextKey: context.key, viewState: IDLE }));
    }
  }, [dependencies.authorizeInspection, dependencies.currentModule]);

  if (!authorized) return { contribution: null };
  const viewState = published?.contextKey === authorized.key ? published.viewState : IDLE;
  return {
    contribution: Object.freeze({
      moduleRoot: authorized.request.moduleRoot,
      viewState,
      onOpenReview: openReview,
      onApproveExactRecipe: approveExactRecipe,
      onDiscardReview: discardReview,
    }),
  };
}
