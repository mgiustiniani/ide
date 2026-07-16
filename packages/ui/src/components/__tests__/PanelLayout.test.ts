// ---------------------------------------------------------------------------
// @ide/ui – PanelLayout Component Tests
// ---------------------------------------------------------------------------
// Tests that PanelLayout renders three panels, handles resize callbacks,
// and hides panels based on visibility.
// ---------------------------------------------------------------------------

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiAgentResponsePanel } from "../AiAgentResponsePanel/AiAgentResponsePanel";
import { PanelLayout } from "../PanelLayout/PanelLayout";
import type { AiAgentActivityEvent } from "../AiAgentResponsePanel/AiAgentResponsePanel";
import type { PanelLayoutActivityContribution } from "../PanelLayout/PanelLayout";
import type { PanelLayout as PanelLayoutType } from "@ide/contracts";
import { DEFAULT_PANEL_LAYOUT } from "@ide/contracts";

// ── Helpers ─────────────────────────────────────────────────────────────

const defaultLayout: PanelLayoutType = {
  ...DEFAULT_PANEL_LAYOUT,
  visibility: {
    leftSidebar: { visible: true, active: false },
    mainArea: { visible: true, active: true },
    bottomPanel: { visible: true, active: false },
  },
  sizes: {
    leftSidebarWidth: 280,
    bottomPanelHeight: 250,
  },
  minSizes: {
    leftSidebarWidth: 160,
    bottomPanelHeight: 80,
  },
};

const responseActivities: AiAgentActivityEvent[] = [
  {
    id: "read-started",
    type: "tool_execution_start",
    title: "Read source file",
    pluginName: "filesystem",
    detail: "Opening the response panel component.",
    timestamp: "10:02",
    status: "running",
    agentId: "frontend-agent",
    runId: "run-123",
    changedFiles: [
      {
        path: "packages/ui/src/components/AiAgentResponsePanel/AiAgentResponsePanel.tsx",
        status: "modified",
      },
    ],
  },
  {
    id: "tests-finished",
    type: "test_complete",
    title: "Focused UI tests passed",
    detail: "Response panel tab coverage completed.",
    timestamp: "10:05",
    status: "success",
    agentId: "frontend-agent",
    runId: "run-123",
    changedFiles: [
      {
        path: "packages/ui/src/components/__tests__/PanelLayout.test.ts",
        status: "added",
      },
    ],
  },
];

