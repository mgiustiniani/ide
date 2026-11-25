import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { JavaTestDiscoveryPanel } from "./JavaTestDiscoveryPanel";
import type { OpenJavaTestSource } from "./useJavaTestSourceAction";
import type { JavaTestDiscovery } from "@ide/contracts";
afterEach(cleanup);
const discovery: JavaTestDiscovery = {
  status: "ready",
  projectPath: "",
  buildTool: "maven",
  scope: "engines",
  message: null,
  tests: [
    { id: "class", kind: "class", className: "p.Test", methodName: null, label: "p.Test" },
    {
      id: "method",
      kind: "method",
      className: "p.Test",
      methodName: "selected",
      label: "<script>selected 😀</script>",
    },
  ],
};
it("opens the discovered class without enabling test execution", async () => {
  const openTestSource = vi.fn(async () => {});
  const run = vi.fn();
  render(
    <JavaTestDiscoveryPanel
      discovery={discovery}
      disabled
      run={run}
      openTestSource={openTestSource}
    />,
  );
  expect(screen.getByRole("button", { name: "Run method group p.Test#selected" })).toBeDisabled();
  const sourceButtons = screen.getAllByRole("button", { name: /Open test class/ });
  expect(sourceButtons).toHaveLength(1);
  await act(async () => {
    fireEvent.click(sourceButtons[0]);
  });
  expect(openTestSource).toHaveBeenCalledWith(discovery.tests[0], discovery, expect.any(Function));
  expect(run).not.toHaveBeenCalled();
});

