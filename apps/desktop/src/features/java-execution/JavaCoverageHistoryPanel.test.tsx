import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { JavaCoverageHistoryPanel } from "./JavaCoverageHistoryPanel";
import type { JavaCoverageHistoryEntry } from "./useJavaCoverageHistory";

function entry(sessionId: string): JavaCoverageHistoryEntry {
  return {
    id: sessionId,
    sessionId,
    completedAt: "2026-11-12T12:00:00Z",
    configurationName: "Unit tests",
    operation: "coverage",
    executionState: "succeeded",
    projectPath: "service",
    buildTool: "maven",
    status: "ready",
    reports: 1,
    files: 2,
    tests: 3,
    counters: {
      lines: { covered: 2, missed: 0 },
      branches: { covered: 0, missed: 0 },
      instructions: { covered: 3, missed: 1 },
    },
  };
}
describe("Java coverage history presentation", () => {
  it("offers explicit deletion for saved measurements and for an empty history", () => {
    const clear = vi.fn();
    const view = render(<JavaCoverageHistoryPanel entries={[entry("now")]} onClear={clear} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear saved coverage history" }));
    expect(clear).toHaveBeenCalledOnce();
    view.rerender(<JavaCoverageHistoryPanel entries={[]} onClear={clear} />);
    expect(screen.getByRole("region")).toHaveTextContent("No saved coverage measurements.");
    expect(screen.getByRole("button", { name: "Clear saved coverage history" })).toBeEnabled();
  });
  it("compares measured percentages in percentage points and keeps zero denominators undefined", () => {
    const before = entry("before");
    before.counters.lines = { covered: 1, missed: 1 };
    render(<JavaCoverageHistoryPanel entries={[entry("now"), before]} />);
    fireEvent.change(screen.getByLabelText("Compare coverage with"), {
      target: { value: "before" },
    });
    const lines = screen.getByRole("rowheader", { name: "lines" }).closest("tr")!;
    expect(lines).toHaveTextContent("100.0%");
    expect(lines).toHaveTextContent("50.0%");
    expect(lines).toHaveTextContent("+50.0 pp");
    const branches = screen.getByRole("rowheader", { name: "branches" }).closest("tr")!;
    expect(within(branches).getAllByRole("cell").at(-1)).toHaveTextContent("—");
    expect(screen.getByRole("region")).toHaveTextContent("3 test(s)");
  });
  it("identifies selected, unfiltered and older scopes when choosing measurements to compare", () => {
    const full = { ...entry("full"), testSelection: { sourceSet: null, selectorCount: 0, selectors: [] } };
    const selected = {
      ...entry("selected"),
      testSelection: {
        sourceSet: "integrationTest", selectorCount: 4,
        selectors: ["ExampleTest#first", "ExampleTest#second", "OtherTest"],
      },
    };
    render(<JavaCoverageHistoryPanel entries={[full, selected, entry("older")]} />);
    expect(within(screen.getByLabelText("Coverage measurement")).getByRole("option", { name: /No IDE test filter/ })).toHaveValue("full");
    const baselines = within(screen.getByLabelText("Compare coverage with"));
    expect(baselines.getByRole("option", { name: /integrationTest · ExampleTest#first.*\(\+1 more\)/ })).toHaveValue("selected");
    expect(baselines.getByRole("option", { name: /Test selection unavailable/ })).toHaveValue("older");
  });
  it("excludes other projects, tools, operations and partial measurements from baselines", () => {
    render(
      <JavaCoverageHistoryPanel
        entries={[
          entry("now"),
          entry("valid"),
          { ...entry("project"), projectPath: "other" },
          { ...entry("tool"), buildTool: "gradle" },
          { ...entry("integration"), operation: "integration-coverage" },
          { ...entry("partial"), status: "partial" },
        ]}
      />,
    );
    const select = screen.getByLabelText("Compare coverage with");
    expect(within(select).getAllByRole("option")).toHaveLength(2);
    expect(within(select).getAllByRole("option")[1]).toHaveValue("valid");
  });
  it("shows partial measurements without offering comparison and clears the previous baseline", () => {
    render(
      <JavaCoverageHistoryPanel
        entries={[
          entry("now"),
          entry("before"),
          { ...entry("partial"), status: "partial", executionState: "failed" },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText("Compare coverage with"), {
      target: { value: "before" },
    });
    fireEvent.change(screen.getByLabelText("Coverage measurement"), {
      target: { value: "partial" },
    });
    expect(screen.queryByLabelText("Compare coverage with")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("partial; comparison is unavailable");
    fireEvent.change(screen.getByLabelText("Coverage measurement"), { target: { value: "now" } });
    expect(screen.getByLabelText("Compare coverage with")).toHaveValue("");
  });
});
