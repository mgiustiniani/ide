import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RefactorKitChangeIntent, RefactoringTarget } from "@ide/contracts";
import type { JavaCleanupFileSearchPort } from "./JavaCleanupFileSearch";
import { JavaBatchCleanupFields } from "./JavaBatchCleanupFields";

function Form({ disabled = false, searchFiles, workspaceGeneration = 1, projectPath = "project" }: { disabled?: boolean; searchFiles?: JavaCleanupFileSearchPort; workspaceGeneration?: number; projectPath?: string }) {
  const [target, setTarget] = useState<RefactoringTarget>({ kind: "file", path: "project/A.java", identity: "project/A.java" });
  const [intent, setIntent] = useState<RefactorKitChangeIntent>();
  return <><JavaBatchCleanupFields target={target} intent={intent} disabled={disabled} onChange={setIntent} onTarget={setTarget} searchFiles={searchFiles} workspaceGeneration={workspaceGeneration} projectPath={projectPath} /><output aria-label="Selection">{JSON.stringify({ target, intent })}</output></>;
}

describe("Java cleanup file selection", () => {
  it("captures mixed cleanup choices and keeps the first-file anchor current", () => {
    render(<Form />);
    fireEvent.change(screen.getByLabelText("Cleanup file 2"), { target: { value: "project/B.java" } });
    fireEvent.change(screen.getByLabelText("Cleanup action 2"), { target: { value: "format-file" } });
    fireEvent.change(screen.getByLabelText("Cleanup file 1"), { target: { value: "project/Renamed.java" } });
    expect(JSON.parse(screen.getByLabelText("Selection").textContent!)).toEqual({
      target: { kind: "file", path: "project/Renamed.java", identity: "project/Renamed.java" },
      intent: { operation: "batch-cleanup", actions: [
        { operation: "organize-imports", path: "project/Renamed.java" },
        { operation: "format-file", path: "project/B.java" },
      ] },
    });
  });
  it("bounds file selection and preserves remaining rows when removing the first", () => {
    render(<Form />);
    expect(screen.getByLabelText("Remove cleanup file 1")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Cleanup file 2"), { target: { value: "project/B.java" } });
    for (let i = 2; i < 16; i++) fireEvent.click(screen.getByRole("button", { name: "Add cleanup file" }));
    expect(screen.getByRole("button", { name: "Add cleanup file" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Remove cleanup file 1"));
    expect(screen.getByLabelText("Cleanup file 1")).toHaveValue("project/B.java");
    expect(JSON.parse(screen.getByLabelText("Selection").textContent!).target.path).toBe("project/B.java");
  });
  it("freezes the reviewed selection", () => {
    render(<Form disabled />);
    expect(screen.getByLabelText("Cleanup file 1")).toBeDisabled();
    expect(screen.getByLabelText("Cleanup action 2")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add cleanup file" })).toBeDisabled();
  });
});

async function searchFor(query: string) {
  fireEvent.change(screen.getByLabelText("Java cleanup file search"), { target: { value: query } });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 170)); });
}

describe("Java cleanup workspace search", () => {
  it("offers distinct Java files within the selected project and preserves the chosen action", async () => {
    const search = vi.fn().mockResolvedValue({ files: [
      { path: "project/A.java" }, { path: "project/B.java" }, { path: "project/B.java" },
      { path: "project/../Escape.java" }, { path: "project/Bad\n.java" },
      { path: "project/readme.md" }, { path: "project-other/C.java" }, { path: "/project/D.java" },
    ], partial: true, truncated: true });
    render(<Form searchFiles={search} />);
    fireEvent.change(screen.getByLabelText("Cleanup action 2"), { target: { value: "format-file" } });
    fireEvent.click(screen.getByLabelText("Find cleanup file 2"));
    await searchFor("B");
    expect(search).toHaveBeenCalledWith("B", 1);
    expect(screen.getAllByRole("button", { name: "project/B.java" })).toHaveLength(1);
    expect(screen.getByLabelText("Java cleanup file matches").textContent).toBe("project/B.java");
    expect(screen.getByText("Some directories could not be searched.")).toBeVisible();
    expect(screen.getByText(/Results are limited/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "project/B.java" }));
    expect(screen.getByLabelText("Cleanup file 2")).toHaveValue("project/B.java");
    expect(screen.getByLabelText("Cleanup action 2")).toHaveValue("format-file");
    expect(screen.queryByLabelText("Java cleanup file search")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Find cleanup file 2")).toHaveFocus();
  });
  it("ignores an older query response and updates the first-file anchor", async () => {
    let finishOld!: (value: unknown) => void;
    const search = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValue({ files: [{ path: "project/New.java" }], partial: false, truncated: false });
    render(<Form searchFiles={search} />);
    fireEvent.click(screen.getByLabelText("Find cleanup file 1"));
    await searchFor("Old");
    await searchFor("New");
    await act(async () => { finishOld({ files: [{ path: "project/Old.java" }], partial: false, truncated: false }); });
    expect(screen.queryByRole("button", { name: "project/Old.java" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "project/New.java" }));
    expect(JSON.parse(screen.getByLabelText("Selection").textContent!).target.path).toBe("project/New.java");
  });
  it.each(["workspace", "project", "review"])("retires pending search when %s authority changes", async (reason) => {
    let finish!: (value: unknown) => void;
    const search = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(<Form searchFiles={search} />);
    fireEvent.click(screen.getByLabelText("Find cleanup file 2"));
    await searchFor("B");
    rerender(<Form searchFiles={search} workspaceGeneration={reason === "workspace" ? 2 : 1}
      projectPath={reason === "project" ? "other" : "project"} disabled={reason === "review"} />);
    await act(async () => { finish({ files: [{ path: "project/B.java" }], partial: false, truncated: false }); });
    expect(screen.queryByRole("button", { name: "project/B.java" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Cleanup file 2")).toHaveValue("");
  });
  it("reports search failure and closes on Escape without changing selection or closing its parent", async () => {
    const parentKey = vi.fn();
    render(<div onKeyDown={parentKey}><Form searchFiles={vi.fn().mockRejectedValue(new Error("Workspace changed."))} /></div>);
    fireEvent.click(screen.getByLabelText("Find cleanup file 2"));
    await searchFor("B");
    expect(screen.getByRole("alert")).toHaveTextContent("Workspace changed.");
    fireEvent.keyDown(screen.getByLabelText("Java cleanup file search"), { key: "Escape" });
    expect(parentKey).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Java cleanup file search")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Cleanup file 2")).toHaveValue("");
  });
});
