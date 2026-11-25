import { describe, expect, it, vi } from "vitest";
import { javaExecutionCommands } from "./javaExecutionCommands";
import { debuggerState } from "../../../../../packages/tauri-adapters/src/java-debugger-state.test-fixtures";

type Controller = Parameters<typeof javaExecutionCommands>[0];
function controller(): Controller {
  return {
    configuration: { buildTool: "jdk", mainClass: "Main", classPath: [] },
    capabilities: {
      workspaceId: "one",
      generation: 1,
      available: true,
      projectKind: "jdk",
      jdk: true,
      maven: false,
      gradle: false,
      debugger: true,
      structuredDebugger: true,
      flightRecorder: true,
      attachDebugger: true,
      reason: null,
    },
    running: false,
    trusted: true,
    pending: false,
    projectContext: undefined,
    canRestart: false,
    classReloadPending: false,
    snapshot: null,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    rerunFailed: vi.fn(async () => {}),
    debugAction: vi.fn(async () => {}),
  };
}
describe("configured Java execution commands", () => {
  it("offers current-stop debugger controls and withholds stepping for caller selection", async () => {
    const current = controller();
    current.running = true;
    const state = debuggerState();
    current.snapshot = {
      workspaceId: "one",
      generation: 1,
      sessionId: "debug",
      operation: "debug",
      state: "running",
      output: "",
      outputTruncated: false,
      exitCode: null,
      debuggerState: state,
    };
    let commands = javaExecutionCommands(current, vi.fn());
    await commands.find((item) => item.id === "java.execution.continue")!.run();
    expect(current.debugAction).toHaveBeenLastCalledWith({ type: "continue", stopId: "stop-1" });
    await commands.find((item) => item.id === "java.execution.step.into")!.run();
    expect(current.debugAction).toHaveBeenLastCalledWith({
      type: "step",
      stopId: "stop-1",
      kind: "into",
    });
    state.selectedFrameId = state.frames[1].id;
    commands = javaExecutionCommands(current, vi.fn());
    expect(commands.some((item) => item.id.startsWith("java.execution.step."))).toBe(false);
    expect(commands.some((item) => item.id === "java.execution.continue")).toBe(true);
  });
  it("opens Java Run and delegates configured operations without inventing cursor targets", async () => {
    const current = controller(),
      open = vi.fn();
    const commands = javaExecutionCommands(current, open);
    expect(commands.map((item) => item.id)).toEqual([
      "java.execution.build",
      "java.execution.run",
      "java.execution.debug",
      "java.execution.test",
      "java.execution.discover",
      "java.execution.jfr",
    ]);
    await commands.find((item) => item.id === "java.execution.run")!.run();
    expect(open).toHaveBeenCalledOnce();
    expect(current.start).toHaveBeenLastCalledWith("run");
    await commands.find((item) => item.id === "java.execution.jfr")!.run();
    expect(current.start).toHaveBeenLastCalledWith("run", true);
  });
  it.each(["untrusted", "saving", "missing tools", "missing module"])(
    "withholds execution for %s",
    (condition) => {
      const current = controller();
      if (condition === "untrusted") current.trusted = false;
      if (condition === "saving") current.pending = true;
      if (condition === "missing tools") current.capabilities = null;
      if (condition === "missing module")
        current.configuration.projectModule = {
          providerId: "maven-effective-v1",
          moduleId: "missing",
          sourceSetId: "main",
        };
      expect(javaExecutionCommands(current, vi.fn())).toEqual([]);
    },
  );
  it("keeps Stop available when trust is withdrawn from an active task", async () => {
    const current = controller();
    current.running = true;
    current.trusted = false;
    const commands = javaExecutionCommands(current, vi.fn());
    expect(commands.map((item) => item.id)).toEqual(["java.execution.stop"]);
    await commands[0].run();
    expect(current.stop).toHaveBeenCalledOnce();
  });
  it("offers attachment only for the configured structured debugger and labels external detachment", async () => {
    const current = controller();
    current.configuration.debuggerMode = "jdi";
    const commands = javaExecutionCommands(current, vi.fn());
    await commands.find((item) => item.id === "java.execution.attach")!.run();
    expect(current.start).toHaveBeenCalledWith("attach");
    current.running = true;
    current.snapshot = {
      workspaceId: "one",
      generation: 1,
      sessionId: "external",
      operation: "attach",
      state: "running",
      output: "",
      outputTruncated: false,
      exitCode: null,
    };
    expect(javaExecutionCommands(current, vi.fn())).toMatchObject([
      { id: "java.execution.stop", label: "Detach Java debugger" },
    ]);
  });
  it("reruns captured failures despite changed form settings and withholds unsafe repeats", async () => {
    const current = controller();
    current.capabilities = null;
    current.configuration.mainClass = "InvalidLaterDraft";
    current.snapshot = {
      workspaceId: "one",
      generation: 1,
      sessionId: "failed-tests",
      operation: "test",
      state: "failed",
      output: "",
      outputTruncated: false,
      exitCode: 1,
      testResults: {
        status: "ready",
        projectPath: ".",
        buildTool: "maven",
        suites: [],
        summary: { total: 1, passed: 0, failed: 1, skipped: 0, error: 0, flaky: 0 },
        unchangedReports: 0,
        message: null,
        canRerunFailed: true,
        rerunReason: null,
      },
    };
    const open = vi.fn();
    const command = () =>
      javaExecutionCommands(current, open).find(
        (item) => item.id === "java.execution.rerun-failed",
      );
    await command()!.run();
    expect(open).toHaveBeenCalledOnce();
    expect(current.rerunFailed).toHaveBeenCalledOnce();
    expect(current.start).not.toHaveBeenCalled();
    for (const key of ["running", "pending"] as const) {
      current[key] = true;
      expect(command()).toBeUndefined();
      current[key] = false;
    }
    current.trusted = false;
    expect(command()).toBeUndefined();
    current.trusted = true;
    current.snapshot.testResults!.canRerunFailed = false;
    expect(command()).toBeUndefined();
    current.snapshot = null;
    expect(command()).toBeUndefined();
  });
  it("uses captured-session restart and disables it during class preparation", async () => {
    const current = controller();
    current.canRestart = true;
    await javaExecutionCommands(current, vi.fn())
      .find((item) => item.id === "java.execution.restart")!
      .run();
    expect(current.restart).toHaveBeenCalledOnce();
    expect(current.start).not.toHaveBeenCalled();
    current.classReloadPending = true;
    expect(
      javaExecutionCommands(current, vi.fn()).some((item) => item.id === "java.execution.restart"),
    ).toBe(false);
  });
});

