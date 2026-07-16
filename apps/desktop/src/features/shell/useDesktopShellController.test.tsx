import type { ProblemItem } from "@ide/ui";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useDesktopShellController,
  type UseDesktopShellControllerDependencies,
} from "./useDesktopShellController";

const range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

function problem(severity: ProblemItem["severity"]): ProblemItem {
  return {
    id: severity,
    provider: "test",
    filePath: "src/Main.java",
    severity,
    range,
    message: `${severity} problem`,
  };
}

function createDependencies(
  overrides: Partial<UseDesktopShellControllerDependencies> = {},
): UseDesktopShellControllerDependencies & {
  actions: {
    setLeftSidebarWidth: ReturnType<typeof vi.fn>;
    setBottomPanelHeight: ReturnType<typeof vi.fn>;
    toggleVisibility: ReturnType<typeof vi.fn>;
    setActivePanel: ReturnType<typeof vi.fn>;
  };
} {
  const actions = {
    setLeftSidebarWidth: vi.fn(),
    setBottomPanelHeight: vi.fn(),
    toggleVisibility: vi.fn(),
    setActivePanel: vi.fn(),
  };
  return {
    actions,
    getPanelActions: () => actions,
    loadAiAgentCommands: vi.fn(async () => undefined),
    hasJavaContext: false,
    problemItems: [],
    ...overrides,
  };
}

describe("useDesktopShellController", () => {
  it("resizes both panels and delegates both visibility toggles to current panel actions", () => {
    const dependencies = createDependencies();
    const { result, rerender } = renderHook(() => useDesktopShellController(dependencies));
    const toggleBottomPanel = result.current.toggleBottomPanel;

    rerender();
    expect(result.current.toggleBottomPanel).toBe(toggleBottomPanel);

    act(() => {
      result.current.resizeLeft(320);
      result.current.resizeBottom(240);
      result.current.toggleLeftSidebar();
      result.current.toggleBottomPanel();
    });

    expect(dependencies.actions.setLeftSidebarWidth).toHaveBeenCalledExactlyOnceWith(320);
    expect(dependencies.actions.setBottomPanelHeight).toHaveBeenCalledExactlyOnceWith(240);
    expect(dependencies.actions.toggleVisibility.mock.calls).toEqual([
      ["leftSidebar"],
      ["bottomPanel"],
    ]);
  });

  it("activates supported tabs, opens the bottom panel, and lazily loads AI commands", () => {
    const dependencies = createDependencies({ hasJavaContext: true });
    const { result } = renderHook(() => useDesktopShellController(dependencies));

    expect(result.current.activeBottomTab).toBe("terminal");
    act(() => result.current.activateBottomTab("ai-agent"));
    expect(result.current.activeBottomTab).toBe("ai-agent");
    expect(dependencies.actions.setActivePanel).toHaveBeenCalledWith("bottomPanel");
    expect(dependencies.loadAiAgentCommands).toHaveBeenCalledOnce();

    act(() => result.current.activateBottomTab("problems"));
    expect(result.current.activeBottomTab).toBe("problems");
    expect(dependencies.loadAiAgentCommands).toHaveBeenCalledOnce();

    act(() => result.current.activateBottomTab("unsupported"));
    expect(result.current.activeBottomTab).toBe("problems");
    expect(dependencies.actions.setActivePanel).toHaveBeenCalledTimes(2);
  });

  it("shows Problems for Java context or supplied items and falls back when context disappears", async () => {
    const initial = createDependencies({ hasJavaContext: true });
    const { result, rerender } = renderHook(
      (dependencies: UseDesktopShellControllerDependencies) =>
        useDesktopShellController(dependencies),
      { initialProps: initial },
    );

    expect(result.current.shouldShowProblems).toBe(true);
    act(() => result.current.activateBottomTab("problems"));
    expect(result.current.activeBottomTab).toBe("problems");

    rerender({ ...initial, hasJavaContext: false, problemItems: [problem("warning")] });
    expect(result.current.shouldShowProblems).toBe(true);
    expect(result.current.activeBottomTab).toBe("problems");

    rerender({ ...initial, hasJavaContext: false, problemItems: [] });
    expect(result.current.shouldShowProblems).toBe(false);
    await waitFor(() => expect(result.current.activeBottomTab).toBe("terminal"));
  });

  it("uses error, warning, information, info, and hint severity precedence", () => {
    const initial = createDependencies({ problemItems: [] });
    const { result, rerender } = renderHook(
      (dependencies: UseDesktopShellControllerDependencies) =>
        useDesktopShellController(dependencies),
      { initialProps: initial },
    );

    expect(result.current.problemSeverity).toBe("hint");

    rerender({ ...initial, problemItems: [problem("info")] });
    expect(result.current.problemSeverity).toBe("info");

    rerender({ ...initial, problemItems: [problem("information"), problem("info")] });
    expect(result.current.problemSeverity).toBe("information");

    rerender({ ...initial, problemItems: [problem("hint"), problem("warning")] });
    expect(result.current.problemSeverity).toBe("warning");

    rerender({
      ...initial,
      problemItems: [problem("warning"), problem("error"), problem("information")],
    });
    expect(result.current.problemSeverity).toBe("error");
  });
});
