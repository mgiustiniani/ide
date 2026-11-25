import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { JavaTestResults } from "@ide/contracts";
import { useJavaTestSourceAction } from "./useJavaTestSourceAction";
import { JavaTestResultsPanel } from "./JavaTestResultsPanel";
function reports(): JavaTestResults {
  return {
    status: "ready",
    projectPath: "service",
    buildTool: "maven",
    unchangedReports: 0,
    suites: [
      {
        name: "SampleTest",
        reportPath: "service/target/surefire-reports/TEST-Sample.xml",
        cases: [
          {
            id: "one",
            name: "fails",
            className: "SampleTest",
            state: "failed",
            durationMs: 3,
            detail: "<script>untrusted</script>\nAssertionError",
            detailTruncated: true,
          },
        ],
      },
    ],
    summary: { total: 1, failed: 1, passed: 0, error: 0, skipped: 0, flaky: 0 },
    message: null,
    canRerunFailed: true,
    rerunReason: null,
  };
}
describe("Java test result presentation", () => {
  it("renders only one hundred case rows at the ten-thousand-case report limit", () => {
    const value = reports();
    const test = value.suites[0].cases[0];
    value.suites[0].cases = Array.from({ length: 10000 }, (_, index) => ({
      ...test,
      id: String(index),
      name: `test-${index}`,
      state: "passed",
      detail: "",
    }));
    value.summary = { total: 10000, passed: 10000, failed: 0, error: 0, skipped: 0, flaky: 0 };
    const view = render(<JavaTestResultsPanel results={value} canRerun={false} rerun={vi.fn()} />);
    expect(view.container.querySelectorAll("li")).toHaveLength(100);
    expect(screen.getByText(/10000 reported tests/)).toHaveTextContent("10000 passed");
  });
  it("bounds rendered cases, brings late failures into view and searches without changing rerun authority", () => {
    const value = reports();
    value.suites[0].cases = Array.from({ length: 250 }, (_, index) => ({
      ...value.suites[0].cases[0],
      id: String(index),
      name: `case-${String(index).padStart(3, "0")}`,
      state: index === 249 ? "failed" : "passed",
      detail: index === 249 ? "special failure detail" : "",
    }));
    value.summary = { total: 250, passed: 249, failed: 1, error: 0, skipped: 0, flaky: 0 };
    const rerun = vi.fn();
    const view = render(<JavaTestResultsPanel results={value} canRerun rerun={rerun} />);
    expect(view.container.querySelectorAll("li")).toHaveLength(100);
    expect(view.container.querySelector("li summary")).toHaveTextContent("case-249");
    fireEvent.change(screen.getByLabelText("Order reported tests"), {
      target: { value: "report" },
    });
    expect(view.container.querySelector("li summary")).toHaveTextContent("case-000");
    fireEvent.click(screen.getByRole("button", { name: "Next tests" }));
    expect(screen.getByText(/Showing 101–200 of 250/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next tests" }));
    expect(view.container.querySelectorAll("li")).toHaveLength(50);
    fireEvent.change(screen.getByLabelText("Search reported tests"), {
      target: { value: "SPECIAL FAILURE" },
    });
    expect(view.container.querySelectorAll("li")).toHaveLength(1);
    expect(screen.getByText(/Showing 1–1 of 1/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Show test outcomes"), { target: { value: "passed" } });
    expect(screen.getByText(/No matching reported tests/)).toBeVisible();
    expect(screen.getByText(/250 reported tests/)).toHaveTextContent("1 failed");
    fireEvent.click(screen.getByRole("button", { name: "Rerun failed tests" }));
    expect(rerun).toHaveBeenCalledOnce();
  });
  it("orders durations globally across suites, retaining unknown durations last", () => {
    const value = reports();
    const test = value.suites[0].cases[0];
    value.suites = [
      {
        ...value.suites[0],
        cases: [
          { ...test, id: "slow", name: "slow", durationMs: 100 },
          { ...test, id: "fast", name: "fast", durationMs: 20 },
        ],
      },
      {
        ...value.suites[0],
        name: "Other",
        reportPath: "other.xml",
        cases: [
          { ...test, id: "medium", name: "medium", durationMs: 70 },
          { ...test, id: "unknown", name: "unknown", durationMs: null },
        ],
      },
    ];
    const view = render(<JavaTestResultsPanel results={value} canRerun rerun={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Order reported tests"), {
      target: { value: "duration" },
    });
    expect(
      [...view.container.querySelectorAll("li summary")].map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining("slow"),
      expect.stringContaining("medium"),
      expect.stringContaining("fast"),
      expect.stringContaining("unknown"),
    ]);
  });
  it("finds suite/report metadata and distinguishes retried passes from ordinary passes", () => {
    const value = reports();
    value.suites[0].cases[0] = { ...value.suites[0].cases[0], state: "flaky" };
    render(<JavaTestResultsPanel results={value} canRerun={false} rerun={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search reported tests"), {
      target: { value: "TEST-SAMPLE.XML" },
    });
    fireEvent.change(screen.getByLabelText("Show test outcomes"), { target: { value: "flaky" } });
    expect(screen.getByText(/Showing 1–1 of 1/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Show test outcomes"), {
      target: { value: "failures" },
    });
    expect(screen.getByText(/No matching reported tests/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Rerun failed tests" })).toBeDisabled();
  });
  it("shows build-issued cases and failure details as text and delegates a reviewed rerun", () => {
    const rerun = vi.fn();
    render(<JavaTestResultsPanel results={reports()} canRerun rerun={rerun} />);
    expect(screen.getByText(/1 reported tests/)).toHaveTextContent("1 failed");
    expect(screen.getByLabelText("Test detail for fails")).toHaveTextContent(
      "<script>untrusted</script>",
    );
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("Test detail was truncated to 16 KiB.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Rerun failed tests" }));
    expect(rerun).toHaveBeenCalledOnce();
  });

  it("opens a reported test source through the supplied Java navigation action", async () => {
    const openTestSource = vi.fn().mockResolvedValue(undefined);
    render(
      <JavaTestResultsPanel
        results={reports()}
        canRerun
        rerun={vi.fn()}
        openTestSource={openTestSource}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open source for SampleTest test fails" }));
    expect(await screen.findByText("Open test source")).toBeVisible();
    expect(openTestSource).toHaveBeenCalledWith(
      reports().suites[0].cases[0],
      expect.objectContaining({ projectPath: "service" }),
      expect.any(Function),
    );
  });

  it("shows a safe refusal when a test source cannot be resolved", async () => {
    render(
      <JavaTestResultsPanel
        results={reports()}
        canRerun
        rerun={vi.fn()}
        openTestSource={async () => {
          throw new Error("JDT LS did not resolve the test class.");
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open source for SampleTest test fails" }));
    expect(await screen.findByText("JDT LS did not resolve the test class.")).toBeVisible();
  });
  it("retains partial cases without offering a partial failed-test rerun", () => {
    const results = {
      ...reports(),
      status: "partial" as const,
      message: "Some reports are unavailable.",
      canRerunFailed: false,
      rerunReason: "Incomplete evidence.",
    };
    const rerun = vi.fn();
    render(<JavaTestResultsPanel results={results} canRerun rerun={rerun} />);
    expect(screen.getByText("Some reports are unavailable.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Rerun failed tests" })).toBeDisabled();
    expect(screen.getByText("Incomplete evidence.")).toBeVisible();
  });
  it("shows report unavailability without a green zero-test summary", () => {
    const results = {
      ...reports(),
      status: "unavailable" as const,
      suites: [],
      summary: { total: 0, passed: 0, failed: 0, error: 0, skipped: 0, flaky: 0 },
      message: "No fresh cases.",
      canRerunFailed: false,
    };
    render(<JavaTestResultsPanel results={results} canRerun rerun={vi.fn()} />);
    expect(screen.getByText("No fresh cases.")).toBeVisible();
    expect(screen.queryByText(/reported tests/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

it("offers debugging of failed selections only with the session's explicit admission", () => {
  const debugFailed = vi.fn();
  const view = render(<JavaTestResultsPanel results={reports()} canRerun rerun={vi.fn()} debugFailed={debugFailed} />);
  expect(screen.getByRole("button", { name: "Debug failed tests" })).toBeDisabled();
  view.rerender(<JavaTestResultsPanel results={reports()} canRerun rerun={vi.fn()} debugFailed={debugFailed} canDebugFailed />);
  fireEvent.click(screen.getByRole("button", { name: "Debug failed tests" }));
  expect(debugFailed).toHaveBeenCalledOnce();
});

it("shows the actual whole-class fallback and warns that previously passing tests run again", () => {
  const value = reports();
  value.rerunSelections = [{ className: "SampleTest", methodName: null }];
  const view = render(<JavaTestResultsPanel results={value} canRerun rerun={vi.fn()} />);
  expect(screen.getByLabelText("Java failed-test selections")).toHaveTextContent("SampleTest — whole class");
  expect(screen.getByLabelText("Java failed-test selections")).toHaveTextContent(/previously passing or skipped/);
  value.rerunSelections = [{ className: "SampleTest", methodName: "fails" }];
  view.rerender(<JavaTestResultsPanel results={value} canRerun rerun={vi.fn()} />);
  expect(screen.getByLabelText("Java failed-test selections")).toHaveTextContent("SampleTest#fails");
  expect(screen.getByLabelText("Java failed-test selections")).not.toHaveTextContent(/previously passing or skipped/);
});

it("shows and searches runner identities independently from identical display names", async () => {
  const results = reports();
  const failed = { ...results.suites[0].cases[0], name: "same display", methodSource: { className: "fixture.Base", methodName: "actualFailure" } };
  results.suites[0].cases = [failed, { ...failed, id: "two", state: "passed", detail: "", methodSource: { className: "fixture.Base", methodName: "actualPass" } }];
  results.summary = { ...results.summary, total: 2, passed: 1 };
  const openTestSource = vi.fn().mockResolvedValue(undefined);
  render(<JavaTestResultsPanel results={results} canRerun={true} rerun={vi.fn()} openTestSource={openTestSource} />);
  expect(screen.getByText("Method: fixture.Base#actualFailure")).toBeInTheDocument();
  expect(screen.getByText("Method: fixture.Base#actualPass")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search reported tests"), { target: { value: "actualFailure" } });
  expect(screen.queryByText("Method: fixture.Base#actualPass")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open source for SampleTest test same display" }));
  await waitFor(() => expect(openTestSource).toHaveBeenCalledWith(failed, results, expect.any(Function)));
  await waitFor(() => expect(screen.getByRole("button", { name: "Open source for SampleTest test same display" })).toBeEnabled());
});

it("distinguishes an inherited method declaration from the runner class and searches either", () => {
  const results = reports();
  results.suites[0].cases[0]!.methodSource = { className: "fixture.ExecutingTest", methodName: "inherited", declaringClassName: "fixture.SharedBase" };
  render(<JavaTestResultsPanel results={results} canRerun={true} rerun={vi.fn()} />);
  expect(screen.getByText("Method: fixture.ExecutingTest#inherited")).toBeInTheDocument();
  expect(screen.getByLabelText("Test method declaring class")).toHaveTextContent("Declared in: fixture.SharedBase");
  fireEvent.change(screen.getByLabelText("Search reported tests"), { target: { value: "fixture.SharedBase" } });
  expect(screen.getByText("Method: fixture.ExecutingTest#inherited")).toBeInTheDocument();
});


it.each(["success", "failure"] as const)("retires old source navigation %s without changing a newer report's pending action", async outcome => {
  let finishOld!: () => void;
  let failOld!: (error: Error) => void;
  let finishNew!: () => void;
  const open = vi.fn()
    .mockImplementationOnce(() => new Promise<void>((resolve, reject) => { finishOld = resolve; failOld = reject; }))
    .mockImplementationOnce(() => new Promise<void>(resolve => { finishNew = resolve; }));
  const old = reports();
  const view = render(<JavaTestResultsPanel results={old} canRerun={false} rerun={vi.fn()} openTestSource={open} />);
  fireEvent.click(screen.getByRole("button", { name: "Open source for SampleTest test fails" }));
  const oldGuard = open.mock.calls[0][2] as () => boolean;
  expect(oldGuard()).toBe(true);
  const fresh = reports();
  fresh.suites[0].cases[0] = { ...fresh.suites[0].cases[0], id: "new", className: "NewTest", name: "new failure" };
  view.rerender(<JavaTestResultsPanel results={fresh} canRerun={false} rerun={vi.fn()} openTestSource={open} />);
  expect(oldGuard()).toBe(false);
  const button = screen.getByRole("button", { name: "Open source for NewTest test new failure" });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(open).toHaveBeenCalledTimes(2);
  expect(button).toBeDisabled();
  await act(async () => { if (outcome === "success") finishOld(); else failOld(new Error("retired source failure")); });
  expect(screen.queryByText("retired source failure")).not.toBeInTheDocument();
  expect(button).toBeDisabled();
  await act(async () => finishNew());
  expect(button).toBeEnabled();
});
it.each(["report", "action"] as const)("clears source errors when the %s is replaced", async change => {
  const value = reports();
  const open = vi.fn(async () => { throw new Error("previous navigation failure"); });
  const view = render(<JavaTestResultsPanel results={value} canRerun={false} rerun={vi.fn()} openTestSource={open} />);
  fireEvent.click(screen.getByRole("button", { name: "Open source for SampleTest test fails" }));
  expect(await screen.findByText("previous navigation failure")).toBeVisible();
  view.rerender(<JavaTestResultsPanel results={change === "report" ? reports() : value} canRerun={false} rerun={vi.fn()}
    openTestSource={change === "action" ? vi.fn(async () => {}) : open} />);
  expect(screen.queryByText("previous navigation failure")).not.toBeInTheDocument();
});


it.each(["action", "unmount"] as const)("retires the editor navigation guard after %s replacement", async change => {
  let finish!: () => void;
  const open = vi.fn((_test, _results, _guard: () => boolean) => new Promise<void>(resolve => { finish = resolve; }));
  const results = reports();
  const view = render(<JavaTestResultsPanel results={results} canRerun={false} rerun={vi.fn()} openTestSource={open} />);
  fireEvent.click(screen.getByRole("button", { name: "Open source for SampleTest test fails" }));
  const guard = open.mock.calls[0][2];
  expect(guard()).toBe(true);
  if (change === "unmount") view.unmount();
  else view.rerender(<JavaTestResultsPanel results={results} canRerun={false} rerun={vi.fn()} openTestSource={vi.fn(async () => {})} />);
  expect(guard()).toBe(false);
  await act(async () => finish());
});


it("keeps pending source navigation valid across language progress updates but retires a replacement language session", async () => {
  const results = reports();
  let finish!: () => void;
  let guard!: () => boolean;
  const open = vi.fn((_test, _results, isCurrent: () => boolean) => {
    guard = isCurrent;
    return new Promise<void>(resolve => { finish = resolve; });
  });
  function Panel({ action, languageGeneration }: { action: typeof open; languageGeneration: number }) {
    const navigate = useJavaTestSourceAction(action, { workspaceId: "one", generation: 1, languageGeneration });
    return <JavaTestResultsPanel results={results} canRerun={false} rerun={vi.fn()} openTestSource={navigate} />;
  }
  const view = render(<Panel action={open} languageGeneration={1} />);
  fireEvent.click(screen.getByRole("button", { name: "Open source for SampleTest test fails" }));
  expect(guard()).toBe(true);
  view.rerender(<Panel action={vi.fn(open)} languageGeneration={1} />);
  expect(guard()).toBe(true);
  expect(screen.getByRole("button", { name: "Open source for SampleTest test fails" })).toBeDisabled();
  view.rerender(<Panel action={open} languageGeneration={2} />);
  expect(guard()).toBe(false);
  expect(screen.getByRole("button", { name: "Open source for SampleTest test fails" })).toBeEnabled();
  await act(async () => finish());
});
