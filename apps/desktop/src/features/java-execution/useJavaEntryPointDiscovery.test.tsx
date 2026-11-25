import { flushSync } from "react-dom";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { JavaEntryPointRequest, JavaEntryPointResult } from "@ide/contracts";
import { javaProjectContextResponse } from "../../../../../tests/story/fixtures/java-project-context-response";
import {
  entryPointRequest,
  entryPointResult,
} from "../../../../../packages/tauri-adapters/src/java-entry-point.test-fixtures";
import { useJavaEntryPointDiscovery } from "./useJavaEntryPointDiscovery";
import { modernEntryPointResult } from "../../../../../packages/tauri-adapters/src/java-entry-point-v2.test-fixtures";
afterEach(cleanup);
function setup() {
  const settings = entryPointRequest.projectContext;
  const context = javaProjectContextResponse({
    ...settings,
    workspaceId: "workspace",
    generation: 1,
    requestId: "context",
  }).context;
  context.modules[0].id = entryPointRequest.scope.moduleId;
  context.modules[0].providerId = entryPointRequest.scope.providerId;
  const verify = vi.fn(),
    updateConfiguration = vi.fn();
  const port = {
    query: vi.fn(async (request: JavaEntryPointRequest): Promise<JavaEntryPointResult> => ({
      ...structuredClone(entryPointResult),
      requestId: request.requestId,
    })),
    cancel: vi.fn(async () => {}),
  };
  const options = {
    port,
    workspaceId: "workspace",
    generation: 1,
    enabled: true,
    trusted: true,
    busy: false,
    selectedConfigurationId: "default",
    configuration: {
      buildTool: "maven" as const,
      mainClass: "Manual",
      classPath: [],
      projectModule: entryPointRequest.scope,
    },
    projectContext: { settings, context },
    reviewSavedBuffers: vi.fn(() => verify),
    updateConfiguration,
  };
  return { options, port, verify, updateConfiguration };
}
it("opts into v2 explicitly and selects the launch owner of a compact source", async () => {
  const h = setup();
  h.port.query.mockImplementation(async request => ({
    ...structuredClone(modernEntryPointResult), requestId: request.requestId,
    discovery: { ...structuredClone(modernEntryPointResult.discovery), requestId: request.requestId },
  }));
  const hook = renderHook(() => useJavaEntryPointDiscovery(h.options));
  act(() => hook.result.current.setLaunchProfile("java25-v1"));
  await act(async () => hook.result.current.discover());
  expect(h.port.query).toHaveBeenCalledWith(expect.objectContaining({
    entryPointSchemaVersion: "java-entry-points-v2", launchProfile: "java25-v1",
  }));
  const candidate = hook.result.current.result!.discovery!.candidates[0];
  await act(async () => hook.result.current.select(candidate));
  expect(h.updateConfiguration).toHaveBeenCalledWith(expect.objectContaining({ mainClass: "record" }));
  h.options.selectedConfigurationId = "other";
  hook.rerender();
  expect(hook.result.current.launchProfile).toBe("classic-declared-v1");
  expect(hook.result.current.result).toBeUndefined();
});
it("cancels a pending modern query when the profile changes and ignores its reply", async () => {
  const h = setup();
  let finish!: (value: JavaEntryPointResult) => void;
  h.port.query.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const hook = renderHook(() => useJavaEntryPointDiscovery(h.options));
  act(() => hook.result.current.setLaunchProfile("java25-v1"));
  let query!: Promise<void>;
  act(() => { query = hook.result.current.discover(); });
  expect(hook.result.current.pending).toBe(true);
  act(() => hook.result.current.setLaunchProfile("inherited-v1"));
  expect(h.port.cancel).toHaveBeenCalledWith(expect.objectContaining({ launchProfile: "java25-v1" }), expect.any(String));
  await act(async () => { finish(structuredClone(modernEntryPointResult)); await query; });
  expect(hook.result.current.result).toBeUndefined();
  expect(h.updateConfiguration).not.toHaveBeenCalled();
});
it("discovers the exact selected source set and fills a provider-owned nested binary name", async () => {
  const h = setup();
  const hook = renderHook(() => useJavaEntryPointDiscovery(h.options));
  expect(hook.result.current.available).toBe(true);
  await act(async () => hook.result.current.discover());
  expect(h.port.query).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: entryPointRequest.scope,
      projectContext: expect.objectContaining({ sdkHome: "/jdk" }),
      limit: 100,
    }),
  );
  const candidate = hook.result.current.result!.discovery!.candidates[0];
  await act(async () => hook.result.current.select(candidate));
  expect(h.updateConfiguration).toHaveBeenCalledWith(
    expect.objectContaining({
      mainClass: "demo.Container$Nested",
      projectModule: entryPointRequest.scope,
    }),
  );
  expect(h.verify).toHaveBeenCalledTimes(3);
});
it("keeps discovery disabled for unavailable or unqualified semantic context without throwing during render", () => {
  const h = setup();
  const context = { ...h.options.projectContext, context: null };
  const hook = renderHook(() =>
    useJavaEntryPointDiscovery({ ...h.options, projectContext: context }),
  );
  expect(hook.result.current.available).toBe(false);
});
it.each(["trusted", "enabled"] as const)("does not query without %s", async (field) => {
  const h = setup();
  const hook = renderHook(() => useJavaEntryPointDiscovery({ ...h.options, [field]: false }));
  await act(async () => hook.result.current.discover());
  expect(h.port.query).not.toHaveBeenCalled();
});
it("refuses dirty source buffers without saving or querying", async () => {
  const h = setup();
  h.options.reviewSavedBuffers.mockImplementation(() => {
    throw new Error("Save Java sources first");
  });
  const hook = renderHook(() => useJavaEntryPointDiscovery(h.options));
  await act(async () => hook.result.current.discover());
  expect(h.port.query).not.toHaveBeenCalled();
  expect(hook.result.current.message).toMatch(/Save Java/);
});
it("rejects results if buffers change while the request is running", async () => {
  const h = setup();
  h.verify
    .mockImplementationOnce(() => {})
    .mockImplementation(() => {
      throw new Error("Source draft changed");
    });
  const hook = renderHook(() => useJavaEntryPointDiscovery(h.options));
  await act(async () => hook.result.current.discover());
  expect(hook.result.current.result).toBeUndefined();
  expect(hook.result.current.message).toMatch(/draft changed/);
});
it("does not select a candidate after a new unsaved edit", async () => {
  const h = setup();
  const hook = renderHook(() => useJavaEntryPointDiscovery(h.options));
  await act(async () => hook.result.current.discover());
  const candidate = hook.result.current.result!.discovery!.candidates[0];
  h.verify.mockImplementation(() => {
    throw new Error("Source draft changed");
  });
  await act(async () => hook.result.current.select(candidate));
  expect(h.updateConfiguration).not.toHaveBeenCalled();
  expect(hook.result.current.result).toBeUndefined();
});
it.each(["workspace", "generation", "SDK", "module", "trust", "configuration"])(
  "cancels and discards late results after %s changes",
  async (change) => {
    const h = setup();
    let resolve!: (value: JavaEntryPointResult) => void;
    h.port.query.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const hook = renderHook((options) => useJavaEntryPointDiscovery(options), {
      initialProps: h.options,
    });
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.discover();
    });
    expect(hook.result.current.pending).toBe(true);
    const changed = { ...h.options };
    if (change === "workspace") changed.workspaceId = "other";
    if (change === "generation") changed.generation = 2;
    if (change === "SDK")
      changed.projectContext = {
        ...changed.projectContext,
        settings: { ...changed.projectContext.settings, sdkHome: "/other-jdk" },
      };
    if (change === "module")
      changed.configuration = {
        ...changed.configuration,
        projectModule: { ...changed.configuration.projectModule, moduleId: "other" },
      };
    if (change === "trust") changed.trusted = false;
    if (change === "configuration") changed.selectedConfigurationId = "other";
    hook.rerender(changed);
    expect(h.port.cancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(entryPointResult);
      await pending;
    });
    expect(hook.result.current.result).toBeUndefined();
    expect(h.updateConfiguration).not.toHaveBeenCalled();
  },
);
it("cancels a request on unmount", async () => {
  const h = setup();
  let resolve!: (value: JavaEntryPointResult) => void;
  h.port.query.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const hook = renderHook(() => useJavaEntryPointDiscovery(h.options));
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.discover();
  });
  hook.unmount();
  expect(h.port.cancel).toHaveBeenCalledTimes(1);
  resolve(entryPointResult);
  await pending;
});

