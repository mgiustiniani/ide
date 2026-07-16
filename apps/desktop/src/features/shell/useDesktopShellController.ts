import type { ProblemItem } from "@ide/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

export type DesktopBottomTabId = "terminal" | "ai-agent" | "problems";

export interface DesktopPanelActions {
  setLeftSidebarWidth(width: number): void;
  setBottomPanelHeight(height: number): void;
  toggleVisibility(panel: "leftSidebar" | "bottomPanel"): void;
  setActivePanel(panel: "bottomPanel"): void;
}

export interface UseDesktopShellControllerDependencies {
  getPanelActions: () => DesktopPanelActions;
  loadAiAgentCommands: () => Promise<unknown>;
  hasJavaContext: boolean;
  problemItems: readonly ProblemItem[];
}

/** Owns panel layout commands and contextual bottom-tab visibility policy. */
export function useDesktopShellController({
  getPanelActions,
  loadAiAgentCommands,
  hasJavaContext,
  problemItems,
}: UseDesktopShellControllerDependencies) {
  const [activeBottomTab, setActiveBottomTab] = useState<DesktopBottomTabId>("terminal");
  const shouldShowProblems = hasJavaContext || problemItems.length > 0;

  const problemSeverity = useMemo<ProblemItem["severity"]>(
    () =>
      problemItems.some((item) => item.severity === "error")
        ? "error"
        : problemItems.some((item) => item.severity === "warning")
          ? "warning"
          : problemItems.some((item) => item.severity === "information")
            ? "information"
            : problemItems.some((item) => item.severity === "info")
              ? "info"
              : "hint",
    [problemItems],
  );

  useEffect(() => {
    if (!shouldShowProblems && activeBottomTab === "problems") {
      setActiveBottomTab("terminal");
    }
  }, [activeBottomTab, shouldShowProblems]);

  const resizeLeft = useCallback(
    (width: number): void => getPanelActions().setLeftSidebarWidth(width),
    [getPanelActions],
  );
  const resizeBottom = useCallback(
    (height: number): void => getPanelActions().setBottomPanelHeight(height),
    [getPanelActions],
  );
  const toggleLeftSidebar = useCallback(
    (): void => getPanelActions().toggleVisibility("leftSidebar"),
    [getPanelActions],
  );
  const toggleBottomPanel = useCallback(
    (): void => getPanelActions().toggleVisibility("bottomPanel"),
    [getPanelActions],
  );
  const activateBottomTab = useCallback(
    (tabId: string): void => {
      if (tabId !== "terminal" && tabId !== "ai-agent" && tabId !== "problems") return;

      setActiveBottomTab(tabId);
      getPanelActions().setActivePanel("bottomPanel");
      if (tabId === "ai-agent") void loadAiAgentCommands();
    },
    [getPanelActions, loadAiAgentCommands],
  );

  return {
    activeBottomTab,
    shouldShowProblems,
    problemSeverity,
    resizeLeft,
    resizeBottom,
    toggleLeftSidebar,
    toggleBottomPanel,
    activateBottomTab,
  };
}
