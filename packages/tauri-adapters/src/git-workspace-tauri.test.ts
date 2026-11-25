import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { TauriGitWorkspaceAdapter } from "./git-workspace-tauri";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const value = () => ({
  activation: 7,
  revision: "a".repeat(64),
  head: "b".repeat(40),
  branch: "main",
  localBranches: [
    { name: "main", head: "b".repeat(40) },
    { name: "feature/topic", head: "e".repeat(40) },
  ],
  repositoryRoot: "/workspace",
  files: [],
  commits: [],
  authorName: "Fixture",
  authorEmail: "fixture@example.invalid",
  commitUnavailableReason: null,
});
const request = {
  workspacePath: "/workspace",
  trusted: true,
  activation: 7,
  revision: "a".repeat(64),
};
beforeEach(() => vi.mocked(invoke).mockReset());
it("passes workspace authority and explicit trust through the typed native request", async () => {
  vi.mocked(invoke).mockResolvedValue(value());
  await new TauriGitWorkspaceAdapter().inspect(request);
  expect(invoke).toHaveBeenCalledWith("git_workspace_status", { request });
});
it.each(["activation", "revision", "files", "head"])(
  "refuses malformed %s snapshots rather than claiming a clean repository",
  async (key) => {
    vi.mocked(invoke).mockResolvedValue({
      ...value(),
      [key]: key === "files" ? [{ path: "../outside" }] : "invalid",
    });
    await expect(new TauriGitWorkspaceAdapter().inspect(request)).rejects.toThrow(
      "malformed workspace snapshot",
    );
  },
);
it("rejects a mutation response from a retired native activation", async () => {
  vi.mocked(invoke).mockResolvedValue({ ...value(), activation: 8 });
  await expect(
    new TauriGitWorkspaceAdapter().mutate({ ...request, kind: "unstage", path: "Main.java" }),
  ).rejects.toThrow("malformed workspace snapshot");
});
it("binds a review to its path, index state and saved-byte fingerprint", async () => {
  const review = {
    revision: request.revision,
    path: "Main.java",
    staged: false,
    text: "patch",
    savedFingerprint: "c".repeat(64),
  };
  vi.mocked(invoke).mockResolvedValue(review);
  const port = new TauriGitWorkspaceAdapter();
  await expect(port.review({ ...request, path: "Main.java", staged: false })).resolves.toEqual(
    review,
  );
  vi.mocked(invoke).mockResolvedValue({ ...review, path: "Other.java" });
  await expect(port.review({ ...request, path: "Main.java", staged: false })).rejects.toThrow(
    "stale changes review",
  );
});
it.each([
  undefined,
  [{ name: "target", head: "invalid" }],
  [{ name: "target\nspoofed", head: "b".repeat(40) }],
  [
    { name: "target", head: "b".repeat(40) },
    { name: "target", head: "b".repeat(40) },
  ],
])("rejects malformed or ambiguous local branch inventories", async (localBranches) => {
  vi.mocked(invoke).mockResolvedValue({ ...value(), localBranches });
  await expect(new TauriGitWorkspaceAdapter().inspect(request)).rejects.toThrow(
    "malformed workspace snapshot",
  );
});

