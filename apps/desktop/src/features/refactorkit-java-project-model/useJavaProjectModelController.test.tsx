import type {
  RefactorKitCapabilities,
  RefactorKitCommandResult,
  RefactorKitStatus,
  WorkspaceInfo,
} from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core/ports";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildProjectModel,
  parseEngineSymbolLine,
  parseEngineSymbols,
  useJavaProjectModelController,
  type JavaProjectModelController,
  type UseJavaProjectModelControllerDependencies,
} from "./useJavaProjectModelController";

const workspace: WorkspaceInfo = {
  id: "workspace-one",
  name: "Sample",
  rootPath: "/workspace/sample",
};

const status: RefactorKitStatus = { available: true };

const capabilities: RefactorKitCapabilities = {
  api: "RefactorKit",
  apiVersion: "0.3",
  provider: "engine",
  providerVersion: "0.7.0-SNAPSHOT",
  javaImportExternalClass: {
    supported: false,
    targetDirectory: false,
    preview: false,
    apply: false,
    rollback: false,
    stability: "experimental",
  },
  operationalSurface: ["scan", "symbols"],
} as RefactorKitCapabilities & { operationalSurface: string[] };

function engineResult(overrides: Partial<RefactorKitCommandResult> = {}): RefactorKitCommandResult {
  return {
    stdout: "",
    stderr: "",
    locations: [],
    success: true,
    code: 0,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    command: ["refactorkit", "symbols", "/workspace/sample"],
    ...overrides,
  };
}

/** Engine symbols stdout whose parsed entry count exceeds the bounded presentation slice. */
function oversizedSymbolsStdout(entryCount: number): string {
  return Array.from(
    { length: entryCount },
    (_, index) =>
      `CLASS\tcom.example.Class${index}\t/workspace/sample/Class${index}.java:${index + 1}`,
  ).join("\n");
}

const SYMBOLS_STDOUT = [
  "PACKAGE\tcom.example\t/workspace/sample/src/main/java/example/package-info.java:1",
  "CLASS\tcom.example.Widget\t/workspace/sample/src/main/java/example/Widget.java:3",
  "INTERFACE\tcom.example.WidgetFactory\t/workspace/sample/src/main/java/example/WidgetFactory.java:5",
  "METHOD\tcom.example.Widget.render\t/workspace/sample/src/main/java/example/Widget.java:9",
  "FIELD\tcom.example.Widget.size\t/workspace/sample/src/main/java/example/Widget.java:7",
].join("\n");

function createHarness(
  overrides: {
    status?: RefactorKitStatus | null;
    capabilities?: RefactorKitCapabilities | null;
    scanSuccess?: boolean;
    symbolsSuccess?: boolean;
    scanThrows?: boolean;
    symbolsThrows?: boolean;
    symbolsStdout?: string;
  } = {},
) {
  const scan = vi.fn(async () => {
    if (overrides.scanThrows) throw new Error("scan failed");
    return engineResult({ success: overrides.scanSuccess ?? true });
  });
  const symbols = vi.fn(async () => {
    if (overrides.symbolsThrows) throw new Error("symbols failed");
    return engineResult({
      success: overrides.symbolsSuccess ?? true,
      stdout: overrides.symbolsStdout ?? SYMBOLS_STDOUT,
    });
  });
  const refactorKit = { scan, symbols } as unknown as RefactorKitPort;
  return { refactorKit, scan, symbols };
}

function renderController(
  harness: ReturnType<typeof createHarness>,
  overrides: {
    status?: RefactorKitStatus | null;
    capabilities?: RefactorKitCapabilities | null;
    refreshCapabilities?: UseJavaProjectModelControllerDependencies["refreshCapabilities"];
    workspaceInfo?: WorkspaceInfo | null;
    workspaceGeneration?: number;
    context?: {
      generation: number;
      workspaceId: string | null;
      isSwitching: boolean;
      isMetadataLoading: boolean;
    };
  } = {},
) {
  const context = overrides.context ?? {
    generation: 1,
    workspaceId: workspace.id,
    isSwitching: false,
    isMetadataLoading: false,
  };
  return renderHook(() =>
    useJavaProjectModelController({
      refactorKit: harness.refactorKit,
      status: Object.prototype.hasOwnProperty.call(overrides, "status")
        ? (overrides.status ?? null)
        : status,
      capabilities: Object.prototype.hasOwnProperty.call(overrides, "capabilities")
        ? (overrides.capabilities ?? null)
        : capabilities,
      isCheckingCapabilities: false,
      refreshCapabilities: overrides.refreshCapabilities,
      workspaceInfo: overrides.workspaceInfo ?? workspace,
      workspaceGeneration: overrides.workspaceGeneration ?? 1,
      getWorkspaceContext: () => context,
    }),
  );
}

