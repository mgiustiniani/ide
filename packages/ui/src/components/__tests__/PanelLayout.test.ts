// ---------------------------------------------------------------------------
// @ide/ui – PanelLayout Component Tests
// ---------------------------------------------------------------------------
// Tests that PanelLayout renders three panels, handles resize callbacks,
// and hides panels based on visibility.
// ---------------------------------------------------------------------------

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AiAgentResponsePanel } from "../AiAgentResponsePanel/AiAgentResponsePanel";
import { PanelLayout } from "../PanelLayout/PanelLayout";
import type { AiAgentActivityEvent } from "../AiAgentResponsePanel/AiAgentResponsePanel";
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
