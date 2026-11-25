import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { JavaEffectiveProjectContext, JavaExecutionSnapshot } from "@ide/contracts";
import type { JavaExecutionPort } from "@ide/web-core";
import { debuggerState } from "../../../../../packages/tauri-adapters/src/java-debugger-state.test-fixtures";
import {
  useJavaExecutionController,
  type JavaExecutionController,
} from "./useJavaExecutionController";
import { JavaClassReloadPanel } from "./JavaClassReloadPanel";

const context = { workspaceId: "one", generation: 1, enabled: true };
const classes = [{ className: "example.Main", classFile: "target/classes/example/Main.class" }];
function live(): JavaExecutionSnapshot {
  return {
    ...context,
    sessionId: "java-debug",
    operation: "debug",
    state: "running",
    exitCode: null,
    output: "",
    outputTruncated: false,
    debuggerState: { ...debuggerState(), canReloadClasses: true },
  };
}
function provider(): JavaExecutionPort {
  return {
    getCapabilities: vi.fn(async (request) => ({
      ...request,
      available: true,
      projectKind: "jdk",
      jdk: true,
      maven: false,
      gradle: false,
      debugger: true,
      structuredDebugger: true,
      reason: null,
    })),
    start: vi.fn(async () => live()),
    snapshot: vi.fn(async () => live()),
    stop: vi.fn(async () => ({ ...live(), state: "stopped" as const })),
    rerunFailed: vi.fn(),
    debugCommand: vi.fn(),
    debugAction: vi.fn(),
    reloadClasses: vi.fn(async () => undefined),
    buildForClassReload: vi.fn(async (request) => ({
      workspaceId: request.workspaceId,
      generation: request.generation,
      sessionId: request.sessionId,
      state: "succeeded" as const,
      exitCode: 0,
      output: "javac completed",
      outputTruncated: false,
    })),
  };
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
async function running(native: JavaExecutionPort) {
  const prepare = vi.fn(async () => undefined);
  const hook = renderHook(
    (props) => useJavaExecutionController({ ...props, port: native, prepare }),
    { initialProps: context },
  );
  await waitFor(() => expect(hook.result.current.capabilities?.structuredDebugger).toBe(true));
  act(() => {
    hook.result.current.setTrusted(true);
    hook.result.current.updateConfiguration({
      buildTool: "jdk",
      mainClass: "Main",
      classPath: [],
      debuggerMode: "jdi",
    });
  });
  await act(async () => hook.result.current.start("debug"));
  return { hook, prepare };
}
describe("Java class reload through production interaction", () => {
  it("builds for review without reloading and retains the provider's hashed selections", async () => {
    const native = provider();
    const changes = {
      status: "ready" as const,
      stopId: "stop-1",
      classes: [{ ...classes[0], expectedSha256: "a".repeat(64) }],
      message: "Compared one file.",
    };
    vi.mocked(native.buildForClassReload!).mockImplementation(async (request) => ({
      ...request,
      state: "succeeded",
      exitCode: 0,
      output: "compiled",
      outputTruncated: false,
      classChanges: changes,
    }));
    const { hook, prepare } = await running(native);
    await act(async () => hook.result.current.buildAndReviewClasses());
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(native.reloadClasses).not.toHaveBeenCalled();
    expect(hook.result.current.classReloadBuild?.classChanges).toEqual(changes);
    hook.unmount();
  });
  it("reports an unavailable comparison for a legacy provider and refuses another suspension's review", async () => {
    const native = provider();
    const { hook } = await running(native);
    await act(async () => hook.result.current.buildAndReviewClasses());
    expect(hook.result.current.error).toMatch(/did not return a compiled-class comparison/);
    expect(hook.result.current.classReloadBuild?.state).toBe("succeeded");
    vi.mocked(native.buildForClassReload!).mockImplementation(async (request) => ({
      ...request,
      state: "succeeded",
      exitCode: 0,
      output: "compiled",
      outputTruncated: false,
      classChanges: { status: "ready", stopId: "another-stop", classes: [], message: "comparison" },
    }));
    await act(async () => hook.result.current.buildAndReviewClasses());
    expect(hook.result.current.error).toMatch(/another suspension/);
    expect(hook.result.current.classReloadBuild).toBeNull();
    expect(native.reloadClasses).not.toHaveBeenCalled();
    hook.unmount();
  });
  it("requires an explicit reviewed selection and keeps its hashes while refusing a retired suspension", () => {
    const selected = { ...classes[0], expectedSha256: "a".repeat(64) };
    const other = {
      className: "example.Other",
      classFile: "target/classes/example/Other.class",
      expectedSha256: "b".repeat(64),
    };
    const controller = {
      trusted: true,
      running: true,
      snapshot: live(),
      classReloadPending: false,
      classReloadBuild: {
        workspaceId: "one",
        generation: 1,
        sessionId: "java-debug",
        state: "succeeded",
        exitCode: 0,
        output: "compiled",
        outputTruncated: false,
        classChanges: {
          status: "ready",
          stopId: "stop-1",
          classes: [selected, other],
          message: "Compared one file.",
        },
      },
      buildAndReviewClasses: vi.fn(),
      buildAndReloadClasses: vi.fn(),
      reloadClasses: vi.fn(),
    } as unknown as JavaExecutionController;
    const view = render(<JavaClassReloadPanel controller={controller} />);
    expect(screen.getByRole("button", { name: "Reload compiled classes" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Use changed classes" }));
    expect(screen.getByLabelText("Class name 1")).toHaveValue(selected.className);
    fireEvent.click(screen.getByRole("button", { name: "Reload compiled classes" }));
    expect(controller.reloadClasses).toHaveBeenCalledExactlyOnceWith([selected, other]);
    view.rerender(
      <JavaClassReloadPanel
        controller={{
          ...controller,
          snapshot: { ...live(), debuggerState: { ...live().debuggerState!, stopId: "stop-2" } },
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Use changed classes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reload compiled classes" })).toBeDisabled();
    expect(screen.getByText(/suspension changed after this selection/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Compiled file 1"), {
      target: { value: "target/classes/example/Manual.class" },
    });
    expect(screen.getByRole("button", { name: "Reload compiled classes" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove class 2" }));
    expect(screen.getByRole("button", { name: "Reload compiled classes" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Reload compiled classes" }));
    expect(controller.reloadClasses).toHaveBeenLastCalledWith([
      { className: selected.className, classFile: "target/classes/example/Manual.class" },
    ]);
  });
  it("requires current trust and actual VM support and reloads compiled files without source-save preparation", async () => {
    const native = provider();
    const { hook, prepare } = await running(native);
    expect(prepare).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.setTrusted(false));
    await act(async () => hook.result.current.reloadClasses(classes));
    expect(native.reloadClasses).not.toHaveBeenCalled();
    expect(hook.result.current.error).toContain("trust");
    act(() => hook.result.current.setTrusted(true));
    await act(async () => hook.result.current.reloadClasses(classes));
    expect(native.reloadClasses).toHaveBeenCalledWith({
      workspaceId: "one",
      generation: 1,
      sessionId: "java-debug",
      trusted: true,
      stopId: "stop-1",
      classes,
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    const oldAction = hook.result.current.reloadClasses;
    hook.rerender({ ...context, workspaceId: "two", generation: 2 });
    await act(async () => oldAction(classes));
    expect(native.reloadClasses).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
  it("keeps Stop available during preparation and ignores a late failure after session retirement", async () => {
    const native = provider();
    let reject!: (error: Error) => void;
    vi.mocked(native.reloadClasses!).mockImplementation(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    );
    const { hook } = await running(native);
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.reloadClasses(classes);
    });
    await waitFor(() => expect(hook.result.current.classReloadPending).toBe(true));
    expect(hook.result.current.pending).toBe(false);
    await act(async () => hook.result.current.stop());
    await act(async () => {
      reject(new Error("retired reload failure"));
      await pending;
    });
    expect(hook.result.current.snapshot?.state).toBe("stopped");
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.classReloadPending).toBe(false);
    hook.unmount();
  });
  it("does not infer reload support from a structured debugger alone", async () => {
    const native = provider();
    vi.mocked(native.start).mockResolvedValue({ ...live(), debuggerState: debuggerState() });
    const { hook } = await running(native);
    await act(async () => hook.result.current.reloadClasses(classes));
    expect(native.reloadClasses).not.toHaveBeenCalled();
    expect(hook.result.current.error).toContain("unavailable");
    hook.unmount();
  });
  it("saves before building, compiles beside the running debugger, then reloads the same session", async () => {
    const native = provider();
    const { hook, prepare } = await running(native);
    await act(async () => hook.result.current.buildAndReloadClasses(classes));
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(native.buildForClassReload).toHaveBeenCalledWith({
      workspaceId: "one",
      generation: 1,
      sessionId: "java-debug",
      trusted: true,
    });
    expect(native.reloadClasses).toHaveBeenCalledWith({
      workspaceId: "one",
      generation: 1,
      sessionId: "java-debug",
      trusted: true,
      stopId: "stop-1",
      classes,
    });
    expect(hook.result.current.classReloadBuild?.output).toBe("javac completed");
    expect(native.snapshot).toHaveBeenCalledTimes(2);
    hook.unmount();
  });
  it("does not reload classes when the selected build fails", async () => {
    const native = provider();
    vi.mocked(native.buildForClassReload!).mockResolvedValue({
      ...context,
      sessionId: "java-debug",
      state: "failed",
      exitCode: 1,
      output: "Compilation failed",
      outputTruncated: false,
    });
    const { hook } = await running(native);
    await act(async () => hook.result.current.buildAndReloadClasses(classes));
    expect(native.reloadClasses).not.toHaveBeenCalled();
    expect(hook.result.current.classReloadBuild?.state).toBe("failed");
    hook.unmount();
  });
  it("collects explicit class files and disables unsupported, untrusted or queued reloads", () => {
    const controller = {
      trusted: true,
      running: true,
      snapshot: live(),
      classReloadPending: false,
      classReloadBuild: null,
      buildAndReloadClasses: vi.fn(),
      reloadClasses: vi.fn(),
    } as unknown as JavaExecutionController;
    const view = render(<JavaClassReloadPanel controller={controller} />);
    const button = screen.getByRole("button", { name: "Reload compiled classes" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Class name 1"), { target: { value: "example.Main" } });
    fireEvent.change(screen.getByLabelText("Compiled file 1"), {
      target: { value: classes[0].classFile },
    });
    fireEvent.click(button);
    expect(controller.reloadClasses).toHaveBeenCalledWith(classes);
    fireEvent.click(screen.getByRole("button", { name: "Build and reload classes" }));
    expect(controller.buildAndReloadClasses).toHaveBeenCalledWith(classes);
    for (const change of [
      { trusted: false },
      { classReloadPending: true },
      { snapshot: { ...live(), debuggerState: debuggerState() } },
      {
        snapshot: {
          ...live(),
          classReload: {
            requestId: "reload-1",
            status: "queued",
            classes: ["example.Main"],
            error: null,
          },
        },
      },
    ]) {
      view.rerender(
        <JavaClassReloadPanel
          controller={{ ...controller, ...change } as JavaExecutionController}
        />,
      );
      expect(button).toBeDisabled();
    }
    view.rerender(
      <JavaClassReloadPanel
        controller={{
          ...controller,
          snapshot: {
            ...live(),
            classReload: {
              requestId: "reload-2",
              status: "failed",
              classes: ["example.Main"],
              error: "JVM refused schema change",
            },
          },
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("JVM refused schema change");
  });

  it("fills a unique compiled output from the selected project context and preserves manual request shape", () => {
    const projectContext = {
      status: "available",
      modules: [
        {
          providerId: "maven-effective-v1",
          id: "app",
          sourceSets: [
            { id: "main", outputDirectories: ["app/target/classes"], runtimeClasspath: [] },
          ],
        },
      ],
    } as unknown as JavaEffectiveProjectContext;
    const controller = {
      trusted: true,
      running: true,
      snapshot: {
        ...live(),
        debuggerState: {
          ...debuggerState(),
          canReloadClasses: true,
          loadedClasses: [
            { className: "example.Main", classLoaderCount: 1 },
            { className: "example.Duplicate", classLoaderCount: 2 },
          ],
        },
      },
      classReloadPending: false,
      classReloadBuild: null,
      configuration: {
        projectModule: {
          providerId: "maven-effective-v1",
          moduleId: "app",
          sourceSetId: "main",
        },
      },
      projectContext: { context: projectContext },
      buildAndReloadClasses: vi.fn(),
      reloadClasses: vi.fn(),
      debugAction: vi.fn(),
    } as unknown as JavaExecutionController;
    render(<JavaClassReloadPanel controller={controller} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh loaded JVM classes" }));
    expect(controller.debugAction).toHaveBeenCalledWith({ type: "listLoadedClasses" });
    const loadedClass = screen.getByLabelText("Prepared JVM class 1");
    expect(loadedClass).toContainElement(
      document.querySelector(
        'select[aria-label="Prepared JVM class 1"] option[value="example.Main"]',
      ),
    );
    const className = screen.getByLabelText("Class name 1");
    const classFile = screen.getByLabelText("Compiled file 1");
    fireEvent.change(loadedClass, { target: { value: "example.Main" } });
    expect(className).toHaveValue("example.Main");
    expect(classFile).toHaveValue("app/target/classes/example/Main.class");
    fireEvent.change(loadedClass, { target: { value: "example.Duplicate" } });
    expect(className).toHaveValue("example.Duplicate");
    expect(
      screen
        .getAllByRole("status")
        .some((item) => item.textContent?.includes("multiple class loaders")),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Build and reload classes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reload compiled classes" })).toBeDisabled();
    fireEvent.change(loadedClass, { target: { value: "example.Main" } });
    expect(
      document.querySelector(
        'datalist#java-class-output-0 option[value="app/target/classes/example/Main.class"]',
      ),
    ).not.toBeNull();
    fireEvent.change(className, { target: { value: "example.Next" } });
    expect(classFile).toHaveValue("app/target/classes/example/Next.class");
    fireEvent.click(screen.getByRole("button", { name: "Build and reload classes" }));
    expect(controller.buildAndReloadClasses).toHaveBeenCalledWith([
      { className: "example.Next", classFile: "app/target/classes/example/Next.class" },
    ]);
    fireEvent.change(classFile, { target: { value: "custom/classes/example/Next.class" } });
    fireEvent.change(className, { target: { value: "another.Type" } });
    expect(classFile).toHaveValue("custom/classes/example/Next.class");
  });
});


it.each(["saving", "compiling", "snapshot"] as const)("refuses HotSwap after trust withdrawal during %s", async phase => {
  const native = provider();
  const { hook, prepare } = await running(native);
  if (phase === "saving") prepare.mockImplementationOnce(async () => { hook.result.current.setTrusted(false); });
  if (phase === "compiling") {
    const build = native.buildForClassReload!;
    vi.mocked(build).mockImplementationOnce(async request => {
      hook.result.current.setTrusted(false);
      return { ...request, state: "succeeded", exitCode: 0, output: "compiled", outputTruncated: false };
    });
  }
  if (phase === "snapshot") vi.mocked(native.snapshot).mockImplementationOnce(async () => {
    hook.result.current.setTrusted(false);
    return live();
  });
  await act(async () => hook.result.current.buildAndReloadClasses(classes));
  if (phase === "saving") expect(native.buildForClassReload).not.toHaveBeenCalled();
  expect(native.reloadClasses).not.toHaveBeenCalled();
  expect(hook.result.current.error).toMatch(/trust/);
});
