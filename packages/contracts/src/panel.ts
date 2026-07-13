// ---------------------------------------------------------------------------
// @ide/contracts – Panel Layout Types
// ---------------------------------------------------------------------------
// Shared types describing the three‑panel IDE layout.

/** Identifies one of the three IDE panels. */
export type PanelId = 'leftSidebar' | 'mainArea' | 'bottomPanel';

/** Visibility state for a single panel. */
export interface PanelVisibility {
  /** Whether the panel is visible. */
  visible: boolean;
  /** Whether the panel is the currently focused / active panel. */
  active: boolean;
}

/** Size information for a panel (in pixels or CSS‑compatible unit). */
export interface PanelSize {
  /** Width of the left sidebar (pixels). */
  leftSidebarWidth: number;
  /** Height of the bottom panel (pixels). */
  bottomPanelHeight: number;
}

/** The overall panel layout of the IDE. */
export interface PanelLayout {
  /** Visibility and focus for each panel. */
  visibility: Record<PanelId, PanelVisibility>;
  /** Current sizes. */
  sizes: PanelSize;
  /** Minimum sizes to enforce during resizing. */
  minSizes: PanelSize;
}

/** Default panel layout values. */
export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  visibility: {
    leftSidebar: { visible: true, active: false },
    mainArea: { visible: true, active: true },
    bottomPanel: { visible: true, active: false },
  },
  sizes: {
    leftSidebarWidth: 320,
    bottomPanelHeight: 300,
  },
  minSizes: {
    leftSidebarWidth: 220,
    bottomPanelHeight: 120,
  },
};
