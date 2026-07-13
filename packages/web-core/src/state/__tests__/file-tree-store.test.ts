// ---------------------------------------------------------------------------
// @ide/web-core – File Tree Store Unit Tests
// ---------------------------------------------------------------------------
// Tests the file-tree Zustand store: root nodes, toggle expand, select file,
// set children, insert/remove nodes, loading flag.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest';
import { createFileTreeStore } from '../file-tree-store';
import type { FileNode, FileTreeStoreSlice } from '../file-tree-store';

// ── Helpers ─────────────────────────────────────────────────────────────

const makeNode = (name: string, type: 'file' | 'folder', children?: FileNode[]): FileNode => ({
  id: `node-${name}`,
  name,
  path: name,
  type,
  ...(children ? { children } : {}),
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('FileTreeStore', () => {
  let store: ReturnType<typeof createFileTreeStore>;

  beforeEach(() => {
    store = createFileTreeStore();
  });

  describe('initial state', () => {
    it('should start with empty rootNodes', () => {
      const state: FileTreeStoreSlice = store.getState();
      expect(state.rootNodes).toEqual([]);
      expect(state.expandedPaths).toBeInstanceOf(Set);
      expect(state.selectedFilePath).toBeNull();
      expect(state.isLoading).toBe(true);
    });
  });

  describe('setRootNodes', () => {
    it('should replace root nodes', () => {
      const nodes = [makeNode('src', 'folder')];
      store.getState().setRootNodes(nodes);
      expect(store.getState().rootNodes).toEqual(nodes);
    });
  });

  describe('toggleExpand', () => {
    it('should add a path to expandedPaths when toggling a collapsed folder', () => {
      const nodes = [makeNode('src', 'folder')];
      store.getState().setRootNodes(nodes);
      store.getState().toggleExpand('src');

      const state = store.getState();
      expect(state.expandedPaths.has('src')).toBe(true);
      expect(state.rootNodes[0].isOpen).toBe(true);
    });

    it('should remove a path from expandedPaths when toggling an expanded folder', () => {
      const nodes = [makeNode('src', 'folder')];
      store.getState().setRootNodes(nodes);
      store.getState().toggleExpand('src');
      store.getState().toggleExpand('src');

      const state = store.getState();
      expect(state.expandedPaths.has('src')).toBe(false);
      expect(state.rootNodes[0].isOpen).toBe(false);
    });

    it('should handle nested folders', () => {
      // Child nodes must have full paths for toggleExpand to match
      const childNode: FileNode = {
        id: 'node-lib',
        name: 'lib',
        path: 'src/lib',
        type: 'folder',
      };
      const nodes = [{
        ...makeNode('src', 'folder', [childNode]),
        isOpen: false,
      }];
      store.getState().setRootNodes(nodes);
      store.getState().toggleExpand('src/lib');

      const state = store.getState();
      expect(state.expandedPaths.has('src/lib')).toBe(true);
      expect(state.rootNodes[0].children![0].isOpen).toBe(true);
    });
  });

  describe('setSelectedFilePath', () => {
    it('should set selected file path', () => {
      store.getState().setSelectedFilePath('src/main.ts');
      expect(store.getState().selectedFilePath).toBe('src/main.ts');
    });

    it('should set to null when passed null', () => {
      store.getState().setSelectedFilePath('src/main.ts');
      store.getState().setSelectedFilePath(null);
      expect(store.getState().selectedFilePath).toBeNull();
    });
  });

  describe('setChildren', () => {
    it('should set children for a folder node', () => {
      const children = [makeNode('main.ts', 'file')];
      const nodes = [makeNode('src', 'folder')];
      store.getState().setRootNodes(nodes);
      store.getState().setChildren('src', children);

      expect(store.getState().rootNodes[0].children).toEqual(children);
    });

    it('should not affect other folders', () => {
      const nodes = [
        makeNode('src', 'folder'),
        makeNode('lib', 'folder'),
      ];
      store.getState().setRootNodes(nodes);
      store.getState().setChildren('src', [makeNode('main.ts', 'file')]);

      expect(store.getState().rootNodes[1].children).toBeUndefined();
    });
  });

  describe('setLoading', () => {
    it('should update loading flag', () => {
      store.getState().setLoading(false);
      expect(store.getState().isLoading).toBe(false);
      store.getState().setLoading(true);
      expect(store.getState().isLoading).toBe(true);
    });
  });

  describe('insertNode', () => {
    it('should insert a node into a folder', () => {
      const nodes = [makeNode('src', 'folder')];
      store.getState().setRootNodes(nodes);
      store.getState().insertNode('src', makeNode('new.ts', 'file'));

      const root = store.getState().rootNodes[0];
      expect(root.children).toHaveLength(1);
      expect(root.children![0].name).toBe('new.ts');
    });

    it('should append to existing children', () => {
      const nodes = [{
        ...makeNode('src', 'folder', [makeNode('a.ts', 'file')]),
      }];
      store.getState().setRootNodes(nodes);
      store.getState().insertNode('src', makeNode('b.ts', 'file'));

      const root = store.getState().rootNodes[0];
      expect(root.children).toHaveLength(2);
      expect(root.children![1].name).toBe('b.ts');
    });
  });

  describe('removeNode', () => {
    it('should remove a node at root level', () => {
      const nodes = [
        makeNode('src', 'folder'),
        makeNode('readme.md', 'file'),
      ];
      store.getState().setRootNodes(nodes);
      store.getState().removeNode('readme.md');

      expect(store.getState().rootNodes).toHaveLength(1);
      expect(store.getState().rootNodes[0].name).toBe('src');
    });

    it('should remove a nested node', () => {
      const childNode: FileNode = {
        id: 'node-main.ts',
        name: 'main.ts',
        path: 'src/main.ts',
        type: 'file',
      };
      const nodes = [{
        ...makeNode('src', 'folder', [childNode]),
      }];
      store.getState().setRootNodes(nodes);
      store.getState().removeNode('src/main.ts');

      expect(store.getState().rootNodes[0].children).toHaveLength(0);
    });
  });
});
