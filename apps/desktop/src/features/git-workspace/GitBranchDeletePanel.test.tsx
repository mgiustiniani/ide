import type {
  GitWorkspaceBranchDeletePlanRequest,
  GitWorkspaceBranchDeletePlan,
  GitWorkspaceMutationRequest,
} from "@ide/contracts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GitWorkspacePanel } from "./GitWorkspacePanel";
import { useGitWorkspaceController } from "./useGitWorkspaceController";
import { gitFixture } from "./gitWorkspace.fixture";
function fixture(count = 1) {
  const snapshot = gitFixture();
  const state = { workspaceId: "w", generation: 1, isSwitching: false, isMetadataLoading: false };
  const port = {
    inspect: vi.fn(async () => snapshot),
    review: vi.fn(),
    mutate: vi.fn(async (_r: GitWorkspaceMutationRequest) => ({
      ...snapshot,
      revision: "d".repeat(64),
      localBranches: snapshot.localBranches.filter((b) => b.name !== "feature/topic"),
    })),
    branchDeletePlan: vi.fn(
      async (r: GitWorkspaceBranchDeletePlanRequest): Promise<GitWorkspaceBranchDeletePlan> => ({
        activation: r.activation,
        revision: r.revision,
        name: r.name,
        branchHead: snapshot.localBranches.find((b) => b.name === r.name)!.head,
        currentHead: snapshot.head!,
        commitsNotInHead: count,
        commits: Array.from({ length: Math.min(count, 200) }, (_, n) => ({
          id: (n + 1).toString(16).padStart(40, "0"),
          author: "Author",
          date: "2026-11-15T12:00:00Z",
          subject: `Unmerged Java change ${n + 1}`,
        })),
        commitsTruncated: count > 200,
        fingerprint: "c".repeat(64),
      }),
    ),
  };
  const beginBranchSwitch = vi.fn(() => ({
    reconcile: vi.fn(async () => undefined),
    release: vi.fn(),
  }));
  const onTransitionBlockReason = vi.fn();
  const props = {
    port,
    workspace: { id: "w", name: "Workspace", rootPath: "/workspace" },
    generation: 1,
    getContext: () => ({ ...state }),
    isDirty: () => true,
    canMutate: () => true,
    openFile: vi.fn(),
    beginBranchSwitch,
    onTransitionBlockReason,
  };
  function Harness({ generation = 1 }: { generation?: number }) {
    return <GitWorkspacePanel controller={useGitWorkspaceController({ ...props, generation })} />;
  }
  return { snapshot, port, state, Harness, beginBranchSwitch, onTransitionBlockReason };
}
async function inspect() {
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh Git" })));
  fireEvent.click(screen.getByText("Delete a local branch", { selector: "summary" }));
  fireEvent.change(screen.getByLabelText("Git branch to delete"), {
    target: { value: "feature/topic" },
  });
}
async function review() {
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Review local branch deletion" })),
  );
}
it("requires exact name and separate force consent, then deletes only the reviewed local reference while retaining drafts", async () => {
  const f = fixture();
  render(<f.Harness />);
  await inspect();
  await review();
  expect(f.port.mutate).not.toHaveBeenCalled();
  const remove = () =>
    screen.getByRole("button", { name: "Delete reviewed local branch" }) as HTMLButtonElement;
  expect(remove().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Confirm local branch deletion name"), {
    target: { value: "feature/topic" },
  });
  expect(remove().disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Allow forced local branch deletion"));
  expect(remove().disabled).toBe(false);
  let finish!: (value: typeof f.snapshot) => void;
  f.port.mutate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => fireEvent.click(remove()));
  expect(f.port.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      kind: "deleteBranch",
      name: "feature/topic",
      confirmation: "feature/topic",
      force: true,
      planFingerprint: "c".repeat(64),
      revision: f.snapshot.revision,
    }),
  );
  expect(f.onTransitionBlockReason).toHaveBeenCalledWith(expect.stringContaining("Git operation"));
  expect(f.beginBranchSwitch).not.toHaveBeenCalled();
  await act(async () =>
    finish({
      ...f.snapshot,
      revision: "d".repeat(64),
      localBranches: [f.snapshot.localBranches[0]],
    }),
  );
  expect(screen.queryByLabelText("Git branch deletion review")).toBeNull();
  expect(f.onTransitionBlockReason).toHaveBeenLastCalledWith(null);
});
it("uses ordinary deletion for a reviewed branch already contained in HEAD", async () => {
  const f = fixture(0);
  render(<f.Harness />);
  await inspect();
  await review();
  fireEvent.change(screen.getByLabelText("Confirm local branch deletion name"), {
    target: { value: "feature/topic" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Delete reviewed local branch" })),
  );
  expect(f.port.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: "deleteBranch", force: false }),
  );
});
it("keeps a truncated commit review explicit and clears confirmation after Refresh", async () => {
  const f = fixture(201);
  render(<f.Harness />);
  await inspect();
  await review();
  expect(screen.getByText(/Only the first 200 commits/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Allow forced local branch deletion"));
  fireEvent.change(screen.getByLabelText("Confirm local branch deletion name"), {
    target: { value: "feature/topic" },
  });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh Git" })));
  expect(screen.queryByLabelText("Git branch deletion review")).toBeNull();
  await review();
  expect(
    (screen.getByLabelText("Confirm local branch deletion name") as HTMLInputElement).value,
  ).toBe("");
  expect(
    (screen.getByLabelText("Allow forced local branch deletion") as HTMLInputElement).checked,
  ).toBe(false);
});
it("refuses a mismatching branch head before any mutation", async () => {
  const f = fixture();
  const original = f.port.branchDeletePlan.getMockImplementation()!;
  f.port.branchDeletePlan.mockImplementationOnce(async (r) => ({
    ...(await original(r)),
    branchHead: "f".repeat(40),
  }));
  render(<f.Harness />);
  await inspect();
  await review();
  expect(screen.queryByLabelText("Git branch deletion review")).toBeNull();
  expect(screen.getByText(/does not match the selected branch/)).toBeTruthy();
  expect(f.port.mutate).not.toHaveBeenCalled();
});
it("suppresses a late deletion plan after workspace activation changes", async () => {
  const f = fixture();
  const original = f.port.branchDeletePlan.getMockImplementation()!;
  let finish!: () => Promise<void>;
  f.port.branchDeletePlan.mockImplementationOnce(
    (r) =>
      new Promise((resolve) => {
        finish = async () => resolve(await original(r));
      }),
  );
  const view = render(<f.Harness />);
  await inspect();
  await review();
  f.state.generation = 2;
  view.rerender(<f.Harness generation={2} />);
  await act(async () => finish());
  expect(screen.queryByLabelText("Git branch deletion review")).toBeNull();
  expect(f.port.mutate).not.toHaveBeenCalled();
});

it("admits a different branch review after deleting the previously selected branch", async () => {
  const f = fixture(0);
  f.snapshot.localBranches.push({ name: "feature/second", head: "f".repeat(40) });
  render(<f.Harness />);
  await inspect();
  await review();
  fireEvent.change(screen.getByLabelText("Confirm local branch deletion name"), {
    target: { value: "feature/topic" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Delete reviewed local branch" })),
  );
  fireEvent.click(screen.getByText("Delete a local branch", { selector: "summary" }));
  expect((screen.getByLabelText("Git branch to delete") as HTMLSelectElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("Git branch to delete"), {
    target: { value: "feature/second" },
  });
  await review();
  expect(f.port.branchDeletePlan).toHaveBeenLastCalledWith(
    expect.objectContaining({ name: "feature/second", revision: "d".repeat(64) }),
  );
  expect(screen.getByLabelText("Git branch deletion review").textContent).toContain(
    "feature/second",
  );
});