function renderAiAgentResponsePanel(): void {
  render(
    React.createElement(AiAgentResponsePanel, {
      latestResponse: "The latest agent response is ready for review.",
      activities: responseActivities,
      isSending: false,
      onClose: vi.fn(),
    }),
  );
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("PanelLayout", () => {
  it("should render left sidebar content", () => {
    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", { "data-testid": "sidebar" }, "Sidebar Content"),
        mainContent: React.createElement("div", { "data-testid": "main" }, "Main Content"),
        bottomContent: React.createElement("div", { "data-testid": "bottom" }, "Bottom Content"),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    expect(screen.getByTestId("sidebar")).toBeDefined();
  });

  it("should render main content", () => {
    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", { "data-testid": "sidebar" }, "Sidebar"),
        mainContent: React.createElement("div", { "data-testid": "main" }, "Main Content"),
        bottomContent: React.createElement("div", { "data-testid": "bottom" }, "Bottom"),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    expect(screen.getByTestId("main")).toBeDefined();
  });

  it("should render bottom panel content", () => {
    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", { "data-testid": "sidebar" }, "Sidebar"),
        mainContent: React.createElement("div", { "data-testid": "main" }, "Main"),
        bottomContent: React.createElement("div", { "data-testid": "bottom" }, "Bottom Content"),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    expect(screen.getByTestId("bottom")).toBeDefined();
  });

  it("keeps full-height navigation beside the exact editor-side bottom host topology", () => {
    const { container } = render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", { "data-testid": "sidebar" }, "Sidebar"),
        searchActivityContent: React.createElement(
          "div",
          { "data-testid": "search-sidebar" },
          "Search results",
        ),
        activeActivity: "search",
        onActivityChange: vi.fn(),
        mainContent: React.createElement("div", { "data-testid": "main" }, "Main Editor"),
        bottomContent: React.createElement("div", { "data-testid": "terminal" }, "Terminal"),
        rightSidebarContent: React.createElement(
          "div",
          { "data-testid": "right-sidebar-content" },
          "AI Agent",
        ),
        statusBarLeft: React.createElement("span", { "data-testid": "status" }, "Ready"),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    const shell = container.querySelector(".ide-shell") as HTMLElement;
    const workspace = container.querySelector(".ide-workspace") as HTMLElement;
    const activityRail = screen.getByRole("navigation", { name: "Primary activity" });
    const searchSidebar = screen.getByRole("tabpanel", { name: "Search" });
    const verticalResizeHandle = screen.getByRole("separator", { name: "Resize file explorer" });
    const contentColumn = container.querySelector(".ide-content-column") as HTMLElement;
    const editorRow = container.querySelector(".ide-editor-row") as HTMLElement;
    const mainEditorPane = screen.getByRole("main", { name: "Editor area" });
    const rightSidebar = screen.getByRole("complementary", { name: "Secondary side panel" });
    const horizontalResizeHandle = screen.getByRole("separator", { name: "Resize bottom panel" });
    const bottomPanel = container.querySelector(".ide-bottom-panel") as HTMLDivElement;
    const statusBar = screen.getByTestId("status").closest(".statusbar") as HTMLElement;

    expect(Array.from(shell.children)).toEqual([workspace, statusBar]);
    expect(Array.from(workspace.children)).toEqual([
      activityRail,
      searchSidebar,
      verticalResizeHandle,
      contentColumn,
    ]);
    expect(searchSidebar.classList.contains("ide-sidebar")).toBe(true);
    expect(within(searchSidebar).getByTestId("search-sidebar")).toBeDefined();
    expect(Array.from(contentColumn.children)).toEqual([
      editorRow,
      horizontalResizeHandle,
      bottomPanel,
    ]);
    expect(Array.from(editorRow.children)).toEqual([mainEditorPane, rightSidebar]);
    expect(bottomPanel.parentElement).toBe(contentColumn);
    expect(bottomPanel.parentElement).not.toBe(workspace);
    expect(activityRail.contains(bottomPanel)).toBe(false);
    expect(searchSidebar.contains(bottomPanel)).toBe(false);
    expect(workspace.nextElementSibling).toBe(statusBar);

    expect(screen.getByTestId("terminal")).toBeDefined();
    expect(bottomPanel.hidden).toBe(false);
    expect(bottomPanel.getAttribute("aria-hidden")).toBe("false");
    expect(bottomPanel.style.height).toBe("250px");
    expect(bottomPanel.style.minHeight).toBe("80px");
    expect(bottomPanel.classList.contains("absolute")).toBe(false);
    expect(bottomPanel.classList.contains("fixed")).toBe(false);
    expect(contentColumn.classList.contains("flex-col")).toBe(true);
    expect(editorRow.classList.contains("flex-1")).toBe(true);
    expect(mainEditorPane.classList.contains("flex-1")).toBe(true);
    expect(mainEditorPane.classList.contains("min-h-0")).toBe(true);
    expect(mainEditorPane.classList.contains("overflow-hidden")).toBe(true);
  });

  it("keeps the optional right sidebar inside the editor row", () => {
    const { container } = render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", { "data-testid": "sidebar" }, "Sidebar"),
        mainContent: React.createElement("div", { "data-testid": "main" }, "Main Editor"),
        bottomContent: React.createElement("div", { "data-testid": "terminal" }, "Terminal"),
        rightSidebarContent: React.createElement(
          "div",
          { "data-testid": "right-sidebar-content" },
          "AI Agent",
        ),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    const editorRow = container.querySelector(".ide-editor-row") as HTMLElement;
    const mainEditorPane = screen.getByRole("main", { name: "Editor area" });
    const rightSidebar = screen.getByRole("complementary", {
      name: "Secondary side panel",
    }) as HTMLElement;

    expect(screen.getByTestId("right-sidebar-content")).toBeDefined();
    expect(Array.from(editorRow.children)).toEqual([mainEditorPane, rightSidebar]);
    expect(rightSidebar.parentElement).toBe(editorRow);
  });

  it("preserves separator ARIA values and keyboard resize behavior", () => {
    const onResizeLeft = vi.fn();
    const onResizeBottom = vi.fn();

    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Sidebar"),
        mainContent: React.createElement("div", null, "Main Editor"),
        bottomContent: React.createElement("div", null, "Terminal"),
        layout: defaultLayout,
        onResizeLeft,
        onResizeBottom,
      }),
    );

    const verticalResizeHandle = screen.getByRole("separator", { name: "Resize file explorer" });
    const horizontalResizeHandle = screen.getByRole("separator", { name: "Resize bottom panel" });

    expect(verticalResizeHandle.getAttribute("aria-orientation")).toBe("vertical");
    expect(verticalResizeHandle.getAttribute("aria-valuemin")).toBe("160");
    expect(verticalResizeHandle.getAttribute("aria-valuenow")).toBe("280");
    expect(verticalResizeHandle.tabIndex).toBe(0);
    expect(horizontalResizeHandle.getAttribute("aria-orientation")).toBe("horizontal");
    expect(horizontalResizeHandle.getAttribute("aria-valuemin")).toBe("80");
    expect(horizontalResizeHandle.getAttribute("aria-valuenow")).toBe("250");
    expect(horizontalResizeHandle.tabIndex).toBe(0);

    fireEvent.keyDown(verticalResizeHandle, { key: "ArrowLeft" });
    fireEvent.keyDown(verticalResizeHandle, { key: "ArrowRight" });
    fireEvent.keyDown(horizontalResizeHandle, { key: "ArrowUp" });
    fireEvent.keyDown(horizontalResizeHandle, { key: "ArrowDown" });

    expect(onResizeLeft.mock.calls).toEqual([[270], [290]]);
    expect(onResizeBottom.mock.calls).toEqual([[260], [240]]);
  });

  it("preserves drag resize behavior for both panel boundaries", () => {
    const onResizeLeft = vi.fn();
    const onResizeBottom = vi.fn();

    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Sidebar"),
        mainContent: React.createElement("div", null, "Main Editor"),
        bottomContent: React.createElement("div", null, "Terminal"),
        layout: defaultLayout,
        onResizeLeft,
        onResizeBottom,
      }),
    );

    const verticalResizeHandle = screen.getByRole("separator", { name: "Resize file explorer" });
    const horizontalResizeHandle = screen.getByRole("separator", { name: "Resize bottom panel" });

    fireEvent.mouseDown(verticalResizeHandle, { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 450 });
    expect(onResizeLeft).toHaveBeenLastCalledWith(330);
    fireEvent.mouseUp(document);

    fireEvent.mouseDown(verticalResizeHandle, { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 0 });
    expect(onResizeLeft).toHaveBeenLastCalledWith(160);
    fireEvent.mouseUp(document);

    fireEvent.mouseDown(horizontalResizeHandle, { clientY: 400 });
    fireEvent.mouseMove(document, { clientY: 350 });
    expect(onResizeBottom).toHaveBeenLastCalledWith(300);
    fireEvent.mouseUp(document);

    fireEvent.mouseDown(horizontalResizeHandle, { clientY: 400 });
    fireEvent.mouseMove(document, { clientY: 450 });
    expect(onResizeBottom).toHaveBeenLastCalledWith(200);
    fireEvent.mouseUp(document);
  });

  it("does not expose sidebar or bottom-panel toggles without their optional callbacks", () => {
    const hiddenLayout = {
      ...defaultLayout,
      visibility: {
        ...defaultLayout.visibility,
        leftSidebar: { visible: false, active: false },
        bottomPanel: { visible: false, active: false },
      },
    };

    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Sidebar Content"),
        mainContent: React.createElement("div", null, "Main"),
        bottomContent: React.createElement("div", null, "Bottom Content"),
        layout: hiddenLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    expect(screen.queryByRole("button", { name: "Expand sidebar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand bottom panel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Collapse bottom panel" })).toBeNull();
  });

  it("keeps a native Expand sidebar button when collapsed content is unmounted", () => {
    const onToggleLeftSidebar = vi.fn();
    const hiddenLayout = {
      ...defaultLayout,
      visibility: {
        ...defaultLayout.visibility,
        leftSidebar: { visible: false, active: false },
      },
    };

    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Sidebar Content"),
        mainContent: React.createElement("div", null, "Main"),
        bottomContent: React.createElement("div", null, "Bottom"),
        layout: hiddenLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
        onToggleLeftSidebar,
      }),
    );

    expect(screen.queryByText("Sidebar Content")).toBeNull();

    const expandSidebar = screen.getByRole("button", { name: "Expand sidebar" });
    expect(expandSidebar.tagName).toBe("BUTTON");
    expect(expandSidebar.getAttribute("aria-label")).toBe("Expand sidebar");
    expect(expandSidebar.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(expandSidebar);

    expect(onToggleLeftSidebar).toHaveBeenCalledTimes(1);
  });

  it("keeps the exact bottom toggle available in expanded and hidden states", () => {
    const onToggleBottomPanel = vi.fn();
    const createPanel = (showBottomPanel: boolean) =>
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Sidebar"),
        mainContent: React.createElement("div", null, "Main"),
        bottomContent: React.createElement("div", null, "Bottom Content"),
        layout: defaultLayout,
        showBottomPanel,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
        onToggleBottomPanel,
      });
    const { rerender } = render(createPanel(true));

    const collapseBottom = screen.getByRole("button", { name: "Collapse bottom panel" });
    expect(collapseBottom.closest(".statusbar")).not.toBeNull();
    expect(collapseBottom.getAttribute("aria-label")).toBe("Collapse bottom panel");
    expect(collapseBottom.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(collapseBottom);

    rerender(createPanel(false));

    const expandBottom = screen.getByRole("button", { name: "Expand bottom panel" });
    expect(expandBottom.closest(".statusbar")).not.toBeNull();
    expect(expandBottom.getAttribute("aria-label")).toBe("Expand bottom panel");
    expect(expandBottom.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expandBottom);

    expect(onToggleBottomPanel).toHaveBeenCalledTimes(2);
  });

  it("re-expands controlled panels without changing the editor-side bottom parent", () => {
    const collapsedLayout = {
      ...defaultLayout,
      visibility: {
        ...defaultLayout.visibility,
        leftSidebar: { visible: false, active: false },
      },
    };
    const createPanel = (layout: PanelLayoutType, showBottomPanel: boolean) =>
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Controlled Sidebar"),
        mainContent: React.createElement("div", null, "Main"),
        bottomContent: React.createElement("div", null, "Controlled Bottom"),
        layout,
        showBottomPanel,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
        onToggleLeftSidebar: vi.fn(),
        onToggleBottomPanel: vi.fn(),
      });
    const { container, rerender } = render(createPanel(collapsedLayout, false));
    const contentColumn = container.querySelector(".ide-content-column") as HTMLElement;
    const editorRow = container.querySelector(".ide-editor-row") as HTMLElement;
    const bottomPanel = container.querySelector(".ide-bottom-panel") as HTMLDivElement;

    expect(screen.queryByText("Controlled Sidebar")).toBeNull();
    expect(screen.queryByText("Controlled Bottom")).toBeNull();
    expect(Array.from(contentColumn.children)).toEqual([editorRow, bottomPanel]);
    expect(bottomPanel.parentElement).toBe(contentColumn);

    rerender(createPanel(defaultLayout, true));

    expect(screen.getByText("Controlled Sidebar")).toBeDefined();
    expect(screen.getByText("Controlled Bottom")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Expand sidebar" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Collapse bottom panel" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(Array.from(contentColumn.children)).toEqual([
      editorRow,
      screen.getByRole("separator", { name: "Resize bottom panel" }),
      bottomPanel,
    ]);
    expect(bottomPanel.parentElement).toBe(contentColumn);
  });

  it("should collapse the left sidebar without changing workspace sibling topology", () => {
    const hiddenLayout = {
      ...defaultLayout,
      visibility: {
        ...defaultLayout.visibility,
        leftSidebar: { visible: false, active: false },
      },
    };

    const { container } = render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", { "data-testid": "sidebar" }, "Sidebar Content"),
        mainContent: React.createElement("div", { "data-testid": "main" }, "Main"),
        bottomContent: React.createElement("div", { "data-testid": "bottom" }, "Bottom"),
        layout: hiddenLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    const workspace = container.querySelector(".ide-workspace") as HTMLElement;
    const activityRail = screen.getByRole("navigation", { name: "Primary activity" });
    const sidebar = screen.getByRole("tabpanel", { name: "Explorer" });
    const contentColumn = container.querySelector(".ide-content-column") as HTMLElement;

    expect(screen.queryByText("Sidebar Content")).toBeNull();
    expect(sidebar.style.width).toBe("0px");
    expect(sidebar.style.minWidth).toBe("0px");
    expect(screen.queryByRole("separator", { name: "Resize file explorer" })).toBeNull();
    expect(Array.from(workspace.children)).toEqual([activityRail, sidebar, contentColumn]);
  });

  it("should hide a layout-hidden bottom panel inside the content column", () => {
    const hiddenLayout = {
      ...defaultLayout,
      visibility: {
        ...defaultLayout.visibility,
        bottomPanel: { visible: false, active: false },
      },
    };

    const { container } = render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", { "data-testid": "sidebar" }, "Sidebar"),
        mainContent: React.createElement("div", { "data-testid": "main" }, "Main"),
        bottomContent: React.createElement("div", { "data-testid": "bottom" }, "Bottom Content"),
        layout: hiddenLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    const contentColumn = container.querySelector(".ide-content-column") as HTMLElement;
    const editorRow = container.querySelector(".ide-editor-row") as HTMLElement;
    const bottomPanel = container.querySelector(".ide-bottom-panel") as HTMLDivElement;

    expect(screen.queryByText("Bottom Content")).toBeNull();
    expect(screen.queryByRole("separator", { name: "Resize bottom panel" })).toBeNull();
    expect(Array.from(contentColumn.children)).toEqual([editorRow, bottomPanel]);
    expect(bottomPanel.hidden).toBe(true);
    expect(bottomPanel.getAttribute("aria-hidden")).toBe("true");
    expect(bottomPanel.style.height).toBe("0px");
    expect(bottomPanel.style.minHeight).toBe("0px");
    expect(bottomPanel.style.borderWidth).toBe("0px");
  });

  it("should keep a host-collapsed bottom panel hidden in the content column", () => {
    const { container } = render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Sidebar"),
        mainContent: React.createElement("div", null, "Main"),
        bottomContent: React.createElement("div", null, "Bottom Content"),
        showBottomPanel: false,
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    const contentColumn = container.querySelector(".ide-content-column") as HTMLElement;
    const editorRow = container.querySelector(".ide-editor-row") as HTMLElement;
    const bottomPanel = container.querySelector(".ide-bottom-panel") as HTMLDivElement;

    expect(screen.queryByText("Bottom Content")).toBeNull();
    expect(screen.queryByRole("separator", { name: "Resize bottom panel" })).toBeNull();
    expect(Array.from(contentColumn.children)).toEqual([editorRow, bottomPanel]);
    expect(bottomPanel.hidden).toBe(true);
    expect(bottomPanel.getAttribute("aria-hidden")).toBe("true");
    expect(bottomPanel.style.height).toBe("0px");
  });

  it("should always render main content regardless of visibility", () => {
    const layout = {
      ...defaultLayout,
      visibility: {
        leftSidebar: { visible: false, active: false },
        mainArea: { visible: true, active: true },
        bottomPanel: { visible: false, active: false },
      },
    };

    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Sidebar"),
        mainContent: React.createElement("div", { "data-testid": "main" }, "Main Content"),
        bottomContent: React.createElement("div", null, "Bottom"),
        layout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    expect(screen.getByTestId("main")).toBeDefined();
  });

  it("exposes the host-selected Search tab and labelled activity panel without taking ownership", () => {
    const onActivityChange = vi.fn();
    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Explorer files"),
        searchActivityContent: React.createElement("div", null, "Host semantic search"),
        activeActivity: "search",
        onActivityChange,
        mainContent: React.createElement("div", null, "Editor"),
        bottomContent: React.createElement("div", null, "Terminal"),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    const activityNavigation = screen.getByRole("navigation", { name: "Primary activity" });
    const tabList = within(activityNavigation).getByRole("tablist");
    const explorerTab = within(tabList).getByRole("tab", { name: "Explorer" });
    const searchTab = within(tabList).getByRole("tab", { name: "Search" });
    const docsTab = within(tabList).getByRole("tab", { name: "Docs" });
    const settingsTab = within(tabList).getByRole("tab", { name: "Settings" });
    const activityPanel = screen.getByRole("tabpanel", { name: "Search" });

    expect(tabList.getAttribute("aria-orientation")).toBe("vertical");
    expect(searchTab.getAttribute("aria-selected")).toBe("true");
    expect(searchTab.tabIndex).toBe(0);
    expect(explorerTab.getAttribute("aria-selected")).toBe("false");
    expect(explorerTab.tabIndex).toBe(-1);
    expect(searchTab.getAttribute("aria-controls")).toBe(activityPanel.id);
    expect(explorerTab.getAttribute("aria-controls")).toBe(activityPanel.id);
    expect(activityPanel.getAttribute("aria-labelledby")).toBe(searchTab.id);
    expect(within(activityPanel).getByText("Host semantic search")).toBeDefined();
    expect(docsTab.getAttribute("aria-disabled")).toBe("true");
    expect(settingsTab.getAttribute("aria-disabled")).toBe("true");
    expect(docsTab.getAttribute("aria-controls")).toBeNull();
    expect(settingsTab.getAttribute("aria-controls")).toBeNull();

    fireEvent.click(explorerTab);

    expect(onActivityChange).toHaveBeenCalledWith("explorer");
    expect(searchTab.getAttribute("aria-selected")).toBe("true");
    expect(within(activityPanel).getByText("Host semantic search")).toBeDefined();
  });

  it("requests keyboard activity changes and moves focus while leaving selection host-controlled", () => {
    const onActivityChange = vi.fn();
    const createLayout = (activeActivity: "explorer" | "search") =>
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Explorer files"),
        searchActivityContent: React.createElement("div", null, "Host semantic search"),
        activeActivity,
        onActivityChange,
        mainContent: React.createElement("div", null, "Editor"),
        bottomContent: React.createElement("div", null, "Terminal"),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      });
    const { rerender } = render(createLayout("search"));
    const searchTab = screen.getByRole("tab", { name: "Search" });
    const explorerTab = screen.getByRole("tab", { name: "Explorer" });

    searchTab.focus();
    fireEvent.keyDown(searchTab, { key: "ArrowLeft" });

    expect(onActivityChange).toHaveBeenLastCalledWith("explorer");
    expect(document.activeElement).toBe(explorerTab);
    expect(searchTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Search" })).toBeDefined();

    rerender(createLayout("explorer"));

    expect(explorerTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Explorer" })).toBeDefined();
    fireEvent.keyDown(explorerTab, { key: "ArrowRight" });
    expect(onActivityChange).toHaveBeenLastCalledWith("search");
    expect(document.activeElement).toBe(searchTab);
    expect(explorerTab.getAttribute("aria-selected")).toBe("true");
  });

  it("renders valid contribution descriptors in deterministic input order with exact accessible linkage", () => {
    const contributions = [
      {
        id: "xcom2-project",
        label: "XCOM 2 Project",
        title: "Inspect XCOM 2 project recognition",
        content: React.createElement("div", null, "Recognition evidence"),
      },
      {
        id: "database",
        label: "Database",
        content: React.createElement("div", null, "Database browser"),
      },
    ] as const satisfies readonly Readonly<PanelLayoutActivityContribution>[];

    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Explorer files"),
        searchActivityContent: React.createElement("div", null, "Search results"),
        activityContributions: contributions,
        activeActivity: "xcom2-project",
        onActivityChange: vi.fn(),
        mainContent: React.createElement("div", null, "Editor"),
        bottomContent: React.createElement("div", null, "Terminal"),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    const navigation = screen.getByRole("navigation", { name: "Primary activity" });
    const tabs = within(navigation).getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Explorer",
      "Search",
      "XCOM 2 Project",
      "Database",
      "Docs",
      "Settings",
    ]);

    const explorerTab = within(navigation).getByRole("tab", { name: "Explorer" });
    const searchTab = within(navigation).getByRole("tab", { name: "Search" });
    const xcomTab = within(navigation).getByRole("tab", { name: "XCOM 2 Project" });
    const databaseTab = within(navigation).getByRole("tab", { name: "Database" });
    const docsTab = within(navigation).getByRole("tab", { name: "Docs" });
    const settingsTab = within(navigation).getByRole("tab", { name: "Settings" });
    const panel = screen.getByRole("tabpanel", { name: "XCOM 2 Project" });

    expect(xcomTab.title).toBe("Inspect XCOM 2 project recognition");
    expect(databaseTab.title).toBe("Database");
    expect(xcomTab.getAttribute("aria-selected")).toBe("true");
    expect(xcomTab.tabIndex).toBe(0);
    expect(panel.getAttribute("aria-labelledby")).toBe(xcomTab.id);
    for (const tab of [explorerTab, searchTab, xcomTab, databaseTab]) {
      expect(tab.getAttribute("aria-controls")).toBe(panel.id);
    }
    expect(docsTab.getAttribute("aria-controls")).toBeNull();
    expect(settingsTab.getAttribute("aria-controls")).toBeNull();
    expect(within(panel).getByText("Recognition evidence")).toBeDefined();
  });

  it("rejects every reserved contribution descriptor", () => {
    const reservedContributions = ["explorer", "search", "docs", "settings"].map((id) => ({
      id,
      label: `Injected ${id}`,
      content: React.createElement("div", null, `Injected ${id} content`),
    }));

    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Explorer files"),
        activityContributions: reservedContributions,
        activeActivity: "docs",
        onActivityChange: vi.fn(),
        mainContent: React.createElement("div", null, "Editor"),
        bottomContent: React.createElement("div", null, "Terminal"),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    const navigation = screen.getByRole("navigation", { name: "Primary activity" });
    expect(within(navigation).getAllByRole("tab")).toHaveLength(4);
    for (const id of ["explorer", "search", "docs", "settings"]) {
      expect(within(navigation).queryByRole("tab", { name: `Injected ${id}` })).toBeNull();
      expect(screen.queryByText(`Injected ${id} content`)).toBeNull();
    }
    expect(screen.getByRole("tabpanel", { name: "Explorer" })).toBeDefined();
  });

  it("keeps only the first duplicate contribution descriptor", () => {
    const duplicateContributions = [
      {
        id: "xcom2-project",
        label: "XCOM 2 Project",
        content: React.createElement("div", null, "First recognition panel"),
      },
      {
        id: "xcom2-project",
        label: "Duplicate XCOM 2 Project",
        content: React.createElement("div", null, "Duplicate recognition panel"),
      },
    ];

    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Explorer files"),
        activityContributions: duplicateContributions,
        activeActivity: "xcom2-project",
        onActivityChange: vi.fn(),
        mainContent: React.createElement("div", null, "Editor"),
        bottomContent: React.createElement("div", null, "Terminal"),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    expect(screen.getAllByRole("tab", { name: "XCOM 2 Project" })).toHaveLength(1);
    expect(screen.queryByRole("tab", { name: "Duplicate XCOM 2 Project" })).toBeNull();
    const panel = screen.getByRole("tabpanel", { name: "XCOM 2 Project" });
    expect(within(panel).getByText("First recognition panel")).toBeDefined();
    expect(within(panel).queryByText("Duplicate recognition panel")).toBeNull();
  });

  it("provides roving Arrow, Home, End, wrap, and Enter keyboard behavior", async () => {
    const user = userEvent.setup();
    const onActivityChange = vi.fn();
    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Explorer files"),
        searchActivityContent: React.createElement("div", null, "Search results"),
        activityContributions: [
          {
            id: "xcom2-project",
            label: "XCOM 2 Project",
            content: React.createElement("div", null, "Recognition evidence"),
          },
          {
            id: "database",
            label: "Database",
            content: React.createElement("div", null, "Database browser"),
          },
        ],
        activeActivity: "explorer",
        onActivityChange,
        mainContent: React.createElement("div", null, "Editor"),
        bottomContent: React.createElement("div", null, "Terminal"),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    const explorerTab = screen.getByRole("tab", { name: "Explorer" });
    const searchTab = screen.getByRole("tab", { name: "Search" });
    const xcomTab = screen.getByRole("tab", { name: "XCOM 2 Project" });
    const databaseTab = screen.getByRole("tab", { name: "Database" });

    explorerTab.focus();
    fireEvent.keyDown(explorerTab, { key: "ArrowRight" });
    expect(document.activeElement).toBe(searchTab);
    fireEvent.keyDown(searchTab, { key: "ArrowDown" });
    expect(document.activeElement).toBe(xcomTab);
    fireEvent.keyDown(xcomTab, { key: "ArrowUp" });
    expect(document.activeElement).toBe(searchTab);
    fireEvent.keyDown(searchTab, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(explorerTab);
    fireEvent.keyDown(explorerTab, { key: "ArrowUp" });
    expect(document.activeElement).toBe(databaseTab);
    fireEvent.keyDown(databaseTab, { key: "ArrowDown" });
    expect(document.activeElement).toBe(explorerTab);
    fireEvent.keyDown(explorerTab, { key: "End" });
    expect(document.activeElement).toBe(databaseTab);
    fireEvent.keyDown(databaseTab, { key: "Home" });
    expect(document.activeElement).toBe(explorerTab);

    xcomTab.focus();
    await user.keyboard("{Enter}");

    expect(onActivityChange.mock.calls.map(([activity]) => activity)).toEqual([
      "search",
      "xcom2-project",
      "search",
      "explorer",
      "database",
      "explorer",
      "database",
      "explorer",
      "xcom2-project",
    ]);
    expect(explorerTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Explorer" })).toBeDefined();
  });

  it("keeps contributed activity content controlled by the host", () => {
    const onActivityChange = vi.fn();
    const contributions = [
      {
        id: "xcom2-project",
        label: "XCOM 2 Project",
        content: React.createElement("div", null, "Recognition evidence"),
      },
    ];
    const createLayout = (activeActivity: string) =>
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Explorer files"),
        activityContributions: contributions,
        activeActivity,
        onActivityChange,
        mainContent: React.createElement("div", null, "Editor"),
        bottomContent: React.createElement("div", null, "Terminal"),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      });
    const { rerender } = render(createLayout("explorer"));
    const xcomTab = screen.getByRole("tab", { name: "XCOM 2 Project" });

    fireEvent.click(xcomTab);

    expect(onActivityChange).toHaveBeenCalledWith("xcom2-project");
    expect(screen.getByRole("tabpanel", { name: "Explorer" })).toBeDefined();
    expect(screen.queryByText("Recognition evidence")).toBeNull();

    rerender(createLayout("xcom2-project"));

    expect(xcomTab.getAttribute("aria-selected")).toBe("true");
    expect(
      within(screen.getByRole("tabpanel", { name: "XCOM 2 Project" })).getByText(
        "Recognition evidence",
      ),
    ).toBeDefined();
  });

  it("falls back to Explorer after the selected contribution is removed", () => {
    const createLayout = (
      activityContributions: readonly Readonly<PanelLayoutActivityContribution>[],
    ) =>
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Explorer fallback"),
        activityContributions,
        activeActivity: "xcom2-project",
        onActivityChange: vi.fn(),
        mainContent: React.createElement("div", null, "Editor"),
        bottomContent: React.createElement("div", null, "Terminal"),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      });
    const contribution = {
      id: "xcom2-project",
      label: "XCOM 2 Project",
      content: React.createElement("div", null, "Recognition evidence"),
    };
    const { rerender } = render(createLayout([contribution]));

    expect(screen.getByRole("tabpanel", { name: "XCOM 2 Project" })).toBeDefined();

    rerender(createLayout([]));

    expect(screen.queryByRole("tab", { name: "XCOM 2 Project" })).toBeNull();
    const explorerTab = screen.getByRole("tab", { name: "Explorer" });
    const panel = screen.getByRole("tabpanel", { name: "Explorer" });
    expect(explorerTab.getAttribute("aria-selected")).toBe("true");
    expect(explorerTab.tabIndex).toBe(0);
    expect(panel.getAttribute("aria-labelledby")).toBe(explorerTab.id);
    expect(within(panel).getByText("Explorer fallback")).toBeDefined();
  });

  it("does not mutate the contribution array or its readonly descriptors", () => {
    const contribution = Object.freeze({
      id: "xcom2-project",
      label: "XCOM 2 Project",
      title: "Recognition",
      content: React.createElement("div", null, "Recognition evidence"),
    });
    const contributions = Object.freeze([contribution]);

    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Explorer files"),
        activityContributions: contributions,
        activeActivity: "xcom2-project",
        onActivityChange: vi.fn(),
        mainContent: React.createElement("div", null, "Editor"),
        bottomContent: React.createElement("div", null, "Terminal"),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    expect(contributions).toEqual([contribution]);
    expect(contributions[0]).toBe(contribution);
    expect(Object.isFrozen(contributions)).toBe(true);
    expect(Object.isFrozen(contribution)).toBe(true);
  });

  it("keeps Search unavailable when the host does not provide activity control", () => {
    render(
      React.createElement(PanelLayout, {
        leftSidebar: React.createElement("div", null, "Explorer files"),
        searchActivityContent: React.createElement("div", null, "Host semantic search"),
        activeActivity: "search",
        mainContent: React.createElement("div", null, "Editor"),
        bottomContent: React.createElement("div", null, "Terminal"),
        layout: defaultLayout,
        onResizeLeft: vi.fn(),
        onResizeBottom: vi.fn(),
      }),
    );

    const searchTab = screen.getByRole("tab", { name: "Search" });
    const explorerTab = screen.getByRole("tab", { name: "Explorer" });

    expect(searchTab.getAttribute("aria-disabled")).toBe("true");
    expect((searchTab as HTMLButtonElement).disabled).toBe(true);
    expect(explorerTab.getAttribute("aria-selected")).toBe("true");
    expect(
      within(screen.getByRole("tabpanel", { name: "Explorer" })).getByText("Explorer files"),
    ).toBeDefined();
  });
});

