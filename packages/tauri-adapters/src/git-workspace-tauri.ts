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
import type { GitWorkspacePort } from "@ide/web-core/ports";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import { invokeTauri } from "./errors";
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const oid = (value: unknown) =>
  typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
const text = (value: unknown) => typeof value === "string" && value.length <= 4096;
function validHistoryScope(value: unknown, request: GitWorkspaceHistoryRequest) {
  return (
    record(value) &&
    value.activation === request.activation &&
    value.revision === request.revision &&
    hash(value.revision) &&
    value.head === request.head &&
    oid(value.head) &&
    value.path === request.path &&
    (value.path === null ||
      (typeof value.path === "string" && isNormalizedWorkspaceRelativePath(value.path))) &&
    value.offset === request.offset &&
    Number.isSafeInteger(value.offset) &&
    Number(value.offset) >= 0 &&
    Number(value.offset) % 50 === 0 &&
    Number(value.offset) <= 4294967245
  );
}
function validRebase(value: unknown) {
  return (
    record(value) &&
    typeof value.branch === "string" &&
    value.branch.length > 0 &&
    value.branch.length <= 1024 &&
    oid(value.originalHead) &&
    oid(value.onto) &&
    (value.stoppedCommit === null || oid(value.stoppedCommit)) &&
    Number.isSafeInteger(value.completed) &&
    Number(value.completed) >= 0 &&
    Number.isSafeInteger(value.total) &&
    Number(value.total) > 0 &&
    Number(value.total) <= 200 &&
    Number(value.completed) <= Number(value.total)
  );
}
function snapshot(value: unknown, activation?: number): GitWorkspaceSnapshot {
  if (
    !record(value) ||
    !Number.isSafeInteger(value.activation) ||
    Number(value.activation) < 0 ||
    (activation !== undefined && value.activation !== activation) ||
    !hash(value.revision) ||
    (value.rebase !== undefined && value.rebase !== null && !validRebase(value.rebase)) ||
    (value.mergeHeads !== undefined &&
      (!Array.isArray(value.mergeHeads) ||
        value.mergeHeads.length > 16 ||
        !value.mergeHeads.every(oid))) ||
    !(value.head === null || oid(value.head)) ||
    !(value.branch === null || text(value.branch)) ||
    !Array.isArray(value.localBranches) ||
    value.localBranches.length > 2000 ||
    !value.localBranches.every(
      (branch) =>
        record(branch) &&
        text(branch.name) &&
        typeof branch.name === "string" &&
        branch.name.length > 0 &&
        !branch.name.startsWith("-") &&
        !/[\u0000-\u0020\u007f]/.test(branch.name) &&
        oid(branch.head),
    ) ||
    new Set(value.localBranches.map((branch) => branch.name)).size !== value.localBranches.length ||
    !text(value.repositoryRoot) ||
    !text(value.authorName) ||
    !text(value.authorEmail) ||
    !(value.commitUnavailableReason === null || text(value.commitUnavailableReason)) ||
    !Array.isArray(value.files) ||
    value.files.length > 2000 ||
    !Array.isArray(value.commits) ||
    value.commits.length > 50 ||
    !value.files.every(
      (file) =>
        record(file) &&
        typeof file.path === "string" &&
        isNormalizedWorkspaceRelativePath(file.path) &&
        (file.originalPath === undefined ||
          (typeof file.originalPath === "string" &&
            isNormalizedWorkspaceRelativePath(file.originalPath))) &&
        typeof file.index === "string" &&
        /^[ MADRCU?!T]$/.test(file.index) &&
        typeof file.worktree === "string" &&
        /^[ MADRCU?!T]$/.test(file.worktree) &&
        [file.staged, file.unstaged, file.conflict, file.directory].every(
          (flag) => typeof flag === "boolean",
        ),
    ) ||
    !value.commits.every(
      (commit) =>
        record(commit) &&
        oid(commit.id) &&
        text(commit.author) &&
        text(commit.date) &&
        text(commit.subject),
    )
  )
    throw new Error("Git returned a malformed workspace snapshot. Refresh before retrying.");
  return value as unknown as GitWorkspaceSnapshot;
}
export class TauriGitWorkspaceAdapter implements GitWorkspacePort {
  async branchDeletePlan(
    request: GitWorkspaceBranchDeletePlanRequest,
  ): Promise<GitWorkspaceBranchDeletePlan> {
    const value = await invokeTauri<unknown>("git_workspace_branch_delete_plan", { request });
    if (
      !record(value) ||
      value.activation !== request.activation ||
      value.revision !== request.revision ||
      !hash(value.revision) ||
      value.name !== request.name ||
      !text(value.name) ||
      !oid(value.branchHead) ||
      !oid(value.currentHead) ||
      !hash(value.fingerprint) ||
      !Number.isSafeInteger(value.commitsNotInHead) ||
      Number(value.commitsNotInHead) < 0 ||
      !Array.isArray(value.commits) ||
      value.commits.length !== Math.min(200, Number(value.commitsNotInHead)) ||
      value.commitsTruncated !== Number(value.commitsNotInHead) > 200 ||
      !value.commits.every(
        (commit) =>
          record(commit) &&
          oid(commit.id) &&
          text(commit.author) &&
          text(commit.date) &&
          text(commit.subject),
      ) ||
      new Set(value.commits.map((commit) => commit.id)).size !== value.commits.length
    )
      throw new Error("Git returned an invalid or stale branch deletion review. Refresh Git.");
    return value as unknown as GitWorkspaceBranchDeletePlan;
  }
  async history(request: GitWorkspaceHistoryRequest): Promise<GitWorkspaceHistory> {
    const value = await invokeTauri<unknown>("git_workspace_history", { request });
    if (
      !validHistoryScope(value, request) ||
      !record(value) ||
      !Array.isArray(value.commits) ||
      value.commits.length > 50 ||
      !value.commits.every(
        (commit) =>
          record(commit) &&
          oid(commit.id) &&
          text(commit.author) &&
          text(commit.date) &&
          text(commit.subject),
      ) ||
      new Set(value.commits.map((commit) => commit.id)).size !== value.commits.length ||
      !(
        value.nextOffset === null ||
        (value.nextOffset === request.offset + 50 && value.commits.length === 50)
      )
    )
      throw new Error("Git returned invalid or stale history. Refresh Git.");
    return value as unknown as GitWorkspaceHistory;
  }
  async commitReview(request: GitWorkspaceCommitReviewRequest): Promise<GitWorkspaceCommitReview> {
    const value = await invokeTauri<unknown>("git_workspace_commit_review", { request });
    if (
      !validHistoryScope(value, request) ||
      !record(value) ||
      value.commit !== request.commit ||
      !oid(value.commit) ||
      typeof value.text !== "string" ||
      new TextEncoder().encode(value.text).length > 1048576 ||
      value.text.includes("\0")
    )
      throw new Error("Git returned an invalid or stale commit review. Refresh Git.");
    return value as unknown as GitWorkspaceCommitReview;
  }
  async rebasePlan(request: GitWorkspaceRebasePlanRequest): Promise<GitWorkspaceRebasePlan> {
    const value = await invokeTauri<unknown>("git_workspace_rebase_plan", { request });
    if (
      !record(value) ||
      value.activation !== request.activation ||
      value.revision !== request.revision ||
      value.upstream !== request.upstream ||
      typeof value.branch !== "string" ||
      !value.branch ||
      value.branch.length > 1024 ||
      !oid(value.originalHead) ||
      !oid(value.onto) ||
      !hash(value.fingerprint) ||
      !Array.isArray(value.commits) ||
      value.commits.length > 200 ||
      !value.commits.every(
        (commit) =>
          record(commit) &&
          oid(commit.id) &&
          text(commit.author) &&
          text(commit.date) &&
          text(commit.subject),
      ) ||
      new Set(value.commits.map((commit) => commit.id)).size !== value.commits.length
    )
      throw new Error("Git returned invalid or stale rebase review. Refresh Git.");
    return value as unknown as GitWorkspaceRebasePlan;
  }

