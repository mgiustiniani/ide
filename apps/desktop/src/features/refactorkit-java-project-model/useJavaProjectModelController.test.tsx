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
  javaImportExternalClass: { supported: false, targetDirectory: false, preview: false, apply: false, rollback: false, stability: "experimental" },
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
  return Array.from({ length: entryCount }, (_, index) =>
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

function createHarness(overrides: {
  status?: RefactorKitStatus | null;
  capabilities?: RefactorKitCapabilities | null;
  scanSuccess?: boolean;
  symbolsSuccess?: boolean;
  scanThrows?: boolean;
  symbolsThrows?: boolean;
  symbolsStdout?: string;
} = {}) {
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
    workspaceInfo?: WorkspaceInfo | null;
    workspaceGeneration?: number;
    context?: { generation: number; workspaceId: string | null; isSwitching: boolean; isMetadataLoading: boolean };
  } = {},
) {
  const context = overrides.context ?? { generation: 1, workspaceId: workspace.id, isSwitching: false, isMetadataLoading: false };
  return renderHook(() =>
    useJavaProjectModelController({
      refactorKit: harness.refactorKit,
      status: overrides.status ?? status,
      capabilities: overrides.capabilities ?? capabilities,
      isCheckingCapabilities: false,
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
    const symbol = parseEngineSymbolLine("CLASS\tcom.example.Widget\t/workspace/sample/Widget.java:3");
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
    const model = buildProjectModel([{ kind: "CLASS", qualifiedName: "Foo", path: "Foo.java", line: 1 }]);
    expect(model.packages[0]).toMatchObject({ name: "(default)", classCount: 1, symbolCount: 1 });
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
      (current: UseJavaProjectModelControllerDependencies) => useJavaProjectModelController(current),
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

  it("AC-002: reports honest unavailable when the capability is not advertised", async () => {
    const harness = createHarness();
    const controller = renderController(harness, {
      capabilities: { ...capabilities, operationalSurface: ["rename"] } as RefactorKitCapabilities & { operationalSurface: string[] },
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
      (current: UseJavaProjectModelControllerDependencies) => useJavaProjectModelController(current),
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
      (current: UseJavaProjectModelControllerDependencies) => useJavaProjectModelController(current),
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
