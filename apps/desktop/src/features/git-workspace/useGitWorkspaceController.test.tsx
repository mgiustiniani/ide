import type { GitWorkspaceBlameRequest, GitWorkspaceMutationRequest } from "@ide/contracts";
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  blameFixture,
  gitFixture,
  rebasePlanFixture,
  rebaseStateFixture,
} from "./gitWorkspace.fixture";
import { useGitWorkspaceController } from "./useGitWorkspaceController";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const snapshot = gitFixture();
  const state = { workspaceId: "w", generation: 1, isSwitching: false, isMetadataLoading: false };
  let dirty = false;
  const port = {
    inspect: vi.fn(async () => snapshot),
    rebasePlan: vi.fn(async (request: { upstream: string }) => rebasePlanFixture(request.upstream)),
    blame: vi.fn(async (request: GitWorkspaceBlameRequest) => blameFixture(request)),
    review: vi.fn(async (request) => ({
      revision: request.revision,
      path: request.path,
      staged: request.staged,
      text: "patch",
      savedFingerprint: request.staged ? null : "c".repeat(64),
    })),
    mutate: vi.fn(async (_request: GitWorkspaceMutationRequest) => ({
      ...snapshot,
      revision: "d".repeat(64),
    })),
  };
  const onTransitionBlockReason = vi.fn();
  const openFile = vi.fn(async () => true);
  const props = {
    port,
    workspace: { id: "w", name: "Workspace", rootPath: "/workspace" },
    generation: 1,
    activeFilePath: "Main.java",
    getContext: () => ({ ...state }),
    isDirty: () => dirty,
    canMutate: () => true,
    beginBranchSwitch: vi.fn(() => ({
      reconcile: vi.fn(async () => undefined as string | undefined),
      release: vi.fn(),
    })),
    onTransitionBlockReason,
    openFile,
    openBlameLocation: vi.fn(
      async (_path: string, _line: number, _fingerprint: string, current: () => boolean) =>
        current(),
    ),
  };
  const hook = renderHook((props) => useGitWorkspaceController(props), { initialProps: props });
  return {
    hook,
    props,
    port,
    snapshot,
    state,
    onTransitionBlockReason,
    openFile,
    setDirty: (value: boolean) => {
      dirty = value;
    },
  };
}
async function inspect(f: ReturnType<typeof fixture>) {
  act(() => f.hook.result.current.setTrusted(true));
  await act(async () => {
    expect(await f.hook.result.current.refresh()).toBe(true);
  });
}
it("never invokes Git before explicit trust and refresh", async () => {
  const f = fixture();
  await act(async () => {
    expect(await f.hook.result.current.refresh()).toBe(false);
  });
  expect(f.port.inspect).not.toHaveBeenCalled();
  act(() => f.hook.result.current.setTrusted(true));
  expect(f.port.inspect).not.toHaveBeenCalled();
  await act(async () => {
    await f.hook.result.current.refresh();
  });
  expect(f.hook.result.current.snapshot).toEqual(f.snapshot);
});
it("stages only the reviewed saved version and blocks transitions until the native response", async () => {
  const f = fixture();
  await inspect(f);
  await act(async () => {
    await f.hook.result.current.review("Main.java", false);
  });
  const pending = deferred<typeof f.snapshot>();
  f.port.mutate.mockReturnValueOnce(pending.promise);
  let action!: Promise<boolean>;
  act(() => {
    action = f.hook.result.current.stage();
  });
  expect(f.onTransitionBlockReason).toHaveBeenCalledWith(
    expect.stringContaining("Wait for the Git"),
  );
  expect(f.hook.result.current.isWriting).toBe(true);
  expect(f.port.mutate.mock.calls[0]![0]).toMatchObject({
    kind: "stage",
    path: "Main.java",
    activation: 7,
    revision: "a".repeat(64),
    savedFingerprint: "c".repeat(64),
  });
  await act(async () => {
    pending.resolve({ ...f.snapshot, revision: "d".repeat(64) });
    expect(await action).toBe(true);
  });
  expect(f.onTransitionBlockReason).toHaveBeenLastCalledWith(null);
  expect(f.hook.result.current.selection).toBeNull();
});
it("refuses unsaved edits checked at invocation rather than review time", async () => {
  const f = fixture();
  await inspect(f);
  await act(async () => {
    await f.hook.result.current.review("Main.java", false);
  });
  f.setDirty(true);
  await act(async () => {
    expect(await f.hook.result.current.stage()).toBe(false);
  });
  expect(f.port.mutate).not.toHaveBeenCalled();
  expect(f.hook.result.current.error).toContain("unsaved");
});
it("requires all-staged review, identity and message before commit", async () => {
  const f = fixture();
  f.snapshot.files[0]!.staged = true;
  await inspect(f);
  act(() => f.hook.result.current.setMessage("Explicit commit"));
  await act(async () => {
    await f.hook.result.current.review("Main.java", true);
    expect(await f.hook.result.current.commit()).toBe(false);
  });
  await act(async () => {
    await f.hook.result.current.review(null, true);
  });
  expect(f.hook.result.current.canCommit).toBe(true);
  await act(async () => {
    expect(await f.hook.result.current.commit()).toBe(true);
  });
  expect(f.port.mutate.mock.calls[0]![0]).toMatchObject({
    kind: "commit",
    message: "Explicit commit",
    authorName: "Fixture",
    authorEmail: "fixture@example.invalid",
  });
});
it("does not commit when outside staging or repository operation prevents review", async () => {
  const f = fixture();
  f.snapshot.files[0]!.staged = true;
  f.snapshot.commitUnavailableReason = "Outside workspace";
  await inspect(f);
  act(() => f.hook.result.current.setMessage("Commit"));
  await act(async () => {
    await f.hook.result.current.review(null, true);
    expect(await f.hook.result.current.commit()).toBe(false);
  });
  expect(f.port.mutate).not.toHaveBeenCalled();
});
it("revokes snapshots and reviews on failure without pretending that mutation did not occur", async () => {
  const f = fixture();
  await inspect(f);
  await act(async () => {
    await f.hook.result.current.review("Main.java", false);
  });
  f.port.mutate.mockRejectedValueOnce(new Error("Git failed; refresh the index"));
  await act(async () => {
    expect(await f.hook.result.current.stage()).toBe(false);
  });
  expect(f.hook.result.current.snapshot).toBeNull();
  expect(f.hook.result.current.error).toContain("refresh");
  expect(f.onTransitionBlockReason).toHaveBeenLastCalledWith(null);
});
it("rejects a retained action when live workspace authority has changed before React", async () => {
  const f = fixture();
  await inspect(f);
  await act(async () => {
    await f.hook.result.current.review("Main.java", false);
  });
  const stage = f.hook.result.current.stage;
  f.state.generation++;
  await act(async () => {
    expect(await stage()).toBe(false);
  });
  expect(f.port.mutate).not.toHaveBeenCalled();
});
it("ignores old status responses and resets trust and message on a new activation", async () => {
  const f = fixture(),
    pending = deferred<typeof f.snapshot>();
  f.port.inspect.mockReturnValueOnce(pending.promise);
  act(() => {
    f.hook.result.current.setTrusted(true);
    f.hook.result.current.setMessage("Old message");
  });
  let request!: Promise<boolean>;
  act(() => {
    request = f.hook.result.current.refresh();
  });
  f.state.generation = 2;
  f.hook.rerender({ ...f.props, generation: 2 });
  await act(async () => {
    pending.resolve(f.snapshot);
    expect(await request).toBe(false);
  });
  expect(f.hook.result.current.snapshot).toBeNull();
  expect(f.hook.result.current.trusted).toBe(false);
  expect(f.hook.result.current.message).toBe("");
});
it("clears transition blocking after unmount while suppressing late presentation", async () => {
  const f = fixture();
  await inspect(f);
  await act(async () => {
    await f.hook.result.current.review("Main.java", false);
  });
  const pending = deferred<typeof f.snapshot>();
  f.port.mutate.mockReturnValueOnce(pending.promise);
  let action!: Promise<boolean>;
  act(() => {
    action = f.hook.result.current.stage();
  });
  f.hook.unmount();
  await act(async () => {
    pending.resolve(f.snapshot);
    expect(await action).toBe(false);
  });
  expect(f.onTransitionBlockReason).toHaveBeenLastCalledWith(null);
});
it("retires review on refresh and does not strand busy state during metadata refresh", async () => {
  const f = fixture();
  await inspect(f);
  await act(async () => {
    await f.hook.result.current.review("Main.java", false);
  });
  const pending = deferred<typeof f.snapshot>();
  f.port.inspect.mockReturnValueOnce(pending.promise);
  let action!: Promise<boolean>;
  act(() => {
    action = f.hook.result.current.refresh();
  });
  expect(f.hook.result.current.selection).toBeNull();
  f.state.isMetadataLoading = true;
  await act(async () => {
    pending.resolve(f.snapshot);
    expect(await action).toBe(false);
  });
  f.state.isMetadataLoading = false;
  f.hook.rerender(f.props);
  expect(f.hook.result.current.busy).toBeNull();
});
it("does not fabricate Git availability without an adapter", () => {
  const f = fixture();
  f.hook.rerender({ ...f.props, port: undefined as never });
  expect(f.hook.result.current.available).toBe(false);
  expect(f.port.inspect).not.toHaveBeenCalled();
});
it("unstages through the current snapshot without writing the editor", async () => {
  const f = fixture();
  f.snapshot.files[0]!.staged = true;
  await inspect(f);
  f.setDirty(true);
  await act(async () => {
    expect(await f.hook.result.current.unstage("Main.java")).toBe(true);
  });
  expect(f.port.mutate.mock.calls[0]![0]).toMatchObject({ kind: "unstage", path: "Main.java" });
  expect(f.openFile).not.toHaveBeenCalled();
});
it("reports failed file navigation without unhandled rejection", async () => {
  const f = fixture();
  await inspect(f);
  f.openFile.mockRejectedValueOnce(new Error("Failed"));
  await act(async () => {
    expect(await f.hook.result.current.openFile("Main.java")).toBe(false);
  });
  expect(f.hook.result.current.error).toContain("could not be opened");
});

