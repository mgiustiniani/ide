import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JavaExecutionSnapshot, JavaLaunchConfiguration } from "@ide/contracts";
import type { JavaExecutionPort } from "@ide/web-core/ports";
import { useJavaExecutionController } from "./useJavaExecutionController";
import {
  defaultJavaConfigurations,
  javaConfigurationsStorageKey,
} from "./javaLaunchConfigurations";

const context = { workspaceId: "one", generation: 1, enabled: true };
const settings: JavaLaunchConfiguration = {
  buildTool: "maven",
  mainClass: "example.Main",
  classPath: ["lib/runtime.jar"],
  projectPath: "server",
  workingDirectory: "run assets/servízio's",
  testFilter: "example.MainTest#fails",
  testReportPaths: ["server/reports"],
  programArguments: ["", "quotes'\"\\\n😀"],
  environment: [{ name: "MODE", value: "literal\nvalue" }],
  jdkHome: "/opt/jdk-21",
};
function nativePort(): JavaExecutionPort {
  return {
    getCapabilities: vi.fn(async (request) => ({
      ...request,
      available: true,
      projectKind: "maven",
      jdk: true,
      maven: true,
      gradle: true,
      debugger: true,
      reason: null,
    })),
    start: vi.fn(async (request) => ({
      workspaceId: request.workspaceId,
      generation: request.generation,
      sessionId: "original",
      operation: request.operation,
      state: "succeeded" as const,
      exitCode: 0,
      output: "",
      outputTruncated: false,
    })),
    snapshot: vi.fn(),
    stop: vi.fn(),
    rerunFailed: vi.fn(),
    debugCommand: vi.fn(),
  };
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("named Java configurations through the production controller", () => {
  it("restores a plain-JDK TestNG framework from a named configuration", async () => {
    const configuration: JavaLaunchConfiguration = {
      buildTool: "jdk",
      mainClass: "example.Main",
      classPath: ["lib/testng.jar"],
      testFramework: "testng",
    };
    localStorage.setItem(
      javaConfigurationsStorageKey("one"),
      JSON.stringify(defaultJavaConfigurations(configuration)),
    );
    const native = nativePort(),
      prepare = vi.fn(async () => undefined);
    const hook = renderHook(
      (props) => useJavaExecutionController({ ...props, port: native, prepare }),
      { initialProps: context },
    );
    await waitFor(() => expect(hook.result.current.capabilities?.jdk).toBe(true));
    expect(hook.result.current.configuration).toEqual(configuration);
    expect(
      JSON.parse(localStorage.getItem(javaConfigurationsStorageKey("one"))!).configurations[0]
        .configuration.testFramework,
    ).toBe("testng");
  });

  it("migrates legacy settings, duplicates independently, restores selection and keeps workspaces isolated", async () => {
    const native = nativePort(),
      prepare = vi.fn(async () => undefined);
    localStorage.setItem("ide.java.launch.one", JSON.stringify(settings));
    const hook = renderHook(
      (props) => useJavaExecutionController({ ...props, port: native, prepare }),
      { initialProps: context },
    );
    await waitFor(() => expect(hook.result.current.capabilities?.jdk).toBe(true));
    act(() => {
      hook.result.current.renameConfiguration("Server");
      hook.result.current.createConfiguration(true);
    });
    expect(hook.result.current.configurations[0].configuration.programArguments).not.toBe(
      hook.result.current.configurations[1].configuration.programArguments,
    );
    act(() => {
      hook.result.current.renameConfiguration("Selected tests");
      hook.result.current.updateConfiguration({
        ...hook.result.current.configuration,
        mainClass: "example.TestApp",
        testFilter: "example.OtherTest#one",
      });
    });
    const selected = hook.result.current.selectedConfigurationId;
    expect(hook.result.current.configurations.map((item) => item.name)).toEqual([
      "Server",
      "Selected tests",
    ]);
    expect(hook.result.current.configurations[0].configuration).toEqual(settings);
    expect(hook.result.current.configurations[1].configuration.mainClass).toBe("example.TestApp");
    expect(JSON.parse(localStorage.getItem("ide.java.launch.one")!)).toEqual(settings);
    act(() => {
      hook.result.current.createConfiguration();
      hook.result.current.deleteConfiguration();
    });
    expect(hook.result.current.selectedConfigurationId).toBe(selected);
    hook.unmount();
    const restored = renderHook(
      (props) => useJavaExecutionController({ ...props, port: native, prepare }),
      { initialProps: context },
    );
    expect(restored.result.current.selectedConfigurationId).toBe(selected);
    expect(restored.result.current.configuration).toMatchObject({
      ...settings,
      mainClass: "example.TestApp",
      testFilter: "example.OtherTest#one",
    });
    expect(restored.result.current.trusted).toBe(false);
    act(() => restored.result.current.setTrusted(true));
    await act(async () => restored.result.current.start("test"));
    expect(native.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ configuration: restored.result.current.configuration }),
    );
    expect(restored.result.current.sessionConfigurationName).toBe("Selected tests");
    restored.rerender({ ...context, workspaceId: "two", generation: 2 });
    expect(restored.result.current.configurations).toEqual(
      defaultJavaConfigurations().configurations,
    );
    expect(restored.result.current.trusted).toBe(false);
    expect(restored.result.current.snapshot).toBeNull();
    expect(restored.result.current.sessionConfigurationName).toBeNull();
    restored.rerender({ ...context, generation: 3 });
    expect(restored.result.current.selectedConfigurationId).toBe(selected);
    await waitFor(() => expect(restored.result.current.capabilities?.projectPath).toBe("server"));
  });

  it("keeps failed-test reruns bound to the original session after selecting or deleting its configuration", async () => {
    const native = nativePort(),
      prepare = vi.fn(async () => undefined);
    const failure: JavaExecutionSnapshot = {
      ...context,
      sessionId: "original",
      operation: "test",
      state: "failed",
      exitCode: 1,
      output: "JUnit failed",
      outputTruncated: false,
      testResults: {
        status: "ready",
        projectPath: "server",
        buildTool: "maven",
        unchangedReports: 0,
        message: null,
        canRerunFailed: true,
        rerunReason: null,
        summary: { total: 1, passed: 0, failed: 1, error: 0, skipped: 0, flaky: 0 },
        suites: [],
      },
    };
    vi.mocked(native.start).mockResolvedValueOnce(failure);
    vi.mocked(native.rerunFailed).mockResolvedValueOnce({ ...failure, sessionId: "rerun" });
    const hook = renderHook(() =>
      useJavaExecutionController({ ...context, port: native, prepare }),
    );
    act(() => {
      hook.result.current.updateConfiguration(settings);
      hook.result.current.renameConfiguration("Failed server tests");
      hook.result.current.setTrusted(true);
    });
    await act(async () => hook.result.current.start("test"));
    act(() => {
      hook.result.current.createConfiguration();
      hook.result.current.selectConfiguration("default");
      hook.result.current.deleteConfiguration();
    });
    expect(
      hook.result.current.configurations.some((item) => item.name === "Failed server tests"),
    ).toBe(false);
    await act(async () => hook.result.current.rerunFailed());
    expect(native.rerunFailed).toHaveBeenCalledWith({
      workspaceId: "one",
      generation: 1,
      sessionId: "original",
      trusted: true,
    });
    expect(native.start).toHaveBeenCalledOnce();
    expect(hook.result.current.sessionConfigurationName).toBe("Failed server tests");
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("freezes settings while saving and running, and accepts changes after the owned process stops", async () => {
    const native = nativePort();
    let finish!: () => void;
    const prepare = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const running: JavaExecutionSnapshot = {
      ...context,
      sessionId: "running",
      operation: "run",
      state: "running",
      exitCode: null,
      output: "",
      outputTruncated: false,
    };
    vi.mocked(native.start).mockResolvedValueOnce(running);
    vi.mocked(native.stop).mockResolvedValueOnce({ ...running, state: "stopped" });
    const hook = renderHook(() =>
      useJavaExecutionController({ ...context, port: native, prepare }),
    );
    await waitFor(() => expect(hook.result.current.capabilities?.jdk).toBe(true));
    act(() => {
      hook.result.current.updateConfiguration(settings);
      hook.result.current.renameConfiguration("Original");
      hook.result.current.setTrusted(true);
    });
    await waitFor(() => expect(hook.result.current.capabilities?.projectPath).toBe("server"));
    const previousStorage = localStorage.getItem(javaConfigurationsStorageKey("one"));
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.start("run");
    });
    function attemptChanges() {
      hook.result.current.renameConfiguration("Changed");
      hook.result.current.createConfiguration(true);
      hook.result.current.updateConfiguration({ ...settings, mainClass: "Changed" });
      hook.result.current.selectConfiguration("unknown");
      hook.result.current.deleteConfiguration();
    }
    act(attemptChanges);
    expect(localStorage.getItem(javaConfigurationsStorageKey("one"))).toBe(previousStorage);
    await act(async () => {
      finish();
      await pending;
    });
    act(attemptChanges);
    expect(hook.result.current.configurations).toHaveLength(1);
    expect(hook.result.current.configuration).toEqual(settings);
    expect(hook.result.current.sessionConfigurationName).toBe("Original");
    await act(async () => hook.result.current.stop());
    act(() => hook.result.current.createConfiguration());
    expect(hook.result.current.configurations).toHaveLength(2);
    await waitFor(() => expect(hook.result.current.capabilities?.projectPath).toBe(""));
  });

  it("rejects callbacks retained from an older workspace without changing settings or launching", async () => {
    const native = nativePort(),
      prepare = vi.fn(async () => undefined);
    const hook = renderHook(
      (props) => useJavaExecutionController({ ...props, port: native, prepare }),
      { initialProps: context },
    );
    act(() => hook.result.current.setTrusted(true));
    const old = hook.result.current;
    hook.rerender({ ...context, workspaceId: "two", generation: 2 });
    await act(async () => {
      old.createConfiguration();
      old.renameConfiguration("Stale");
      old.updateConfiguration(settings);
      old.selectConfiguration("default");
      old.deleteConfiguration();
      await old.start("run");
    });
    expect(hook.result.current.configurations).toEqual(defaultJavaConfigurations().configurations);
    expect(localStorage.getItem(javaConfigurationsStorageKey("two"))).toBeNull();
    expect(native.start).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    act(() => hook.result.current.setTrusted(true));
    const unmounted = hook.result.current;
    hook.unmount();
    await act(async () => {
      unmounted.updateConfiguration(settings);
      unmounted.createConfiguration();
      await unmounted.start("run");
    });
    expect(localStorage.getItem(javaConfigurationsStorageKey("two"))).toBeNull();
    expect(native.start).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("refuses invalid names, excessive collections and deletion of the last configuration without losing settings", async () => {
    const native = nativePort();
    const hook = renderHook(() =>
      useJavaExecutionController({
        ...context,
        port: native,
        prepare: async () => undefined,
      }),
    );
    await waitFor(() => expect(hook.result.current.capabilities?.jdk).toBe(true));
    act(() => {
      hook.result.current.renameConfiguration("  Server  ");
      hook.result.current.createConfiguration();
    });
    for (const name of ["SERVER", "", "line\nbreak", "😀".repeat(33)]) {
      act(() => hook.result.current.renameConfiguration(name));
      expect(hook.result.current.error).toBeTruthy();
      expect(hook.result.current.configurations[1].name).toBe("Configuration 1");
    }
    act(() => {
      for (let index = 0; index < 20; index += 1) hook.result.current.createConfiguration();
    });
    expect(hook.result.current.configurations).toHaveLength(16);
    expect(hook.result.current.error).toMatch(/at most 16/);
    act(() => {
      for (let index = 0; index < 16; index += 1) hook.result.current.deleteConfiguration();
    });
    expect(hook.result.current.configurations).toHaveLength(1);
    expect(hook.result.current.configurations[0].name).toBe("Server");
    expect(hook.result.current.error).toMatch(/at least one/);
  });

  it.each([
    { ...defaultJavaConfigurations(), version: 2 },
    { ...defaultJavaConfigurations(), selectedId: "missing" },
    { ...defaultJavaConfigurations(), configurations: [] },
    {
      ...defaultJavaConfigurations(),
      configurations: [
        defaultJavaConfigurations().configurations[0],
        defaultJavaConfigurations().configurations[0],
      ],
    },
    {
      ...defaultJavaConfigurations(),
      configurations: [
        {
          id: "default",
          name: "Default",
          configuration: { ...settings, environment: [{ name: "N", value: 4 }] },
        },
      ],
    },
    {
      ...defaultJavaConfigurations(),
      configurations: Array.from({ length: 17 }, (_, index) => ({
        id: `c${index}`,
        name: `Name ${index}`,
        configuration: settings,
      })),
    },
    " ".repeat(2 * 1024 * 1024 + 1),
  ])("uses an untrusted default for malformed or oversized saved collections", async (stored) => {
    const native = nativePort();
    localStorage.setItem("ide.java.launch.one", JSON.stringify(settings));
    localStorage.setItem(
      javaConfigurationsStorageKey("one"),
      typeof stored === "string" ? stored : JSON.stringify(stored),
    );
    const hook = renderHook(() =>
      useJavaExecutionController({
        ...context,
        port: native,
        prepare: async () => undefined,
      }),
    );
    await waitFor(() => expect(hook.result.current.capabilities?.jdk).toBe(true));
    expect(hook.result.current.configurations).toEqual(defaultJavaConfigurations().configurations);
    expect(hook.result.current.trusted).toBe(false);
  });

  it("reports unavailable persistence while keeping the selected in-memory configuration usable", async () => {
    const native = nativePort();
    const hook = renderHook(() =>
      useJavaExecutionController({ ...context, port: native, prepare: async () => undefined }),
    );
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("Quota exceeded");
    });
    act(() => {
      hook.result.current.updateConfiguration(settings);
      hook.result.current.setTrusted(true);
    });
    expect(hook.result.current.error).toMatch(/could not be saved/);
    await waitFor(() => expect(hook.result.current.capabilities?.projectPath).toBe("server"));
    expect(hook.result.current.error).toMatch(/could not be saved/);
    expect(localStorage.getItem(javaConfigurationsStorageKey("one"))).toBeNull();
    await act(async () => hook.result.current.start("run"));
    expect(native.start).toHaveBeenCalledWith(expect.objectContaining({ configuration: settings }));
  });
});
