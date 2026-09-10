import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RefactorKitCapabilities,
  RefactorKitStatus,
  WorkspaceInfo,
} from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core/ports";
import { JavaProjectModelPanel } from "./JavaProjectModelPanel";
import {
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

function oversizedSymbolsStdout(entryCount: number): string {
  return Array.from({ length: entryCount }, (_, index) =>
    `CLASS\tcom.example.Class${index}\t/workspace/sample/Class${index}.java:${index + 1}`,
  ).join("\n");
}

/**
 * Renders the real controller hook against a stub RefactorKit port, performs
 * the user-initiated refresh, and returns the settled controller for panel
 * rendering. The engine result is the only symbol source; nothing is mocked
 * into a fake model.
 */
async function renderControllerPanel(symbolsStdout: string): Promise<JavaProjectModelController> {
  const refactorKit = {
    scan: vi.fn(async () => ({ stdout: "", stderr: "", locations: [], success: true, code: 0, timedOut: false, stdoutTruncated: false, stderrTruncated: false, command: ["refactorkit", "scan", "/workspace/sample"] })),
    symbols: vi.fn(async () => ({ stdout: symbolsStdout, stderr: "", locations: [], success: true, code: 0, timedOut: false, stdoutTruncated: false, stderrTruncated: false, command: ["refactorkit", "symbols", "/workspace/sample"] })),
  } as unknown as RefactorKitPort;
  const dependencies: UseJavaProjectModelControllerDependencies = {
    refactorKit,
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
  const hook = renderHook(
    (current: UseJavaProjectModelControllerDependencies) => useJavaProjectModelController(current),
    { initialProps: dependencies },
  );
  let controller: JavaProjectModelController = hook.result.current;
  await act(async () => {
    controller = hook.result.current;
    await controller.refresh();
  });
  controller = hook.result.current;
  return controller;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("JavaProjectModelPanel", () => {
  it("AC-001: renders the honest truncation state when the engine result exceeds the bounded symbol list", async () => {
    const controller = await renderControllerPanel(oversizedSymbolsStdout(520));

    expect(controller.availability).toBe("available");
    expect(controller.model?.symbols).toHaveLength(500);
    expect(controller.totalSymbolCount).toBe(520);
    expect(controller.presentedSymbolsTruncated).toBe(true);

    render(<JavaProjectModelPanel controller={controller} />);
    expect(screen.getByText(/Symbols \(500 of 520\)/)).toBeTruthy();
    const indicator = screen.getByTestId("java-project-model-symbols-truncation");
    expect(indicator.textContent).toContain("Showing 500 of 520 symbols");
  });

  it("AC-001: renders only the presented count without a truncation indicator when the result fits the bounded list", async () => {
    const controller = await renderControllerPanel(
      "CLASS\tcom.example.Widget\t/workspace/sample/Widget.java:3\n" +
        "METHOD\tcom.example.Widget.render\t/workspace/sample/Widget.java:9",
    );

    expect(controller.availability).toBe("available");
    expect(controller.model?.symbols).toHaveLength(2);
    expect(controller.totalSymbolCount).toBe(2);
    expect(controller.presentedSymbolsTruncated).toBe(false);

    render(<JavaProjectModelPanel controller={controller} />);
    expect(screen.getByText(/Symbols \(2\)/)).toBeTruthy();
    expect(screen.queryByTestId("java-project-model-symbols-truncation")).toBeNull();
  });
});
