import type {
  GitWorkspaceHistoryRequest,
  GitWorkspaceCommitReviewRequest,
  GitWorkspaceHistory,
} from "@ide/contracts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GitWorkspacePanel } from "./GitWorkspacePanel";
import { useGitWorkspaceController } from "./useGitWorkspaceController";
import { gitFixture } from "./gitWorkspace.fixture";
function page(request: GitWorkspaceHistoryRequest): GitWorkspaceHistory {
  return {
    activation: request.activation,
    revision: request.revision,
    head: request.head,
    path: request.path,
    offset: request.offset,
    nextOffset: request.offset === 0 ? 50 : null,
    commits: Array.from({ length: request.offset === 0 ? 50 : 1 }, (_, n) => ({
      id: (request.offset + n + 1).toString(16).padStart(40, "0"),
      author: "Author",
      date: "2026-11-15T12:00:00Z",
      subject: `Historical change ${request.offset + n + 1}`,
    })),
  };
}
function fixture() {
  const snapshot = gitFixture();
  const state = { workspaceId: "w", generation: 1, isSwitching: false, isMetadataLoading: false };
  const port = {
    inspect: vi.fn(async () => snapshot),
    review: vi.fn(),
    mutate: vi.fn(),
    history: vi.fn(async (r: GitWorkspaceHistoryRequest) => page(r)),
    commitReview: vi.fn(async (r: GitWorkspaceCommitReviewRequest) => ({
      ...r,
      text: "committed patch, no draft",
    })),
  };
  const openFile = vi.fn();
  const props = {
    port,
    workspace: { id: "w", name: "Workspace", rootPath: "/workspace" },
    generation: 1,
    activeFilePath: "Main.java",
    getContext: () => ({ ...state }),
    isDirty: () => true,
    canMutate: () => true,
    openFile,
    onTransitionBlockReason: vi.fn(),
    beginBranchSwitch: () => ({ reconcile: async () => undefined, release: () => {} }),
  };
  function Harness({ generation = 1 }: { generation?: number }) {
    return <GitWorkspacePanel controller={useGitWorkspaceController({ ...props, generation })} />;
  }
  return { port, props, state, Harness, openFile };
}
async function inspect() {
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh Git" })));
}
it("pages beyond recent history and reviews only the selected committed source while preserving dirty editors", async () => {
  const f = fixture();
  render(<f.Harness />);
  expect(f.port.history).not.toHaveBeenCalled();
  await inspect();
  fireEvent.click(screen.getByText("Commit history", { selector: "summary" }));
  fireEvent.change(screen.getByLabelText("Git history path"), {
    target: { value: "deleted caffè.java" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Browse commit history" })),
  );
  expect(f.port.history).toHaveBeenLastCalledWith(
    expect.objectContaining({ path: "deleted caffè.java", offset: 0, head: "b".repeat(40) }),
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Older commits" })));
  expect(screen.getByText("Historical change 51")).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Review commit / })));
  expect(f.port.commitReview).toHaveBeenLastCalledWith(
    expect.objectContaining({
      path: "deleted caffè.java",
      offset: 50,
      commit: (51).toString(16).padStart(40, "0"),
    }),
  );
  expect(screen.getByLabelText("Git historical commit review").textContent).toBe(
    "committed patch, no draft",
  );
  expect(
    (screen.getByRole("button", { name: "Older commits" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Newer commits" })));
  expect(screen.queryByLabelText("Git historical commit review")).toBeNull();
  expect(f.port.mutate).not.toHaveBeenCalled();
  expect(f.openFile).not.toHaveBeenCalled();
});
it("uses the active file literally, refuses traversal and clears captured history on refresh", async () => {
  const f = fixture();
  render(<f.Harness />);
  await inspect();
  fireEvent.click(screen.getByText("Commit history", { selector: "summary" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "History of active file" })),
  );
  expect(f.port.history).toHaveBeenLastCalledWith(
    expect.objectContaining({ path: "Main.java", offset: 0 }),
  );
  fireEvent.change(screen.getByLabelText("Git history path"), {
    target: { value: "../outside.java" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Browse commit history" })),
  );
  expect(f.port.history).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh Git" })));
  expect(screen.queryByLabelText("Git commit history")).toBeNull();
});
it.each(["history", "review"])(
  "retires a late %s reply when workspace activation changes",
  async (kind) => {
    const f = fixture();
    const view = render(<f.Harness />);
    await inspect();
    fireEvent.click(screen.getByText("Commit history", { selector: "summary" }));
    let resolve!: () => void;
    if (kind === "history")
      f.port.history.mockImplementationOnce(
        (r) =>
          new Promise((done) => {
            resolve = () => done(page(r));
          }),
      );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Browse commit history" })),
    );
    if (kind === "review") {
      f.port.commitReview.mockImplementationOnce(
        (r) =>
          new Promise((done) => {
            resolve = () => done({ ...r, text: "late private patch" });
          }),
      );
      await act(async () =>
        fireEvent.click(screen.getAllByRole("button", { name: /^Review commit / })[0]),
      );
    }
    f.state.generation = 2;
    view.rerender(<f.Harness generation={2} />);
    await act(async () => resolve());
    expect(screen.queryByLabelText("Git commit history")).toBeNull();
    expect(screen.queryByText("late private patch")).toBeNull();
  },
);
it("refuses a mismatching page instead of retaining stale Git authority", async () => {
  const f = fixture();
  f.port.history.mockImplementationOnce(async (r) => ({ ...page(r), head: "d".repeat(40) }));
  render(<f.Harness />);
  await inspect();
  fireEvent.click(screen.getByText("Commit history", { selector: "summary" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Browse commit history" })),
  );
  expect(screen.queryByLabelText("Git commit history")).toBeNull();
  expect(screen.getByText(/does not match the captured page/)).toBeTruthy();
});