it("creates a local branch without acquiring an editor source-write lease", async () => {
  const f = fixture();
  await inspect(f);
  await act(async () =>
    expect(await f.hook.result.current.branchAction("createBranch", "feature/topic")).toBe(true),
  );
  expect(f.port.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "createBranch",
      name: "feature/topic",
      revision: f.snapshot.revision,
    }),
  );
  expect(f.props.beginBranchSwitch).not.toHaveBeenCalled();
});
it("holds source and transition guards through reconciliation after switching", async () => {
  const f = fixture();
  await inspect(f);
  const pending = deferred<string | undefined>();
  const lease = { reconcile: vi.fn(() => pending.promise), release: vi.fn() };
  f.props.beginBranchSwitch.mockReturnValueOnce(lease);
  let operation!: Promise<boolean>;
  await act(async () => {
    operation = f.hook.result.current.branchAction("switchBranch", "feature/topic");
    await Promise.resolve();
  });
  expect(f.port.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "switchBranch", name: "feature/topic" }),
  );
  expect(lease.reconcile).toHaveBeenCalledOnce();
  expect(lease.release).not.toHaveBeenCalled();
  expect(f.hook.result.current.isWriting).toBe(true);
  await act(async () => {
    pending.resolve("A missing file was retained.");
    expect(await operation).toBe(true);
  });
  expect(f.hook.result.current.status).toContain("A missing file was retained.");
  expect(lease.release).toHaveBeenCalledOnce();
  expect(f.onTransitionBlockReason).toHaveBeenLastCalledWith(null);
});
it("refuses dirty buffers or pending saves before a branch switch reaches Git", async () => {
  const f = fixture();
  await inspect(f);
  f.props.beginBranchSwitch.mockImplementationOnce(() => {
    throw new Error("Save all editor buffers and wait for file operations.");
  });
  await act(async () =>
    expect(await f.hook.result.current.branchAction("switchBranch", "feature/topic")).toBe(false),
  );
  expect(f.port.mutate).not.toHaveBeenCalled();
  expect(f.hook.result.current.error).toContain("Save all editor buffers");
  expect(f.hook.result.current.snapshot).toBeNull();
  expect(f.onTransitionBlockReason).toHaveBeenLastCalledWith(null);
});
it("reconciles even a failed switch because trusted hooks can already have changed files", async () => {
  const f = fixture();
  await inspect(f);
  const lease = { reconcile: vi.fn(async () => "Reload warning."), release: vi.fn() };
  f.props.beginBranchSwitch.mockReturnValueOnce(lease);
  f.port.mutate.mockRejectedValueOnce(new Error("Git may have changed repository state."));
  await act(async () =>
    expect(await f.hook.result.current.branchAction("switchBranch", "feature/topic")).toBe(false),
  );
  expect(lease.reconcile).toHaveBeenCalledOnce();
  expect(lease.release).toHaveBeenCalledOnce();
  expect(f.hook.result.current.error).toContain(
    "Git may have changed repository state. Reload warning.",
  );
  expect(f.hook.result.current.snapshot).toBeNull();
});
it("never reconciles a retired workspace but always releases the owned source guard", async () => {
  const f = fixture();
  await inspect(f);
  const pending = deferred<typeof f.snapshot>();
  f.port.mutate.mockReturnValueOnce(pending.promise);
  const lease = { reconcile: vi.fn(async () => undefined), release: vi.fn() };
  f.props.beginBranchSwitch.mockReturnValueOnce(lease);
  let operation!: Promise<boolean>;
  act(() => {
    operation = f.hook.result.current.branchAction("switchBranch", "feature/topic");
  });
  f.state.generation++;
  await act(async () => {
    pending.resolve(f.snapshot);
    expect(await operation).toBe(false);
  });
  expect(lease.reconcile).not.toHaveBeenCalled();
  expect(lease.release).toHaveBeenCalledOnce();
  expect(f.onTransitionBlockReason).toHaveBeenLastCalledWith(null);
});
it("refuses current, missing and unborn switch targets without a Git mutation", async () => {
  const f = fixture();
  await inspect(f);
  await act(async () => {
    expect(await f.hook.result.current.branchAction("switchBranch", "main")).toBe(false);
    expect(await f.hook.result.current.branchAction("switchBranch", "missing")).toBe(false);
  });
  f.snapshot.head = null;
  await act(async () =>
    expect(await f.hook.result.current.branchAction("createBranch", "feature/new")).toBe(false),
  );
  expect(f.port.mutate).not.toHaveBeenCalled();
});