  async blame(request: GitWorkspaceBlameRequest): Promise<GitWorkspaceBlame> {
    const value = await invokeTauri<unknown>("git_workspace_blame", { request });
    let sourceBytes = 0;
    if (
      !record(value) ||
      value.activation !== request.activation ||
      value.revision !== request.revision ||
      value.path !== request.path ||
      value.startLine !== request.startLine ||
      !hash(value.savedFingerprint) ||
      (request.savedFingerprint !== undefined &&
        value.savedFingerprint !== request.savedFingerprint) ||
      !Number.isSafeInteger(value.totalLines) ||
      Number(value.totalLines) < 0 ||
      Number(value.totalLines) > 524288 ||
      !Number.isSafeInteger(value.startLine) ||
      Number(value.startLine) < 1 ||
      Number(value.startLine) > Math.max(1, Number(value.totalLines)) ||
      !Array.isArray(value.lines) ||
      value.lines.length !==
        Math.min(200, Math.max(0, Number(value.totalLines) - request.startLine + 1)) ||
      !value.lines.every(
        (line, index) =>
          record(line) &&
          line.line === request.startLine + index &&
          (line.commit === null
            ? line.author === null && line.authorTime === null
            : oid(line.commit) &&
              !/^0+$/u.test(line.commit as string) &&
              typeof line.author === "string" &&
              line.author.length > 0 &&
              line.author.length <= 256 &&
              Number.isSafeInteger(line.authorTime) &&
              Math.abs(Number(line.authorTime)) <= 8640000000000) &&
          typeof line.summary === "string" &&
          line.summary.length <= 1024 &&
          typeof line.text === "string" &&
          !line.text.includes("\n") &&
          !line.text.includes("\0") &&
          (sourceBytes += new TextEncoder().encode(line.text).length) <= 524288 &&
          [line.boundary, line.ignored, line.unblamable].every((flag) => typeof flag === "boolean"),
      )
    )
      throw new Error("Git returned invalid or stale saved-source blame. Refresh Git.");
    return value as unknown as GitWorkspaceBlame;
  }
  async inspect(request: GitWorkspaceRequest) {
    return snapshot(await invokeTauri<unknown>("git_workspace_status", { request }));
  }
  async review(request: GitWorkspaceReviewRequest): Promise<GitWorkspaceReview> {
    const value = await invokeTauri<unknown>("git_workspace_review", { request });
    if (
      !record(value) ||
      value.revision !== request.revision ||
      value.path !== request.path ||
      value.staged !== request.staged ||
      typeof value.text !== "string" ||
      value.text.length > 1048576 ||
      !(value.savedFingerprint === null || hash(value.savedFingerprint)) ||
      (!request.staged && !hash(value.savedFingerprint))
    )
      throw new Error("Git returned an invalid or stale changes review. Refresh before retrying.");
    return value as unknown as GitWorkspaceReview;
  }
  async mutate(request: GitWorkspaceMutationRequest) {
    return snapshot(
      await invokeTauri<unknown>("git_workspace_mutate", { request }),
      request.activation,
    );
  }
}