const blameRequest = { ...request, path: "Main.java", startLine: 1 };
function blameValue() {
  return {
    activation: 7,
    revision: request.revision,
    path: "Main.java",
    startLine: 1,
    totalLines: 1,
    savedFingerprint: "c".repeat(64),
    lines: [
      {
        line: 1,
        commit: "b".repeat(40),
        author: "Fixture",
        authorTime: 1794744000,
        summary: "Initial",
        text: "class Main {}",
        boundary: false,
        ignored: false,
        unblamable: false,
      },
    ],
  };
}
it("correlates native blame with the saved version and accepts explicit uncommitted rows", async () => {
  const value = blameValue();
  vi.mocked(invoke).mockResolvedValue(value);
  const port = new TauriGitWorkspaceAdapter();
  await expect(
    port.blame({ ...blameRequest, savedFingerprint: value.savedFingerprint }),
  ).resolves.toEqual(value);
  expect(invoke).toHaveBeenCalledWith("git_workspace_blame", {
    request: { ...blameRequest, savedFingerprint: value.savedFingerprint },
  });
  vi.mocked(invoke).mockResolvedValue({
    ...value,
    lines: [
      {
        ...value.lines[0],
        commit: null,
        author: null,
        authorTime: null,
        summary: "Uncommitted saved text",
      },
    ],
  });
  await expect(port.blame(blameRequest)).resolves.toMatchObject({ lines: [{ commit: null }] });
});
it.each([
  { activation: 8 },
  { path: "Other.java" },
  { startLine: 2 },
  { revision: "d".repeat(64) },
  { savedFingerprint: "invalid" },
  { totalLines: 2 },
  { lines: [] },
  { totalLines: 524289 },
])("rejects stale, incomplete or oversized blame pages: %j", async (patch) => {
  vi.mocked(invoke).mockResolvedValue({ ...blameValue(), ...patch });
  await expect(new TauriGitWorkspaceAdapter().blame(blameRequest)).rejects.toThrow(
    "saved-source blame",
  );
});
it.each([
  { line: 2 },
  { commit: "0".repeat(40) },
  { author: "" },
  { authorTime: 8640000000001 },
  { authorTime: 1.5 },
  { text: "a\nb" },
  { text: "a\0b" },
  { text: "x".repeat(524289) },
  { ignored: undefined },
  { commit: null, author: "forged", authorTime: null },
])("rejects malformed blame lines: %j", async (patch) => {
  const value = blameValue();
  vi.mocked(invoke).mockResolvedValue({ ...value, lines: [{ ...value.lines[0], ...patch }] });
  await expect(new TauriGitWorkspaceAdapter().blame(blameRequest)).rejects.toThrow(
    "saved-source blame",
  );
});
it("rejects a page from a different saved version even if the Git revision matches", async () => {
  vi.mocked(invoke).mockResolvedValue(blameValue());
  await expect(
    new TauriGitWorkspaceAdapter().blame({ ...blameRequest, savedFingerprint: "d".repeat(64) }),
  ).rejects.toThrow("saved-source blame");
});

it.each([["invalid"], "invalid", Array(17).fill("b".repeat(40))])(
  "refuses malformed merge parent inventories",
  async (mergeHeads) => {
    vi.mocked(invoke).mockResolvedValue({ ...value(), mergeHeads });
    await expect(new TauriGitWorkspaceAdapter().inspect(request)).rejects.toThrow(
      "malformed workspace snapshot",
    );
  },
);

const rebasePlanValue = () => ({
  activation: 7,
  revision: request.revision,
  branch: "main",
  upstream: "feature/topic",
  originalHead: "b".repeat(40),
  onto: "e".repeat(40),
  commits: [
    {
      id: "b".repeat(40),
      author: "Fixture",
      date: "2026-11-15T12:00:00Z",
      subject: "Local change",
    },
  ],
  fingerprint: "c".repeat(64),
});
it("correlates a rebase review with its captured authority and upstream", async () => {
  vi.mocked(invoke).mockResolvedValue(rebasePlanValue());
  await expect(
    new TauriGitWorkspaceAdapter().rebasePlan({ ...request, upstream: "feature/topic" }),
  ).resolves.toEqual(rebasePlanValue());
  expect(invoke).toHaveBeenCalledWith("git_workspace_rebase_plan", {
    request: { ...request, upstream: "feature/topic" },
  });
});
it.each([
  { activation: 8 },
  { revision: "d".repeat(64) },
  { upstream: "other" },
  { fingerprint: "wrong" },
  { commits: [{ id: "bad" }] },
  { commits: [rebasePlanValue().commits[0], rebasePlanValue().commits[0]] },
])("rejects invalid rebase history review %j", async (patch) => {
  vi.mocked(invoke).mockResolvedValue({ ...rebasePlanValue(), ...patch });
  await expect(
    new TauriGitWorkspaceAdapter().rebasePlan({ ...request, upstream: "feature/topic" }),
  ).rejects.toThrow("rebase review");
});
it.each([
  { branch: "" },
  { originalHead: "bad" },
  { total: 201 },
  { total: 0 },
  { completed: -1 },
  { completed: 2 },
  { stoppedCommit: "bad" },
])("rejects malformed rebase status %j", async (patch) => {
  vi.mocked(invoke).mockResolvedValue({
    ...value(),
    rebase: {
      branch: "main",
      originalHead: "b".repeat(40),
      onto: "e".repeat(40),
      stoppedCommit: null,
      completed: 1,
      total: 1,
      ...patch,
    },
  });
  await expect(new TauriGitWorkspaceAdapter().inspect(request)).rejects.toThrow(
    "malformed workspace snapshot",
  );
});

