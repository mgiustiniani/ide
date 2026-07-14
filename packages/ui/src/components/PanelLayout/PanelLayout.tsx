// ---------------------------------------------------------------------------
// @ide/ui – PanelLayout
// Main layout component: IDE shell layout with activity rail, sidebar, main
// editor area, optional bottom panel, and status bar. Features: smooth CSS
// transitions on collapse/expand and stable flex sizing for embedded editors.
// ---------------------------------------------------------------------------

import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";
import type { PanelLayout as PanelLayoutType } from "@ide/contracts";

export type PanelLayoutActivity = "explorer" | "search";
type ActivityRailTabId = PanelLayoutActivity | "docs" | "settings";

interface ActivityRailTab {
  id: ActivityRailTabId;
  label: string;
  isActive: boolean;
  disabled?: boolean;
}

export interface PanelLayoutProps {
  /** Left sidebar content used by the default Explorer activity. */
  leftSidebar: ReactNode;
  /** Optional host-composed content for the generic Search activity. */
  searchActivityContent?: ReactNode;
  /** Host-controlled selected activity. Defaults to Explorer. */
  activeActivity?: PanelLayoutActivity;
  /** Enables activity selection when supplied with searchActivityContent. */
  onActivityChange?: (activity: PanelLayoutActivity) => void;
  /** Main content area (editor). */
  mainContent: ReactNode;
  /** Bottom panel content (terminal). */
  bottomContent: ReactNode;
  /** Current layout state. */
  layout: PanelLayoutType;
  /** Called when the user resizes the left sidebar width. */
  onResizeLeft: (width: number) => void;
  /** Called when the user resizes the bottom panel height. */
  onResizeBottom: (height: number) => void;
  /** Optional status bar content (left section). */
  statusBarLeft?: ReactNode;
  /** Optional status bar content (right section). */
  statusBarRight?: ReactNode;
  /** Optional side panel rendered directly next to the editor. */
  rightSidebarContent?: ReactNode;
  /** Width for the optional right side panel. */
  rightSidebarWidth?: number;
  /** Minimum width for the optional right side panel. */
  rightSidebarMinWidth?: number;
  /** Accessible label for the optional right side panel wrapper. */
  rightSidebarAriaLabel?: string;
  /**
   * Render the bottom panel when layout visibility also allows it.
   * Defaults to true so the terminal is visible in the default IDE layout.
   */
  showBottomPanel?: boolean;
}