it("renames a selected branch with the captured revision while preserving dirty buffers", async () => {
  const f = fixture();
  await inspect(f);
  f.setDirty(true);
  await act(async () =>
    expect(await f.hook.result.current.renameBranch("main", "renamed")).toBe(true),
  );
  expect(f.port.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "renameBranch",
      oldName: "main",
      name: "renamed",
      revision: f.snapshot.revision,
    }),
  );
  expect(f.props.beginBranchSwitch).not.toHaveBeenCalled();
  expect(f.openFile).not.toHaveBeenCalled();
});
it("refuses missing, duplicate and retired branch rename selections before invoking Git", async () => {
  const f = fixture();
  await inspect(f);
  await act(async () => {
    expect(await f.hook.result.current.renameBranch("missing", "new")).toBe(false);
    expect(await f.hook.result.current.renameBranch("main", "feature/topic")).toBe(false);
    expect(await f.hook.result.current.renameBranch("main", "main")).toBe(false);
    expect(await f.hook.result.current.renameBranch("main", "")).toBe(false);
  });
  f.state.generation++;
  await act(async () =>
    expect(await f.hook.result.current.renameBranch("main", "new")).toBe(false),
  );
  expect(f.port.mutate).not.toHaveBeenCalled();
});
it("discards a late branch rename response after workspace retirement", async () => {
  const f = fixture();
  await inspect(f);
  const pending = deferred<typeof f.snapshot>();
  f.port.mutate.mockReturnValueOnce(pending.promise);
  let operation!: Promise<boolean>;
  act(() => {
    operation = f.hook.result.current.renameBranch("feature/topic", "renamed");
  });
  expect(f.hook.result.current.isWriting).toBe(true);
  f.state.generation++;
  await act(async () => {
    pending.resolve(f.snapshot);
    expect(await operation).toBe(false);
  });
  expect(f.hook.result.current.snapshot).toBeNull();
  expect(f.onTransitionBlockReason).toHaveBeenLastCalledWith(null);
});

