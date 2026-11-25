import { act, render, screen, waitFor } from "@testing-library/react";
import type { WorkspaceInfo } from "@ide/contracts";
import type { PiWorkspaceAgentPort } from "@ide/web-core/ports";
import { beforeEach, expect, it, vi } from "vitest";
import { PiWorkspaceAgentActivity } from "./PiWorkspaceAgentActivity";

const state = vi.hoisted(() => ({
  controller: { accessories: { workspaceId: "a", changes: [{ path: "Main.java" }] } },
  produceDiff: vi.fn(),
}));
vi.mock("./usePiWorkspaceAgentController", () => ({
  usePiWorkspaceAgentController: () => state.controller,
}));
vi.mock("@ide/tauri-adapters", () => ({
  TauriWorkspaceChangesAdapter: class {},
  TauriEditorOpenRangeAdapter: class {},
  TauriReadOnlyDiffAdapter: class {
    produceDiff = state.produceDiff;
  },
}));
vi.mock("@ide/ui", () => ({
  PiWorkspaceAgentScreen: ({ reviews }: { reviews?: ReadonlyMap<string, unknown> }) => (
    <output data-testid="reviews">{JSON.stringify(reviews ? [...reviews] : [])}</output>
  ),
}));
const workspace: WorkspaceInfo = { id: "a", rootPath: "/workspace/a", name: "A" };
const port = {} as PiWorkspaceAgentPort;
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  state.produceDiff.mockReset();
  state.controller.accessories = { workspaceId: "a", changes: [{ path: "Main.java" }] };
});

it("retires pending review work when the same workspace is reopened", async () => {
  const old = deferred(),
    fresh = deferred();
  state.produceDiff.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const view = render(
    <PiWorkspaceAgentActivity port={port} workspace={workspace} workspaceGeneration={1} />,
  );
  await waitFor(() => expect(state.produceDiff).toHaveBeenCalledTimes(1));
  view.rerender(
    <PiWorkspaceAgentActivity port={port} workspace={workspace} workspaceGeneration={2} />,
  );
  await waitFor(() => expect(state.produceDiff).toHaveBeenCalledTimes(2));
  await act(async () => old.resolve({ kind: "unavailable", reason: "old generation" }));
  expect(screen.getByTestId("reviews").textContent).not.toContain("old generation");
  await act(async () => fresh.resolve({ kind: "unavailable", reason: "fresh generation" }));
  expect(screen.getByTestId("reviews").textContent).toContain("fresh generation");
});

it("does not query stale accessories from another workspace", async () => {
  state.produceDiff.mockResolvedValue({ kind: "unavailable", reason: "wrong workspace" });
  render(
    <PiWorkspaceAgentActivity
      port={port}
      workspace={{ ...workspace, id: "b", rootPath: "/workspace/b" }}
    />,
  );
  await act(async () => {});
  expect(state.produceDiff).not.toHaveBeenCalled();
});

it("does not query Git without a selected workspace", async () => {
  state.produceDiff.mockResolvedValue({ kind: "unavailable", reason: "no workspace" });
  render(<PiWorkspaceAgentActivity port={port} workspace={null} />);
  await act(async () => {});
  expect(state.produceDiff).not.toHaveBeenCalled();
});