/** Any rendered hook result whose current controller is the Java project-model controller. */
type ControllerHookResult = {
  result: { current: JavaProjectModelController };
};

async function refreshAndSettle(controller: ControllerHookResult) {
  await act(async () => {
    await controller.result.current.refresh();
  });
  await waitFor(() => expect(controller.result.current.isBusy).toBe(false));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseEngineSymbolLine", () => {
  it("parses a valid engine symbol line into kind, qualified name, path, and line", () => {
    const symbol = parseEngineSymbolLine(
      "CLASS\tcom.example.Widget\t/workspace/sample/Widget.java:3",
    );
    expect(symbol).toEqual({
      kind: "CLASS",
      qualifiedName: "com.example.Widget",
      path: "/workspace/sample/Widget.java",
      line: 3,
    });
  });

  it("returns null for malformed or empty lines", () => {
    expect(parseEngineSymbolLine("")).toBeNull();
    expect(parseEngineSymbolLine("CLASS")).toBeNull();
    expect(parseEngineSymbolLine("CLASS\tcom.example.Widget")).toBeNull();
    expect(parseEngineSymbolLine("CLASS\tcom.example.Widget\tWidget.java")).toBeNull();
    expect(parseEngineSymbolLine("CLASS\tcom.example.Widget\tWidget.java:0")).toBeNull();
  });
});

describe("parseEngineSymbols", () => {
  it("parses every non-empty line of the engine symbols stdout", () => {
    const symbols = parseEngineSymbols(SYMBOLS_STDOUT);
    expect(symbols).toHaveLength(5);
    expect(symbols[0]).toMatchObject({ kind: "PACKAGE", qualifiedName: "com.example" });
  });

  it("skips malformed lines without fabricating entries", () => {
    const symbols = parseEngineSymbols("CLASS\tcom.example.Widget\tWidget.java:3\nbad\n\n");
    expect(symbols).toHaveLength(1);
  });
});

describe("buildProjectModel", () => {
  it("groups engine symbols into packages, classes, and symbols", () => {
    const symbols = parseEngineSymbols(SYMBOLS_STDOUT);
    const model = buildProjectModel(symbols);
    expect(model.packages).toHaveLength(1);
    expect(model.packages[0]).toMatchObject({ name: "com.example", classCount: 2, symbolCount: 5 });
    expect(model.classes.map((c) => c.name)).toEqual(["Widget", "WidgetFactory"]);
    expect(model.symbols).toHaveLength(5);
  });

  it("maps the default package for symbols without a package", () => {
    const model = buildProjectModel([
      { kind: "CLASS", qualifiedName: "Foo", path: "Foo.java", line: 1 },
    ]);
    expect(model.packages[0]).toMatchObject({ name: "(default)", classCount: 1, symbolCount: 1 });
  });

  it("retains every engine source path when a package spans multiple workspace projects", () => {
    const model = buildProjectModel([
      {
        kind: "CLASS",
        qualifiedName: "pkg.GradleType",
        path: "gradle/app/src/main/java/pkg/GradleType.java",
        line: 1,
      },
      {
        kind: "CLASS",
        qualifiedName: "pkg.MavenType",
        path: "maven/app/src/main/java/pkg/MavenType.java",
        line: 1,
      },
    ]);

    expect(model.packages[0]).toMatchObject({
      name: "pkg",
      path: "gradle/app/src/main/java/pkg/GradleType.java",
      sourcePaths: [
        "gradle/app/src/main/java/pkg/GradleType.java",
        "maven/app/src/main/java/pkg/MavenType.java",
      ],
    });
  });

  it("AC-001: exposes the full engine symbol count and honest truncation state for large engine results", () => {
    const symbols = Array.from({ length: 520 }, (_, index) => ({
      kind: "CLASS",
      qualifiedName: `com.example.Class${index}`,
      path: `/workspace/sample/Class${index}.java`,
      line: index + 1,
    }));
    const model = buildProjectModel(symbols);
    expect(model.symbols).toHaveLength(500);
    expect(model.totalSymbolCount).toBe(520);
    expect(model.presentedSymbolsTruncated).toBe(true);
  });

  it("AC-001: reports no truncation when the engine result fits the bounded presentation", () => {
    const symbols = parseEngineSymbols(SYMBOLS_STDOUT);
    const model = buildProjectModel(symbols);
    expect(model.symbols).toHaveLength(5);
    expect(model.totalSymbolCount).toBe(5);
    expect(model.presentedSymbolsTruncated).toBe(false);
  });
});

