import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { JavaCoveragePanel } from "./JavaCoveragePanel";
import { coverage } from "../../../../../packages/tauri-adapters/src/java-coverage.test-fixtures";
describe("Java coverage presentation", () => {
  it("shows partly covered lines and branch choices; an empty branch denominator has no percentage", () => {
    const results = coverage();
    results.counters.branches = { missed: 0, covered: 0 };
    results.files[0].counters.branches = results.counters.branches;
    render(<JavaCoveragePanel results={results} />);
    expect(screen.getByRole("region", { name: "Java test coverage" })).toHaveTextContent(
      "— (0 / 0)",
    );
    expect(screen.getByRole("table")).toHaveTextContent("1 / 2");
    expect(screen.getByLabelText("Measured source file")).toHaveValue(results.files[0].id);
  });
  it("paginates large source-line measurements and clears presentation for unavailable results", () => {
    const results = coverage();
    results.files[0].lines = Array.from({ length: 401 }, (_, i) => ({
      number: i + 1,
      missedInstructions: 0,
      coveredInstructions: 1,
      missedBranches: 0,
      coveredBranches: 0,
    }));
    const view = render(<JavaCoveragePanel results={results} />);
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(200);
    fireEvent.click(screen.getByRole("button", { name: "Next lines" }));
    expect(screen.getByRole("region")).toHaveTextContent("Lines 201–400 of 401");
    view.rerender(
      <JavaCoveragePanel
        results={{
          ...results,
          status: "unavailable",
          files: [],
          reports: 0,
          message: "Agent did not run.",
        }}
      />,
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Agent did not run.");
  });
  it("opens only source paths resolved from the synchronized project context", () => {
    const results = coverage();
    const openSource = vi.fn();
    render(
      <JavaCoveragePanel
        results={results}
        sourcePaths={new Map([[results.files[0]!.id, "src/main/java/example/Choice.java"]])}
        onOpenSource={openSource}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open measured source" }));
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(openSource).toHaveBeenNthCalledWith(
      1,
      "src/main/java/example/Choice.java",
      results.files[0]!.lines[0]!.number,
    );
    expect(openSource).toHaveBeenNthCalledWith(2, "src/main/java/example/Choice.java", 3);
  });
});
