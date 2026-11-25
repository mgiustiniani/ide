import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ProblemsPanel,
  getProblemCounts,
  groupProblems,
  sortProblems,
  type ProblemItem,
} from "../ProblemsPanel";

const range = (line: number, character: number) => ({
  start: { line, character },
  end: { line, character: character + 1 },
});

const items: ProblemItem[] = [
  {
    id: "hint",
    provider: "JDT LS",
    filePath: "src/B.java",
    severity: "hint",
    range: range(0, 0),
    message: "Hint B",
  },
  {
    id: "warning",
    provider: "JDT LS",
    filePath: "src/A.java",
    severity: "warning",
    range: range(4, 2),
    message: "Warning A",
    code: 7,
    source: "Java",
  },
  {
    id: "error-late",
    provider: "Compiler",
    filePath: "src/B.java",
    severity: "error",
    range: range(5, 0),
    message: "Error B",
  },
  {
    id: "info",
    provider: "JDT LS",
    filePath: "src/A.java",
    severity: "info",
    range: range(1, 0),
    message: "Info A",
  },
  {
    id: "error-first",
    provider: "JDT LS",
    filePath: "src/A.java",
    severity: "error",
    range: range(0, 1),
    message: "Error A",
  },
];

describe("ProblemsPanel", () => {
  it("explains unavailable diagnostics without inventing a source problem or reporting success", () => {
    render(<ProblemsPanel items={[]} notice="Java 26 preview requires a compatible compiler." />);
    expect(screen.getByRole("alert").textContent).toContain("Java 26 preview");
    expect(screen.queryByText("No problems detected.")).toBeNull();
    expect(screen.queryByRole("treeitem")).toBeNull();
  });
  it("sorts by severity, file, and zero-based position and creates normalized groups", () => {
    expect(sortProblems(items).map((item) => item.id)).toEqual([
      "error-first",
      "error-late",
      "warning",
      "info",
      "hint",
    ]);
    expect(
      groupProblems(items).map((group) => [group.severity, group.filePath, group.provider]),
    ).toEqual([
      ["error", "src/A.java", "JDT LS"],
      ["error", "src/B.java", "Compiler"],
      ["warning", "src/A.java", "JDT LS"],
      ["info", "src/A.java", "JDT LS"],
      ["hint", "src/B.java", "JDT LS"],
    ]);
    expect(getProblemCounts(items)).toEqual({ error: 2, warning: 1, info: 1, hint: 1, total: 5 });
  });

  it("renders provider/file groups, severity counts, bounded semantics, and safe text", () => {
    render(
      <ProblemsPanel
        items={[...items, { ...items[0], id: "html", message: "<strong>not HTML</strong>" }]}
      />,
    );
    expect(screen.getByText("6 problems")).toBeDefined();
    expect(screen.getByLabelText("2 errors")).toBeDefined();
    expect(screen.getByLabelText("2 hints")).toBeDefined();
    expect(screen.getByRole("tree", { name: "Problems list" })).toBeDefined();
    expect(screen.getAllByRole("treeitem")).toHaveLength(6);
    expect(screen.getByTestId("problems-scroll-region").className).toContain("overflow-auto");
    expect(screen.getAllByText("JDT LS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("src/A.java").length).toBeGreaterThan(0);
    expect(screen.getByText("<strong>not HTML</strong>").querySelector("strong")).toBeNull();
  });

  it("navigates with click, Enter, and Space using the original zero-based range", () => {
    const onNavigate = vi.fn();
    render(<ProblemsPanel items={[items[1]]} onNavigate={onNavigate} />);
    const problem = screen.getByRole("treeitem");

    fireEvent.click(problem);
    fireEvent.keyDown(problem, { key: "Enter" });
    fireEvent.keyDown(problem, { key: " " });
    expect(onNavigate).toHaveBeenCalledTimes(3);
    expect(onNavigate).toHaveBeenLastCalledWith("src/A.java", items[1].range);
    expect(problem.getAttribute("aria-label")).toContain("line 5, column 3");
    expect(within(problem).getByText(/Java\(7\)/)).toBeDefined();
  });

  it("passes the provider problem identity to the guarded navigation handler", () => {
    const onNavigateProblem = vi.fn(),
      onNavigate = vi.fn();
    render(
      <ProblemsPanel
        items={[items[1]]}
        onNavigateProblem={onNavigateProblem}
        onNavigate={onNavigate}
      />,
    );
    const problem = screen.getByRole("treeitem");
    fireEvent.click(problem);
    fireEvent.keyDown(problem, { key: "Enter" });
    fireEvent.keyDown(problem, { key: " " });
    expect(onNavigateProblem).toHaveBeenCalledTimes(3);
    expect(onNavigateProblem).toHaveBeenLastCalledWith(items[1]);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("shows an accessible empty state", () => {
    render(<ProblemsPanel items={[]} />);
    expect(screen.getByRole("status").textContent).toBe("No problems detected.");
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.getByLabelText("0 errors")).toBeDefined();
  });
});