it("reads only saved text despite editor drafts without taking a source-write lease", async () => {
  const f = fixture();
  await act(async () => {
    expect(await f.hook.result.current.blameFile("Main.java")).toBe(false);
  });
  expect(f.port.blame).not.toHaveBeenCalled();
  await inspect(f);
  f.setDirty(true);
  await act(async () => {
    expect(await f.hook.result.current.blameFile("Main.java")).toBe(true);
  });
  expect(f.port.blame).toHaveBeenCalledWith({
    workspacePath: "/workspace",
    trusted: true,
    activation: 7,
    revision: f.snapshot.revision,
    path: "Main.java",
    startLine: 1,
  });
  expect(f.hook.result.current.blameSelection?.lines[0]?.text).toBe("saved line 1");
  await act(async () => {
    await f.hook.result.current.blameFile("Main.java", 201, "c".repeat(64));
  });
  expect(f.port.blame).toHaveBeenLastCalledWith(
    expect.objectContaining({ startLine: 201, savedFingerprint: "c".repeat(64) }),
  );
  expect(f.props.beginBranchSwitch).not.toHaveBeenCalled();
  expect(f.onTransitionBlockReason).not.toHaveBeenCalledWith(expect.any(String));
  expect(f.port.mutate).not.toHaveBeenCalled();
  expect(f.openFile).not.toHaveBeenCalled();
});
it("rechecks the exact saved blame page before navigating to a selected line", async () => {
  const f = fixture();
  await inspect(f);
  await act(async () => {
    await f.hook.result.current.blameFile("Main.java");
  });
  await act(async () => {
    expect(await f.hook.result.current.openBlameLine(2)).toBe(true);
  });
  expect(f.port.blame).toHaveBeenLastCalledWith(
    expect.objectContaining({
      path: "Main.java",
      startLine: 1,
      savedFingerprint: "c".repeat(64),
    }),
  );
  expect(f.props.openBlameLocation).toHaveBeenCalledWith(
    "Main.java",
    2,
    "c".repeat(64),
    expect.any(Function),
  );
  expect(f.props.beginBranchSwitch).not.toHaveBeenCalled();
  expect(f.port.mutate).not.toHaveBeenCalled();
});
it("keeps dirty-source attribution readable but refuses saved-line navigation and absent lines", async () => {
  const f = fixture();
  await inspect(f);
  await act(async () => {
    await f.hook.result.current.blameFile("Main.java");
  });
  f.port.blame.mockClear();
  await act(async () => {
    expect(await f.hook.result.current.openBlameLine(201)).toBe(false);
  });
  f.setDirty(true);
  await act(async () => {
    expect(await f.hook.result.current.openBlameLine(2)).toBe(false);
  });
  expect(f.hook.result.current.error).toContain("Save or discard");
  expect(f.hook.result.current.blameSelection).not.toBeNull();
  expect(f.port.blame).not.toHaveBeenCalled();
  expect(f.props.openBlameLocation).not.toHaveBeenCalled();
});
it.each(["dirty", "workspace", "provider"])(
  "refuses %s changes while revalidating a blame location",
  async (kind) => {
    const f = fixture();
    await inspect(f);
    await act(async () => {
      await f.hook.result.current.blameFile("Main.java");
    });
    const pending = deferred<ReturnType<typeof blameFixture>>();
    f.port.blame.mockReturnValueOnce(pending.promise);
    let operation!: Promise<boolean>;
    act(() => {
      operation = f.hook.result.current.openBlameLine(2);
    });
    if (kind === "dirty") f.setDirty(true);
    if (kind === "workspace") {
      f.state.generation++;
      f.hook.rerender({ ...f.props, generation: 2 });
    }
    if (kind === "provider") f.hook.rerender({ ...f.props, port: { ...f.port } });
    await act(async () => {
      pending.resolve(blameFixture({ path: "Main.java", startLine: 1 }));
      expect(await operation).toBe(false);
    });
    expect(f.props.openBlameLocation).not.toHaveBeenCalled();
  },
);
it("retires blame and snapshot after a changed-source refusal during navigation", async () => {
  const f = fixture();
  await inspect(f);
  await act(async () => {
    await f.hook.result.current.blameFile("Main.java");
  });
  f.port.blame.mockRejectedValueOnce(new Error("The saved file changed. Refresh Git."));
  await act(async () => {
    expect(await f.hook.result.current.openBlameLine(2)).toBe(false);
  });
  expect(f.props.openBlameLocation).not.toHaveBeenCalled();
  expect(f.hook.result.current.blameSelection).toBeNull();
  expect(f.hook.result.current.snapshot).toBeNull();
});
it("refuses invalid blame input and retires a page on review and failed refresh", async () => {
  const f = fixture();
  await inspect(f);
  for (const [path, line] of [
    ["../outside", 1],
    ["Main.java", 0],
    ["Main.java", 1.5],
  ] as const) {
    await act(async () => {
      expect(await f.hook.result.current.blameFile(path, line)).toBe(false);
    });
  }
  expect(f.port.blame).not.toHaveBeenCalled();
  await act(async () => {
    await f.hook.result.current.blameFile("Main.java");
  });
  await act(async () => {
    await f.hook.result.current.review("Main.java", false);
  });
  expect(f.hook.result.current.blameSelection).toBeNull();
  f.port.blame.mockRejectedValueOnce(new Error("SOURCE_CHANGED; Refresh Git"));
  await act(async () => {
    expect(await f.hook.result.current.blameFile("Main.java")).toBe(false);
  });
  expect(f.hook.result.current.snapshot).toBeNull();
  expect(f.hook.result.current.error).toContain("SOURCE_CHANGED");
  await act(async () => {
    expect(await f.hook.result.current.blameFile("Main.java")).toBe(false);
  });
  expect(f.port.blame).toHaveBeenCalledTimes(2);
});
it.each(["workspace", "provider"])(
  "ignores delayed blame and retained callbacks after %s retirement",
  async (kind) => {
    const f = fixture();
    await inspect(f);
    const pending = deferred<ReturnType<typeof blameFixture>>();
    f.port.blame.mockReturnValueOnce(pending.promise);
    const retained = f.hook.result.current.blameFile;
    let action!: Promise<boolean>;
    act(() => {
      action = retained("Main.java");
    });
    if (kind === "workspace") {
      f.state.generation++;
      f.hook.rerender({ ...f.props, generation: 2 });
    } else f.hook.rerender({ ...f.props, port: { ...f.port } });
    await act(async () => {
      pending.resolve(blameFixture({ path: "Main.java", startLine: 1 }));
      expect(await action).toBe(false);
    });
    expect(f.hook.result.current.blameSelection).toBeNull();
    expect(f.hook.result.current.trusted).toBe(false);
    await act(async () => {
      expect(await retained("Main.java")).toBe(false);
    });
    expect(f.port.blame).toHaveBeenCalledTimes(1);
  },
);
it("withdraws the snapshot for a page from the wrong saved version", async () => {
  const f = fixture();
  await inspect(f);
  f.port.blame.mockResolvedValueOnce({
    ...blameFixture({ path: "Main.java", startLine: 201 }),
    savedFingerprint: "d".repeat(64),
  });
  await act(async () => {
    expect(await f.hook.result.current.blameFile("Main.java", 201, "c".repeat(64))).toBe(false);
  });
  expect(f.hook.result.current.snapshot).toBeNull();
  expect(f.hook.result.current.blameSelection).toBeNull();
});

