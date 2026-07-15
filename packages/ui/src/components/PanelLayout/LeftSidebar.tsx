// ---------------------------------------------------------------------------
// @ide/ui – LeftSidebar
// Resizable-shell-compatible sidebar with independently collapsible sections.
// ---------------------------------------------------------------------------

import { useId, useState, type ReactNode } from "react";
import { Icon } from "../ui/Icon";

export interface LeftSidebarProps {
  /** Title displayed in the sidebar title bar. */
  title?: string;
  /** Whether the whole sidebar is visible. */
  isVisible: boolean;
  /** Called to toggle whole-sidebar visibility. */
  onToggle: () => void;
  /** File explorer content. */
  children: ReactNode;
  /** Optional workspace explorer content. Omitting it preserves the single-section layout. */
  workspaceContent?: ReactNode;
  /** Controlled expanded state for the Files section. */
  filesExpanded?: boolean;
  /** Initial Files state when uncontrolled. */
  defaultFilesExpanded?: boolean;
  /** Called whenever the Files section requests an expanded-state change. */
  onFilesExpandedChange?: (expanded: boolean) => void;
  /** Controlled expanded state for the Workspaces section. */
  workspacesExpanded?: boolean;
  /** Initial Workspaces state when uncontrolled. */
  defaultWorkspacesExpanded?: boolean;
  /** Called whenever the Workspaces section requests an expanded-state change. */
  onWorkspacesExpandedChange?: (expanded: boolean) => void;
  /** Accessible/display labels for the accordion sections. */
  filesTitle?: string;
  workspacesTitle?: string;
}

export function LeftSidebar({
  title = "Explorer",
  isVisible,
  onToggle,
  children,
  workspaceContent,
  filesExpanded,
  defaultFilesExpanded = true,
  onFilesExpandedChange,
  workspacesExpanded,
  defaultWorkspacesExpanded = true,
  onWorkspacesExpandedChange,
  filesTitle = "File Explorer",
  workspacesTitle = "Workspace Explorer",
}: LeftSidebarProps): JSX.Element {
  const generatedId = useId().replace(/:/g, "");
  const [internalFilesExpanded, setInternalFilesExpanded] = useState(defaultFilesExpanded);
  const [internalWorkspacesExpanded, setInternalWorkspacesExpanded] =
    useState(defaultWorkspacesExpanded);
  const filesOpen = filesExpanded ?? internalFilesExpanded;
  const workspacesOpen = workspacesExpanded ?? internalWorkspacesExpanded;
  const hasWorkspaces = workspaceContent !== undefined && workspaceContent !== null;
  const filesPanelId = `left-sidebar-files-${generatedId}`;
  const workspacesPanelId = `left-sidebar-workspaces-${generatedId}`;

  const setFilesOpen = (next: boolean) => {
    if (filesExpanded === undefined) setInternalFilesExpanded(next);
    onFilesExpandedChange?.(next);
  };
  const setWorkspacesOpen = (next: boolean) => {
    if (workspacesExpanded === undefined) setInternalWorkspacesExpanded(next);
    onWorkspacesExpandedChange?.(next);
  };

  const layoutState = hasWorkspaces
    ? filesOpen && workspacesOpen
      ? "both-open"
      : filesOpen
        ? "files-only"
        : workspacesOpen
          ? "workspaces-only"
          : "both-closed"
    : filesOpen
      ? "files-only"
      : "both-closed";

  return (
    <div className="left-sidebar flex flex-col h-full min-h-0" data-accordion-layout={layoutState}>
      <div className="panel-header left-sidebar-titlebar">
        <span>{title}</span>
        <button
          type="button"
          className="left-sidebar-icon-button"
          onClick={onToggle}
          aria-label={isVisible ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={isVisible}
        >
          <Icon type={isVisible ? "chevron-down" : "chevron-right"} size={12} />
        </button>
      </div>

      <div
        className={`left-sidebar-accordion flex-1 min-h-0 overflow-hidden flex flex-col panel-transition-max-height ${
          isVisible ? "panel-content-visible" : "panel-content-hidden"
        }`}
        aria-hidden={!isVisible}
        hidden={!isVisible}
      >
        <SidebarSection
          title={filesTitle}
          expanded={filesOpen}
          panelId={filesPanelId}
          onToggle={() => setFilesOpen(!filesOpen)}
          className={filesOpen ? "left-sidebar-section--files-open" : ""}
        >
          {children}
        </SidebarSection>

        {hasWorkspaces && (
          <SidebarSection
            title={workspacesTitle}
            expanded={workspacesOpen}
            panelId={workspacesPanelId}
            onToggle={() => setWorkspacesOpen(!workspacesOpen)}
            className={workspacesOpen ? "left-sidebar-section--workspaces-open" : ""}
          >
            {workspaceContent}
          </SidebarSection>
        )}
      </div>
    </div>
  );
}

interface SidebarSectionProps {
  title: string;
  expanded: boolean;
  panelId: string;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}

function SidebarSection({
  title,
  expanded,
  panelId,
  onToggle,
  className = "",
  children,
}: SidebarSectionProps): JSX.Element {
  return (
    <section className={`left-sidebar-section ${className}`} data-expanded={expanded}>
      <h2 className="left-sidebar-section-header">
        <button
          type="button"
          className="left-sidebar-section-toggle"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
        >
          <Icon type={expanded ? "chevron-down" : "chevron-right"} size={12} />
          <span>{title}</span>
        </button>
      </h2>
      <div
        id={panelId}
        className="left-sidebar-section-content"
        hidden={!expanded}
        aria-hidden={!expanded}
      >
        {children}
      </div>
    </section>
  );
}