it("keeps structured debugger commands available during a selected test session", async () => {
  const current = controller();
  current.configuration = { ...current.configuration, testFilter: "FixtureTest#selected" };
  current.capabilities = { ...current.capabilities!, debugTests: true };
  expect(javaExecutionCommands(current, vi.fn()).some((command) => command.id === "java.execution.debug-test")).toBe(true);
  current.running = true;
  current.snapshot = { workspaceId: "one", generation: 1, sessionId: "test-debug", operation: "debug-test", state: "running", output: "", outputTruncated: false, exitCode: null, debuggerState: { ...debuggerState(), canReloadClasses: false } };
  const commands = javaExecutionCommands(current, vi.fn());
  await commands.find((command) => command.id === "java.execution.continue")!.run();
  expect(current.debugAction).toHaveBeenCalledWith({ type: "continue", stopId: "stop-1" });
  expect(commands.some((command) => command.id === "java.execution.stop")).toBe(true);
});

it("offers debugging of failures using captured native admission independently of current form tools", async () => {
  const current = controller();
  const { reports } = await import("../../../../../packages/tauri-adapters/src/java-test-results.test-fixtures");
  current.capabilities = null;
  current.snapshot = { workspaceId: "one", generation: 1, sessionId: "failed", operation: "test", state: "failed", output: "", outputTruncated: false, exitCode: 1, testResults: reports(), canDebugFailedTests: true };
  const command = () => javaExecutionCommands(current, vi.fn()).find((item) => item.id === "java.execution.debug-failed");
  await command()!.run();
  expect(current.rerunFailed).toHaveBeenCalledWith(true);
  current.snapshot.canDebugFailedTests = false;
  expect(command()).toBeUndefined();
  current.snapshot.canDebugFailedTests = true;
  current.trusted = false;
  expect(command()).toBeUndefined();
});

it.each(["clean", "rebuild"] as const)("offers %s in the command palette only for an advertised available Maven or Gradle tool", async (operation) => {
  const current = controller();
  current.configuration.buildTool = "maven";
  current.capabilities = { ...current.capabilities!, maven: true, cleanProject: true, rebuildProject: true };
  await javaExecutionCommands(current, vi.fn()).find((command) => command.id === `java.execution.${operation}`)!.run();
  expect(current.start).toHaveBeenCalledWith(operation);
  current.capabilities[operation === "clean" ? "cleanProject" : "rebuildProject"] = undefined;
  expect(javaExecutionCommands(current, vi.fn()).some((command) => command.id === `java.execution.${operation}`)).toBe(false);
});
