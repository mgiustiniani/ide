import type {
  GitWorkspaceBlameRequest,
  GitWorkspaceBlame,
  GitWorkspaceSnapshot,
} from "@ide/contracts";
export const gitFixture = (): GitWorkspaceSnapshot => ({
  activation: 7,
  revision: "a".repeat(64),
  branch: "main",
  localBranches: [
    { name: "main", head: "b".repeat(40) },
    { name: "feature/topic", head: "e".repeat(40) },
  ],
  head: "b".repeat(40),
  repositoryRoot: "/workspace",
  files: [
    {
      path: "Main.java",
      index: " ",
      worktree: "M",
      staged: false,
      unstaged: true,
      conflict: false,
      directory: false,
    },
  ],
  commits: [
    { id: "b".repeat(40), author: "Fixture", date: "2026-11-15T12:00:00Z", subject: "Initial" },
  ],
  authorName: "Fixture",
  authorEmail: "fixture@example.invalid",
  commitUnavailableReason: null,
});

export function blameFixture(
  request: Pick<GitWorkspaceBlameRequest, "path" | "startLine">,
): GitWorkspaceBlame {
  return {
    activation: 7,
    revision: "a".repeat(64),
    path: request.path,
    startLine: request.startLine,
    totalLines: 201,
    savedFingerprint: "c".repeat(64),
    lines: Array.from({ length: Math.min(200, 202 - request.startLine) }, (_, index) => ({
      line: request.startLine + index,
      commit: index === 0 ? null : "b".repeat(40),
      author: index === 0 ? null : "Fixture Author",
      authorTime: index === 0 ? null : 1794744000,
      summary: index === 0 ? "Uncommitted saved text" : "Initial",
      text: `saved line ${request.startLine + index}`,
      boundary: false,
      ignored: false,
      unblamable: false,
    })),
  };
}

export const rebaseStateFixture = () => ({
  branch: "main",
  originalHead: "b".repeat(40),
  onto: "e".repeat(40),
  stoppedCommit: "b".repeat(40),
  completed: 1,
  total: 1,
});
export function rebasePlanFixture(upstream: string) {
  return {
    activation: 7,
    revision: "a".repeat(64),
    branch: "main",
    upstream,
    originalHead: "b".repeat(40),
    onto: "e".repeat(40),
    commits: gitFixture().commits,
    fingerprint: "c".repeat(64),
  };
}