describe("AiAgentResponsePanel tabs", () => {
  it("shows the latest response on the Response tab by default", () => {
    renderAiAgentResponsePanel();

    const responseTab = screen.getByRole("tab", { name: "Response" });
    const responsePanel = screen.getByRole("tabpanel", { name: "Response" });

    expect(responseTab.getAttribute("aria-selected")).toBe("true");
    expect(within(responsePanel).getByText("Latest response")).toBeDefined();
    expect(
      within(responsePanel).getByText("The latest agent response is ready for review."),
    ).toBeDefined();
  });

  it("selects the Activity tab and shows activity items", () => {
    renderAiAgentResponsePanel();

    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    const activityTab = screen.getByRole("tab", { name: "Activity" });
    const activityPanel = screen.getByRole("tabpanel", { name: "Activity" });

    expect(activityTab.getAttribute("aria-selected")).toBe("true");
    expect(within(activityPanel).getByRole("list", { name: "AI Agent activity" })).toBeDefined();
    expect(within(activityPanel).getByText("Read source file")).toBeDefined();
    expect(within(activityPanel).getByText("Opening the response panel component.")).toBeDefined();
  });

  it("selects the Agents tab and summarizes the provided agent", () => {
    renderAiAgentResponsePanel();

    fireEvent.click(screen.getByRole("tab", { name: "Agents" }));

    const agentsPanel = screen.getByRole("tabpanel", { name: "Agents" });
    const agentsList = within(agentsPanel).getByRole("list", {
      name: "AI Agent activity by agent",
    });

    expect(within(agentsList).getByText("frontend-agent")).toBeDefined();
    expect(within(agentsList).getByText("2 events")).toBeDefined();
    expect(within(agentsList).getByText("run-123")).toBeDefined();
  });

  it("selects the Changes tab and summarizes changed files", () => {
    renderAiAgentResponsePanel();

    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));

    const changesPanel = screen.getByRole("tabpanel", { name: "Changes" });
    const changesList = within(changesPanel).getByRole("list", { name: "AI Agent changed files" });

    expect(
      within(changesList).getByText(
        "packages/ui/src/components/AiAgentResponsePanel/AiAgentResponsePanel.tsx",
      ),
    ).toBeDefined();
    expect(within(changesList).getByText("modified")).toBeDefined();
    expect(
      within(changesList).getByText("packages/ui/src/components/__tests__/PanelLayout.test.ts"),
    ).toBeDefined();
    expect(within(changesList).getByText("added")).toBeDefined();
  });
});