it.each(["mergeBranch", "abortMerge"] as const)(
  "reconciles saved source and releases the editor lease for %s",
  async (kind) => {
    const f = fixture();
    f.snapshot.files = [];
    f.snapshot.mergeHeads = kind === "abortMerge" ? ["e".repeat(40)] : [];
    await inspect(f);
    const lease = { reconcile: vi.fn(async () => undefined), release: vi.fn() };
    f.props.beginBranchSwitch.mockReturnValueOnce(lease);
    const response = { ...f.snapshot, mergeHeads: kind === "mergeBranch" ? ["e".repeat(40)] : [] };
    f.port.mutate.mockResolvedValueOnce(response);
    await act(async () => {
      expect(
        await (kind === "mergeBranch"
          ? f.hook.result.current.branchAction(kind, "feature/topic")
          : f.hook.result.current.abortMerge()),
      ).toBe(true);
    });
    expect(f.props.beginBranchSwitch).toHaveBeenCalledOnce();
    expect(lease.reconcile).toHaveBeenCalledOnce();
    expect(lease.release).toHaveBeenCalledOnce();
    expect(f.port.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ kind, revision: f.snapshot.revision }),
    );
    if (kind === "mergeBranch") expect(f.hook.result.current.status).toContain("Merge paused");
  },
);
it("refuses merge writes when the editor lease cannot protect drafts and reconciles a failed native merge", async () => {
  const f = fixture();
  f.snapshot.files = [];
  f.snapshot.mergeHeads = [];
  await inspect(f);
  f.props.beginBranchSwitch.mockImplementationOnce(() => {
    throw new Error("Save all editor buffers");
  });
  await act(async () => {
    expect(await f.hook.result.current.branchAction("mergeBranch", "feature/topic")).toBe(false);
  });
  expect(f.port.mutate).not.toHaveBeenCalled();
  expect(f.hook.result.current.error).toContain("Save all editor buffers");
  await act(async () => {
    await f.hook.result.current.refresh();
  });
  const lease = { reconcile: vi.fn(async () => undefined), release: vi.fn() };
  f.props.beginBranchSwitch.mockReturnValueOnce(lease);
  f.port.mutate.mockRejectedValueOnce(new Error("Git failed"));
  await act(async () => {
    expect(await f.hook.result.current.branchAction("mergeBranch", "feature/topic")).toBe(false);
  });
  expect(lease.reconcile).toHaveBeenCalledOnce();
  expect(lease.release).toHaveBeenCalledOnce();
});
it("requires an all-index review for an identical-tree merge commit", async () => {
  const f = fixture();
  f.snapshot.files = [];
  f.snapshot.mergeHeads = ["e".repeat(40)];
  await inspect(f);
  act(() => f.hook.result.current.setMessage("Merge reviewed parents"));
  await act(async () => {
    expect(await f.hook.result.current.commit()).toBe(false);
  });
  await act(async () => {
    await f.hook.result.current.review(null, true);
  });
  expect(f.hook.result.current.canCommit).toBe(true);
  await act(async () => {
    expect(await f.hook.result.current.commit()).toBe(true);
  });
});

