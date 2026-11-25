import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { JavaSourceBreakpointsPanel } from "./JavaSourceBreakpointsPanel";
import type { JavaSourceBreakpoints } from "./useJavaSourceBreakpoints";
describe("Saved breakpoint conditions", () => {
  it("edits a specific saved point without a source save and hides drafts when its workspace changes", () => {
    const configure = vi.fn();
    const controller = {
      contextKey: "one:1",
      points: [{ sourcePath: "Main.java", line: 10, fingerprint: "a".repeat(64), enabled: true }],
      error: null,
      configure,
      remove: vi.fn(),
      enable: vi.fn(),
      clear: vi.fn(),
      rebindActive: vi.fn(),
    } as unknown as JavaSourceBreakpoints;
    const view = render(<JavaSourceBreakpointsPanel controller={controller} disabled={false} />);
    expect(
      screen.getByText(/initialized loaded-class static fields, array elements and length/),
    ).toBeVisible();
    expect(screen.getByText(/bitwise and shift operators/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Edit condition for Main.java:10" }));
    fireEvent.change(screen.getByLabelText("Saved breakpoint condition"), {
      target: { value: "i >= 2" },
    });
    fireEvent.change(screen.getByLabelText("Saved breakpoint matching hit"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Saved breakpoint log message (optional)"), {
      target: { value: "value={i}" },
    });
    fireEvent.submit(screen.getByRole("form"));
    expect(configure).toHaveBeenCalledWith("Main.java", 10, {
      condition: "i >= 2",
      hitCount: 3,
      logMessage: "value={i}",
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit condition for Main.java:10" }));
    view.rerender(
      <JavaSourceBreakpointsPanel
        controller={{ ...controller, contextKey: "two:2" }}
        disabled={false}
      />,
    );
    expect(screen.queryByRole("form")).toBeNull();
    view.rerender(<JavaSourceBreakpointsPanel controller={controller} disabled={true} />);
    expect(screen.getByRole("button", { name: "Edit condition for Main.java:10" })).toBeDisabled();
  });
  it("shows a unique context relocation while leaving movement behind explicit rebinding", () => {
    const rebindActive = vi.fn(),
      controller = {
        contextKey: "one:1",
        points: [{ sourcePath: "Main.java", line: 10, fingerprint: "a".repeat(64), enabled: true }],
        error: null,
        review: {
          sourcePath: "Main.java",
          relocations: [{ sourcePath: "Main.java", fromLine: 10, toLine: 14, status: "unique" }],
        },
        rebindActive,
      } as unknown as JavaSourceBreakpoints;
    render(<JavaSourceBreakpointsPanel controller={controller} disabled={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Main.java:10 has one matching source context at line 14",
    );
    expect(rebindActive).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Rebind active file" })).toBeEnabled();
  });
});
