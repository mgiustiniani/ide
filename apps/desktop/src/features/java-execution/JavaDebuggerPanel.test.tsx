import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JavaDebuggerPanel } from "./JavaDebuggerPanel";
import { debuggerState } from "../../../../../packages/tauri-adapters/src/java-debugger-state.test-fixtures";
afterEach(cleanup);
describe("JDI debugger view", () => {
  it("offers Drop frame only for a provider-admitted current selection and explains retained effects", () => {
    const state = debuggerState(),
      action = vi.fn();
    const view = render(<JavaDebuggerPanel state={state} active action={action} />);
    expect(screen.getByRole("button", { name: "Drop frame" })).toBeDisabled();
    state.canDropFrame = true;
    view.rerender(<JavaDebuggerPanel state={{ ...state }} active action={action} />);
    expect(screen.getByText(/Object changes and external effects remain/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Drop frame" }));
    expect(action).toHaveBeenLastCalledWith({
      type: "dropFrame",
      stopId: "stop-1",
      frameId: state.selectedFrameId,
    });
    view.rerender(
      <JavaDebuggerPanel
        state={{ ...state, canDropFrame: false, selectedFrameId: state.frames[1].id }}
        active
        action={action}
      />,
    );
    expect(screen.getByRole("button", { name: "Drop frame" })).toBeDisabled();
    view.rerender(<JavaDebuggerPanel state={state} active={false} action={action} />);
    expect(screen.getByRole("button", { name: "Drop frame" })).toBeDisabled();
  });
  it("sends read-only conditions and matching-hit counts and displays the reached inactive breakpoint", () => {
    const state = debuggerState(),
      action = vi.fn();
    state.breakpoints[0] = {
      ...state.breakpoints[0],
      condition: "i % 2 == 0",
      hitCount: 3,
      hits: 3,
    };
    render(<JavaDebuggerPanel state={state} active={true} action={action} />);
    expect(
      screen.getByText(/initialized loaded-class static fields, array elements and length/),
    ).toBeVisible();
    expect(
      screen.getByText(/decimal, octal, hexadecimal and binary integer literals/),
    ).toBeVisible();
    expect(screen.getByText(/bitwise and shift operators/)).toBeVisible();
    expect(screen.getByText(/primitive numeric casts, boolean identity casts/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Breakpoint (class:line)"), {
      target: { value: "Main:8" },
    });
    fireEvent.change(screen.getByLabelText("Breakpoint condition (optional)"), {
      target: { value: "i >= 2" },
    });
    fireEvent.change(screen.getByLabelText("Stop on matching hit (optional)"), {
      target: { value: "2" },
    });
    fireEvent.change(
      screen.getByLabelText("Log message (optional; makes this a non-suspending logpoint)"),
      {
        target: { value: "value={i}" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Set breakpoint" }));
    expect(action).toHaveBeenLastCalledWith({
      type: "setBreakpoint",
      className: "Main",
      line: 8,
      condition: "i >= 2",
      hitCount: 2,
      logMessage: "value={i}",
    });
    expect(screen.getByRole("list", { name: "Java breakpoints" })).toHaveTextContent(
      "matching hits: 3 · stops once on 3 (reached; inactive)",
    );
    fireEvent.change(screen.getByLabelText("Stop on matching hit (optional)"), {
      target: { value: "1000000001" },
    });
    expect(screen.getByRole("button", { name: "Set breakpoint" })).toBeDisabled();
  });
  it("renders typed locals and dispatches the current stop rather than interpreting console text", () => {
    const action = vi.fn();
    render(<JavaDebuggerPanel state={debuggerState()} active action={action} />);
    expect(screen.getByRole("table", { name: "Java local variables" })).toHaveTextContent("42");
    fireEvent.click(screen.getByRole("button", { name: "Step over" }));
    expect(action).toHaveBeenLastCalledWith({ type: "step", stopId: "stop-1", kind: "over" });
    fireEvent.click(screen.getByRole("button", { name: "Inspect holder" }));
    expect(action).toHaveBeenLastCalledWith({
      type: "variables",
      stopId: "stop-1",
      reference: "stop-1:object:77",
      start: 0,
    });
  });
  it("binds class exclusions to each explicit step and rejects invalid patterns without disabling Continue", () => {
    const action = vi.fn();
    function View() {
      const [text, setText] = useState("");
      return <JavaDebuggerPanel state={debuggerState()} active action={action} stepFilterText={text} onStepFilterTextChange={setText} />;
    }
    render(<View />);
    fireEvent.change(screen.getByLabelText("Step exclusion patterns (one per line)"), { target: { value: "java.*\njdk.*" } });
    fireEvent.click(screen.getByRole("button", { name: "Step into" }));
    expect(action).toHaveBeenLastCalledWith({ type: "step", stopId: "stop-1", kind: "into", exclusionFilters: ["java.*", "jdk.*"] });
    fireEvent.change(screen.getByLabelText("Step exclusion patterns (one per line)"), { target: { value: "*" } });
    expect(screen.getByRole("button", { name: "Step into" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Step exclusion patterns (one per line)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Step out" }));
    expect(action).toHaveBeenLastCalledWith({ type: "step", stopId: "stop-1", kind: "out" });
    fireEvent.change(screen.getByLabelText("Step exclusion patterns (one per line)"), { target: { value: Array.from({ length: 6 }, (_, i) => String.fromCharCode(97 + i).repeat(400)).join("\n") } });
    expect(screen.getByRole("button", { name: "Step over" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("1,536 UTF-8 bytes");
  });
  it("shows native command failures as an accessible debugger alert", () => {
    render(
      <JavaDebuggerPanel
        state={debuggerState()}
        active
        action={vi.fn()}
        commandError="The JDI debugger session has stopped."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The JDI debugger session has stopped.");
  });
  it("selects a caller frame and refuses stepping there while leaving Continue and inspection available", () => {
    const state = debuggerState(),
      action = vi.fn();
    state.selectedFrameId = state.frames[1].id;
    render(<JavaDebuggerPanel state={state} active action={action} />);
    expect(screen.getByRole("button", { name: "Step into" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    fireEvent.click(
      within(screen.getByRole("list", { name: "Java stack frames" })).getByRole("button", {
        name: /Main.calculate/,
      }),
    );
    expect(action).toHaveBeenLastCalledWith({
      type: "selectFrame",
      stopId: "stop-1",
      frameId: state.frames[0].id,
    });
  });
  it("pages actual array children, offers bounded watch expressions and displays provider refusal", () => {
    const state = debuggerState(),
      action = vi.fn();
    state.variablePage = {
      reference: "stop-1:object:77",
      start: 0,
      total: 44,
      variables: Array.from({ length: 32 }, (_, i) => ({
        name: `[${i}]`,
        type: "int",
        value: String(i),
        valueTruncated: false,
        reference: null,
        childCount: 0,
      })),
    };
    state.error = "Unsupported expression syntax. Method calls and assignments are unavailable.";
    render(<JavaDebuggerPanel state={state} active action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Next children" }));
    expect(action).toHaveBeenLastCalledWith({
      type: "variables",
      stopId: "stop-1",
      reference: "stop-1:object:77",
      start: 32,
    });
    fireEvent.change(screen.getByLabelText("Watch expression"), {
      target: { value: "holder.values[33]" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add watch" }));
    expect(action).toHaveBeenLastCalledWith({
      type: "watch",
      stopId: "stop-1",
      expression: "holder.values[33]",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Method calls and assignments are unavailable.",
    );
  });
  it("evaluates a bounded expression without changing persistent watches and keeps its current-frame result", () => {
    const state = debuggerState(),
      action = vi.fn();
    state.error = "Previous watch error";
    state.watches = [
      {
        expression: "holder.number",
        variable: {
          name: "holder.number",
          type: "int",
          value: "7",
          valueTruncated: false,
          reference: null,
          childCount: 0,
        },
        error: null,
      },
    ];
    const view = render(<JavaDebuggerPanel state={state} active action={action} />);
    fireEvent.change(screen.getByLabelText("Watch expression"), {
      target: { value: "value * 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Evaluate once" }));
    expect(action).toHaveBeenLastCalledWith({
      type: "evaluate",
      stopId: "stop-1",
      expression: "value * 2",
    });

    const evaluated = debuggerState();
    evaluated.error = state.error;
    evaluated.watches = state.watches;
    evaluated.evaluation = {
      stopId: "stop-1",
      frameId: "stop-1:1:0",
      expression: "value * 2",
      variable: {
        name: "value * 2",
        type: "int",
        value: "84",
        valueTruncated: false,
        reference: null,
        childCount: 0,
      },
      error: null,
    };
    view.rerender(<JavaDebuggerPanel state={evaluated} active action={action} />);
    expect(screen.getByRole("table", { name: "Evaluation value * 2" })).toHaveTextContent("84");
    expect(screen.getByRole("list", { name: "Java watches" })).toHaveTextContent("holder.number");
    expect(action).not.toHaveBeenCalledWith(expect.objectContaining({ type: "removeWatch" }));
  });
  it("evaluates at the persistent-watch limit without consuming a watch slot", () => {
    const state = debuggerState(),
      action = vi.fn();
    state.watches = Array.from({ length: 32 }, (_, index) => ({
      expression: `value + ${index}`,
      variable: {
        name: `value + ${index}`,
        type: "int",
        value: String(42 + index),
        valueTruncated: false,
        reference: null,
        childCount: 0,
      },
      error: null,
    }));
    render(<JavaDebuggerPanel state={state} active action={action} />);
    fireEvent.change(screen.getByLabelText("Watch expression"), {
      target: { value: "value * 2" },
    });
    expect(screen.getByRole("button", { name: "Add watch" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Evaluate once" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Evaluate once" }));
    expect(action).toHaveBeenLastCalledWith({
      type: "evaluate",
      stopId: "stop-1",
      expression: "value * 2",
    });
    expect(action).not.toHaveBeenCalledWith(expect.objectContaining({ type: "removeWatch" }));
    expect(screen.getByRole("list", { name: "Java watches" }).querySelectorAll("li")).toHaveLength(
      32,
    );
  });
  it("sends local mutation only for the selected current frame", () => {
    const state = debuggerState(),
      action = vi.fn();
    const view = render(<JavaDebuggerPanel state={state} active action={action} />);
    fireEvent.change(screen.getByLabelText("Set local variable"), {
      target: { value: "value = value + 1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set local" }));
    expect(action).toHaveBeenLastCalledWith({
      type: "setLocalValue",
      stopId: "stop-1",
      frameId: "stop-1:1:0",
      assignment: "value = value + 1",
    });

    const obsolete = debuggerState();
    obsolete.frames[0].obsolete = true;
    view.rerender(<JavaDebuggerPanel state={obsolete} active action={action} />);
    fireEvent.change(screen.getByLabelText("Set local variable"), {
      target: { value: "value = 43" },
    });
    expect(screen.getByRole("button", { name: "Set local" })).toBeDisabled();
  });
  it.each(["frame", "stop", "resume", "inactive", "obsolete", "missing-frame"] as const)(
    "discards a local mutation draft after a %s change without dispatching it",
    (change) => {
      const state = debuggerState();
      const action = vi.fn();
      const view = render(<JavaDebuggerPanel state={state} active action={action} />);
      const input = () => screen.getByLabelText("Set local variable");
      const submit = () => screen.getByRole("button", { name: "Set local" });
      fireEvent.change(input(), { target: { value: "value = value + 1" } });
      // Polling the same suspended frame must preserve an intentional edit.
      view.rerender(<JavaDebuggerPanel state={debuggerState()} active action={action} />);
      expect(input()).toHaveValue("value = value + 1");
      expect(submit()).toBeEnabled();

      const changed = debuggerState();
      if (change === "frame") changed.selectedFrameId = changed.frames[1].id;
      if (change === "stop") changed.stopId = "stop-2";
      if (change === "resume") changed.status = "running";
      if (change === "obsolete") changed.frames[0].obsolete = true;
      if (change === "missing-frame") changed.frames = [];
      view.rerender(
        <JavaDebuggerPanel state={changed} active={change !== "inactive"} action={action} />,
      );
      expect(input()).toHaveValue("");
      expect(submit()).toBeDisabled();
      fireEvent.click(submit());
      expect(action).not.toHaveBeenCalled();

      // Returning to an earlier frame cannot resurrect its retired mutation.
      view.rerender(<JavaDebuggerPanel state={state} active action={action} />);
      expect(input()).toHaveValue("");
      expect(submit()).toBeDisabled();
      fireEvent.change(input(), { target: { value: "value = 7" } });
      fireEvent.click(submit());
      expect(action).toHaveBeenCalledExactlyOnceWith({
        type: "setLocalValue",
        stopId: state.stopId,
        frameId: state.selectedFrameId,
        assignment: "value = 7",
      });
    },
  );
  it("discards a one-time result returned for a stale frame", () => {
    const state = debuggerState(),
      action = vi.fn();
    const view = render(<JavaDebuggerPanel state={state} active action={action} />);
    fireEvent.change(screen.getByLabelText("Watch expression"), { target: { value: "value" } });
    fireEvent.click(screen.getByRole("button", { name: "Evaluate once" }));
    expect(action).toHaveBeenLastCalledWith({
      type: "evaluate",
      stopId: "stop-1",
      expression: "value",
    });

    const changedFrame = debuggerState();
    changedFrame.selectedFrameId = changedFrame.frames[1].id;
    view.rerender(<JavaDebuggerPanel state={changedFrame} active action={action} />);
    const lateResult = debuggerState();
    lateResult.selectedFrameId = lateResult.frames[1].id;
    lateResult.evaluation = {
      stopId: "stop-1",
      frameId: "stop-1:1:0",
      expression: "value",
      variable: {
        name: "value",
        type: "int",
        value: "7",
        valueTruncated: false,
        reference: null,
        childCount: 0,
      },
      error: null,
    };
    view.rerender(<JavaDebuggerPanel state={lateResult} active action={action} />);
    expect(screen.queryByRole("region", { name: "Evaluation result" })).not.toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(1);
  });
  it("makes terminated/loading views read-only and enables only Pause when running", () => {
    const state = debuggerState(),
      action = vi.fn();
    state.status = "running";
    state.stopId = null;
    state.frames = [];
    state.variables = [];
    state.selectedFrameId = null;
    state.selectedThreadId = null;
    const view = render(<JavaDebuggerPanel state={state} active action={action} />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(action).toHaveBeenCalledWith({ type: "pause" });
    view.rerender(
      <JavaDebuggerPanel
        state={{ ...state, status: "terminated" }}
        active={false}
        action={action}
      />,
    );
    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Set breakpoint" })).toBeDisabled();
  });
});

it("reviews exact exception filters, preserves acknowledged settings on mode changes and refuses invalid names", () => {
  const state = debuggerState(), action = vi.fn();
  const view = render(<JavaDebuggerPanel state={state} active action={action} />);
  fireEvent.change(screen.getByLabelText("Exception class (optional binary name)"), { target: { value: " Main$Problem " } });
  fireEvent.click(screen.getByLabelText("Include exception subclasses"));
  fireEvent.click(screen.getByRole("button", { name: "Apply exception filter" }));
  expect(action).toHaveBeenLastCalledWith({ type: "exceptions", mode: "none", className: "Main$Problem", includeSubclasses: false });
  view.rerender(<JavaDebuggerPanel state={{ ...state, exceptionClassName: "Main$Problem", exceptionIncludeSubclasses: false }} active action={action} />);
  fireEvent.change(screen.getByLabelText("Exception breakpoints"), { target: { value: "caught" } });
  expect(action).toHaveBeenLastCalledWith({ type: "exceptions", mode: "caught", className: "Main$Problem", includeSubclasses: false });
  expect(screen.getByText("Current exception filter: Main$Problem only.")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Exception class (optional binary name)"), { target: { value: "java.*" } });
  expect(screen.getByRole("button", { name: "Apply exception filter" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Exception breakpoints"), { target: { value: "none" } });
  expect(action).toHaveBeenLastCalledWith({ type: "exceptions", mode: "none", className: "Main$Problem", includeSubclasses: false });
  view.rerender(<JavaDebuggerPanel state={state} active={false} action={action} />);
  expect(screen.getByRole("button", { name: "Apply exception filter" })).toBeDisabled();
});

it("requires acknowledged support for muting and displays only the confirmed setting", () => {
  const action = vi.fn();
  const state = debuggerState();
  const view = render(<JavaDebuggerPanel state={state} active action={action} />);
  expect(screen.getByRole("button", { name: "Mute line breakpoints" })).toBeDisabled();
  view.rerender(<JavaDebuggerPanel state={{ ...state, breakpointsMuted: false }} active action={action} />);
  fireEvent.click(screen.getByRole("button", { name: "Mute line breakpoints" }));
  expect(action).toHaveBeenLastCalledWith({ type: "muteBreakpoints", muted: true });
  expect(screen.getByRole("button", { name: "Mute line breakpoints" })).toBeInTheDocument();
  view.rerender(<JavaDebuggerPanel state={{ ...state, breakpointsMuted: true }} active action={action} />);
  expect(screen.getByText(/Exception breakpoints and Run to Cursor remain active/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Unmute line breakpoints" }));
  expect(action).toHaveBeenLastCalledWith({ type: "muteBreakpoints", muted: false });
  view.rerender(<JavaDebuggerPanel state={{ ...state, breakpointsMuted: true }} active={false} action={action} />);
  expect(screen.getByRole("button", { name: "Unmute line breakpoints" })).toBeDisabled();
});
