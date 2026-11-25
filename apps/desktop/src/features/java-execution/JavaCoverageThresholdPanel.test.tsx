import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { JavaCoverageThresholdPanel } from "./JavaCoverageThresholdPanel";
import { emptyCoverageThresholds } from "./javaCoverageThresholds";
describe("Coverage threshold presentation", () => {
  it("edits literal percentages and shows the captured execution thresholds separately", () => {
    const update = vi.fn();
    render(
      <JavaCoverageThresholdPanel
        settings={emptyCoverageThresholds}
        onChange={update}
        disabled={false}
        check={{
          status: "failed",
          settings: { ...emptyCoverageThresholds, branches: "75" },
          counters: {
            lines: { covered: 1, missed: 1 },
            branches: { covered: 1, missed: 1 },
            instructions: { covered: 3, missed: 2 },
          },
          message: "Threshold not reached.",
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Minimum branches coverage (%)"), {
      target: { value: "80" },
    });
    expect(update).toHaveBeenCalledWith({ ...emptyCoverageThresholds, branches: "80" });
    expect(screen.getByRole("alert")).toHaveTextContent("failed");
    expect(screen.getByLabelText("Coverage threshold result")).toHaveTextContent(
      "required 75%; measured 50.0000% (1 / 2)",
    );
  });
  it("disables changes during execution and presents invalid saved drafts", () => {
    render(
      <JavaCoverageThresholdPanel
        settings={{ ...emptyCoverageThresholds, lines: "101" }}
        onChange={vi.fn()}
        disabled={true}
        check={null}
      />,
    );
    expect(screen.getByLabelText("Minimum lines coverage (%)")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("0 to 100");
  });
});