it("explicit cancellation retires a late result and permits another request", async () => {
  const h = setup();
  let resolve!: (value: JavaEntryPointResult) => void;
  h.port.query.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const hook = renderHook(() => useJavaEntryPointDiscovery(h.options));
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.discover();
  });
  act(() => hook.result.current.cancel());
  expect(hook.result.current.pending).toBe(false);
  expect(h.port.cancel).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve(entryPointResult);
    await pending;
  });
  expect(hook.result.current.result).toBeUndefined();
  await act(async () => hook.result.current.discover());
  expect(hook.result.current.result?.status).toBe("ready");
});
it("does not revive a retired list when trust is granted again", async () => {
  const h = setup();
  const hook = renderHook((options) => useJavaEntryPointDiscovery(options), {
    initialProps: h.options,
  });
  await act(async () => hook.result.current.discover());
  expect(hook.result.current.result?.status).toBe("ready");
  hook.rerender({ ...h.options, trusted: false });
  expect(hook.result.current.result).toBeUndefined();
  hook.rerender(h.options);
  expect(hook.result.current.result).toBeUndefined();
});
function sourceResult(count: number): JavaEntryPointResult {
  const value = structuredClone(entryPointResult),
    discovery = value.discovery!;
  discovery.candidates = discovery.candidates
    .filter((c) => c.source.path === "src/main/java/demo/Runner.java")
    .slice(0, count);
  discovery.returnedCount =
    discovery.totalEligibleCount =
    discovery.observedEligibleLowerBound =
      discovery.candidates.length;
  return value;
}
it("runs one provider-owned main from an exact saved source using its binary name", async () => {
  const h = setup(),
    runSelectedConfiguration = vi.fn(async () => {}),
    isCurrent = vi.fn(() => true);
  h.port.query.mockResolvedValue(sourceResult(1));
  const hook = renderHook(() =>
    useJavaEntryPointDiscovery({ ...h.options, runSelectedConfiguration }),
  );
  await act(async () =>
    hook.result.current.discover({ path: "src/main/java/demo/Runner.java", isCurrent }),
  );
  expect(h.port.query).toHaveBeenCalledWith(
    expect.objectContaining({ path: "src/main/java/demo/Runner.java" }),
  );
  expect(runSelectedConfiguration).toHaveBeenCalledWith(
    expect.objectContaining({ mainClass: "demo.Runner", projectModule: entryPointRequest.scope }),
    "run",
  );
  expect(h.updateConfiguration).toHaveBeenCalledWith(
    expect.objectContaining({ mainClass: "demo.Runner" }),
  );
});
it("requires a choice for multiple mains declared in the same file", async () => {
  const h = setup(),
    runSelectedConfiguration = vi.fn(async () => {});
  h.port.query.mockResolvedValue(sourceResult(2));
  const hook = renderHook(() =>
    useJavaEntryPointDiscovery({ ...h.options, runSelectedConfiguration }),
  );
  await act(async () =>
    hook.result.current.discover({ path: "src/main/java/demo/Runner.java", isCurrent: () => true }),
  );
  expect(runSelectedConfiguration).not.toHaveBeenCalled();
  expect(hook.result.current.sourcePath).toBe("src/main/java/demo/Runner.java");
  const candidate = hook.result.current.result!.discovery!.candidates.find(
    (c) => c.binaryName === "demo.Secondary",
  )!;
  await act(async () => hook.result.current.select(candidate));
  expect(runSelectedConfiguration).toHaveBeenCalledWith(
    expect.objectContaining({ mainClass: "demo.Secondary" }),
    "run",
  );
});
it("does not execute a guessed class when a file returns no main", async () => {
  const h = setup(),
    runSelectedConfiguration = vi.fn(async () => {});
  h.port.query.mockResolvedValue(sourceResult(0));
  const hook = renderHook(() =>
    useJavaEntryPointDiscovery({ ...h.options, runSelectedConfiguration }),
  );
  await act(async () =>
    hook.result.current.discover({ path: "src/main/java/demo/Runner.java", isCurrent: () => true }),
  );
  expect(hook.result.current.result!.discovery!.complete).toBe(false);
  expect(h.updateConfiguration).not.toHaveBeenCalled();
  expect(runSelectedConfiguration).not.toHaveBeenCalled();
});
it("does not launch if the source model changes before discovery responds", async () => {
  const h = setup(),
    runSelectedConfiguration = vi.fn(async () => {});
  let current = true;
  h.port.query.mockImplementation(async () => {
    current = false;
    return sourceResult(1);
  });
  const hook = renderHook(() =>
    useJavaEntryPointDiscovery({ ...h.options, runSelectedConfiguration }),
  );
  await act(async () =>
    hook.result.current.discover({
      path: "src/main/java/demo/Runner.java",
      isCurrent: () => current,
    }),
  );
  expect(h.updateConfiguration).not.toHaveBeenCalled();
  expect(runSelectedConfiguration).not.toHaveBeenCalled();
  expect(hook.result.current.message).toMatch(/source action changed/);
});
it("does not launch a displayed file candidate after its model is retired", async () => {
  const h = setup(),
    runSelectedConfiguration = vi.fn(async () => {});
  let current = true;
  h.port.query.mockResolvedValue(sourceResult(2));
  const hook = renderHook(() =>
    useJavaEntryPointDiscovery({ ...h.options, runSelectedConfiguration }),
  );
  await act(async () =>
    hook.result.current.discover({
      path: "src/main/java/demo/Runner.java",
      isCurrent: () => current,
    }),
  );
  const candidate = hook.result.current.result!.discovery!.candidates[0];
  current = false;
  await act(async () => hook.result.current.select(candidate));
  expect(h.updateConfiguration).not.toHaveBeenCalled();
  expect(runSelectedConfiguration).not.toHaveBeenCalled();
});
it("retires a pending file launch when launch settings are edited", async () => {
  const h = setup(),
    runSelectedConfiguration = vi.fn(async () => {});
  let resolve!: (value: JavaEntryPointResult) => void;
  h.port.query.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const options = { ...h.options, runSelectedConfiguration };
  const hook = renderHook((options) => useJavaEntryPointDiscovery(options), {
    initialProps: options,
  });
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.discover({
      path: "src/main/java/demo/Runner.java",
      isCurrent: () => true,
    });
  });
  hook.rerender({ ...options, configuration: { ...options.configuration, mainClass: "Changed" } });
  await act(async () => {
    resolve(sourceResult(1));
    await pending;
  });
  expect(h.port.cancel).toHaveBeenCalledOnce();
  expect(runSelectedConfiguration).not.toHaveBeenCalled();
  expect(h.updateConfiguration).not.toHaveBeenCalled();
});
it.each(["truncated", "incomplete", "unknown total"])(
  "requires an explicit file choice for a single returned candidate with %s enumeration",
  async (reason) => {
    const h = setup(),
      runSelectedConfiguration = vi.fn(async () => {});
    const response = sourceResult(1);
    if (reason === "truncated")
      Object.assign(response.discovery!, {
        truncated: true,
        totalEligibleCount: 2,
        observedEligibleLowerBound: 2,
      });
    if (reason === "incomplete") response.discovery!.scopeAnalysisComplete = false;
    if (reason === "unknown total") response.discovery!.totalEligibleCount = null;
    h.port.query.mockResolvedValue(response);
    const hook = renderHook(() =>
      useJavaEntryPointDiscovery({ ...h.options, runSelectedConfiguration }),
    );
    await act(async () =>
      hook.result.current.discover({
        path: "src/main/java/demo/Runner.java",
        isCurrent: () => true,
      }),
    );
    expect(runSelectedConfiguration).not.toHaveBeenCalled();
    expect(h.updateConfiguration).not.toHaveBeenCalled();
    const candidate = hook.result.current.result!.discovery!.candidates[0];
    await act(async () => hook.result.current.select(candidate));
    expect(runSelectedConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ mainClass: "demo.Runner" }),
      "run",
    );
  },
);

