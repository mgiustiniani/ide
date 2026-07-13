// ---------------------------------------------------------------------------
// @ide/web-core – Panel Store Unit Tests
// ---------------------------------------------------------------------------
// Tests the panel layout Zustand store: toggle visibility, set visibility,
// set active panel, resize, reset.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest';
import { createPanelStore } from '../panel-store';
import type { PanelStoreSlice, PanelId } from '../panel-store';
import { DEFAULT_PANEL_LAYOUT } from '@ide/contracts';

// ── Tests ───────────────────────────────────────────────────────────────

describe('PanelStore', () => {
  let store: ReturnType<typeof createPanelStore>;

  beforeEach(() => {
    store = createPanelStore();
  });

  describe('initial state', () => {
    it('should start with default layout', () => {
      const state: PanelStoreSlice = store.getState();
      expect(state.layout).toEqual(DEFAULT_PANEL_LAYOUT);
    });
  });

  describe('toggleVisibility', () => {
    it('should toggle leftSidebar visibility', () => {
      store.getState().toggleVisibility('leftSidebar');
      expect(store.getState().layout.visibility.leftSidebar.visible).toBe(false);

      store.getState().toggleVisibility('leftSidebar');
      expect(store.getState().layout.visibility.leftSidebar.visible).toBe(true);
    });

    it('should toggle bottomPanel visibility', () => {
      store.getState().toggleVisibility('bottomPanel');
      expect(store.getState().layout.visibility.bottomPanel.visible).toBe(false);

      store.getState().toggleVisibility('bottomPanel');
      expect(store.getState().layout.visibility.bottomPanel.visible).toBe(true);
    });

    it('should not affect mainArea visibility', () => {
      store.getState().toggleVisibility('leftSidebar');
      expect(store.getState().layout.visibility.mainArea.visible).toBe(true);
    });
  });

  describe('setVisibility', () => {
    it('should set visibility explicitly', () => {
      store.getState().setVisibility('bottomPanel', false);
      expect(store.getState().layout.visibility.bottomPanel.visible).toBe(false);
    });

    it('should keep other panels unchanged', () => {
      store.getState().setVisibility('leftSidebar', false);
      expect(store.getState().layout.visibility.mainArea.visible).toBe(true);
      expect(store.getState().layout.visibility.bottomPanel.visible).toBe(true);
    });
  });

  describe('setActivePanel', () => {
    it('should set the given panel as active and deactivate others', () => {
      store.getState().setActivePanel('leftSidebar');

      const vis = store.getState().layout.visibility;
      expect(vis.leftSidebar.active).toBe(true);
      expect(vis.mainArea.active).toBe(false);
      expect(vis.bottomPanel.active).toBe(false);
    });

    it('should set mainArea as active', () => {
      store.getState().setActivePanel('mainArea');
      expect(store.getState().layout.visibility.mainArea.active).toBe(true);
    });

    it('should set bottomPanel as active', () => {
      store.getState().setActivePanel('bottomPanel');
      expect(store.getState().layout.visibility.bottomPanel.active).toBe(true);
    });
  });

  describe('setLeftSidebarWidth', () => {
    it('should update left sidebar width', () => {
      store.getState().setLeftSidebarWidth(300);
      expect(store.getState().layout.sizes.leftSidebarWidth).toBe(300);
    });

    it('should enforce minimum width', () => {
      store.getState().setLeftSidebarWidth(50);
      expect(store.getState().layout.sizes.leftSidebarWidth).toBe(220);
    });

    it('should not affect bottom panel height', () => {
      store.getState().setLeftSidebarWidth(400);
      expect(store.getState().layout.sizes.bottomPanelHeight).toBe(300);
    });
  });

  describe('setBottomPanelHeight', () => {
    it('should update bottom panel height', () => {
      store.getState().setBottomPanelHeight(340);
      expect(store.getState().layout.sizes.bottomPanelHeight).toBe(340);
    });

    it('should enforce minimum height', () => {
      store.getState().setBottomPanelHeight(10);
      expect(store.getState().layout.sizes.bottomPanelHeight).toBe(120);
    });
  });

  describe('resetLayout', () => {
    it('should reset to default layout', () => {
      store.getState().setLeftSidebarWidth(500);
      store.getState().setBottomPanelHeight(500);
      store.getState().toggleVisibility('leftSidebar');
      store.getState().resetLayout();

      expect(store.getState().layout).toEqual(DEFAULT_PANEL_LAYOUT);
    });
  });
});