it("opens a clean tracked file from a current blame page without acquiring a write lease", async () => {
  const f = fixture();
  f.snapshot.files = [];
  f.setDirty(true);
  await inspect(f);
  await act(async () => {
    await f.hook.result.current.blameFile("Main.java");
  });
  await act(async () => {
    expect(await f.hook.result.current.openFile("Main.java")).toBe(true);
  });
  expect(f.openFile).toHaveBeenCalledWith("Main.java");
  expect(f.props.beginBranchSwitch).not.toHaveBeenCalled();
  await act(async () => {
    expect(await f.hook.result.current.openFile("Unreviewed.java")).toBe(false);
  });
  expect(f.openFile).toHaveBeenCalledTimes(1);
});

it("requires a current history review before rebasing and holds the external source-write lease", async () => {
  const f = fixture();
  f.snapshot.files = [];
  await inspect(f);
  await act(async () => {
    expect(await f.hook.result.current.startRebase()).toBe(false);
  });
  await act(async () => {
    expect(await f.hook.result.current.prepareRebase("feature/topic")).toBe(true);
  });
  expect(f.port.mutate).not.toHaveBeenCalled();
  expect(f.props.beginBranchSwitch).not.toHaveBeenCalled();
  expect(f.hook.result.current.rebasePlan?.commits).toHaveLength(1);
  await act(async () => {
    expect(await f.hook.result.current.startRebase()).toBe(true);
  });
  expect(f.port.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "startRebase",
      upstream: "feature/topic",
      planFingerprint: "c".repeat(64),
    }),
  );
  expect(f.props.beginBranchSwitch).toHaveBeenCalledOnce();
  expect(f.hook.result.current.rebasePlan).toBeNull();
});
it("requires whole-index review before rebase continuation and clears it after a source operation", async () => {
  const f = fixture();
  f.snapshot.rebase = rebaseStateFixture();
  await inspect(f);
  await act(async () => {
    expect(await f.hook.result.current.rebaseAction("continueRebase")).toBe(false);
  });
  await act(async () => {
    await f.hook.result.current.review(null, true);
  });
  expect(f.hook.result.current.canContinueRebase).toBe(true);
  await act(async () => {
    expect(await f.hook.result.current.rebaseAction("continueRebase")).toBe(true);
  });
  expect(f.props.beginBranchSwitch).toHaveBeenCalledOnce();
  expect(f.hook.result.current.selection).toBeNull();
});
it.each(["skipRebase", "abortRebase"] as const)(
  "reconciles source after %s failure without inventing success",
  async (kind) => {
    const f = fixture();
    f.snapshot.rebase = rebaseStateFixture();
    await inspect(f);
    const lease = { reconcile: vi.fn(async () => undefined), release: vi.fn() };
    f.props.beginBranchSwitch.mockReturnValueOnce(lease);
    f.port.mutate.mockRejectedValueOnce(new Error("Git failed"));
    await act(async () => {
      expect(await f.hook.result.current.rebaseAction(kind)).toBe(false);
    });
    expect(lease.reconcile).toHaveBeenCalledOnce();
    expect(lease.release).toHaveBeenCalledOnce();
    expect(f.hook.result.current.snapshot).toBeNull();
  },
);
it("retires a delayed rebase plan and retained action when the provider changes", async () => {
  const f = fixture();
  await inspect(f);
  const pending = deferred<ReturnType<typeof rebasePlanFixture>>();
  f.port.rebasePlan.mockReturnValueOnce(pending.promise);
  const retained = f.hook.result.current.prepareRebase;
  let action!: Promise<boolean>;
  act(() => {
    action = retained("feature/topic");
  });
  f.hook.rerender({ ...f.props, port: { ...f.port } });
  await act(async () => {
    pending.resolve(rebasePlanFixture("feature/topic"));
    expect(await action).toBe(false);
  });
  expect(f.hook.result.current.rebasePlan).toBeNull();
  await act(async () => {
    expect(await retained("feature/topic")).toBe(false);
  });
  expect(f.port.rebasePlan).toHaveBeenCalledOnce();
});