it("retires a pending source lookup when discovery is replaced", async () => {
  let rejectLookup!: (reason: Error) => void;
  const pending = new Promise<void>((_, reject) => {
    rejectLookup = reject;
  });
  const openTestSource = vi.fn<OpenJavaTestSource>(() => pending);
  const props = { disabled: false, run: vi.fn(), openTestSource };
  const view = render(<JavaTestDiscoveryPanel discovery={discovery} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Open test class p.Test" }));
  const isCurrent = openTestSource.mock.calls[0][2];
  expect(isCurrent()).toBe(true);

  view.rerender(<JavaTestDiscoveryPanel discovery={{ ...discovery, projectPath: "other" }} {...props} />);
  expect(isCurrent()).toBe(false);
  await act(async () => {
    rejectLookup(new Error("Old discovery lookup failed"));
  });
  expect(screen.queryByText("Old discovery lookup failed")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open test class p.Test" })).toBeEnabled();
});

it("searches all runner names while exposing one explicit method-name group", () => {
  const run = vi.fn(),
    debug = vi.fn(),
    cover = vi.fn();
  render(
    <JavaTestDiscoveryPanel
      discovery={{
        ...discovery,
        tests: [
          {
            ...discovery.tests[1],
            label: "selected()",
            displayNames: ["selected()", "selected(TestInfo)"],
            displayNameCount: 2,
          },
        ],
      }}
      disabled={false}
      run={run}
      debug={debug}
      cover={cover}
    />,
  );
  expect(screen.getByText(/every matching overload/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Search discovered tests"), {
    target: { value: "TestInfo" },
  });
  fireEvent.click(screen.getByText("Discovered display names (2)"));
  expect(screen.getByText("selected(TestInfo)")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Run method group p.Test#selected" }));
  fireEvent.click(screen.getByRole("button", { name: "Debug method group p.Test#selected" }));
  fireEvent.click(screen.getByRole("button", { name: "Cover method group p.Test#selected" }));
  for (const action of [run, debug, cover]) expect(action).toHaveBeenCalledWith("method");
});
it("bounds ten thousand selections and runs or covers an exact searched provider identity", () => {
  const large: JavaTestDiscovery = {
    ...discovery,
    tests: Array.from({ length: 10000 }, (_, index) => ({
      id: `discovery-${index}`,
      kind: "method",
      className: "p.Test",
      methodName: `selected${index}`,
      label: `Display ${index}`,
    })),
  };
  const run = vi.fn(),
    cover = vi.fn();
  const view = render(
    <JavaTestDiscoveryPanel discovery={large} disabled={false} run={run} cover={cover} />,
  );
  expect(view.container.querySelectorAll("li")).toHaveLength(100);
  expect(screen.getByText(/10000 method-name groups/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next discovered tests" }));
  expect(screen.getByText(/Showing 101–200 of 10000/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Search discovered tests"), {
    target: { value: "SELECTED9999" },
  });
  expect(view.container.querySelectorAll("li")).toHaveLength(1);
  expect(screen.getByText("p.Test#selected9999")).toBeVisible();
  expect(screen.getByText(/Showing 1–1 of 1/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Run method group p.Test#selected9999" }));
  fireEvent.click(screen.getByRole("button", { name: "Cover method group p.Test#selected9999" }));
  expect(run).toHaveBeenCalledWith("discovery-9999");
  expect(cover).toHaveBeenCalledWith("discovery-9999");
});
it("filters classes and methods while retaining whole-discovery counts and partial admission", () => {
  const run = vi.fn(),
    cover = vi.fn();
  const view = render(
    <JavaTestDiscoveryPanel
      discovery={{ ...discovery, status: "partial" }}
      disabled={false}
      run={run}
      cover={cover}
    />,
  );
  fireEvent.change(screen.getByLabelText("Discovered test kind"), { target: { value: "method" } });
  expect(view.container.querySelectorAll("li")).toHaveLength(1);
  expect(screen.getByText(/1 classes, 1 method-name groups/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Run method group p.Test#selected" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cover method group p.Test#selected" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Search discovered tests"), {
    target: { value: "selected" },
  });
  fireEvent.change(screen.getByLabelText("Discovered test kind"), { target: { value: "class" } });
  expect(screen.getByText(/No matching discovered tests/)).toBeVisible();
  expect(run).not.toHaveBeenCalled();
  expect(cover).not.toHaveBeenCalled();
});
it("clamps paging when results shrink and removes selections for unavailable discovery", () => {
  const large: JavaTestDiscovery = {
    ...discovery,
    tests: Array.from({ length: 101 }, (_, index) => ({
      ...discovery.tests[0],
      id: String(index),
    })),
  };
  const view = render(<JavaTestDiscoveryPanel discovery={large} disabled={false} run={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Next discovered tests" }));
  expect(screen.getByText(/Showing 101–101 of 101/)).toBeVisible();
  view.rerender(<JavaTestDiscoveryPanel discovery={discovery} disabled={false} run={vi.fn()} />);
  expect(screen.getByText(/Showing 1–2 of 2/)).toBeVisible();
  view.rerender(
    <JavaTestDiscoveryPanel
      discovery={{
        ...discovery,
        status: "unavailable",
        tests: [],
        message: "Discovery unavailable.",
      }}
      disabled={false}
      run={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Discovery unavailable.");
  expect(screen.queryByRole("button")).toBeNull();
});
it("presents runner labels as text and delegates explicit class or method selection", () => {
  const run = vi.fn();
  render(<JavaTestDiscoveryPanel discovery={discovery} disabled={false} run={run} />);
  expect(screen.getByText("<script>selected 😀</script>")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Run method group p.Test#selected" }));
  expect(run).toHaveBeenCalledWith("method");
  expect(
    screen.getByText(
      /Surefire include\/exclude patterns, groups, suite XML, engine settings and argLine are not applied/,
    ),
  ).toBeVisible();
});
it("disables selection during pending work or incomplete discovery", () => {
  const run = vi.fn();
  const view = render(<JavaTestDiscoveryPanel discovery={discovery} disabled run={run} />);
  expect(screen.getByRole("button", { name: "Run class p.Test" })).toBeDisabled();
  view.rerender(
    <JavaTestDiscoveryPanel
      discovery={{ ...discovery, status: "partial", message: "Unsupported identity" }}
      disabled={false}
      run={run}
    />,
  );
  expect(screen.getByRole("button", { name: "Run method group p.Test#selected" })).toBeDisabled();
});

it("debugs the exact discovered identity and refuses partial discovery", () => {
  const debug = vi.fn();
  const view = render(
    <JavaTestDiscoveryPanel discovery={discovery} disabled={false} run={vi.fn()} debug={debug} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Debug method group p.Test#selected" }));
  expect(debug).toHaveBeenCalledWith("method");
  view.rerender(
    <JavaTestDiscoveryPanel
      discovery={{ ...discovery, status: "partial" }}
      disabled={false}
      run={vi.fn()}
      debug={debug}
    />,
  );
  expect(screen.getByRole("button", { name: "Debug method group p.Test#selected" })).toBeDisabled();
});
