import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeTauri } from "./errors";
import { TauriReadOnlyDiffAdapter, TauriWorkspaceChangesAdapter } from "./git-diff-review-tauri";

vi.mock("./errors", async (original) => ({
  ...(await original<typeof import("./errors")>()), invokeTauri: vi.fn(),
}));

beforeEach(() => vi.mocked(invokeTauri).mockReset());

describe("workspace-bound Git review", () => {
  it("sends the selected workspace with literal paths", async () => {
    vi.mocked(invokeTauri).mockResolvedValueOnce([" :(glob)*.java "]);
    await expect(new TauriWorkspaceChangesAdapter("/workspace/a").listModifiedFiles())
      .resolves.toEqual([" :(glob)*.java "]);
    expect(invokeTauri).toHaveBeenLastCalledWith("git_status_modified", { workspacePath: "/workspace/a" });
    vi.mocked(invokeTauri).mockResolvedValueOnce({ kind: "unavailable", reason: "No hunks" });
    await new TauriReadOnlyDiffAdapter("/workspace/a").produceDiff(" :(glob)*.java ");
    expect(invokeTauri).toHaveBeenLastCalledWith("git_diff_hunks", {
      workspacePath: "/workspace/a", filePath: " :(glob)*.java ",
    });
  });

  it("reports a failed status query instead of a clean repository", async () => {
    vi.mocked(invokeTauri).mockRejectedValueOnce(new Error("not a repository"));
    await expect(new TauriWorkspaceChangesAdapter().listModifiedFiles()).rejects.toThrow();
  });

  it("turns stale or failed diff calls into an unavailable review without native diagnostics", async () => {
    vi.mocked(invokeTauri).mockRejectedValueOnce(new Error("private native detail"));
    const result = await new TauriReadOnlyDiffAdapter("/workspace/a").produceDiff("Main.java");
    expect(result.kind).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("private native detail");
  });
});
