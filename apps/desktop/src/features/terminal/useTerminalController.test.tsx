import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTerminalController } from "./useTerminalController";

function createHarness() {
  const viewModel = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    executeCommand: vi.fn(async (_command: string) => undefined),
    updateCurrentInput: vi.fn(),
    clearOutput: vi.fn(),
  };
  const session = {
    startSession: vi.fn(),
    stopSession: vi.fn(),
  };
  const store = {
    setSessionActive: vi.fn(),
    setLoading: vi.fn(),
  };
  const getStore = vi.fn(() => store);
  const hook = renderHook(() => useTerminalController({ viewModel, session, getStore }));

  return { hook, viewModel, session, store, getStore };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTerminalController", () => {
  it("starts the terminal on mount and fully stops it on unmount", () => {
    const harness = createHarness();

    expect(harness.viewModel.connect).toHaveBeenCalledOnce();
    expect(harness.session.startSession).toHaveBeenCalledOnce();
    expect(harness.store.setSessionActive).toHaveBeenNthCalledWith(1, true);
    expect(harness.store.setLoading).toHaveBeenCalledWith(false);

    harness.hook.unmount();

    expect(harness.viewModel.disconnect).toHaveBeenCalledOnce();
    expect(harness.session.stopSession).toHaveBeenCalledOnce();
    expect(harness.store.setSessionActive).toHaveBeenLastCalledWith(false);
  });

  it("executes commands and clears the current input after success", async () => {
    const harness = createHarness();

    await act(() => harness.hook.result.current.executeCommand("pnpm test"));

    expect(harness.viewModel.executeCommand).toHaveBeenCalledWith("pnpm test");
    expect(harness.viewModel.updateCurrentInput).toHaveBeenCalledWith("");
  });

  it("clears input after command failure and logs no command, source, or error detail", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = createHarness();
    harness.viewModel.executeCommand.mockRejectedValueOnce(
      new Error("secret output from /private/workspace/Main.java"),
    );

    await act(() => harness.hook.result.current.executeCommand("cat /private/workspace/Main.java"));

    expect(harness.viewModel.updateCurrentInput).toHaveBeenCalledWith("");
    expect(consoleError).toHaveBeenCalledWith("[Terminal] Command execution failed", {
      errorType: "Error",
    });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("cat /private");
    expect(logged).not.toContain("secret output");
    expect(logged).not.toContain("Main.java");
  });

  it("forwards input, clears output, and resets workspace-local terminal state", () => {
    const harness = createHarness();

    act(() => harness.hook.result.current.updateInput("next command"));
    expect(harness.viewModel.updateCurrentInput).toHaveBeenLastCalledWith("next command");

    act(() => harness.hook.result.current.clear());
    expect(harness.viewModel.clearOutput).toHaveBeenCalledTimes(1);

    act(() => harness.hook.result.current.resetWorkspace());
    expect(harness.viewModel.clearOutput).toHaveBeenCalledTimes(2);
    expect(harness.viewModel.updateCurrentInput).toHaveBeenLastCalledWith("");
  });
});
