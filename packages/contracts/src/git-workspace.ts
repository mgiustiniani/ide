/** Local Git operations; source buffers remain owned by the editor. */
export interface GitWorkspaceRequest {
  workspacePath: string;
  trusted: boolean;
}
export interface GitWorkspaceScope extends GitWorkspaceRequest {
  activation: number;
}
export interface GitWorkspaceFile {
  path: string;
  originalPath?: string;
  index: string;
  worktree: string;
  staged: boolean;
  unstaged: boolean;
  conflict: boolean;
  directory: boolean;
}
export interface GitWorkspaceCommit {
  id: string;
  author: string;
  date: string;
  subject: string;
}
export const GIT_HISTORY_PAGE_SIZE = 50;
export interface GitWorkspaceHistoryRequest extends GitWorkspaceScope {
  revision: string;
  head: string;
  /** Literal workspace-relative path, or null for the workspace. */
  path: string | null;
  offset: number;
}
export interface GitWorkspaceHistory extends Omit<
  GitWorkspaceHistoryRequest,
  "workspacePath" | "trusted"
> {
  commits: GitWorkspaceCommit[];
  nextOffset: number | null;
}
export interface GitWorkspaceCommitReviewRequest extends GitWorkspaceHistoryRequest {
  commit: string;
}
export interface GitWorkspaceCommitReview extends Omit<
  GitWorkspaceCommitReviewRequest,
  "workspacePath" | "trusted"
> {
  /** Read-only metadata and patch; merges compare against their first parent. */
  text: string;
}
export interface GitWorkspaceSnapshot {
  activation: number;
  revision: string;
  branch: string | null;
  localBranches: { name: string; head: string }[];
  head: string | null;
  repositoryRoot: string;
  files: GitWorkspaceFile[];
  commits: GitWorkspaceCommit[];
  authorName: string;
  authorEmail: string;
  commitUnavailableReason: string | null;
  /** Present on hosts supporting explicit local merge review. */
  mergeHeads?: string[];
  rebase?: GitWorkspaceRebase | null;
}
export interface GitWorkspaceReviewRequest extends GitWorkspaceScope {
  revision: string;
  staged: boolean;
  /** null reviews every staged file in this workspace. */
  path: string | null;
}
export interface GitWorkspaceReview {
  revision: string;
  staged: boolean;
  path: string | null;
  text: string;
  savedFingerprint: string | null;
}
export type GitWorkspaceMutationRequest = GitWorkspaceScope & {
  revision: string;
} & (
    | { kind: "stage"; path: string; savedFingerprint: string }
    | { kind: "unstage"; path: string }
    | { kind: "commit"; message: string; authorName: string; authorEmail: string }
    | { kind: "createBranch"; name: string }
    | { kind: "switchBranch"; name: string }
    | { kind: "mergeBranch"; name: string }
    | { kind: "abortMerge" }
    | { kind: "startRebase"; upstream: string; planFingerprint: string }
    | { kind: "continueRebase" | "skipRebase" | "abortRebase" }
    | { kind: "renameBranch"; oldName: string; name: string }
    | {
        kind: "deleteBranch";
        name: string;
        planFingerprint: string;
        confirmation: string;
        force: boolean;
      }
  );

export interface GitWorkspaceBranchDeletePlanRequest extends GitWorkspaceScope {
  revision: string;
  name: string;
}
export interface GitWorkspaceBranchDeletePlan {
  activation: number;
  revision: string;
  name: string;
  branchHead: string;
  currentHead: string;
  commitsNotInHead: number;
  commits: GitWorkspaceCommit[];
  commitsTruncated: boolean;
  fingerprint: string;
}

export const GIT_BLAME_PAGE_LINES = 200;
export interface GitWorkspaceBlameRequest extends GitWorkspaceScope {
  revision: string;
  path: string;
  startLine: number;
  /** Pagination must retain the captured saved source version. */
  savedFingerprint?: string;
}
export interface GitWorkspaceBlameLine {
  line: number;
  commit: string | null;
  author: string | null;
  authorTime: number | null;
  summary: string;
  text: string;
  boundary: boolean;
  ignored: boolean;
  unblamable: boolean;
}
export interface GitWorkspaceBlame {
  activation: number;
  revision: string;
  path: string;
  startLine: number;
  totalLines: number;
  savedFingerprint: string;
  lines: GitWorkspaceBlameLine[];
}

export interface GitWorkspaceRebase {
  branch: string;
  originalHead: string;
  onto: string;
  stoppedCommit: string | null;
  completed: number;
  total: number;
}
export interface GitWorkspaceRebasePlanRequest extends GitWorkspaceScope {
  revision: string;
  upstream: string;
}
export interface GitWorkspaceRebasePlan {
  activation: number;
  revision: string;
  branch: string;
  upstream: string;
  originalHead: string;
  onto: string;
  commits: GitWorkspaceCommit[];
  fingerprint: string;
}