it("starts Debug rather than Run for a unique provider-owned file main", async () => {
  const h = setup(),
    runSelectedConfiguration = vi.fn(async () => {});
  h.port.query.mockResolvedValue(sourceResult(1));
  const hook = renderHook(() =>
    useJavaEntryPointDiscovery({ ...h.options, runSelectedConfiguration }),
  );
  await act(async () =>
    hook.result.current.discover({
      path: "src/main/java/demo/Runner.java",
      isCurrent: () => true,
      operation: "debug",
    }),
  );
  expect(runSelectedConfiguration).toHaveBeenCalledWith(
    expect.objectContaining({ mainClass: "demo.Runner" }),
    "debug",
  );
  expect(h.port.query.mock.calls[0][0]).not.toHaveProperty("operation");
});
it("retains Debug intent while choosing among multiple file mains", async () => {
  const h = setup(),
    runSelectedConfiguration = vi.fn(async () => {});
  h.port.query.mockResolvedValue(sourceResult(2));
  const hook = renderHook(() =>
    useJavaEntryPointDiscovery({ ...h.options, runSelectedConfiguration }),
  );
  await act(async () =>
    hook.result.current.discover({
      path: "src/main/java/demo/Runner.java",
      isCurrent: () => true,
      operation: "debug",
    }),
  );
  expect(runSelectedConfiguration).not.toHaveBeenCalled();
  expect(hook.result.current.sourceOperation).toBe("debug");
  const candidate = hook.result.current.result!.discovery!.candidates[1];
  await act(async () => hook.result.current.select(candidate));
  expect(runSelectedConfiguration).toHaveBeenCalledWith(
    expect.objectContaining({ mainClass: candidate.binaryName }),
    "debug",
  );
});
it("forwards the cursor without deriving a class name in the controller", async () => {
  const h = setup(),
    runSelectedConfiguration = vi.fn(async () => {}),
    position = { line: 0, character: 80 };
  const response = sourceResult(1);
  response.discovery!.selection = {
    mode: "enclosing-type",
    path: "src/main/java/demo/Runner.java",
    position,
    binaryName: "demo.Runner",
    range: { start: { line: 0, character: 10 }, end: { line: 0, character: 110 } },
  };
  h.port.query.mockResolvedValue(response);
  const hook = renderHook(() =>
    useJavaEntryPointDiscovery({ ...h.options, runSelectedConfiguration }),
  );
  await act(async () =>
    hook.result.current.discover({
      path: "src/main/java/demo/Runner.java",
      position,
      isCurrent: () => true,
      operation: "debug",
    }),
  );
  expect(h.port.query).toHaveBeenCalledWith(
    expect.objectContaining({ path: "src/main/java/demo/Runner.java", position }),
  );
  expect(runSelectedConfiguration).toHaveBeenCalledWith(
    expect.objectContaining({ mainClass: "demo.Runner" }),
    "debug",
  );
});
it("does not fall back to an outer main for a selected inner type with no candidate", async () => {
  const h = setup(),
    runSelectedConfiguration = vi.fn(async () => {}),
    position = { line: 0, character: 80 };
  const response = sourceResult(0);
  response.discovery!.selection = {
    mode: "enclosing-type",
    path: "src/main/java/demo/Runner.java",
    position,
    binaryName: "demo.Runner$Dormant",
    range: { start: { line: 0, character: 70 }, end: { line: 0, character: 90 } },
  };
  h.port.query.mockResolvedValue(response);
  const hook = renderHook(() =>
    useJavaEntryPointDiscovery({ ...h.options, runSelectedConfiguration }),
  );
  await act(async () =>
    hook.result.current.discover({
      path: "src/main/java/demo/Runner.java",
      position,
      isCurrent: () => true,
    }),
  );
  expect(hook.result.current.result!.discovery!.selection!.binaryName).toBe("demo.Runner$Dormant");
  expect(runSelectedConfiguration).not.toHaveBeenCalled();
  expect(h.updateConfiguration).not.toHaveBeenCalled();
});

