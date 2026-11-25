import type { GitWorkspaceBlameRequest, GitWorkspaceMutationRequest } from "@ide/contracts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GitWorkspacePanel } from "./GitWorkspacePanel";
import { useGitWorkspaceController } from "./useGitWorkspaceController";
import {
  blameFixture,
  gitFixture,
  rebasePlanFixture,
  rebaseStateFixture,
} from "./gitWorkspace.fixture";
function fixture() {
  const snapshot = gitFixture();
  let dirty = false;
  const port = {
    inspect: vi.fn(async () => snapshot),
    rebasePlan: vi.fn(async (request: { upstream: string }) => rebasePlanFixture(request.upstream)),
    blame: vi.fn(async (request: GitWorkspaceBlameRequest) => blameFixture(request)),
    review: vi.fn(async (r) => ({
      revision: r.revision,
      path: r.path,
      staged: r.staged,
      text: r.staged ? "staged source" : "saved source",
      savedFingerprint: r.staged ? null : "c".repeat(64),
    })),
    mutate: vi.fn(async (_request: GitWorkspaceMutationRequest) => ({
      ...snapshot,
      revision: "d".repeat(64),
    })),
  };
  const props = {
    port,
    workspace: { id: "w", rootPath: "/workspace", name: "Workspace" },
    generation: 1,
    activeFilePath: "Main.java",
    getContext: () => ({
      workspaceId: "w",
      generation: 1,
      isSwitching: false,
      isMetadataLoading: false,
    }),
    isDirty: () => dirty,
    canMutate: () => true,
    beginBranchSwitch: vi.fn(() => ({
      reconcile: vi.fn(async () => undefined as string | undefined),
      release: vi.fn(),
    })),
    openFile: vi.fn(async () => true),
    openBlameLocation: vi.fn(
      async (_path: string, _line: number, _fingerprint: string, current: () => boolean) =>
        current(),
    ),
    onTransitionBlockReason: vi.fn(),
  };
  function Harness() {
    return <GitWorkspacePanel controller={useGitWorkspaceController(props)} />;
  }
  return {
    Harness,
    props,
    port,
    snapshot,
    setDirty: (v: boolean) => {
      dirty = v;
    },
  };
}
async function inspect() {
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh Git" })));
}
it("requires trust and explicit refresh and exposes only the saved-file staging action", async () => {
  const f = fixture();
  render(<f.Harness />);
  expect((screen.getByRole("button", { name: "Refresh Git" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(f.port.inspect).not.toHaveBeenCalled();
  await inspect();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Review saved changes in Main.java" })),
  );
  expect(screen.getByLabelText("Git changes review").textContent).toBe("saved source");
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Stage reviewed saved file" })),
  );
  expect(f.port.mutate.mock.calls[0]![0]).toMatchObject({ kind: "stage", path: "Main.java" });
});
it("keeps a dirty source visible but disables staging instead of silently saving it", async () => {
  const f = fixture();
  f.setDirty(true);
  render(<f.Harness />);
  await inspect();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Review saved changes in Main.java" })),
  );
  expect(
    (screen.getByRole("button", { name: "Stage reviewed saved file" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByText(/Save or discard this file's editor changes/)).toBeDefined();
  expect(f.port.mutate).not.toHaveBeenCalled();
});
it("requires all-staged review before an explicit authored commit and displays real history", async () => {
  const f = fixture();
  f.snapshot.files[0]!.staged = true;
  render(<f.Harness />);
  await inspect();
  fireEvent.change(screen.getByRole("textbox", { name: "Git commit message" }), {
    target: { value: "Reviewed commit" },
  });
  expect(
    (screen.getByRole("button", { name: "Commit staged changes" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Review all staged changes" })),
  );
  expect(screen.getByLabelText("Git changes review").textContent).toBe("staged source");
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Commit staged changes" })),
  );
  expect(f.port.mutate.mock.calls[0]![0]).toMatchObject({
    kind: "commit",
    message: "Reviewed commit",
  });
  expect(screen.getByRole("list", { name: "Recent Git commits" }).textContent).toContain("Initial");
});
it("offers explicit local creation and a separately selected branch switch", async () => {
  const f = fixture();
  render(<f.Harness />);
  await inspect();
  fireEvent.change(screen.getByRole("textbox", { name: "New Git branch name" }), {
    target: { value: "feature/new" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Create local branch" })),
  );
  expect(f.port.mutate.mock.calls[0]![0]).toMatchObject({
    kind: "createBranch",
    name: "feature/new",
  });
  expect(
    (screen.getByRole("button", { name: "Switch local branch" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "Target Git branch" }), {
    target: { value: "feature/topic" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Switch local branch" })),
  );
  expect(f.port.mutate.mock.calls[1]![0]).toMatchObject({
    kind: "switchBranch",
    name: "feature/topic",
  });
});

it("requires an explicit rename source and an unused destination before renaming", async () => {
  const f = fixture();
  f.setDirty(true);
  render(<f.Harness />);
  await inspect();
  const button = screen.getByRole("button", { name: "Rename local branch" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "Git branch to rename" }), {
    target: { value: "main" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Replacement Git branch name" }), {
    target: { value: "feature/topic" },
  });
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Replacement Git branch name" }), {
    target: { value: "feature/renamed" },
  });
  expect(button.disabled).toBe(false);
  await act(async () => fireEvent.click(button));
  expect(f.port.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "renameBranch", oldName: "main", name: "feature/renamed" }),
  );
});

it("shows saved attribution, pages the captured version and retains inputs on a failed read", async () => {
  const f = fixture();
  f.setDirty(true);
  render(<f.Harness />);
  fireEvent.click(screen.getByText("Saved-source blame"));
  await inspect();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Blame active saved file" })),
  );
  expect((screen.getByLabelText("Git blame file") as HTMLInputElement).value).toBe("Main.java");
  expect(screen.getByLabelText("Git blame line 1").textContent).toContain("Uncommitted saved text");
  expect(screen.getByLabelText("Git blame line 2").textContent).toContain("Fixture Author");
  expect(screen.getByText(/annotation shows only its saved text/)).toBeDefined();
  expect(
    (screen.getByRole("button", { name: "Open saved line 2" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Next blame page" })));
  expect(f.port.blame).toHaveBeenLastCalledWith(
    expect.objectContaining({
      path: "Main.java",
      startLine: 201,
      savedFingerprint: "c".repeat(64),
    }),
  );
  expect(
    (screen.getByRole("button", { name: "Next blame page" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  f.port.blame.mockRejectedValueOnce(new Error("SOURCE_CHANGED"));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Previous blame page" })),
  );
  expect(screen.queryByLabelText("Git blame lines")).toBeNull();
  expect((screen.getByLabelText("Git blame file") as HTMLInputElement).value).toBe("Main.java");
  expect(screen.getByRole("alert").textContent).toContain("SOURCE_CHANGED");
  expect(f.port.mutate).not.toHaveBeenCalled();
});

it("opens a selected clean saved blame line through fresh provider validation", async () => {
  const f = fixture();
  render(<f.Harness />);
  fireEvent.click(screen.getByText("Saved-source blame"));
  await inspect();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Blame active saved file" })),
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open saved line 2" })));
  expect(f.props.openBlameLocation).toHaveBeenCalledWith(
    "Main.java",
    2,
    "c".repeat(64),
    expect.any(Function),
  );
  expect(f.port.blame).toHaveBeenCalledTimes(2);
  expect(f.port.mutate).not.toHaveBeenCalled();
});

it("requires explicit abort acknowledgment and supports all-index review of a merge without tree changes", async () => {
  const f = fixture();
  f.snapshot.files = [];
  f.snapshot.mergeHeads = ["e".repeat(40)];
  render(<f.Harness />);
  // Trust is the first checkbox; abort confirmation does not exist before Refresh.
  await inspect();
  fireEvent.change(screen.getByRole("combobox", { name: "Target Git branch" }), {
    target: { value: "feature/topic" },
  });
  expect(
    (screen.getByRole("button", { name: "Switch local branch" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  const reviewAll = screen.getByRole("button", {
    name: "Review all staged changes",
  }) as HTMLButtonElement;
  expect(reviewAll.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("Git commit message"), {
    target: { value: "Reviewed merge without tree differences" },
  });
  await act(async () => fireEvent.click(reviewAll));
  expect(
    (screen.getByRole("button", { name: "Commit staged changes" }) as HTMLButtonElement).disabled,
  ).toBe(false);
  const abort = screen.getByRole("button", { name: "Abort reviewed merge" }) as HTMLButtonElement;
  expect(abort.disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Discard saved merge resolutions on abort" }),
  );
  expect(abort.disabled).toBe(false);
  await act(async () => fireEvent.click(abort));
  expect(f.port.mutate).toHaveBeenCalledWith(expect.objectContaining({ kind: "abortMerge" }));
});

it("shows a concrete rebase history review and requires explicit rewrite acknowledgment", async () => {
  const f = fixture();
  f.snapshot.files = [];
  render(<f.Harness />);
  await inspect();
  fireEvent.change(screen.getByRole("combobox", { name: "Git rebase upstream" }), {
    target: { value: "feature/topic" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Review local rebase" })),
  );
  expect(screen.getByLabelText("Git rebase history review").textContent).toContain("Initial");
  const start = screen.getByRole("button", { name: "Start reviewed rebase" }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  expect(f.port.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Acknowledge local history rewrite" }));
  await act(async () => fireEvent.click(start));
  expect(f.port.mutate).toHaveBeenCalledWith(expect.objectContaining({ kind: "startRebase" }));
});
it("requires separate acknowledgment for skip and abort, and review before continuation", async () => {
  const f = fixture();
  f.snapshot.files = [];
  f.snapshot.rebase = rebaseStateFixture();
  f.snapshot.commitUnavailableReason = "Rebase active";
  render(<f.Harness />);
  await inspect();
  const abort = screen.getByRole("button", { name: "Abort reviewed rebase" }) as HTMLButtonElement;
  const skip = screen.getByRole("button", {
    name: "Skip reviewed rebase commit",
  }) as HTMLButtonElement;
  expect(abort.disabled).toBe(true);
  expect(skip.disabled).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Continue reviewed rebase" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Review all staged changes" })),
  );
  expect(
    (screen.getByRole("button", { name: "Continue reviewed rebase" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", { name: "Drop stopped rebase commit" }));
  expect(skip.disabled).toBe(false);
  expect(abort.disabled).toBe(true);
  await act(async () => fireEvent.click(skip));
  expect(f.port.mutate).toHaveBeenCalledWith(expect.objectContaining({ kind: "skipRebase" }));
});
