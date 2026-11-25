import type {
  GitWorkspaceBranchDeletePlan,
  GitWorkspaceBranchDeletePlanRequest,
  GitWorkspaceHistory,
  GitWorkspaceHistoryRequest,
  GitWorkspaceCommitReview,
  GitWorkspaceCommitReviewRequest,
  GitWorkspaceBlame,
  GitWorkspaceBlameRequest,
  GitWorkspaceMutationRequest,
  GitWorkspaceRequest,
  GitWorkspaceRebasePlan,
  GitWorkspaceRebasePlanRequest,
  GitWorkspaceReview,
  GitWorkspaceReviewRequest,
  GitWorkspaceSnapshot,
} from "@ide/contracts";

/** Explicit local Git actions. Implementations never save editor buffers. */
export interface GitWorkspacePort {
  branchDeletePlan?(
    request: GitWorkspaceBranchDeletePlanRequest,
  ): Promise<GitWorkspaceBranchDeletePlan>;
  history?(request: GitWorkspaceHistoryRequest): Promise<GitWorkspaceHistory>;
  commitReview?(request: GitWorkspaceCommitReviewRequest): Promise<GitWorkspaceCommitReview>;
  rebasePlan?(request: GitWorkspaceRebasePlanRequest): Promise<GitWorkspaceRebasePlan>;
  blame?(request: GitWorkspaceBlameRequest): Promise<GitWorkspaceBlame>;
  inspect(request: GitWorkspaceRequest): Promise<GitWorkspaceSnapshot>;
  review(request: GitWorkspaceReviewRequest): Promise<GitWorkspaceReview>;
  mutate(request: GitWorkspaceMutationRequest): Promise<GitWorkspaceSnapshot>;
}