it.each(["trust", "workspace", "configuration", "port", "unmount"] as const)(
  "rejects a captured main-discovery callback after %s changes", async change => {
    const h = setup();
    const hook = renderHook(options => useJavaEntryPointDiscovery(options), { initialProps: h.options });
    const discover = hook.result.current.discover;
    if (change === "unmount") hook.unmount();
    else hook.rerender({ ...h.options,
      ...(change === "trust" ? { trusted: false } : {}),
      ...(change === "workspace" ? { workspaceId: "other" } : {}),
      ...(change === "configuration" ? { selectedConfigurationId: "other" } : {}),
      ...(change === "port" ? { port: { ...h.port, query: vi.fn() } } : {}),
    });
    await act(async () => discover());
    expect(h.port.query).not.toHaveBeenCalled();
    expect(h.options.reviewSavedBuffers).not.toHaveBeenCalled();
  },
);
it.each(["configuration", "port", "unmount"] as const)(
  "rejects a captured main selection after %s changes", async change => {
    const h = setup();
    const hook = renderHook(options => useJavaEntryPointDiscovery(options), { initialProps: h.options });
    await act(async () => hook.result.current.discover());
    const select = hook.result.current.select;
    const candidate = hook.result.current.result!.discovery!.candidates[0];
    if (change === "unmount") hook.unmount();
    else hook.rerender({ ...h.options,
      ...(change === "configuration" ? { selectedConfigurationId: "other" } : {}),
      ...(change === "port" ? { port: { ...h.port, query: vi.fn() } } : {}),
    });
    await act(async () => select(candidate));
    expect(h.updateConfiguration).not.toHaveBeenCalled();
  },
);
it("retires pending main discovery when its provider port changes", async () => {
  const h = setup();
  let resolve!: (value: JavaEntryPointResult) => void;
  h.port.query.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const hook = renderHook(options => useJavaEntryPointDiscovery(options), { initialProps: h.options });
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.discover(); });
  hook.rerender({ ...h.options, port: { ...h.port, query: vi.fn() } });
  expect(h.port.cancel).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(entryPointResult); await pending; });
  expect(hook.result.current.result).toBeUndefined();
});


it("does not revive a captured discovery callback after trust is withdrawn and granted again", async () => {
  const h = setup();
  const hook = renderHook(options => useJavaEntryPointDiscovery(options), { initialProps: h.options });
  const discover = hook.result.current.discover;
  hook.rerender({ ...h.options, trusted: false });
  hook.rerender(h.options);
  await act(async () => discover());
  expect(h.port.query).not.toHaveBeenCalled();
  await act(async () => hook.result.current.discover());
  expect(h.port.query).toHaveBeenCalledTimes(1);
});
it("refuses a provider query when saved-buffer verification retires its configuration", async () => {
  const h = setup();
  const hook = renderHook(options => useJavaEntryPointDiscovery(options), { initialProps: h.options });
  h.verify.mockImplementationOnce(() => flushSync(() => hook.rerender({ ...h.options, trusted: false })));
  await act(async () => hook.result.current.discover());
  expect(h.port.query).not.toHaveBeenCalled();
  expect(hook.result.current.result).toBeUndefined();
});
