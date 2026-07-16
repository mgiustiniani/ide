/* global document, HTMLElement, HTMLButtonElement */
// This function is plain JavaScript so WebDriver can serialize it without transpiler helpers.

/**
 * @param {{ change: string, headerSelector?: string }} input
 * @returns {import("./application-content-layout.js").LayoutSnapshot}
 */
export function captureApplicationLayoutFromDocument({ change, headerSelector }) {
  /** @param {string} selector */
  const required = (selector) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Required layout element is absent: ${selector}`);
    }
    return element;
  };
  /** @param {HTMLElement} element */
  const measure = (element) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      left: bounds.left,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      hidden: element.hidden,
      ariaHidden: element.getAttribute("aria-hidden"),
    };
  };
  /** @param {string} label */
  const separator = (label) => {
    const element = [...document.querySelectorAll("[role='separator']")].find(
      (candidate) => candidate.getAttribute("aria-label") === label,
    );
    if (!(element instanceof HTMLElement)) return undefined;
    return {
      label: element.getAttribute("aria-label"),
      orientation: element.getAttribute("aria-orientation"),
      valueMin: Number(element.getAttribute("aria-valuemin")),
      valueNow: Number(element.getAttribute("aria-valuenow")),
      tabIndex: element.tabIndex,
    };
  };
  /** @param {readonly string[]} labels */
  const toggle = (labels) => {
    const element = [...document.querySelectorAll("button")].find((candidate) =>
      labels.includes(candidate.getAttribute("aria-label") ?? ""),
    );
    if (!(element instanceof HTMLButtonElement)) return undefined;
    return {
      label: element.getAttribute("aria-label"),
      expanded: element.getAttribute("aria-expanded"),
      tabIndex: element.tabIndex,
    };
  };

  const shell = required(".ide-shell");
  const workspace = required(".ide-workspace");
  const activityRail = required(".activity-rail");
  const sidebar = required(".ide-sidebar");
  const contentColumn = required(".ide-content-column");
  const editor = required(".ide-main-editor-pane");
  const bottomPanel = required(".ide-bottom-panel");
  const statusBar = required(".ide-shell > .statusbar");
  const editorRow = required(".ide-editor-row");
  const headerCandidate = headerSelector ? document.querySelector(headerSelector) : null;
  const header = headerCandidate instanceof HTMLElement ? headerCandidate : null;
  const verticalSeparator = separator("Resize file explorer");
  const horizontalSeparator = separator("Resize bottom panel");
  const sidebarToggle = toggle(["Collapse sidebar", "Expand sidebar"]);
  const bottomPanelToggle = toggle(["Collapse bottom panel", "Expand bottom panel"]);

  return {
    change,
    viewport: {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    },
    ...(header ? { header: measure(header) } : {}),
    shell: measure(shell),
    workspace: measure(workspace),
    activityRail: measure(activityRail),
    sidebar: measure(sidebar),
    contentColumn: measure(contentColumn),
    editor: measure(editor),
    bottomPanel: measure(bottomPanel),
    statusBar: measure(statusBar),
    ...(verticalSeparator ? { verticalSeparator } : {}),
    ...(horizontalSeparator ? { horizontalSeparator } : {}),
    ...(sidebarToggle ? { sidebarToggle } : {}),
    ...(bottomPanelToggle ? { bottomPanelToggle } : {}),
    topology: {
      activityRailInWorkspace: activityRail.parentElement === workspace,
      sidebarInWorkspace: sidebar.parentElement === workspace,
      contentColumnInWorkspace: contentColumn.parentElement === workspace,
      editorRowInContentColumn: editorRow.parentElement === contentColumn,
      editorInEditorRow: editor.parentElement === editorRow,
      bottomPanelInContentColumn: bottomPanel.parentElement === contentColumn,
    },
  };
}
