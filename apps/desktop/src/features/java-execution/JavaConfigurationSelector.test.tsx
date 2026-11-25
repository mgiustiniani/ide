import { fireEvent, render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { JavaExecutionPort } from "@ide/web-core/ports";
import { JavaExecutionPanel } from "./JavaExecutionPanel";
import { useJavaExecutionController } from "./useJavaExecutionController";

function nativePort(): JavaExecutionPort {
  return {
    getCapabilities: vi.fn(async (request) => ({
      ...request,
      available: true,
      projectKind: "jdk",
      jdk: true,
      maven: false,
      gradle: false,
      debugger: true,
      reason: null,
    })),
    start: vi.fn(async (request) => ({
      workspaceId: request.workspaceId,
      generation: request.generation,
      sessionId: "one",
      operation: request.operation,
      state: "succeeded" as const,
      exitCode: 0,
      output: "",
      outputTruncated: false,
    })),
    stop: vi.fn(),
    snapshot: vi.fn(),
    debugCommand: vi.fn(),
    rerunFailed: vi.fn(),
  };
}
function Activity({ port, prepare }: { port: JavaExecutionPort; prepare(): Promise<void> }) {
  const controller = useJavaExecutionController({
    port,
    workspaceId: "ui",
    generation: 1,
    enabled: true,
    prepare,
  });
  return <JavaExecutionPanel controller={controller} />;
}
beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("saved Java configuration controls", () => {
  it("edits independent configurations, launches the selection and restores it without trust", async () => {
    const port = nativePort(),
      prepare = vi.fn(async () => undefined);
    localStorage.setItem(
      "ide.java.launch.ui",
      JSON.stringify({
        buildTool: "jdk",
        mainClass: "Main",
        classPath: [],
        programArguments: ["", "literal 😀"],
        jvmOptions: ["-Xmx96m", "-Dproperty=literal 😀"],
        testJvmOptions: ["-Xmx128m", "-Dtest=literal 😀"],
        environment: [{ name: "MODE", value: "x y" }],
        jdkHome: "/opt/jdk-21",
      }),
    );
    const mounted = render(<Activity port={port} prepare={prepare} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Build" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Delete configuration" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate configuration" }));
    fireEvent.change(screen.getByLabelText("Configuration name"), { target: { value: "Worker" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename configuration" }));
    const workerId = (screen.getByLabelText("Java configuration") as HTMLSelectElement).value;
    fireEvent.change(screen.getByLabelText("Main class"), { target: { value: "WorkerMain" } });
    fireEvent.change(screen.getByLabelText("Java configuration"), { target: { value: "default" } });
    expect(screen.getByLabelText("Main class")).toHaveValue("Main");
    fireEvent.change(screen.getByLabelText("Java configuration"), { target: { value: workerId } });
    expect(screen.getByLabelText("Main class")).toHaveValue("WorkerMain");
    fireEvent.click(screen.getByRole("checkbox", { name: /I trust this workspace/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Run" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() =>
      expect(port.start).toHaveBeenCalledWith(
        expect.objectContaining({
          configuration: expect.objectContaining({
            mainClass: "WorkerMain",
            programArguments: ["", "literal 😀"],
            jvmOptions: ["-Xmx96m", "-Dproperty=literal 😀"],
            testJvmOptions: ["-Xmx128m", "-Dtest=literal 😀"],
            environment: [{ name: "MODE", value: "x y" }],
            jdkHome: "/opt/jdk-21",
          }),
        }),
      ),
    );
    expect(screen.getByText("Session configuration: Worker")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Java configuration"), { target: { value: "default" } });
    expect(screen.getByText("Session configuration: Worker")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Java configuration"), { target: { value: workerId } });
    mounted.unmount();
    render(<Activity port={port} prepare={prepare} />);
    expect(screen.getByLabelText("Java configuration")).toHaveValue(workerId);
    expect(screen.getByLabelText("Configuration name")).toHaveValue("Worker");
    expect(screen.getByLabelText("Main class")).toHaveValue("WorkerMain");
    expect(screen.getByRole("checkbox", { name: /I trust this workspace/ })).not.toBeChecked();
    expect(screen.getByLabelText("JVM option 2")).toHaveValue("-Dproperty=literal 😀");
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(port.start).toHaveBeenCalledOnce();
    await act(async () => {});
  });

  it("refuses duplicate names and disables configuration controls while source-save preparation is pending", async () => {
    const port = nativePort();
    let finish!: () => void;
    const prepare = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    render(<Activity port={port} prepare={prepare} />);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate configuration" }));
    fireEvent.change(screen.getByLabelText("Configuration name"), { target: { value: "default" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename configuration" }));
    expect(screen.getByRole("alert")).toHaveTextContent("names must be unique");
    fireEvent.click(screen.getByRole("checkbox", { name: /I trust this workspace/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Build" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    for (const label of ["Java configuration", "Configuration name", "Main class"])
      expect(screen.getByLabelText(label)).toBeDisabled();
    for (const name of [
      "New configuration",
      "Rename configuration",
      "Duplicate configuration",
      "Delete configuration",
    ])
      expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(port.start).not.toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() => expect(port.start).toHaveBeenCalledOnce());
  });
});