const historyRequest = { ...request, head: "b".repeat(40), path: null, offset: 0 };
const historyPage = () => ({
  activation: 7,
  revision: request.revision,
  head: historyRequest.head,
  path: null,
  offset: 0,
  nextOffset: null,
  commits: [
    {
      id: "c".repeat(40),
      author: "Author",
      date: "2026-11-15T12:00:00Z",
      subject: "Historical source",
    },
  ],
});
it("decodes a captured Git history page and first-parent commit review", async () => {
  const adapter = new TauriGitWorkspaceAdapter();
  vi.mocked(invoke).mockResolvedValueOnce(historyPage());
  await expect(adapter.history(historyRequest)).resolves.toEqual(historyPage());
  expect(invoke).toHaveBeenLastCalledWith("git_workspace_history", { request: historyRequest });
  const r = { ...historyRequest, commit: "c".repeat(40) },
    value = { ...r, text: "committed patch" };
  vi.mocked(invoke).mockResolvedValueOnce(value);
  await expect(adapter.commitReview(r)).resolves.toEqual(value);
});
it.each([
  { activation: 8 },
  { revision: "d".repeat(64) },
  { head: "d".repeat(40) },
  { path: "Main.java" },
  { offset: 50 },
  { nextOffset: 50 },
  { commits: [{ id: "--all" }] },
  { commits: Array(51).fill({ id: "c".repeat(40), author: "a", date: "d", subject: "s" }) },
  { commits: [...historyPage().commits, ...historyPage().commits] },
])("refuses malformed or stale history page %j", async (patch) => {
  vi.mocked(invoke).mockResolvedValue({ ...historyPage(), ...patch });
  await expect(new TauriGitWorkspaceAdapter().history(historyRequest)).rejects.toThrow(
    "invalid or stale history",
  );
});
it.each([
  { commit: "d".repeat(40) },
  { offset: 50 },
  { text: "bad\0patch" },
  { text: "é".repeat(524289) },
])("refuses malformed historical commit review", async (patch) => {
  const r = { ...historyRequest, commit: "c".repeat(40) };
  vi.mocked(invoke).mockResolvedValue({ ...r, text: "patch", ...patch });
  await expect(new TauriGitWorkspaceAdapter().commitReview(r)).rejects.toThrow(
    "invalid or stale commit review",
  );
});

const deletionRequest = { ...request, name: "feature/topic" };
const deletionPlan = () => ({
  activation: request.activation,
  revision: request.revision,
  name: "feature/topic",
  branchHead: "e".repeat(40),
  currentHead: "b".repeat(40),
  commitsNotInHead: 1,
  commits: [
    {
      id: "e".repeat(40),
      author: "Author",
      date: "2026-11-15T12:00:00Z",
      subject: "Unmerged change",
    },
  ],
  commitsTruncated: false,
  fingerprint: "c".repeat(64),
});
it("correlates branch deletion review and forwards explicit confirmation separately from force", async () => {
  const adapter = new TauriGitWorkspaceAdapter();
  vi.mocked(invoke).mockResolvedValueOnce(deletionPlan());
  await expect(adapter.branchDeletePlan(deletionRequest)).resolves.toEqual(deletionPlan());
  expect(invoke).toHaveBeenLastCalledWith("git_workspace_branch_delete_plan", {
    request: deletionRequest,
  });
  const r = {
    ...request,
    kind: "deleteBranch" as const,
    name: "feature/topic",
    planFingerprint: "c".repeat(64),
    confirmation: "feature/topic",
    force: true,
  };
  vi.mocked(invoke).mockResolvedValueOnce(value());
  await adapter.mutate(r);
  expect(invoke).toHaveBeenLastCalledWith("git_workspace_mutate", { request: r });
});
it.each([
  { activation: 8 },
  { revision: "d".repeat(64) },
  { name: "another" },
  { branchHead: "invalid" },
  { currentHead: null },
  { commitsNotInHead: 2 },
  { commitsNotInHead: -1 },
  { commitsTruncated: true },
  { fingerprint: "invalid" },
  { commits: [...deletionPlan().commits, ...deletionPlan().commits], commitsNotInHead: 2 },
])("refuses stale or inconsistent branch deletion review %j", async (patch) => {
  vi.mocked(invoke).mockResolvedValue({ ...deletionPlan(), ...patch });
  await expect(new TauriGitWorkspaceAdapter().branchDeletePlan(deletionRequest)).rejects.toThrow(
    "invalid or stale branch deletion review",
  );
});
