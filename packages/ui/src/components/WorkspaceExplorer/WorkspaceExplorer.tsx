// ---------------------------------------------------------------------------
// @ide/ui – WorkspaceExplorer
// Presentation-only workspace switcher for use in compact IDE sidebars.
// ---------------------------------------------------------------------------

import type { WorkspaceInfo, WorkspaceRegistry } from '@ide/contracts';

export interface WorkspaceExplorerProps {
  /** Registered workspaces. `workspaceRegistry` is accepted as a descriptive alias. */
  registry?: WorkspaceRegistry | null;
  workspaceRegistry?: WorkspaceRegistry | null;
  /** Current workspace. An explicit ID takes precedence over both other sources. */
  currentWorkspaceId?: string | null;
  currentWorkspace?: WorkspaceInfo | null;
  /** Called with the exact stable ID of the selected workspace. */
  onSwitchWorkspace?: (workspaceId: string) => void;
  /** Optional alias for onSwitchWorkspace. */
  onWorkspaceSwitch?: (workspaceId: string) => void;
  /** Optional registry refresh action. */
  onRefresh?: () => void;
  isLoading?: boolean;
  /** Disables switching and refresh actions. */
  disabled?: boolean;
  /** Indicates that a switch is in progress. */
  isSwitching?: boolean;
  /** Identifies the row currently switching, when available. */
  switchingWorkspaceId?: string | null;
  error?: string | Error | null;
  /** Accessible label for the selectable workspace list. */
  ariaLabel?: string;
}

export function WorkspaceExplorer({
  registry,
  workspaceRegistry,
  currentWorkspaceId,
  currentWorkspace,
  onSwitchWorkspace,
  onWorkspaceSwitch,
  onRefresh,
  isLoading = false,
  disabled = false,
  isSwitching = false,
  switchingWorkspaceId = null,
  error = null,
  ariaLabel = 'Registered workspaces',
}: WorkspaceExplorerProps): JSX.Element {
  const resolvedRegistry = registry ?? workspaceRegistry;
  const workspaces = resolvedRegistry?.workspaces ?? [];
  const activeId = currentWorkspaceId ?? currentWorkspace?.id ?? resolvedRegistry?.currentWorkspaceId ?? null;
  const switchWorkspace = onSwitchWorkspace ?? onWorkspaceSwitch;
  const actionsDisabled = disabled || isLoading || isSwitching || switchingWorkspaceId !== null;
  const errorMessage = error instanceof Error ? error.message : error;

  return (
    <div className="workspace-explorer" aria-busy={isLoading || isSwitching || switchingWorkspaceId !== null}>
      {onRefresh && (
        <div className="workspace-explorer-toolbar">
          <button
            type="button"
            className="workspace-explorer-refresh"
            onClick={onRefresh}
            disabled={actionsDisabled}
          >
            Refresh
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="workspace-explorer-message workspace-explorer-error" role="alert">
          {errorMessage}
        </div>
      )}

      {isLoading && (
        <div className="workspace-explorer-message" role="status" aria-live="polite">
          Loading workspaces…
        </div>
      )}

      {!isLoading && workspaces.length === 0 && (
        <div className="workspace-explorer-message" role="status">
          No registered workspaces
        </div>
      )}

      {workspaces.length > 0 && (
        <div className="workspace-explorer-list" role="listbox" aria-label={ariaLabel}>
          {workspaces.map((workspace) => {
            const isCurrent = workspace.id === activeId;
            const isRowSwitching = workspace.id === switchingWorkspaceId;
            const rowDisabled = actionsDisabled || isCurrent || switchWorkspace === undefined;
            return (
              <button
                key={workspace.id}
                type="button"
                role="option"
                aria-selected={isCurrent}
                aria-disabled={rowDisabled}
                className={`workspace-explorer-row ${isCurrent ? 'workspace-explorer-row--current' : ''}`}
                disabled={rowDisabled}
                onClick={() => switchWorkspace?.(workspace.id)}
                title={`${workspace.name}\n${workspace.rootPath}`}
              >
                <span className="workspace-explorer-row-main">
                  <span className="workspace-explorer-name">{workspace.name}</span>
                  {isCurrent && <span className="workspace-explorer-current">Current</span>}
                  {isRowSwitching && <span className="workspace-explorer-switching">Switching…</span>}
                </span>
                <span className="workspace-explorer-path" title={workspace.rootPath}>
                  {compactWorkspacePath(workspace.rootPath)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {(isSwitching || switchingWorkspaceId !== null) && (
        <div className="sr-only" role="status" aria-live="polite">
          Switching workspace…
        </div>
      )}
    </div>
  );
}

/** Keep paths useful while avoiding a full home/machine path in the sidebar. */
export function compactWorkspacePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 2) return normalized || path;
  return `…/${segments.slice(-2).join('/')}`;
}