export function PanelLayout({
  leftSidebar,
  searchActivityContent,
  activeActivity = "explorer",
  onActivityChange,
  mainContent,
  bottomContent,
  layout,
  onResizeLeft,
  onResizeBottom,
  statusBarLeft,
  statusBarRight,
  rightSidebarContent,
  rightSidebarWidth = 420,
  rightSidebarMinWidth = 320,
  rightSidebarAriaLabel = "Secondary side panel",
  showBottomPanel = true,
}: PanelLayoutProps): JSX.Element {
  const activityIdPrefix = useId();
  const activityTabRefs = useRef<Record<PanelLayoutActivity, HTMLButtonElement | null>>({
    explorer: null,
    search: null,
  });
  const { visibility, sizes, minSizes } = layout;

  const searchEnabled = searchActivityContent !== undefined && Boolean(onActivityChange);
  const selectedActivity: PanelLayoutActivity =
    activeActivity === "search" && searchEnabled ? "search" : "explorer";
  const selectedActivityContent =
    selectedActivity === "search" ? searchActivityContent : leftSidebar;
  const activityPanelId = `${activityIdPrefix}-activity-panel`;
  const activityTabs: ActivityRailTab[] = [
    { id: "explorer", label: "Explorer", isActive: selectedActivity === "explorer" },
    {
      id: "search",
      label: "Search",
      isActive: selectedActivity === "search",
      disabled: !searchEnabled,
    },
    { id: "docs", label: "Docs", isActive: false, disabled: true },
    { id: "settings", label: "Settings", isActive: false, disabled: true },
  ];

  const handleActivityKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    activity: PanelLayoutActivity,
  ): void => {
    if (!searchEnabled) return;

    const activities: PanelLayoutActivity[] = ["explorer", "search"];
    const currentIndex = activities.indexOf(activity);
    let nextActivity: PanelLayoutActivity | undefined;

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextActivity = activities[(currentIndex - 1 + activities.length) % activities.length];
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextActivity = activities[(currentIndex + 1) % activities.length];
    } else if (event.key === "Home") {
      nextActivity = activities[0];
    } else if (event.key === "End") {
      nextActivity = activities[activities.length - 1];
    }

    if (nextActivity) {
      event.preventDefault();
      activityTabRefs.current[nextActivity]?.focus();
      onActivityChange?.(nextActivity);
    }
  };

  const sidebarVisible = visibility.leftSidebar.visible;
  const bottomMounted = visibility.bottomPanel.visible;
  const bottomExpanded = showBottomPanel && bottomMounted;
  const sidebarWidth = sidebarVisible ? sizes.leftSidebarWidth : 0;
  const bottomHeight = bottomExpanded ? sizes.bottomPanelHeight : 0;
  const rightSidebarVisible = Boolean(rightSidebarContent);
  const rightSidebarResponsiveMinWidth = `min(${rightSidebarMinWidth}px, 50%)`;
  const rightSidebarResponsiveMaxWidth = `min(${rightSidebarWidth}px, 50%)`;

  return (
    <div className="ide-shell h-full w-full min-h-0 min-w-0 overflow-hidden flex flex-col">
      {/* Main content area: activity rail + sidebar + editor */}
      <div className="ide-workspace flex-1 min-h-0 min-w-0 flex overflow-hidden">
        {/* Kate/KDE-style side tabs. Docs and Settings remain placeholders. */}
        <nav className="activity-rail" aria-label="Primary activity">
          <div className="activity-rail-tabs" role="tablist" aria-orientation="vertical">
            {activityTabs.map((tab) => {
              const selectableActivity =
                tab.id === "explorer" || tab.id === "search" ? tab.id : undefined;

              return (
                <button
                  key={tab.id}
                  id={`${activityIdPrefix}-${tab.id}-tab`}
                  ref={
                    selectableActivity
                      ? (element) => {
                          activityTabRefs.current[selectableActivity] = element;
                        }
                      : undefined
                  }
                  type="button"
                  className={`activity-rail-tab ${tab.isActive ? "activity-rail-tab--active" : ""}`}
                  role="tab"
                  tabIndex={tab.isActive ? 0 : -1}
                  aria-selected={tab.isActive}
                  aria-controls={tab.disabled ? undefined : activityPanelId}
                  aria-disabled={tab.disabled ? true : undefined}
                  aria-label={tab.label}
                  disabled={tab.disabled}
                  title={tab.disabled ? `${tab.label} (coming soon)` : tab.label}
                  onClick={
                    selectableActivity ? () => onActivityChange?.(selectableActivity) : undefined
                  }
                  onKeyDown={
                    selectableActivity
                      ? (event) => handleActivityKeyDown(event, selectableActivity)
                      : undefined
                  }
                >
                  <span className="activity-rail-label" aria-hidden="true" data-label={tab.label} />
                </button>
              );
            })}
          </div>
        </nav>

        {/* Left sidebar with smooth width transition */}
        <div
          id={activityPanelId}
          className="ide-sidebar relative min-h-0 overflow-hidden bg-[var(--surface-sidebar)] panel-transition-width glass-panel panel-shadow"
          role="tabpanel"
          aria-labelledby={`${activityIdPrefix}-${selectedActivity}-tab`}
          style={{
            width: sidebarWidth,
            minWidth: sidebarWidth > 0 ? minSizes.leftSidebarWidth : 0,
            minHeight: 0,
            flexShrink: 0,
          }}
        >
          <div className="h-full min-h-0 w-full min-w-0 panel-transition-opacity">
            {sidebarVisible ? selectedActivityContent : null}
          </div>
        </div>

        {/* Vertical resize handle (visible when sidebar is shown) */}
        {sidebarVisible && (
          <div
            className="resize-handle resize-handle--vertical cursor-col-resize gradient-accent"
            role="separator"
            tabIndex={0}
            aria-label="Resize file explorer"
            aria-orientation="vertical"
            aria-valuemin={minSizes.leftSidebarWidth}
            aria-valuenow={sizes.leftSidebarWidth}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                const delta = e.key === "ArrowLeft" ? -10 : 10;
                onResizeLeft(Math.max(minSizes.leftSidebarWidth, sizes.leftSidebarWidth + delta));
              }
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              startResize(
                "horizontal",
                e.clientX,
                sizes.leftSidebarWidth,
                minSizes.leftSidebarWidth,
                onResizeLeft,
              );
            }}
          />
        )}

        {/* Editor-side column: editor row above bottom tool windows. */}
        <div className="ide-content-column flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="ide-editor-row flex flex-1 min-h-0 min-w-0 overflow-hidden">
            {/* Main editor area */}
            <main
              className="ide-main-editor-pane flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden bg-[var(--surface-editor)] panel-shadow"
              aria-label="Editor area"
            >
              {mainContent}
            </main>

            {rightSidebarVisible && (
              <aside
                className="ide-right-sidebar-pane min-h-0 min-w-0 max-w-full overflow-hidden bg-[var(--surface-sidebar)] panel-shadow"
                aria-label={rightSidebarAriaLabel}
                style={{
                  width: rightSidebarWidth,
                  minWidth: rightSidebarResponsiveMinWidth,
                  maxWidth: rightSidebarResponsiveMaxWidth,
                  flexShrink: 1,
                }}
              >
                {rightSidebarContent}
              </aside>
            )}
          </div>

          {/* Horizontal resize handle (visible only when bottom panel is expanded) */}
          {bottomExpanded && (
            <div
              className="resize-handle resize-handle--horizontal cursor-row-resize gradient-accent"
              role="separator"
              tabIndex={0}
              aria-label="Resize bottom panel"
              aria-orientation="horizontal"
              aria-valuemin={minSizes.bottomPanelHeight}
              aria-valuenow={sizes.bottomPanelHeight}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const delta = e.key === "ArrowUp" ? 10 : -10;
                  onResizeBottom(
                    Math.max(minSizes.bottomPanelHeight, sizes.bottomPanelHeight + delta),
                  );
                }
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                startResize(
                  "vertical",
                  e.clientY,
                  sizes.bottomPanelHeight,
                  minSizes.bottomPanelHeight,
                  onResizeBottom,
                );
              }}
            />
          )}

          {/* Bottom panel with smooth height transition */}
          <div
            className="ide-bottom-panel min-w-0 overflow-hidden bg-[var(--surface-panel)] panel-transition-height glass-panel panel-shadow"
            hidden={!bottomExpanded}
            aria-hidden={!bottomExpanded}
            style={{
              height: bottomHeight,
              minHeight: bottomHeight > 0 ? minSizes.bottomPanelHeight : 0,
              flexShrink: 0,
              boxSizing: "border-box",
              borderWidth: bottomExpanded ? undefined : 0,
            }}
          >
            <div className="h-full min-h-0 w-full min-w-0 panel-transition-opacity">
              {bottomExpanded ? bottomContent : null}
            </div>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="statusbar statusbar-gradient">
        <div className="statusbar-left">{statusBarLeft}</div>
        <div className="statusbar-right">{statusBarRight}</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Drag‑to‑resize helper
 * --------------------------------------------------------------------------- */

function startResize(
  direction: "horizontal" | "vertical",
  startPos: number,
  startSize: number,
  minSize: number,
  onResize: (newSize: number) => void,
): void {
  const initialPos = startPos;
  const initialSize = startSize;

  const handleMouseMove = (e: MouseEvent) => {
    const delta = direction === "horizontal" ? e.clientX - initialPos : initialPos - e.clientY;
    const newSize = Math.max(minSize, initialSize + delta);
    onResize(newSize);
  };

  const handleMouseUp = () => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
  document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
  document.body.style.userSelect = "none";
}
