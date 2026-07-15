// ---------------------------------------------------------------------------
// @ide/ui – BottomPanel
// Compact dynamic tool-window host for core and contextual project tools.
// ---------------------------------------------------------------------------

import type { KeyboardEvent, ReactNode } from "react";
import { useRef } from "react";
import type { DiagnosticSeverity } from "../diagnostics";

export interface BottomPanelBadgeMetadata {
  /** Visible badge value; use count when the value is numeric. */
  value?: string | number;
  /** Truthful current count for a contextual contribution. */
  count?: number;
  /** Highest severity represented by the count. */
  severity?: DiagnosticSeverity;
  /** Accessible description, for example “3 problems, 2 errors and 1 warning”. */
  ariaLabel?: string;
}

export interface BottomPanelTab {
  /** Unique tab identifier. */
  id: string;
  /** Label displayed in the tool-window header. */
  label: string;
  /** Whether this tab is currently active. */
  isActive: boolean;
  /** Optional presentation icon. */
  icon?: ReactNode;
  /** Optional dynamic badge content and severity metadata. */
  badge?: string | number | BottomPanelBadgeMetadata;
  /** Optional numeric count, used when badge is not supplied. */
  count?: number;
  /** Whether the contribution is always available or project-contextual. */
  scope?: "core" | "project";
  /** Optional tooltip for the contribution. */
  title?: string;
  /** Prevents activation and keyboard focus. */
  disabled?: boolean;
}

export interface BottomPanelProps {
  /** Available contributions in the bottom tool-window host. */
  tabs: BottomPanelTab[];
  /** Called when the user activates an enabled contribution. */
  onTabActivate: (tabId: string) => void;
  /** Child content for the active contribution. */
  children: ReactNode;
  /** Optional actions displayed at the right side of the header. */
  actions?: ReactNode;
}

export function BottomPanel({
  tabs,
  onTabActivate,
  children,
  actions,
}: BottomPanelProps): JSX.Element {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeTab = tabs.find((tab) => tab.isActive);
  const focusableTabIndex = tabs.findIndex((tab) => tab.isActive && !tab.disabled);
  const fallbackFocusableTabIndex = tabs.findIndex((tab) => !tab.disabled);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

    const enabledIndexes = tabs
      .map((tab, tabIndex) => (tab.disabled ? -1 : tabIndex))
      .filter((tabIndex) => tabIndex >= 0);
    if (enabledIndexes.length === 0) return;

    event.preventDefault();
    const position = enabledIndexes.indexOf(index);
    let targetIndex: number;
    if (event.key === "Home") targetIndex = enabledIndexes[0];
    else if (event.key === "End") targetIndex = enabledIndexes[enabledIndexes.length - 1];
    else {
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextPosition =
        (Math.max(position, 0) + direction + enabledIndexes.length) % enabledIndexes.length;
      targetIndex = enabledIndexes[nextPosition];
    }

    tabRefs.current[targetIndex]?.focus();
    onTabActivate(tabs[targetIndex].id);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="panel-header flex min-w-0 shrink-0 items-stretch">
        <div
          aria-label="Tool windows"
          className="flex min-w-0 flex-1 items-stretch gap-0 overflow-x-auto overflow-y-hidden"
          role="tablist"
          aria-orientation="horizontal"
        >
          {tabs.map((tab, index) => {
            const badgeMetadata = typeof tab.badge === "object" ? tab.badge : undefined;
            const badge = badgeMetadata?.value ?? badgeMetadata?.count ?? tab.badge ?? tab.count;
            const badgeAriaLabel =
              badgeMetadata?.ariaLabel ??
              (badge !== undefined && badge !== null ? String(badge) : undefined);
            return (
              <button
                key={tab.id}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                id={`bottom-panel-tab-${tab.id}`}
                type="button"
                className={[
                  "relative inline-flex h-7 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs transition-colors duration-100 focus-visible:z-10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--border-focus)]",
                  tab.isActive
                    ? "border-[var(--tab-active-border)] bg-[var(--tab-active-bg)] font-medium text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--tab-hover-bg)] hover:text-[var(--text-primary)]",
                  tab.disabled
                    ? "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-[var(--text-secondary)]"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={tab.disabled}
                role="tab"
                aria-controls="bottom-panel-content"
                aria-label={badgeAriaLabel ? `${tab.label} ${badgeAriaLabel}` : undefined}
                aria-selected={tab.isActive}
                tabIndex={
                  index === (focusableTabIndex >= 0 ? focusableTabIndex : fallbackFocusableTabIndex)
                    ? 0
                    : -1
                }
                title={tab.title}
                data-scope={tab.scope ?? "core"}
                onClick={() => onTabActivate(tab.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
              >
                {tab.icon !== undefined ? (
                  <span className="flex shrink-0 items-center" aria-hidden="true">
                    {tab.icon}
                  </span>
                ) : null}
                <span>{tab.label}</span>
                {badge !== undefined && badge !== null ? (
                  <span
                    className="min-w-4 rounded-full bg-[var(--input-bg)] px-1 text-center text-[0.65rem] leading-4 text-[var(--text-secondary)]"
                    aria-hidden="true"
                    data-severity={badgeMetadata?.severity}
                  >
                    {String(badge)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {actions ? (
          <div
            className="flex shrink-0 items-center gap-0.5 border-l border-[var(--border-default)] px-1"
            aria-label="Tool window actions"
          >
            {actions}
          </div>
        ) : null}
      </div>

      <div
        id="bottom-panel-content"
        className="flex-1 overflow-hidden"
        role="tabpanel"
        aria-labelledby={activeTab ? `bottom-panel-tab-${activeTab.id}` : undefined}
      >
        {children}
      </div>
    </div>
  );
}
