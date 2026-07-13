// ---------------------------------------------------------------------------
// @ide/web-core – Panel Layout Store (Zustand)
// ---------------------------------------------------------------------------
// Manages the three‑panel layout: visibility, sizes, active panel.

import { create } from 'zustand';
import type { PanelLayout, PanelId } from '@ide/contracts';
import { DEFAULT_PANEL_LAYOUT } from '@ide/contracts';

/** Slice of the store exposed to consumers. */
export interface PanelStoreSlice {
  /** Current layout configuration. */
  layout: PanelLayout;

  // ── Actions ────────────────────────────────────────────────────────

  /** Toggle visibility of a panel. */
  toggleVisibility(panel: PanelId): void;
  /** Set visibility of a panel explicitly. */
  setVisibility(panel: PanelId, visible: boolean): void;
  /** Set the active / focused panel. */
  setActivePanel(panel: PanelId): void;
  /** Update left sidebar width. */
  setLeftSidebarWidth(width: number): void;
  /** Update bottom panel height. */
  setBottomPanelHeight(height: number): void;
  /** Reset layout to defaults. */
  resetLayout(): void;
}

export type PanelStore = PanelStoreSlice;

export type { PanelId } from '@ide/contracts';

export function createPanelStore() {
  return create<PanelStoreSlice>((set) => ({
    layout: { ...DEFAULT_PANEL_LAYOUT },

    toggleVisibility(panel: PanelId) {
      set((state) => ({
        layout: {
          ...state.layout,
          visibility: {
            ...state.layout.visibility,
            [panel]: {
              ...state.layout.visibility[panel],
              visible: !state.layout.visibility[panel].visible,
            },
          },
        },
      }));
    },

    setVisibility(panel: PanelId, visible: boolean) {
      set((state) => ({
        layout: {
          ...state.layout,
          visibility: {
            ...state.layout.visibility,
            [panel]: {
              ...state.layout.visibility[panel],
              visible,
            },
          },
        },
      }));
    },

    setActivePanel(panel: PanelId) {
      set((state) => {
        const visibility = { ...state.layout.visibility };
        for (const key in visibility) {
          const id = key as PanelId;
          visibility[id] = { ...visibility[id], active: id === panel };
        }
        return {
          layout: { ...state.layout, visibility },
        };
      });
    },

    setLeftSidebarWidth(width: number) {
      set((state) => ({
        layout: {
          ...state.layout,
          sizes: {
            ...state.layout.sizes,
            leftSidebarWidth: Math.max(
              width,
              state.layout.minSizes.leftSidebarWidth,
            ),
          },
        },
      }));
    },

    setBottomPanelHeight(height: number) {
      set((state) => ({
        layout: {
          ...state.layout,
          sizes: {
            ...state.layout.sizes,
            bottomPanelHeight: Math.max(
              height,
              state.layout.minSizes.bottomPanelHeight,
            ),
          },
        },
      }));
    },

    resetLayout() {
      set({ layout: { ...DEFAULT_PANEL_LAYOUT } });
    },
  }));
}