describe("useJavaProjectModelController", () => {
  it("AC-001: requests the engine scan/symbols and presents the project model from the engine result", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    await refreshAndSettle(controller);

    expect(harness.scan).toHaveBeenCalledTimes(1);
    expect(harness.symbols).toHaveBeenCalledTimes(1);
    expect(controller.result.current.availability).toBe("available");
    expect(controller.result.current.model?.packages[0]).toMatchObject({
      name: "com.example",
      classCount: 2,
    });
    expect(controller.result.current.model?.classes[0]).toMatchObject({
      qualifiedName: "com.example.Widget",
    });
    expect(controller.result.current.model?.symbols).toHaveLength(5);
    expect(controller.result.current.model?.totalSymbolCount).toBe(5);
    expect(controller.result.current.model?.presentedSymbolsTruncated).toBe(false);
    expect(controller.result.current.totalSymbolCount).toBe(5);
    expect(controller.result.current.presentedSymbolsTruncated).toBe(false);
    expect(controller.result.current.projectRoot).toBe("/workspace/sample");
    expect(controller.result.current.error).toBeNull();
  });

  it("AC-001: presents a bounded symbol slice with the full engine result count and an honest truncation state", async () => {
    const harness = createHarness({ symbolsStdout: oversizedSymbolsStdout(520) });
    const controller = renderController(harness);
    await refreshAndSettle(controller);

    expect(controller.result.current.availability).toBe("available");
    expect(controller.result.current.model?.symbols).toHaveLength(500);
    expect(controller.result.current.model?.totalSymbolCount).toBe(520);
    expect(controller.result.current.model?.presentedSymbolsTruncated).toBe(true);
    expect(controller.result.current.totalSymbolCount).toBe(520);
    expect(controller.result.current.presentedSymbolsTruncated).toBe(true);
  });

  it("AC-001: clears the truncation state when no model is presented", async () => {
    const harness = createHarness();
    const deps: UseJavaProjectModelControllerDependencies = {
      refactorKit: harness.refactorKit,
      status,
      capabilities,
      isCheckingCapabilities: false,
      workspaceInfo: workspace,
      workspaceGeneration: 1,
      getWorkspaceContext: () => ({
        generation: 1,
        workspaceId: workspace.id,
        isSwitching: false,
        isMetadataLoading: false,
      }),
    };
    const controller = renderHook(
      (current: UseJavaProjectModelControllerDependencies) =>
        useJavaProjectModelController(current),
      { initialProps: deps },
    );
    await refreshAndSettle(controller);
    expect(controller.result.current.totalSymbolCount).toBe(5);

    const nextWorkspace: WorkspaceInfo = {
      id: "workspace-two",
      name: "Other",
      rootPath: "/workspace/other",
    };
    controller.rerender({
      ...deps,
      workspaceInfo: nextWorkspace,
      workspaceGeneration: 2,
      getWorkspaceContext: () => ({
        generation: 2,
        workspaceId: nextWorkspace.id,
        isSwitching: false,
        isMetadataLoading: false,
      }),
    });

    expect(controller.result.current.model).toBeNull();
    expect(controller.result.current.totalSymbolCount).toBeNull();
    expect(controller.result.current.presentedSymbolsTruncated).toBeNull();
  });

  it("AC-002: reports honest unavailable when the engine is absent and never fabricates a model", async () => {
    const harness = createHarness();
    const controller = renderController(harness, { status: { available: false } });
    await refreshAndSettle(controller);

    expect(harness.scan).not.toHaveBeenCalled();
    expect(harness.symbols).not.toHaveBeenCalled();
    expect(controller.result.current.availability).toBe("unavailable");
    expect(controller.result.current.model).toBeNull();
    expect(controller.result.current.availabilityReason).toBeTruthy();
  });

  it("rechecks shared capabilities when a refresh sees a stale unavailable engine snapshot", async () => {
    const harness = createHarness();
    const refreshCapabilities = vi.fn(async () => ({
      status,
      capabilities,
    }));
    const controller = renderController(harness, {
      status: { available: false },
      capabilities: null,
      refreshCapabilities,
    });

    await refreshAndSettle(controller);

    expect(refreshCapabilities).toHaveBeenCalledOnce();
    expect(harness.scan).toHaveBeenCalledOnce();
    expect(harness.symbols).toHaveBeenCalledOnce();
    expect(controller.result.current.availability).toBe("available");
  });

  it("waits for the current shared refresh when its capability retry is superseded", async () => {
    const harness = createHarness();
    type CapabilitySnapshot = {
      status: RefactorKitStatus | null;
      capabilities: RefactorKitCapabilities | null;
    };
    let resolveCapabilities!: (snapshot: CapabilitySnapshot) => void;
    const refreshCapabilities = vi.fn(
      () =>
        new Promise<CapabilitySnapshot>((resolve) => {
          resolveCapabilities = resolve;
        }),
    );
    const dependencies: UseJavaProjectModelControllerDependencies = {
      refactorKit: harness.refactorKit,
      status: { available: false },
      capabilities: null,
      isCheckingCapabilities: false,
      refreshCapabilities,
      workspaceInfo: workspace,
      workspaceGeneration: 1,
      getWorkspaceContext: () => ({
        generation: 1,
        workspaceId: workspace.id,
        isSwitching: false,
        isMetadataLoading: false,
      }),
    };
    const controller = renderHook(
      (current: UseJavaProjectModelControllerDependencies) =>
        useJavaProjectModelController(current),
      { initialProps: dependencies },
    );

    let firstRefresh!: Promise<void>;
    act(() => {
      firstRefresh = controller.result.current.refresh();
    });
    expect(refreshCapabilities).toHaveBeenCalledOnce();

    controller.rerender({ ...dependencies, isCheckingCapabilities: true });
    await act(async () => {
      resolveCapabilities({ status: null, capabilities: null });
      await firstRefresh;
    });

    expect(controller.result.current.availability).toBe("unavailable");
    expect(controller.result.current.availabilityReason).toBe(
      "RefactorKit capability discovery is still loading.",
    );
    expect(controller.result.current.error).toBeNull();
    expect(harness.scan).not.toHaveBeenCalled();

    controller.rerender({
      ...dependencies,
      status,
      capabilities,
      isCheckingCapabilities: false,
    });
    await waitFor(() => expect(controller.result.current.availability).toBe("available"));

    expect(refreshCapabilities).toHaveBeenCalledOnce();
    expect(harness.scan).toHaveBeenCalledOnce();
    expect(harness.symbols).toHaveBeenCalledOnce();
  });

  it("reports capability-read failure instead of claiming the engine omitted scan and symbols", async () => {
    const harness = createHarness();
    const controller = renderController(harness, {
      status,
      capabilities: null,
      refreshCapabilities: async () => ({ status, capabilities: null }),
    });

    await refreshAndSettle(controller);

    expect(harness.scan).not.toHaveBeenCalled();
    expect(harness.symbols).not.toHaveBeenCalled();
    expect(controller.result.current.availability).toBe("error");
    expect(controller.result.current.availabilityReason).toBeNull();
    expect(controller.result.current.error).toBe(
      "RefactorKit capability discovery could not be refreshed.",
    );
  });

  it("shows a source-safe capability protocol detail when refresh returns one", async () => {
    const harness = createHarness();
    const protocolError =
      "[tauri:get_refactorkit_capabilities] Invalid response: invalid methods metadata";
    const controller = renderController(harness, {
      status,
      capabilities: null,
      refreshCapabilities: async () => ({
        status,
        capabilities: null,
        capabilitiesError: protocolError,
      }),
    });

    await refreshAndSettle(controller);

    expect(controller.result.current.availability).toBe("error");
    expect(controller.result.current.error).toBe(protocolError);
    expect(harness.scan).not.toHaveBeenCalled();
  });

  it("waits for capability discovery and retries a requested project-model refresh", async () => {
    const harness = createHarness();
    const initialDependencies: UseJavaProjectModelControllerDependencies = {
      refactorKit: harness.refactorKit,
      status: null,
      capabilities: null,
      isCheckingCapabilities: true,
      workspaceInfo: workspace,
      workspaceGeneration: 1,
      getWorkspaceContext: () => ({
        generation: 1,
        workspaceId: workspace.id,
        isSwitching: false,
        isMetadataLoading: false,
      }),
    };
    const controller = renderHook(
      (dependencies: UseJavaProjectModelControllerDependencies) =>
        useJavaProjectModelController(dependencies),
      { initialProps: initialDependencies },
    );

    await act(async () => {
      await controller.result.current.refresh();
    });

    expect(controller.result.current.isBusy).toBe(true);
    expect(controller.result.current.availabilityReason).toBe(
      "RefactorKit capability discovery is still loading.",
    );
    expect(harness.scan).not.toHaveBeenCalled();

    controller.rerender({
      ...initialDependencies,
      status,
      capabilities,
      isCheckingCapabilities: false,
    });

    await waitFor(() => expect(controller.result.current.availability).toBe("available"));
    expect(harness.scan).toHaveBeenCalledOnce();
    expect(harness.symbols).toHaveBeenCalledOnce();
    expect(controller.result.current.isBusy).toBe(false);
  });

  it("uses engine discovery when the installed engine is not on PATH", async () => {
    const harness = createHarness();
    const installedEngineCapabilities = {
      ...capabilities,
      engineDiscovered: true,
    } as RefactorKitCapabilities & {
      engineDiscovered: boolean;
      operationalSurface: string[];
    };
    const controller = renderController(harness, {
      status: { available: false, lastError: "refactorkit was not found on PATH" },
      capabilities: installedEngineCapabilities,
    });

    await refreshAndSettle(controller);

    expect(harness.scan).toHaveBeenCalledExactlyOnceWith();
    expect(harness.symbols).toHaveBeenCalledExactlyOnceWith();
    expect(controller.result.current.availability).toBe("available");
  });

  it("AC-002: reports honest unavailable when the capability is not advertised", async () => {
    const harness = createHarness();
    const controller = renderController(harness, {
      capabilities: {
        ...capabilities,
        operationalSurface: ["rename"],
      } as RefactorKitCapabilities & { operationalSurface: string[] },
    });
    await refreshAndSettle(controller);

    expect(harness.scan).not.toHaveBeenCalled();
    expect(controller.result.current.availability).toBe("unavailable");
    expect(controller.result.current.model).toBeNull();
  });

  it("AC-002: reports an error when the engine scan fails and never fabricates a model", async () => {
    const harness = createHarness({ scanSuccess: false });
    const controller = renderController(harness);
    await refreshAndSettle(controller);

    expect(controller.result.current.availability).toBe("error");
    expect(controller.result.current.model).toBeNull();
    expect(controller.result.current.error).toBeTruthy();
  });

  it("AC-002: reports an error when scan throws and never fabricates a model", async () => {
    const harness = createHarness({ scanThrows: true });
    const controller = renderController(harness);
    await refreshAndSettle(controller);

    expect(controller.result.current.availability).toBe("error");
    expect(controller.result.current.model).toBeNull();
    expect(controller.result.current.error).toBeTruthy();
  });

  it("AC-002: reports an error when symbols fails and never fabricates a model", async () => {
    const harness = createHarness({ symbolsSuccess: false });
    const controller = renderController(harness);
    await refreshAndSettle(controller);

    expect(controller.result.current.availability).toBe("error");
    expect(controller.result.current.model).toBeNull();
  });

  it("AC-001/002: refuses an unauthorized workspace and never invokes the engine", async () => {
    const harness = createHarness();
    const controller = renderController(harness, {
      workspaceInfo: null,
      context: { generation: 1, workspaceId: null, isSwitching: false, isMetadataLoading: false },
    });
    await refreshAndSettle(controller);

    expect(harness.scan).not.toHaveBeenCalled();
    expect(controller.result.current.availability).toBe("unavailable");
    expect(controller.result.current.model).toBeNull();
  });

  it("AC-003: synchronously revokes the presented project model when the workspace generation changes", async () => {
    const harness = createHarness();
    const deps: UseJavaProjectModelControllerDependencies = {
      refactorKit: harness.refactorKit,
      status,
      capabilities,
      isCheckingCapabilities: false,
      workspaceInfo: workspace,
      workspaceGeneration: 1,
      getWorkspaceContext: () => ({
        generation: 1,
        workspaceId: workspace.id,
        isSwitching: false,
        isMetadataLoading: false,
      }),
    };
    const controller = renderHook(
      (current: UseJavaProjectModelControllerDependencies) =>
        useJavaProjectModelController(current),
      { initialProps: deps },
    );
    await refreshAndSettle(controller);

    expect(controller.result.current.availability).toBe("available");
    expect(controller.result.current.model).not.toBeNull();
    expect(controller.result.current.projectRoot).toBe("/workspace/sample");

    const nextWorkspace: WorkspaceInfo = {
      id: "workspace-two",
      name: "Other",
      rootPath: "/workspace/other",
    };
    controller.rerender({
      ...deps,
      workspaceInfo: nextWorkspace,
      workspaceGeneration: 2,
      getWorkspaceContext: () => ({
        generation: 2,
        workspaceId: nextWorkspace.id,
        isSwitching: false,
        isMetadataLoading: false,
      }),
    });

    expect(controller.result.current.availability).toBe("unavailable");
    expect(controller.result.current.availabilityReason).toBeTruthy();
    expect(controller.result.current.model).toBeNull();
    expect(controller.result.current.projectRoot).toBeNull();
    expect(harness.scan).toHaveBeenCalledTimes(1);
    expect(harness.symbols).toHaveBeenCalledTimes(1);
  });

  it("AC-003: after a workspace-generation reset the model stays unavailable until the user refreshes the new workspace", async () => {
    const harness = createHarness();
    const nextWorkspace: WorkspaceInfo = {
      id: "workspace-two",
      name: "Other",
      rootPath: "/workspace/other",
    };
    const deps: UseJavaProjectModelControllerDependencies = {
      refactorKit: harness.refactorKit,
      status,
      capabilities,
      isCheckingCapabilities: false,
      workspaceInfo: workspace,
      workspaceGeneration: 1,
      getWorkspaceContext: () => ({
        generation: 1,
        workspaceId: workspace.id,
        isSwitching: false,
        isMetadataLoading: false,
      }),
    };
    const controller = renderHook(
      (current: UseJavaProjectModelControllerDependencies) =>
        useJavaProjectModelController(current),
      { initialProps: deps },
    );
    await refreshAndSettle(controller);
    expect(controller.result.current.availability).toBe("available");

    controller.rerender({
      ...deps,
      workspaceInfo: nextWorkspace,
      workspaceGeneration: 2,
      getWorkspaceContext: () => ({
        generation: 2,
        workspaceId: nextWorkspace.id,
        isSwitching: false,
        isMetadataLoading: false,
      }),
    });
    expect(controller.result.current.availability).toBe("unavailable");
    expect(controller.result.current.model).toBeNull();

    // The user refreshes for the new workspace: the engine is re-consulted and
    // availability is re-derived honestly from the engine result.
    await refreshAndSettle(controller);

    expect(harness.scan).toHaveBeenCalledTimes(2);
    expect(harness.symbols).toHaveBeenCalledTimes(2);
    expect(controller.result.current.availability).toBe("available");
    expect(controller.result.current.model).not.toBeNull();
    expect(controller.result.current.projectRoot).toBe("/workspace/other");
  });
});
